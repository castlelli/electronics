// Checks the website's gate model (docs/alu/js/netlist.js):
//   1. against the behavioural reference for every width 2..64, every adder and option mix;
//   2. against iverilog's outputs in alu/tests/golden.json (written by alu/scripts/golden.py);
//   3. that the timing behaves as theory says (ripple linear, prefix logarithmic);
//   4. that the event-driven simulation settles on the zero-delay answer.
// Run: node alu/tests/parity.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ADDERS, buildAlu, evaluate, reference, analyze, simulate, opEnabled, getWord,
} from "../../docs/alu/js/netlist.js";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let checks = 0;
const fail = (msg) => {
  failures++;
  if (failures < 15) console.log("FAIL " + msg);
};

let seed = 12345;
const rand32 = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return BigInt(seed >>> 0);
};
function randWord(W) {
  const mask = (1n << BigInt(W)) - 1n;
  const pick = Number(rand32() & 7n);
  if (pick === 0) return mask;
  if (pick === 1) return 1n << (rand32() % BigInt(W));
  if (pick === 2) return mask >> 1n;
  if (pick === 3) return mask ^ (mask >> 1n);
  return ((rand32() << 32n) | rand32()) & mask;
}

const KEYS = ["result", "carry", "overflow", "eq", "ne", "gt", "ge", "lt", "le", "even", "odd"];
function compare(cfg, net, A, B, op, expected, tag) {
  const got = evaluate(net, A, B, op);
  checks++;
  for (const k of KEYS) {
    if (BigInt(got[k]) !== BigInt(expected[k])) {
      fail(`${tag} W=${cfg.width} ${cfg.adder} ${JSON.stringify(cfg)} A=${A} B=${B} op=${op}: ${k}=${got[k]} expected ${expected[k]}`);
      return;
    }
  }
}

// 1. model vs reference
const variants = [
  {},
  { logic: true },
  { shift: false },
  { shift: false, logic: true, parity: false },
  { cmp: false },
  { cmpMode: "SIGNED" },
  { cmpMode: "UNSIGNED", cmpArch: "TREE" },
  { cmpMode: "MAGNITUDE", cmpArch: "TREE", logic: true },
];
for (let W = 2; W <= 64; W++) {
  for (const adder of ADDERS) {
    for (const v of variants) {
      const cfg = { width: W, adder, ...v };
      const net = buildAlu(cfg);
      if (W <= 5) {
        for (let A = 0; A < 1 << W; A++)
          for (let B = 0; B < 1 << W; B++)
            for (let op = 0; op < 7; op++)
              if (opEnabled(net.config, op)) compare(net.config, net, A, B, op, reference(cfg, A, B, op), "ref");
      } else {
        for (let k = 0; k < 60; k++) {
          const op = Number(rand32() % 7n);
          if (!opEnabled(net.config, op)) continue;
          const A = randWord(W);
          const B = randWord(W);
          compare(net.config, net, A, B, op, reference(cfg, A, B, op), "ref");
        }
      }
    }
  }
}
console.log(`model vs reference: ${checks} checks`);

// 2. model vs iverilog
const goldenPath = join(here, "golden.json");
if (existsSync(goldenPath)) {
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  let n = 0;
  for (const run of golden.runs) {
    const net = buildAlu(run.config);
    for (const [a, b, op, result, carry, overflow, cmp, par] of run.vectors) {
      const flags = cmp.split("").map(Number);
      const [even, odd] = par.split("").map(Number);
      const expected = {
        result: BigInt("0x" + result), carry, overflow,
        eq: flags[0], ne: flags[1], gt: flags[2], ge: flags[3], lt: flags[4], le: flags[5], even, odd,
      };
      compare(net.config, net, BigInt("0x" + a), BigInt("0x" + b), op, expected, "iverilog");
      n++;
    }
  }
  console.log(`model vs iverilog: ${n} vectors over ${golden.runs.length} configurations`);
} else {
  fail("golden.json missing: run alu/scripts/golden.py");
}

// 3. timing scales as expected (adder path only)
const adderDelay = (adder, width) => analyze(buildAlu({ width, adder })).latest.adder.delay;
for (const adder of ADDERS) {
  const d = [8, 16, 32, 64].map((w) => adderDelay(adder, w));
  console.log(`${adder.padEnd(6)} adder delay at 8/16/32/64 bits: ${d.map((x) => x.toFixed(1)).join(" / ")} tau`);
}
const r = [16, 32, 64].map((w) => adderDelay("RIPPLE", w));
if (!(Math.abs((r[2] - r[1]) - 2 * (r[1] - r[0])) < 1e-9)) fail("ripple delay is not linear in width");
const k = [16, 32, 64].map((w) => adderDelay("KOGGE", w));
if (!(Math.abs((k[2] - k[1]) - (k[1] - k[0])) < 1e-9)) fail("Kogge-Stone delay is not logarithmic in width");
if (!(adderDelay("KOGGE", 64) < adderDelay("BRENT", 64) && adderDelay("BRENT", 64) < adderDelay("CLA", 64)
  && adderDelay("SELECT", 64) < adderDelay("RIPPLE", 64))) fail("adder speed ordering at 64 bits");
const area = (adder) => analyze(buildAlu({ width: 64, adder })).byUnit.adder.transistors;
if (!(area("KOGGE") > area("BRENT") && area("BRENT") > area("RIPPLE"))) fail("adder area ordering at 64 bits");

// 4. event simulation settles to the static answer, and never later than the static bound
for (const adder of ADDERS) {
  for (const W of [8, 24, 64]) {
    const net = buildAlu({ width: W, adder, logic: true });
    const info = analyze(net);
    for (let t = 0; t < 20; t++) {
      const before = { A: randWord(W), B: randWord(W), op: Number(rand32() % 7n) };
      const after = { A: randWord(W), B: randWord(W), op: Number(rand32() % 7n) };
      const sim = simulate(net, before, after);
      const ref = evaluate(net, after.A, after.B, after.op);
      checks++;
      if (getWord(sim.final, net.outputs.result) !== ref.result) fail(`simulate result W=${W} ${adder}`);
      if (sim.settle > info.delay + 1e-9) fail(`simulate settle ${sim.settle} > static ${info.delay}`);
    }
  }
}

// EP02 default: the numbers quoted on the site
const ep02 = analyze(buildAlu({}));
console.log(`EP02 configuration: ${ep02.gates} gates, ${ep02.transistors} transistors, ` +
  `critical path ${ep02.delay} tau through ${ep02.pathUnits.join(" > ")}`);

console.log(failures ? `${failures} failure(s)` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
