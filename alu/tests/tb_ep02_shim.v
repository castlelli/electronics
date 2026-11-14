// Presents the parameterized ALU with EP02's port names so the original testbench
// (ep02/tb_ula_8bit.v) runs unchanged against the rewrite.
module ula_8bit (
    input  [7:0] A,
    input  [7:0] B,
    input  [1:0] opcode,
    output [7:0] result,
    output carry_out,
    output overflow,
    output A_equal_B,
    output A_not_equal_B,
    output A_greater_B,
    output A_greater_equal_B,
    output A_less_B,
    output A_less_equal_B,
    output even_parity,
    output odd_parity
);
    alu #(.WIDTH(8)) core (
        .A(A), .B(B), .op({1'b0, opcode}),
        .result(result), .carry_out(carry_out), .overflow(overflow),
        .eq(A_equal_B), .ne(A_not_equal_B), .gt(A_greater_B), .ge(A_greater_equal_B),
        .lt(A_less_B), .le(A_less_equal_B), .even(even_parity), .odd(odd_parity)
    );
endmodule
