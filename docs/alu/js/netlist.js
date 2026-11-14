// Gate-level model of the parameterized ALU. It mirrors alu/rtl/*.v gate for gate, with
// constant folding and dead-gate removal on top (what a synthesis tool would also do).
// Everything on the site comes from here: the live result, the timing simulation, the
// gate and transistor counts, the floorplan and the critical path.

export const ADDERS = ["RIPPLE", "CLA", "SELECT", "BRENT", "KOGGE"];
export const UNITS = ["decode", "invert", "adder", "logic", "abs", "compare", "parity", "mux"];

// Delays in units of tau (roughly one inverter delay) and static CMOS transistor counts.
// These are textbook-style estimates, not a real process.
export const DELAY = { NOT: 1, NAND: 1, NOR: 1, AND: 1.5, OR: 1.5, XOR: 2, XNOR: 2, MUX: 2 };
export const TRANSISTORS = { NOT: 2, NAND: 4, NOR: 4, AND: 6, OR: 6, XOR: 12, XNOR: 12, MUX: 12 };

export const DEFAULT_CONFIG = Object.freeze({
  width: 8,
  adder: "RIPPLE",
  shift: true,
  logic: false,
  cmp: true,
  parity: true,
  cmpMode: "MAGNITUDE", // MAGNITUDE | SIGNED | UNSIGNED
  cmpArch: "SERIAL", // SERIAL | TREE
});

export const OP = { ADD: 0, SUB: 1, SHL: 2, SHR: 3, AND: 4, OR: 5, XOR: 6 };

export function opEnabled(config, op) {
  if (op <= 1) return true;
  if (op <= 3) return config.shift;
  if (op <= 6) return config.logic;
  return false;
}

const FOLDABLE = new Set(["AND", "OR", "XOR", "XNOR", "NAND", "NOR"]);

class Builder {
  constructor() {
    this.gates = [];
    this.netCount = 2; // net 0 is constant 0, net 1 is constant 1
    this.driver = [null, null]; // net -> gate
    this.hash = new Map();
    this.inputs = {};
    this.names = {};
    this.unit = "decode";
    this.bit = -1;
  }

  input(name, width) {
    const ids = [];
    for (let i = 0; i < width; i++) {
      ids.push(this.netCount++);
      this.driver.push(null);
    }
    this.inputs[name] = ids;
    return ids;
  }

  name(label, net) {
    this.names[label] = net;
    return net;
  }

  raw(type, ins) {
    const key = type + ":" + (FOLDABLE.has(type) ? [...ins].sort((x, y) => x - y) : ins).join(",");
    const found = this.hash.get(key);
    if (found !== undefined) return found;
    const out = this.netCount++;
    const gate = { type, ins, out, unit: this.unit, bit: this.bit };
    this.gates.push(gate);
    this.driver.push(gate);
    this.hash.set(key, out);
    return out;
  }

  isNotOf(a, b) {
    const g = this.driver[a];
    return g && g.type === "NOT" && g.ins[0] === b;
  }

  not(a) {
    if (a < 2) return 1 - a;
    const g = this.driver[a];
    if (g && g.type === "NOT") return g.ins[0];
    return this.raw("NOT", [a]);
  }

  and(a, b) {
    if (a === 0 || b === 0) return 0;
    if (a === 1) return b;
    if (b === 1 || a === b) return a;
    if (this.isNotOf(a, b) || this.isNotOf(b, a)) return 0;
    return this.raw("AND", [a, b]);
  }

  or(a, b) {
    if (a === 1 || b === 1) return 1;
    if (a === 0) return b;
    if (b === 0 || a === b) return a;
    if (this.isNotOf(a, b) || this.isNotOf(b, a)) return 1;
    return this.raw("OR", [a, b]);
  }

  xor(a, b) {
    if (a === 0) return b;
    if (b === 0) return a;
    if (a === 1) return this.not(b);
    if (b === 1) return this.not(a);
    if (a === b) return 0;
    return this.raw("XOR", [a, b]);
  }

  xnor(a, b) {
    if (a < 2 || b < 2 || a === b) return this.not(this.xor(a, b));
    return this.raw("XNOR", [a, b]);
  }

  nor(a, b) {
    if (a < 2 || b < 2 || a === b) return this.not(this.or(a, b));
    return this.raw("NOR", [a, b]);
  }

  // s ? b : a
  mux(s, a, b) {
    if (s === 0 || a === b) return a;
    if (s === 1) return b;
    if (a === 0 && b === 1) return s;
    if (a === 1 && b === 0) return this.not(s);
    if (a === 0) return this.and(s, b);
    if (b === 0) return this.and(this.not(s), a);
    return this.raw("MUX", [s, a, b]);
  }

  // Balanced reduction, paired like the Verilog trees (2k+1 with 2k on each level).
  reduce(nets, fn) {
    let level = nets.slice();
    while (level.length > 1) {
      const next = [];
      for (let k = 0; 2 * k < level.length; k++) {
        next.push(2 * k + 1 < level.length ? fn(level[2 * k + 1], level[2 * k]) : level[2 * k]);
      }
      level = next;
    }
    return level[0];
  }

  at(unit, bit) {
    this.unit = unit;
    this.bit = bit;
  }
}

// Pairs (i, j) meaning "node i absorbs node j" on each level of a prefix network.
// Shared by the netlist builder and the network diagram.
export function prefixLevels(kind, W) {
  const L = W <= 1 ? 1 : Math.ceil(Math.log2(W));
  const levels = [];
  if (kind === "KOGGE") {
    for (let lv = 0; lv < L; lv++) {
      const d = 1 << lv;
      const pairs = [];
      for (let i = d; i < W; i++) pairs.push([i, i - d]);
      levels.push(pairs);
    }
  } else if (kind === "BRENT") {
    for (let lv = 0; lv < 2 * L - 1; lv++) {
      const d = lv < L ? 1 << lv : 1 << (2 * L - 2 - lv);
      const pairs = [];
      for (let i = 0; i < W; i++) {
        const hit = lv < L ? (i + 1) % (2 * d) === 0 && i >= d : (i + 1) % (2 * d) === d && i >= 3 * d - 1;
        if (hit) pairs.push([i, i - d]);
      }
      levels.push(pairs);
    }
  } else if (kind === "RIPPLE") {
    for (let i = 1; i < W; i++) levels.push([[i, i - 1]]);
  }
  return levels.filter((pairs) => pairs.length);
}

// Carry-select blocks: [first bit, size], sizes 2, 3, 4, ...
export function selectBlocks(W) {
  const blocks = [];
  for (let start = 0, size = 2; start < W; start += size, size++) blocks.push([start, Math.min(size, W - start)]);
  return blocks;
}

function rippleChain(b, a, x, cin, lo, n, label) {
  const s = [];
  let c = cin;
  for (let i = 0; i < n; i++) {
    b.bit = lo + i;
    const p = b.xor(a[lo + i], x[lo + i]);
    s.push(b.xor(p, c));
    c = b.or(b.and(a[lo + i], x[lo + i]), b.and(c, p));
    if (label !== undefined) b.name(`${label}c${lo + i + 1}`, c);
  }
  return { s, c };
}

function buildAdder(b, arch, a, x, cin) {
  const W = a.length;
  b.unit = "adder";
  if (arch === "RIPPLE") {
    b.name("c0", cin);
    const { s, c } = rippleChain(b, a, x, cin, 0, W, "");
    return { s, cout: c };
  }
  if (arch === "SELECT") {
    const s = new Array(W);
    let c = cin;
    for (const [lo, n] of selectBlocks(W)) {
      if (lo === 0) {
        const r = rippleChain(b, a, x, c, 0, n);
        r.s.forEach((v, i) => (s[i] = v));
        c = r.c;
      } else {
        const r0 = rippleChain(b, a, x, 0, lo, n);
        const r1 = rippleChain(b, a, x, 1, lo, n);
        for (let i = 0; i < n; i++) {
          b.bit = lo + i;
          s[lo + i] = b.mux(c, r0.s[i], r1.s[i]);
        }
        b.bit = lo + n - 1;
        c = b.mux(c, r0.c, r1.c);
      }
      b.name(`c${lo + n}`, c);
    }
    return { s, cout: c };
  }

  const g = [];
  const p = [];
  for (let i = 0; i < W; i++) {
    b.bit = i;
    g.push(b.and(a[i], x[i]));
    p.push(b.xor(a[i], x[i]));
  }
  const c = [cin];
  if (arch === "CLA") {
    let gg, pp;
    for (let i = 0; i < W; i++) {
      b.bit = i;
      if (i % 4 === 0) {
        gg = g[i];
        pp = p[i];
      } else {
        gg = b.or(g[i], b.and(p[i], gg));
        pp = b.and(p[i], pp);
      }
      c.push(b.or(gg, b.and(pp, c[i - (i % 4)])));
    }
  } else {
    let G = g.slice();
    let P = p.slice();
    b.bit = 0;
    G[0] = b.or(g[0], b.and(p[0], cin));
    for (const pairs of prefixLevels(arch, W)) {
      const nG = G.slice();
      const nP = P.slice();
      for (const [i, j] of pairs) {
        b.bit = i;
        nG[i] = b.or(G[i], b.and(P[i], G[j]));
        nP[i] = b.and(P[i], P[j]);
      }
      G = nG;
      P = nP;
    }
    for (let i = 0; i < W; i++) c.push(G[i]);
  }
  const s = [];
  for (let i = 0; i < W; i++) {
    b.bit = i;
    s.push(b.xor(p[i], c[i]));
  }
  c.forEach((net, i) => b.name(`c${i}`, net));
  return { s, cout: c[W] };
}

function buildAbs(b, a, arch) {
  const W = a.length;
  const sign = a[W - 1];
  const v = a.map((bit, i) => {
    b.bit = i;
    return b.xor(bit, sign);
  });
  const c = [sign];
  if (arch === "TREE") {
    let T = v.slice();
    b.bit = 0;
    T[0] = b.and(v[0], sign);
    for (let d = 1; d < W; d *= 2) {
      const n = T.slice();
      for (let i = d; i < W; i++) {
        b.bit = i;
        n[i] = b.and(T[i], T[i - d]);
      }
      T = n;
    }
    for (let i = 0; i < W; i++) c.push(T[i]);
  } else {
    // EP02: a full adder chain with b = 0, which folds down to v_i & c_i.
    for (let i = 0; i < W; i++) {
      b.bit = i;
      c.push(b.or(b.and(v[i], 0), b.and(c[i], v[i])));
    }
  }
  return v.map((bit, i) => {
    b.bit = i;
    return b.xor(bit, c[i]);
  });
}

function buildComparator(b, x, y, arch) {
  const W = x.length;
  const same = x.map((xi, i) => {
    b.bit = i;
    return b.xnor(xi, y[i]);
  });
  if (arch === "TREE") {
    let E = same.slice();
    let G = x.map((xi, i) => {
      b.bit = i;
      return b.and(xi, b.not(y[i]));
    });
    for (let span = 1; E.length > 1; span *= 2) {
      const nE = [];
      const nG = [];
      for (let k = 0; 2 * k < E.length; k++) {
        if (2 * k + 1 < E.length) {
          b.bit = Math.min(W - 1, 2 * k * span + span);
          nE.push(b.and(E[2 * k + 1], E[2 * k]));
          nG.push(b.or(G[2 * k + 1], b.and(E[2 * k + 1], G[2 * k])));
        } else {
          nE.push(E[2 * k]);
          nG.push(G[2 * k]);
        }
      }
      E = nE;
      G = nG;
    }
    return { eq: E[0], gt: G[0] };
  }
  let g = 0;
  for (let i = 0; i < W; i++) {
    b.bit = i;
    g = b.or(b.and(x[i], b.not(y[i])), b.and(same[i], g));
  }
  b.bit = W - 1;
  const eq = reduceAt(b, same, (p, q) => b.and(p, q));
  return { eq, gt: g };
}

// Tree reduction that places each node at the bit in the middle of the span it covers.
function reduceAt(b, nets, fn) {
  const W = nets.length;
  let level = nets.slice();
  for (let span = 1; level.length > 1; span *= 2) {
    const next = [];
    for (let k = 0; 2 * k < level.length; k++) {
      if (2 * k + 1 < level.length) {
        b.bit = Math.min(W - 1, 2 * k * span + span);
        next.push(fn(level[2 * k + 1], level[2 * k]));
      } else next.push(level[2 * k]);
    }
    level = next;
  }
  return level[0];
}

export function normalizeConfig(config) {
  const c = { ...DEFAULT_CONFIG, ...config };
  c.width = Math.max(2, Math.min(64, Math.round(c.width)));
  return c;
}

export function buildAlu(config) {
  const cfg = normalizeConfig(config);
  const W = cfg.width;
  const b = new Builder();
  const A = b.input("A", W);
  const B = b.input("B", W);
  const op = b.input("op", 3);

  // Decoding.
  b.at("decode", -1);
  const n0 = () => b.not(op[0]);
  const n1 = () => b.not(op[1]);
  const n2 = () => b.not(op[2]);
  let sel = { sum: 1, shl: 0, shr: 0, and: 0, or: 0, xor: 0 };
  if (cfg.logic) {
    sel.sum = cfg.shift ? b.and(n2(), n1()) : n2();
    if (cfg.shift) {
      const t = b.and(n2(), op[1]);
      sel.shl = b.and(t, n0());
      sel.shr = b.and(t, op[0]);
    }
    const u = b.and(op[2], n1());
    sel.and = b.and(u, n0());
    sel.or = b.and(u, op[0]);
    sel.xor = b.and(op[2], op[1]);
  } else if (cfg.shift) {
    sel.sum = n1();
    sel.shl = b.and(op[1], n0());
    sel.shr = b.and(op[1], op[0]);
  }

  // Add / subtract.
  const sub = op[0];
  b.unit = "invert";
  const bx = B.map((bit, i) => {
    b.bit = i;
    return b.xor(bit, sub);
  });
  const add = buildAdder(b, cfg.adder, A, bx, sub);
  b.at("adder", W - 1);
  const ovf = b.and(b.xnor(A[W - 1], bx[W - 1]), b.xor(A[W - 1], add.s[W - 1]));
  const sumNets = add.s.slice();
  const coutNet = add.cout;

  // Logic.
  const groups = [[sel.sum, add.s]];
  if (cfg.shift) {
    groups.push([sel.shl, A.map((_, i) => (i === 0 ? 0 : A[i - 1]))]);
    groups.push([sel.shr, A.map((_, i) => (i === W - 1 ? A[W - 1] : A[i + 1]))]);
  }
  if (cfg.logic) {
    b.unit = "logic";
    const andv = A.map((a, i) => ((b.bit = i), b.and(a, B[i])));
    const orv = A.map((a, i) => ((b.bit = i), b.or(a, B[i])));
    const xorv = A.map((a, i) => ((b.bit = i), b.xor(a, B[i])));
    groups.push([sel.and, andv], [sel.or, orv], [sel.xor, xorv]);
  }

  // Result multiplexer (AND-OR).
  b.unit = "mux";
  const result = [];
  for (let i = 0; i < W; i++) {
    b.bit = i;
    const terms = groups.map(([s, v]) => b.and(s, v[i]));
    result.push(b.reduce(terms, (p, q) => b.or(p, q)));
  }
  b.bit = W - 1;
  const carry = b.and(sel.sum, add.cout);
  const overflow = b.and(sel.sum, ovf);

  // Comparison.
  const outputs = { result, carry, overflow };
  if (cfg.cmp) {
    let x = A;
    let y = B;
    if (cfg.cmpMode === "MAGNITUDE") {
      b.unit = "abs";
      x = buildAbs(b, A, cfg.cmpArch);
      y = buildAbs(b, B, cfg.cmpArch);
    } else if (cfg.cmpMode === "SIGNED") {
      b.at("compare", W - 1);
      x = [...A.slice(0, W - 1), b.not(A[W - 1])];
      y = [...B.slice(0, W - 1), b.not(B[W - 1])];
    }
    b.unit = "compare";
    const { eq, gt } = buildComparator(b, x, y, cfg.cmpArch);
    b.at("compare", -1);
    const ge = b.or(gt, eq);
    Object.assign(outputs, { eq, ne: b.not(eq), gt, ge, lt: b.nor(gt, eq), le: b.not(gt) });
    if (cfg.cmpMode === "MAGNITUDE") {
      outputs.absA = x;
      outputs.absB = y;
    }
  } else Object.assign(outputs, { eq: 0, ne: 0, gt: 0, ge: 0, lt: 0, le: 0 });

  if (cfg.parity) {
    b.unit = "parity";
    const odd = reduceAt(b, A, (p, q) => b.xor(p, q));
    b.at("parity", -1);
    outputs.odd = odd;
    outputs.even = b.not(odd);
  } else Object.assign(outputs, { odd: 0, even: 0 });

  // Remove gates that drive nothing (internal taps like absA are not kept alive).
  const live = new Uint8Array(b.netCount);
  const roots = [...result, carry, overflow, outputs.eq, outputs.ne, outputs.gt, outputs.ge,
    outputs.lt, outputs.le, outputs.odd, outputs.even];
  roots.forEach((n) => (live[n] = 1));
  for (let k = b.gates.length - 1; k >= 0; k--) {
    const g = b.gates[k];
    if (live[g.out]) g.ins.forEach((n) => (live[n] = 1));
  }
  const gates = b.gates.filter((g) => live[g.out]);

  return {
    config: cfg,
    width: W,
    netCount: b.netCount,
    gates,
    inputs: b.inputs,
    outputs,
    names: b.names,
    adder: { sum: sumNets, cout: coutNet },
    select: sel,
  };
}

// ---------- evaluation ----------

export function setWord(values, nets, word) {
  let w = BigInt(word);
  for (let i = 0; i < nets.length; i++) {
    values[nets[i]] = Number(w & 1n);
    w >>= 1n;
  }
}

export function getWord(values, nets) {
  let w = 0n;
  for (let i = nets.length - 1; i >= 0; i--) w = (w << 1n) | BigInt(values[nets[i]]);
  return w;
}

export function gateValue(type, v, ins) {
  const a = v[ins[0]];
  const b = ins.length > 1 ? v[ins[1]] : 0;
  switch (type) {
    case "NOT": return a ^ 1;
    case "AND": return a & b;
    case "OR": return a | b;
    case "XOR": return a ^ b;
    case "XNOR": return (a ^ b) ^ 1;
    case "NAND": return (a & b) ^ 1;
    case "NOR": return (a | b) ^ 1;
    case "MUX": return a ? v[ins[2]] : b;
    default: throw new Error("unknown gate " + type);
  }
}

// Zero-delay evaluation; returns the net values and the decoded outputs.
export function evaluate(net, A, B, op) {
  const v = new Uint8Array(net.netCount);
  v[1] = 1;
  setWord(v, net.inputs.A, A);
  setWord(v, net.inputs.B, B);
  setWord(v, net.inputs.op, op);
  for (const g of net.gates) v[g.out] = gateValue(g.type, v, g.ins);
  const o = net.outputs;
  const flag = (n) => v[n];
  return {
    values: v,
    result: getWord(v, o.result),
    carry: flag(o.carry),
    overflow: flag(o.overflow),
    eq: flag(o.eq), ne: flag(o.ne), gt: flag(o.gt), ge: flag(o.ge), lt: flag(o.lt), le: flag(o.le),
    even: flag(o.even), odd: flag(o.odd),
  };
}

// Behavioural reference, independent of the gates.
export function reference(config, A, B, op) {
  const cfg = normalizeConfig(config);
  const W = BigInt(cfg.width);
  const mask = (1n << W) - 1n;
  const top = 1n << (W - 1n);
  A = BigInt(A) & mask;
  B = BigInt(B) & mask;
  let result = 0n;
  let carry = 0;
  let overflow = 0;
  if (op <= 1) {
    const bx = op === 1 ? ~B & mask : B;
    const wide = A + bx + BigInt(op);
    result = wide & mask;
    carry = Number(wide >> W);
    overflow = Number((A & top) === (bx & top) && (result & top) !== (A & top));
  } else if (op === 2) result = (A << 1n) & mask;
  else if (op === 3) result = (A >> 1n) | (A & top);
  else if (op === 4) result = A & B;
  else if (op === 5) result = A | B;
  else result = A ^ B;

  const flags = { eq: 0, ne: 0, gt: 0, ge: 0, lt: 0, le: 0 };
  if (cfg.cmp) {
    let x = A;
    let y = B;
    if (cfg.cmpMode === "MAGNITUDE") {
      x = A & top ? (-A) & mask : A;
      y = B & top ? (-B) & mask : B;
    } else if (cfg.cmpMode === "SIGNED") {
      x = A ^ top;
      y = B ^ top;
    }
    const eq = x === y;
    const gt = x > y;
    Object.assign(flags, { eq: +eq, ne: +!eq, gt: +gt, ge: +(gt || eq), lt: +!(gt || eq), le: +!gt });
  }
  let odd = 0;
  if (cfg.parity) for (let w = A; w; w >>= 1n) odd ^= Number(w & 1n);
  return { result, carry, overflow, ...flags, odd: cfg.parity ? odd : 0, even: cfg.parity ? odd ^ 1 : 0 };
}

// ---------- cost and timing ----------

export function analyze(net) {
  const arrival = new Float64Array(net.netCount);
  const from = new Int32Array(net.netCount).fill(-1); // gate index on the latest input path
  const gates = net.gates;
  for (let k = 0; k < gates.length; k++) {
    const g = gates[k];
    let t = 0;
    let src = -1;
    for (const n of g.ins) {
      if (n >= 2 && (src === -1 || arrival[n] > t)) {
        t = arrival[n];
        src = n;
      }
    }
    arrival[g.out] = t + DELAY[g.type];
    from[g.out] = src;
  }
  const gateOf = new Map(gates.map((g, k) => [g.out, k]));
  const trace = (n) => {
    const path = [];
    while (n >= 2 && gateOf.has(n)) {
      path.push(gateOf.get(n));
      n = from[n];
    }
    return path.reverse();
  };

  const o = net.outputs;
  const groups = {
    result: o.result,
    carry: [o.carry, o.overflow],
    compare: [o.eq, o.ne, o.gt, o.ge, o.lt, o.le],
    parity: [o.even, o.odd],
    adder: [...net.adder.sum, net.adder.cout],
  };
  const latest = {};
  for (const [key, nets] of Object.entries(groups)) {
    let best = -1;
    let at = 0;
    for (const n of nets) if (n >= 2 && arrival[n] >= at) ((at = arrival[n]), (best = n));
    latest[key] = { delay: at, net: best };
  }
  const outputs = ["result", "carry", "compare", "parity"];
  const worst = outputs.reduce((m, key) => (latest[key].delay > latest[m].delay ? key : m), "result");

  const byUnit = Object.fromEntries(UNITS.map((u) => [u, { gates: 0, transistors: 0 }]));
  let transistors = 0;
  for (const g of gates) {
    const t = TRANSISTORS[g.type];
    transistors += t;
    byUnit[g.unit].gates++;
    byUnit[g.unit].transistors += t;
  }
  const path = trace(latest[worst].net);
  const pathUnits = [];
  for (const k of path) {
    const u = gates[k].unit;
    if (pathUnits[pathUnits.length - 1] !== u) pathUnits.push(u);
  }
  return {
    gates: gates.length,
    transistors,
    byUnit,
    delay: latest[worst].delay,
    worst,
    latest,
    path,
    pathUnits,
    adderPath: trace(latest.adder.net),
    arrival,
  };
}

// ---------- event-driven timing simulation ----------

// Applies `after` to a circuit settled at `before` and plays the events with transport delays.
// Times are in tau. Returns per-net transition lists [[t, value], ...] and the settle time.
export function simulate(net, before, after) {
  const settled = evaluate(net, before.A, before.B, before.op).values;
  const v = settled.slice();
  const fanout = Array.from({ length: net.netCount }, () => []);
  net.gates.forEach((g, k) => g.ins.forEach((n) => fanout[n].push(k)));

  const queue = new Map(); // time in half-tau -> Map(net -> value)
  const push = (t, n, val) => {
    if (!queue.has(t)) queue.set(t, new Map());
    queue.get(t).set(n, val);
  };
  const target = new Uint8Array(net.netCount);
  target[1] = 1;
  setWord(target, net.inputs.A, after.A);
  setWord(target, net.inputs.B, after.B);
  setWord(target, net.inputs.op, after.op);
  for (const name of ["A", "B", "op"]) for (const n of net.inputs[name]) if (target[n] !== v[n]) push(0, n, target[n]);

  const changes = new Map();
  let settle = 0;
  let events = 0;
  while (queue.size) {
    const t = Math.min(...queue.keys());
    const batch = queue.get(t);
    queue.delete(t);
    const touched = new Set();
    for (const [n, val] of batch) {
      if (v[n] === val) continue;
      v[n] = val;
      events++;
      if (!changes.has(n)) changes.set(n, []);
      changes.get(n).push([t / 2, val]);
      settle = Math.max(settle, t / 2);
      for (const k of fanout[n]) touched.add(k);
    }
    for (const k of touched) {
      const g = net.gates[k];
      push(t + DELAY[g.type] * 2, g.out, gateValue(g.type, v, g.ins));
    }
    if (events > 2e6) break;
  }
  return { initial: settled, final: v, changes, settle, events };
}
