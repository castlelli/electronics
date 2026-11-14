// Reads vectors (A B op, hex) from vectors.txt and writes the ALU outputs to outputs.txt,
// so the website's gate model can be compared with iverilog (see alu/scripts/golden.py).
module tb_golden;
    parameter WIDTH     = 8;
    parameter ADDER     = "RIPPLE";
    parameter EN_SHIFT  = 1;
    parameter EN_LOGIC  = 0;
    parameter EN_CMP    = 1;
    parameter EN_PARITY = 1;
    parameter CMP_MODE  = "MAGNITUDE";
    parameter CMP_ARCH  = "SERIAL";

    reg  [WIDTH-1:0] A, B;
    reg  [2:0]       op;
    wire [WIDTH-1:0] result;
    wire carry_out, overflow, eq, ne, gt, ge, lt, le, even, odd;

    alu #(.WIDTH(WIDTH), .ADDER(ADDER), .EN_SHIFT(EN_SHIFT), .EN_LOGIC(EN_LOGIC), .EN_CMP(EN_CMP),
          .EN_PARITY(EN_PARITY), .CMP_MODE(CMP_MODE), .CMP_ARCH(CMP_ARCH)) dut (
        .A(A), .B(B), .op(op), .result(result), .carry_out(carry_out), .overflow(overflow),
        .eq(eq), .ne(ne), .gt(gt), .ge(ge), .lt(lt), .le(le), .even(even), .odd(odd));

    integer fin, fout, n;
    initial begin
        fin  = $fopen("vectors.txt", "r");
        fout = $fopen("outputs.txt", "w");
        while (!$feof(fin)) begin
            n = $fscanf(fin, "%h %h %h\n", A, B, op);
            if (n == 3) begin
                #1;
                $fdisplay(fout, "%h %h %0d %h %b %b %b%b%b%b%b%b %b%b",
                          A, B, op, result, carry_out, overflow, eq, ne, gt, ge, lt, le, even, odd);
            end
        end
        $fclose(fin);
        $fclose(fout);
        $finish;
    end
endmodule
