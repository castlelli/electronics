"""Writes alu/tests/golden.json: random vectors run through iverilog for a set of ALU
configurations. alu/tests/parity.mjs checks the website's gate model against them.

Needs iverilog and vvp on PATH (or IVERILOG_BIN). Usage: python alu/scripts/golden.py
"""

import json
import random
import subprocess
import tempfile
from pathlib import Path

from verify import RTL, ROOT, TESTS, quoted, tool

CONFIGS = [
    {"width": 8},
    {"width": 8, "adder": "KOGGE", "logic": True},
    {"width": 12, "adder": "CLA", "cmpMode": "SIGNED"},
    {"width": 16, "adder": "SELECT", "cmpArch": "TREE"},
    {"width": 20, "adder": "BRENT", "shift": False, "logic": True},
    {"width": 32, "adder": "KOGGE", "cmpMode": "UNSIGNED", "cmpArch": "TREE"},
    {"width": 48, "adder": "BRENT", "logic": True, "parity": False},
    {"width": 64, "adder": "RIPPLE", "logic": True},
    {"width": 64, "adder": "KOGGE", "cmpArch": "TREE", "logic": True},
    {"width": 64, "adder": "SELECT", "cmp": False},
]
DEFAULTS = {"adder": "RIPPLE", "shift": True, "logic": False, "cmp": True, "parity": True,
            "cmpMode": "MAGNITUDE", "cmpArch": "SERIAL"}
VECTORS = 200


def params(cfg):
    c = {**DEFAULTS, **cfg}
    return {"WIDTH": c["width"], "ADDER": quoted(c["adder"]), "EN_SHIFT": int(c["shift"]),
            "EN_LOGIC": int(c["logic"]), "EN_CMP": int(c["cmp"]), "EN_PARITY": int(c["parity"]),
            "CMP_MODE": quoted(c["cmpMode"]), "CMP_ARCH": quoted(c["cmpArch"])}


def word(rng, width):
    mask = (1 << width) - 1
    pick = rng.randrange(6)
    if pick == 0:
        return mask
    if pick == 1:
        return 1 << rng.randrange(width)
    if pick == 2:
        return mask >> 1
    return rng.getrandbits(width)


def main():
    rng = random.Random(2026)
    runs = []
    with tempfile.TemporaryDirectory() as tmp:
        for cfg in CONFIGS:
            c = {**DEFAULTS, **cfg}
            ops = [0, 1] + ([2, 3] if c["shift"] else []) + ([4, 5, 6] if c["logic"] else [])
            lines = [f"{word(rng, c['width']):x} {word(rng, c['width']):x} {rng.choice(ops):x}"
                     for _ in range(VECTORS)]
            Path(tmp, "vectors.txt").write_text("\n".join(lines) + "\n")
            cmd = [tool("iverilog"), "-g2012", "-s", "tb_golden", "-o", "sim"]
            for key, value in params(cfg).items():
                cmd += ["-P", f"tb_golden.{key}={value}"]
            cmd += [str(TESTS / "tb_golden.v"), *map(str, RTL)]
            subprocess.run(cmd, check=True, cwd=tmp)
            subprocess.run([tool("vvp"), "-n", "sim"], check=True, cwd=tmp, capture_output=True)
            vectors = []
            for line in Path(tmp, "outputs.txt").read_text().split("\n"):
                if line.strip():
                    a, b, op, result, carry, ovf, cmp, par = line.split()
                    vectors.append([a, b, int(op), result, int(carry), int(ovf), cmp, par])
            runs.append({"config": c, "vectors": vectors})
            print(f"{c['width']:>2}-bit {c['adder']:<6} {len(vectors)} vectors")
    out = TESTS / "golden.json"
    out.write_text(json.dumps({"generator": "alu/scripts/golden.py", "runs": runs}, separators=(",", ":")) + "\n")
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
