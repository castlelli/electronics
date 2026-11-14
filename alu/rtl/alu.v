// Parameterized gate-level ALU, grown from the 8-bit EP02 design (ep02/ula_8bit.v).
//
// Opcodes (3 bits):  000 ADD  001 SUB  010 A*2  011 A/2 (arithmetic)
//                    100 AND  101 OR   110 XOR
// Opcodes of units that are switched off are don't-care, so their decoding costs nothing.
// With the defaults (WIDTH 8, RIPPLE, shifts, MAGNITUDE compare through abs, parity, no logic)
// this is EP02: alu/tests/tb_ep02_shim.v runs the original testbench against it.
//
// Parameters
//   WIDTH      4..64
//   ADDER      "RIPPLE" | "CLA" | "SELECT" | "BRENT" | "KOGGE"
//   EN_SHIFT   A*2 and A/2
//   EN_LOGIC   AND, OR, XOR
//   EN_CMP     comparison flags (otherwise tied to 0)
//   EN_PARITY  parity flags of A (otherwise tied to 0)
//   CMP_MODE   "MAGNITUDE" (|A| vs |B|, as in EP02) | "SIGNED" | "UNSIGNED"
//   CMP_ARCH   "SERIAL" (a chain from bit 0 up, as in EP02) | "TREE" (log2 depth)

module alu #(
    parameter WIDTH     = 8,
    parameter ADDER     = "RIPPLE",
    parameter EN_SHIFT  = 1,
    parameter EN_LOGIC  = 0,
    parameter EN_CMP    = 1,
    parameter EN_PARITY = 1,
    parameter CMP_MODE  = "MAGNITUDE",
    parameter CMP_ARCH  = "SERIAL"
) (
    input  [WIDTH-1:0] A,
    input  [WIDTH-1:0] B,
    input  [2:0]       op,
    output [WIDTH-1:0] result,
    output             carry_out,
    output             overflow,
    output             eq, ne, gt, ge, lt, le,
    output             even, odd
);
    localparam W = WIDTH;

    // Add/subtract: B is inverted by XOR and the carry-in is 1 for SUB (two's complement).
    wire           sub = op[0];
    wire [W-1:0]   bx  = B ^ {W{sub}};
    wire [W-1:0]   sum;
    wire           cout;
    adder #(.W(W), .ARCH(ADDER)) add (.a(A), .b(bx), .cin(sub), .s(sum), .cout(cout));
    wire           ovf = ~(A[W-1] ^ bx[W-1]) & (A[W-1] ^ sum[W-1]);

    // Decoding: one select line per result group.
    wire sel_sum, sel_shl, sel_shr, sel_and, sel_or, sel_xor;
    generate
        if (EN_LOGIC) begin : dec3
            assign sel_sum = EN_SHIFT ? (~op[2] & ~op[1]) : ~op[2];
            assign sel_shl = EN_SHIFT & ~op[2] &  op[1] & ~op[0];
            assign sel_shr = EN_SHIFT & ~op[2] &  op[1] &  op[0];
            assign sel_and =  op[2] & ~op[1] & ~op[0];
            assign sel_or  =  op[2] & ~op[1] &  op[0];
            assign sel_xor =  op[2] &  op[1];
        end else begin : dec2
            assign sel_sum = EN_SHIFT ? ~op[1] : 1'b1;
            assign sel_shl = EN_SHIFT & op[1] & ~op[0];
            assign sel_shr = EN_SHIFT & op[1] &  op[0];
            assign sel_and = 1'b0;
            assign sel_or  = 1'b0;
            assign sel_xor = 1'b0;
        end
    endgenerate

    // Shifts are only wires; logic ops are one gate per bit.
    wire [W-1:0] shl = {A[W-2:0], 1'b0};
    wire [W-1:0] shr = {A[W-1], A[W-1:1]};

    // Result multiplexer as AND-OR: each group is gated by its select line.
    assign result = ({W{sel_sum}} & sum)
                  | ({W{sel_shl}} & shl)
                  | ({W{sel_shr}} & shr)
                  | ({W{sel_and}} & (A & B))
                  | ({W{sel_or}}  & (A | B))
                  | ({W{sel_xor}} & (A ^ B));
    assign carry_out = sel_sum & cout;
    assign overflow  = sel_sum & ovf;

    // Comparison.
    wire [W-1:0] x, y;
    wire         c_eq, c_gt;
    generate
        if (CMP_MODE == "MAGNITUDE") begin : mag
            abs_unit #(.W(W), .ARCH(CMP_ARCH)) abs_a (.a(A), .y(x));
            abs_unit #(.W(W), .ARCH(CMP_ARCH)) abs_b (.a(B), .y(y));
        end else if (CMP_MODE == "SIGNED") begin : sgn
            // Flipping both sign bits turns a signed comparison into an unsigned one.
            assign x = {~A[W-1], A[W-2:0]};
            assign y = {~B[W-1], B[W-2:0]};
        end else begin : uns
            assign x = A;
            assign y = B;
        end
        if (CMP_ARCH == "TREE") comparator_tree   #(.W(W)) cmp (.x(x), .y(y), .eq(c_eq), .gt(c_gt));
        else                    comparator_serial #(.W(W)) cmp (.x(x), .y(y), .eq(c_eq), .gt(c_gt));
    endgenerate

    assign eq = EN_CMP ? c_eq            : 1'b0;
    assign ne = EN_CMP ? ~c_eq           : 1'b0;
    assign gt = EN_CMP ? c_gt            : 1'b0;
    assign ge = EN_CMP ? (c_gt | c_eq)   : 1'b0;
    assign lt = EN_CMP ? ~(c_gt | c_eq)  : 1'b0;
    assign le = EN_CMP ? ~c_gt           : 1'b0;

    // Parity of A.
    wire p_odd;
    parity_tree #(.W(W)) par (.a(A), .odd(p_odd));
    assign odd  = EN_PARITY ? p_odd  : 1'b0;
    assign even = EN_PARITY ? ~p_odd : 1'b0;
endmodule

// |a| in two's complement: invert when negative, then add the sign bit.
// SERIAL increments with a ripple chain (EP02 used a full adder with b = 0);
// TREE computes every carry as an AND-prefix of the inverted bits.
module abs_unit #(parameter W = 8, parameter ARCH = "SERIAL") (
    input  [W-1:0] a,
    output [W-1:0] y
);
    wire         sign = a[W-1];
    wire [W-1:0] v = a ^ {W{sign}};
    wire [W:0]   c;
    assign c[0] = sign;
    genvar i, lv;
    generate
        if (ARCH == "TREE") begin : tree
            localparam integer L = (W <= 1) ? 1 : $clog2(W);
            wire [W-1:0] T [0:L];      // T[L][i] = sign & v[0] & ... & v[i]
            assign T[0] = {v[W-1:1], v[0] & sign};
            for (lv = 0; lv < L; lv = lv + 1) begin : level
                for (i = 0; i < W; i = i + 1) begin : node
                    if (i >= (1 << lv)) begin : merge
                        assign T[lv+1][i] = T[lv][i] & T[lv][i - (1 << lv)];
                    end else begin : pass
                        assign T[lv+1][i] = T[lv][i];
                    end
                end
            end
            assign c[W:1] = T[L];
        end else begin : chain
            for (i = 0; i < W; i = i + 1) begin : bit_
                assign c[i+1] = v[i] & c[i];
            end
        end
        assign y = v ^ c[W-1:0];
    endgenerate
endmodule

// EP02's comparator: eq from all bits equal; gt from a chain running up from bit 0,
// g[i+1] = x_i & ~y_i | same_i & g[i].
module comparator_serial #(parameter W = 8) (
    input  [W-1:0] x, y,
    output         eq, gt
);
    wire [W-1:0] same = ~(x ^ y);
    wire [W:0]   g;
    assign g[0] = 1'b0;
    genvar i;
    generate
        for (i = 0; i < W; i = i + 1) begin : bit_
            assign g[i+1] = (x[i] & ~y[i]) | (same[i] & g[i]);
        end
    endgenerate
    assign eq = &same;
    assign gt = g[W];
endmodule

// Tree comparator: pairs of (eq, gt) merge upward, high half first:
// eq = eq_h & eq_l, gt = gt_h | eq_h & gt_l.
module comparator_tree #(parameter W = 8) (
    input  [W-1:0] x, y,
    output         eq, gt
);
    localparam integer L = (W <= 1) ? 1 : $clog2(W);
    wire [W-1:0] E [0:L];
    wire [W-1:0] G [0:L];
    assign E[0] = ~(x ^ y);
    assign G[0] = x & ~y;
    genvar lv, k;
    generate
        for (lv = 0; lv < L; lv = lv + 1) begin : level
            localparam integer N    = (W + (1 << lv) - 1) >> lv;        // nodes on this level
            localparam integer NEXT = (N + 1) >> 1;
            for (k = 0; k < NEXT; k = k + 1) begin : node
                if (2 * k + 1 < N) begin : merge
                    assign E[lv+1][k] = E[lv][2*k+1] & E[lv][2*k];
                    assign G[lv+1][k] = G[lv][2*k+1] | (E[lv][2*k+1] & G[lv][2*k]);
                end else begin : pass
                    assign E[lv+1][k] = E[lv][2*k];
                    assign G[lv+1][k] = G[lv][2*k];
                end
            end
            if (NEXT < W) begin : pad
                assign E[lv+1][W-1:NEXT] = 0;
                assign G[lv+1][W-1:NEXT] = 0;
            end
        end
    endgenerate
    assign eq = E[L][0];
    assign gt = G[L][0];
endmodule

// XOR tree over the bits of a, paired the same way as the tree comparator.
module parity_tree #(parameter W = 8) (
    input  [W-1:0] a,
    output         odd
);
    localparam integer L = (W <= 1) ? 1 : $clog2(W);
    wire [W-1:0] X [0:L];
    assign X[0] = a;
    genvar lv, k;
    generate
        for (lv = 0; lv < L; lv = lv + 1) begin : level
            localparam integer N    = (W + (1 << lv) - 1) >> lv;
            localparam integer NEXT = (N + 1) >> 1;
            for (k = 0; k < NEXT; k = k + 1) begin : node
                if (2 * k + 1 < N) begin : merge
                    assign X[lv+1][k] = X[lv][2*k+1] ^ X[lv][2*k];
                end else begin : pass
                    assign X[lv+1][k] = X[lv][2*k];
                end
            end
            if (NEXT < W) begin : pad
                assign X[lv+1][W-1:NEXT] = 0;
            end
        end
    endgenerate
    assign odd = X[L][0];
endmodule
