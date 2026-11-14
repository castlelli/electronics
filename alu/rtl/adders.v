// Gate-level adders for the parameterized ALU.
// Every adder has the same ports: s = a + b + cin (mod 2^W), cout = carry out of bit W-1.
// The structure here mirrors docs/alu/js/netlist.js, which the website uses to count gates
// and time paths; the Verilog is the functional reference checked by the testbenches.

module full_adder (input a, input b, input cin, output s, output cout);
    wire p = a ^ b;
    assign s    = p ^ cin;
    assign cout = (a & b) | (cin & p);
endmodule

// Ripple carry: one full adder per bit, the carry walks through all W of them.
module adder_ripple #(parameter W = 8) (
    input  [W-1:0] a, b,
    input          cin,
    output [W-1:0] s,
    output         cout
);
    wire [W:0] c;
    assign c[0] = cin;
    genvar i;
    generate
        for (i = 0; i < W; i = i + 1) begin : bit_
            full_adder fa (.a(a[i]), .b(b[i]), .cin(c[i]), .s(s[i]), .cout(c[i+1]));
        end
    endgenerate
    assign cout = c[W];
endmodule

// Carry lookahead in 4-bit blocks. Inside a block the group generate/propagate terms do not
// depend on the incoming carry, so each block passes its carry on in two gate levels
// (c_out = G | P & c_in) instead of four full adders.
module adder_cla4 #(parameter W = 8) (
    input  [W-1:0] a, b,
    input          cin,
    output [W-1:0] s,
    output         cout
);
    wire [W-1:0] g = a & b;
    wire [W-1:0] p = a ^ b;
    wire [W-1:0] gg, pp;          // group terms from the block's first bit up to bit i
    wire [W:0]   c;
    assign c[0] = cin;
    genvar i;
    generate
        for (i = 0; i < W; i = i + 1) begin : bit_
            if (i % 4 == 0) begin : first
                assign gg[i] = g[i];
                assign pp[i] = p[i];
            end else begin : rest
                assign gg[i] = g[i] | (p[i] & gg[i-1]);
                assign pp[i] = p[i] & pp[i-1];
            end
            assign c[i+1] = gg[i] | (pp[i] & c[i - i % 4]);
        end
    endgenerate
    assign s    = p ^ c[W-1:0];
    assign cout = c[W];
endmodule

// Carry select with growing blocks (2, 3, 4, ...): each block after the first computes its
// sum twice, for carry-in 0 and 1, and a mux picks one when the real carry arrives.
// The delay grows like sqrt(W).
module adder_select #(parameter W = 8) (
    input  [W-1:0] a, b,
    input          cin,
    output [W-1:0] s,
    output         cout
);
    function integer block_start;   // first bit of block k
        input integer k;
        integer j, start;
        begin
            start = 0;
            for (j = 0; j < k; j = j + 1) start = start + j + 2;
            block_start = start;
        end
    endfunction
    function integer block_size;
        input integer k;
        integer start;
        begin
            start = block_start(k);
            block_size = (start + k + 2 > W) ? W - start : k + 2;
        end
    endfunction

    wire [W:0] c;                   // c[i] is the carry into bit i (only block edges are used)
    assign c[0] = cin;
    genvar k;
    generate
        for (k = 0; block_start(k) < W; k = k + 1) begin : blk
            localparam integer LO = block_start(k);
            localparam integer N  = block_size(k);
            if (k == 0) begin : plain
                adder_ripple #(.W(N)) add (.a(a[LO+N-1:LO]), .b(b[LO+N-1:LO]), .cin(c[LO]),
                                           .s(s[LO+N-1:LO]), .cout(c[LO+N]));
            end else begin : dual
                wire [N-1:0] s0, s1;
                wire c0, c1;
                adder_ripple #(.W(N)) add0 (.a(a[LO+N-1:LO]), .b(b[LO+N-1:LO]), .cin(1'b0),
                                            .s(s0), .cout(c0));
                adder_ripple #(.W(N)) add1 (.a(a[LO+N-1:LO]), .b(b[LO+N-1:LO]), .cin(1'b1),
                                            .s(s1), .cout(c1));
                assign s[LO+N-1:LO] = c[LO] ? s1 : s0;
                assign c[LO+N]      = c[LO] ? c1 : c0;
            end
        end
    endgenerate
    assign cout = c[W];
endmodule

// Parallel prefix adders. Bit i starts with (g_i, p_i); the carry-in is folded into bit 0.
// The black cell (G, P) o (G', P') = (G | P & G', P & P') merges two spans.
// KOGGE: log2(W) levels, a cell at every bit on every level (fast, many gates and wires).
// BRENT: an up-sweep and a down-sweep, 2 log2(W) - 1 levels, about 2W cells (small, slower).
module adder_prefix #(parameter W = 8, parameter KIND = "KOGGE") (
    input  [W-1:0] a, b,
    input          cin,
    output [W-1:0] s,
    output         cout
);
    localparam integer L      = (W <= 1) ? 1 : $clog2(W);
    localparam integer LEVELS = (KIND == "KOGGE") ? L : 2 * L - 1;

    wire [W-1:0] g = a & b;
    wire [W-1:0] p = a ^ b;
    wire [W-1:0] G [0:LEVELS];
    wire [W-1:0] P [0:LEVELS];

    assign G[0] = {g[W-1:1], g[0] | (p[0] & cin)};
    assign P[0] = p;

    genvar lv, i;
    generate
        for (lv = 0; lv < LEVELS; lv = lv + 1) begin : level
            for (i = 0; i < W; i = i + 1) begin : node
                // Which earlier bit (if any) does node i combine with on this level?
                localparam integer UP   = lv;                    // up-sweep step for BRENT
                localparam integer DOWN = 2 * L - 2 - lv;        // down-sweep step for BRENT
                localparam integer D = (KIND == "KOGGE") ? (1 << lv)
                                     : (lv < L) ? (1 << UP) : (1 << DOWN);
                localparam integer HIT = (KIND == "KOGGE") ? (i >= D)
                                     : (lv < L) ? (((i + 1) % (2 * D)) == 0)
                                     : ((((i + 1) % (2 * D)) == D) && (i >= 3 * D - 1));
                if (HIT) begin : merge
                    assign G[lv+1][i] = G[lv][i] | (P[lv][i] & G[lv][i-D]);
                    assign P[lv+1][i] = P[lv][i] & P[lv][i-D];
                end else begin : pass
                    assign G[lv+1][i] = G[lv][i];
                    assign P[lv+1][i] = P[lv][i];
                end
            end
        end
    endgenerate

    wire [W:0] c = {G[LEVELS], cin};
    assign s    = p ^ c[W-1:0];
    assign cout = c[W];
endmodule

// Picks one of the adders above by name.
module adder #(parameter W = 8, parameter ARCH = "RIPPLE") (
    input  [W-1:0] a, b,
    input          cin,
    output [W-1:0] s,
    output         cout
);
    generate
        if (ARCH == "RIPPLE")      adder_ripple #(.W(W)) u (.a(a), .b(b), .cin(cin), .s(s), .cout(cout));
        else if (ARCH == "CLA")    adder_cla4   #(.W(W)) u (.a(a), .b(b), .cin(cin), .s(s), .cout(cout));
        else if (ARCH == "SELECT") adder_select #(.W(W)) u (.a(a), .b(b), .cin(cin), .s(s), .cout(cout));
        else if (ARCH == "BRENT")  adder_prefix #(.W(W), .KIND("BRENT")) u (.a(a), .b(b), .cin(cin), .s(s), .cout(cout));
        else                       adder_prefix #(.W(W), .KIND("KOGGE")) u (.a(a), .b(b), .cin(cin), .s(s), .cout(cout));
    endgenerate
endmodule
