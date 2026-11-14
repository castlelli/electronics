# ALU

A gate-level arithmetic logic unit in Verilog, grown from the fixed 8-bit design in
[`ep02/`](../ep02) into a parameterized one, with a live website:
**https://castlelli.github.io/electronics/alu/** (Portuguese at `/alu/pt/`).

## Hardware (`rtl/`)

`alu.v` is parameterized by:

| Parameter | Values |
|---|---|
| `WIDTH` | 4 to 64 |
| `ADDER` | `RIPPLE`, `CLA` (4-bit lookahead blocks), `SELECT` (growing carry-select blocks), `BRENT` (Brent–Kung), `KOGGE` (Kogge–Stone) |
| `EN_SHIFT`, `EN_LOGIC`, `EN_CMP`, `EN_PARITY` | optional units (×2/÷2, AND/OR/XOR, comparison flags, parity) |
| `CMP_MODE` | `MAGNITUDE` (\|A\| vs \|B\|, as in EP02), `SIGNED`, `UNSIGNED` |
| `CMP_ARCH` | `SERIAL` (chain from bit 0, as in EP02) or `TREE` |

Opcodes: `000` ADD, `001` SUB, `010` A×2, `011` A÷2 (arithmetic), `100` AND, `101` OR, `110` XOR.
Opcodes of disabled units are don't-care. The defaults reproduce EP02.

Every unit is written at gate level (no `+`), and `docs/alu/js/netlist.js` builds the same
structure in the browser, where it is used for evaluation, event-driven timing, gate and
transistor counts, the floorplan and the critical path.

## Checks

```sh
python alu/scripts/verify.py     # original EP02 testbench on the rewrite + 86 configurations
python alu/scripts/golden.py     # iverilog vectors -> alu/tests/golden.json
node alu/tests/parity.mjs        # browser gate model vs reference and vs iverilog
```

The scripts need `iverilog` and `vvp` on `PATH` (or `IVERILOG_BIN` set to their directory).
