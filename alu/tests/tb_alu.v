// Self-checking testbench for the parameterized ALU against a behavioural reference.
// Override the parameters from the command line, e.g.
//   iverilog -g2012 -P tb_alu.WIDTH=16 -P tb_alu.ADDER=\"KOGGE\" ...
// WIDTH <= 8 runs every A, B and opcode; wider runs N_RANDOM random vectors plus corner cases.
`timescale 1ns/1ps

module tb_alu;
    parameter WIDTH     = 8;
    parameter ADDER     = "RIPPLE";
    parameter EN_SHIFT  = 1;
    parameter EN_LOGIC  = 1;
    parameter EN_CMP    = 1;
    parameter EN_PARITY = 1;
    parameter CMP_MODE  = "MAGNITUDE";
    parameter CMP_ARCH  = "SERIAL";
    parameter N_RANDOM  = 6000;

    localparam W = WIDTH;
    localparam [63:0] MASK = (W == 64) ? ~64'd0 : ((64'd1 << W) - 1);

    reg  [W-1:0] A, B;
    reg  [2:0]   op;
    wire [W-1:0] result;
    wire carry_out, overflow, eq, ne, gt, ge, lt, le, even, odd;

    alu #(.WIDTH(W), .ADDER(ADDER), .EN_SHIFT(EN_SHIFT), .EN_LOGIC(EN_LOGIC), .EN_CMP(EN_CMP),
          .EN_PARITY(EN_PARITY), .CMP_MODE(CMP_MODE), .CMP_ARCH(CMP_ARCH)) dut (
        .A(A), .B(B), .op(op), .result(result), .carry_out(carry_out), .overflow(overflow),
        .eq(eq), .ne(ne), .gt(gt), .ge(ge), .lt(lt), .le(le), .even(even), .odd(odd));

    integer errors = 0, checks = 0, seed = 1;

    function enabled;
        input [2:0] o;
        enabled = (o <= 3'd1) || (EN_SHIFT && (o == 3'd2 || o == 3'd3))
               || (EN_LOGIC && (o >= 3'd4 && o <= 3'd6));
    endfunction

    // Reference model on 65-bit integers.
    reg [64:0] wide;
    reg [W-1:0] r_exp, bx, xa, xb;
    reg c_exp, v_exp, e_exp, g_exp, odd_exp;

    task check;
        begin
            #1;
            bx = (op == 3'd1) ? ~B : B;
            c_exp = 0; v_exp = 0;
            case (op)
                3'd0, 3'd1: begin
                    wide  = {1'b0, A} + {1'b0, bx} + (op == 3'd1);
                    r_exp = wide[W-1:0];
                    c_exp = wide[W];
                    v_exp = (A[W-1] == bx[W-1]) && (r_exp[W-1] != A[W-1]);
                end
                3'd2: r_exp = {A[W-2:0], 1'b0};
                3'd3: r_exp = {A[W-1], A[W-1:1]};
                3'd4: r_exp = A & B;
                3'd5: r_exp = A | B;
                default: r_exp = A ^ B;
            endcase
            if (CMP_MODE == "MAGNITUDE") begin
                xa = A[W-1] ? -A : A;            // |-2^(W-1)| wraps to 2^(W-1), read as unsigned
                xb = B[W-1] ? -B : B;
            end else if (CMP_MODE == "SIGNED") begin
                xa = A ^ ({{(W-1){1'b0}}, 1'b1} << (W-1));
                xb = B ^ ({{(W-1){1'b0}}, 1'b1} << (W-1));
            end else begin
                xa = A; xb = B;
            end
            e_exp = (xa == xb);
            g_exp = (xa > xb);
            odd_exp = ^A;
            checks = checks + 1;
            if (result !== r_exp || carry_out !== c_exp || overflow !== v_exp
                || (EN_CMP && {eq, ne, gt, ge, lt, le} !== {e_exp, !e_exp, g_exp, g_exp | e_exp, !(g_exp | e_exp), !g_exp})
                || (!EN_CMP && {eq, ne, gt, ge, lt, le} !== 6'b0)
                || (EN_PARITY && {even, odd} !== {!odd_exp, odd_exp})
                || (!EN_PARITY && {even, odd} !== 2'b0)) begin
                if (errors < 8)
                    $display("FAIL A=%h B=%h op=%0d: result=%h c=%b v=%b cmp=%b par=%b, expected result=%h c=%b v=%b eq=%b gt=%b odd=%b",
                             A, B, op, result, carry_out, overflow, {eq, ne, gt, ge, lt, le}, {even, odd},
                             r_exp, c_exp, v_exp, e_exp, g_exp, odd_exp);
                errors = errors + 1;
            end
        end
    endtask

    function [W-1:0] rand_word;
        input integer dummy;
        reg [63:0] r;
        begin
            r = {$random(seed), $random(seed)};
            case ($random(seed) & 7)        // bias towards carry-heavy and edge patterns
                0: r = MASK;
                1: r = 64'd1 << ({$random(seed)} % W);
                2: r = MASK >> 1;
                3: r = ~(MASK >> 1);
                default: ;
            endcase
            rand_word = r[W-1:0];
        end
    endfunction

    integer i, a, b, o;
    initial begin
        if (W <= 8) begin
            for (a = 0; a < (1 << W); a = a + 1)
                for (b = 0; b < (1 << W); b = b + 1)
                    for (o = 0; o < 8; o = o + 1)
                        if (enabled(o)) begin
                            A = a; B = b; op = o; check;
                        end
        end else begin
            for (i = 0; i < N_RANDOM; i = i + 1) begin
                A = rand_word(0); B = rand_word(0);
                op = {$random(seed)} % 7;
                if (enabled(op)) check;
            end
        end
        $display("%s W=%0d ADDER=%0s SHIFT=%0d LOGIC=%0d CMP=%0d/%0s/%0s PARITY=%0d: %0d checks, %0d errors",
                 errors == 0 ? "PASS" : "FAIL", W, ADDER, EN_SHIFT, EN_LOGIC, EN_CMP, CMP_MODE, CMP_ARCH,
                 EN_PARITY, checks, errors);
        $finish;
    end
endmodule
