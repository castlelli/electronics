"""Runs the Verilog checks for the parameterized ALU.

1. The original EP02 testbench (ep02/tb_ula_8bit.v) against the rewrite, through a shim.
2. tb_alu.v over a matrix of widths, adders and options.

Needs iverilog and vvp on PATH (or IVERILOG_BIN pointing at their directory).
Usage: python alu/scripts/verify.py [--quick]
"""

import itertools
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RTL = sorted((ROOT / "alu" / "rtl").glob("*.v"))
TESTS = ROOT / "alu" / "tests"
BIN = os.environ.get("IVERILOG_BIN", "")

ADDERS = ["RIPPLE", "CLA", "SELECT", "BRENT", "KOGGE"]


def tool(name):
    return str(Path(BIN) / name) if BIN else name


def run(sources, params, workdir, top=None):
    out = Path(workdir) / "sim"
    cmd = [tool("iverilog"), "-g2012", "-o", str(out)]
    if top:
        cmd += ["-s", top]
    for key, value in params.items():
        cmd += ["-P", f"{top}.{key}={value}"]
    cmd += [str(s) for s in sources]
    subprocess.run(cmd, check=True, cwd=workdir)
    result = subprocess.run([tool("vvp"), "-n", str(out)], check=True, cwd=workdir,
                            capture_output=True, text=True)
    return result.stdout


def quoted(text):
    return f'"{text}"'


def matrix(quick):
    widths = [4, 8, 13, 16, 32, 64] if not quick else [4, 8, 16, 64]
    for width, adder in itertools.product(widths, ADDERS):
        yield {"WIDTH": width, "ADDER": quoted(adder)}
    for mode, arch in itertools.product(["MAGNITUDE", "SIGNED", "UNSIGNED"], ["SERIAL", "TREE"]):
        for width in ([5, 8, 24, 64] if not quick else [8, 64]):
            yield {"WIDTH": width, "ADDER": quoted("KOGGE"), "CMP_MODE": quoted(mode),
                   "CMP_ARCH": quoted(arch)}
    for shift, logic, cmp, parity in itertools.product([0, 1], repeat=4):
        for width in ([6, 32] if not quick else [6]):
            yield {"WIDTH": width, "ADDER": quoted("SELECT"), "EN_SHIFT": shift, "EN_LOGIC": logic,
                   "EN_CMP": cmp, "EN_PARITY": parity}


def main():
    quick = "--quick" in sys.argv
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        log = run([ROOT / "ep02" / "tb_ula_8bit.v", TESTS / "tb_ep02_shim.v", *RTL], {}, tmp)
        ok = "RESULTADO FINAL: PASSOU" in log
        failures += not ok
        print(("PASS" if ok else "FAIL") + " original EP02 testbench on the rewrite (26 + 262144 cases)")
        for params in matrix(quick):
            log = run([TESTS / "tb_alu.v", *RTL], params, tmp, top="tb_alu")
            line = next((l for l in log.splitlines() if l.startswith(("PASS", "FAIL"))), "FAIL no summary line")
            failures += not line.startswith("PASS")
            print(line)
    print(f"{failures} failing run(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
