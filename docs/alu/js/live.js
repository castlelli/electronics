// Section 1: the original 8-bit ALU, evaluated gate by gate, with a block schematic whose
// active path lights up for the chosen operation.
import { t } from "./i18n.js";
import { buildAlu, evaluate, getWord } from "./netlist.js";
import { h, s, segmented, hex, signedOf } from "./ui.js";

const W = 8;
const net = buildAlu({}); // the original design
export const liveState = { A: 0x64, B: 0x32, op: 0, previous: { A: 0, B: 0, op: 0 } };
const listeners = new Set();
export const onLive = (fn) => listeners.add(fn);

// Block diagram geometry (viewBox 900 x 400).
const BLOCKS = {
  inv: { x: 110, y: 110, w: 100, h: 40 },
  adder: { x: 260, y: 40, w: 130, h: 130 },
  shift: { x: 260, y: 190, w: 130, h: 50 },
  par: { x: 260, y: 255, w: 130, h: 40 },
  absA: { x: 110, y: 312, w: 80, h: 34 },
  absB: { x: 110, y: 354, w: 80, h: 34 },
  cmp: { x: 260, y: 312, w: 130, h: 76 },
};
const WIRES = {
  A_add: "M24 80 H260",
  A_shift: "M70 80 V215 H260",
  A_par: "M70 215 V275 H260",
  A_abs: "M70 275 V329 H110",
  B_inv: "M24 130 H110",
  B_abs: "M50 130 V371 H110",
  inv_add: "M210 130 H260",
  op_sub: "M160 14 V110",
  op_sel: "M160 14 H500 V58",
  add_mux: "M390 90 H470",
  shift_mux: "M390 215 H470",
  mux_out: "M530 145 H640",
  flags_cv: "M390 150 H430 V196 H640",
  par_out: "M390 275 H640",
  absA_cmp: "M190 329 H260",
  absB_cmp: "M190 371 H260",
  cmp_out: "M390 350 H640",
};

let svg;
const nodes = { blocks: {}, wires: {}, labels: {} };

function drawSchematic() {
  svg = document.getElementById("schematic");
  svg.innerHTML = "";
  for (const [key, d] of Object.entries(WIRES)) {
    nodes.wires[key] = s("path", { d, class: "wire" }, svg);
  }
  const label = (key, x, y, anchor = "start", cls = "bus-label") =>
    (nodes.labels[key] = s("text", { x, y, "text-anchor": anchor, class: cls }, svg));

  for (const [key, b] of Object.entries(BLOCKS)) {
    const g = s("g", { class: "blk" }, svg);
    s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 1 }, g);
    s("text", { x: b.x + b.w / 2, y: b.y + b.h / 2 + (b.h > 45 ? -4 : 4), "text-anchor": "middle", text: t.blocks[key] }, g);
    if (b.h > 45) nodes.labels[key + "_val"] = s("text", { x: b.x + b.w / 2, y: b.y + b.h / 2 + 14, "text-anchor": "middle", class: "val" }, g);
    nodes.blocks[key] = g;
  }
  // Result multiplexer as a trapezoid.
  const mux = s("g", { class: "blk" }, svg);
  s("path", { d: "M470 52 L530 72 L530 218 L470 238 Z" }, mux);
  s("text", { x: 500, y: 150, "text-anchor": "middle", text: t.blocks.mux, transform: "rotate(-90 500 146)" }, mux);
  nodes.blocks.mux = mux;

  s("text", { x: 8, y: 84, class: "pin", text: "A" }, svg);
  s("text", { x: 8, y: 134, class: "pin", text: "B" }, svg);
  s("text", { x: 166, y: 12, class: "pin", text: "op" }, svg);
  label("A", 96, 74);
  label("B", 76, 124);
  label("inv", 218, 124);
  label("sum", 398, 84);
  label("shift", 398, 209);
  label("absA", 196, 323);
  label("absB", 196, 365);
  label("op", 186, 30);

  // Outputs on the right.
  s("text", { x: 650, y: 132, class: "bus-label", text: t.readout.result }, svg);
  label("result", 650, 154, "start", "hexval");
  s("text", { x: 650, y: 190, class: "bus-label", text: "C · V" }, svg);
  label("cv", 650, 210, "start", "hexval");
  s("text", { x: 650, y: 268, class: "bus-label", text: `${t.leds.even} · ${t.leds.odd}` }, svg);
  label("par", 650, 288, "start", "hexval");
  s("text", { x: 650, y: 342, class: "bus-label", text: "= ≠ > ≥ < ≤" }, svg);
  label("cmp", 650, 362, "start", "hexval");
}

function wordControl(container, name) {
  container.innerHTML = "";
  const head = h("div", { class: "word-head" }, container);
  h("span", { class: "word-name", text: name }, head);
  const value = h("span", { class: "word-value" }, head);
  const bits = h("div", { class: "bits", role: "group", "aria-label": name }, container);
  const buttons = [];
  for (let i = W - 1; i >= 0; i--) {
    const b = h("button", { type: "button", "aria-label": `${name}${i}`,
      onclick: () => update({ [name]: liveState[name] ^ (1 << i) }) }, bits);
    b.append(document.createTextNode("0"));
    h("span", { text: i }, b);
    buttons[i] = b;
  }
  const tools = h("div", { class: "word-tools" }, container);
  const input = h("input", { type: "text", inputmode: "numeric", "aria-label": `${name}`, spellcheck: "false" }, tools);
  input.addEventListener("change", () => {
    const text = input.value.trim().toLowerCase();
    let v = text.startsWith("0x") ? parseInt(text, 16) : text.startsWith("0b") ? parseInt(text.slice(2), 2) : parseInt(text, 10);
    if (Number.isFinite(v)) update({ [name]: ((v % 256) + 256) % 256 });
    else render();
  });
  h("button", { class: "button", type: "button", text: t.negate, title: "−x",
    onclick: () => update({ [name]: (256 - liveState[name]) & 255 }) }, tools);
  h("button", { class: "button", type: "button", text: t.random,
    onclick: () => update({ [name]: Math.floor(Math.random() * 256) }) }, tools);
  return { value, buttons, input };
}

let words;
let opControl;

function update(patch) {
  liveState.previous = { A: liveState.A, B: liveState.B, op: liveState.op };
  Object.assign(liveState, patch);
  render();
  listeners.forEach((fn) => fn(liveState));
}

function equation(op, res) {
  const sym = ["+", "−", "×", "÷"][op];
  const rhs = (x) => (op <= 1 ? `${x(liveState.B)}` : "2");
  const u = (x) => x;
  const sg = (x) => signedOf(x, W);
  return `<div class="small">${u(liveState.A)} ${sym} ${rhs(u)} = ${res}</div>` +
    `<div class="small">${sg(liveState.A)} ${sym} ${rhs(sg)} = ${sg(res)}</div>`;
}

function render() {
  const r = evaluate(net, liveState.A, liveState.B, liveState.op);
  const v = r.values;
  for (const name of ["A", "B"]) {
    const x = liveState[name];
    const w = words[name];
    w.value.textContent = `0x${hex(x, W)} · ${x} · ${signedOf(x, W) >= 0 ? "+" : ""}${signedOf(x, W)}`;
    w.buttons.forEach((b, i) => {
      const on = (x >> i) & 1;
      b.firstChild.nodeValue = String(on);
      b.setAttribute("aria-pressed", String(!!on));
    });
    if (document.activeElement !== w.input) w.input.value = String(signedOf(x, W));
  }

  const op = liveState.op;
  const arith = op <= 1;
  const on = {
    A_add: arith, inv_add: arith, B_inv: arith, add_mux: arith, flags_cv: arith, op_sub: arith,
    A_shift: !arith, shift_mux: !arith, mux_out: true, op_sel: true,
  };
  const aux = ["A_par", "A_abs", "B_abs", "par_out", "absA_cmp", "absB_cmp", "cmp_out"];
  for (const [key, node] of Object.entries(nodes.wires)) {
    node.classList.toggle("on", !!on[key]);
    node.style.stroke = aux.includes(key) ? "var(--carry)" : "";
    node.style.opacity = aux.includes(key) ? "0.75" : "";
  }
  nodes.blocks.adder.classList.toggle("on", arith);
  nodes.blocks.inv.classList.toggle("on", arith);
  nodes.blocks.adder.classList.toggle("idle", !arith);
  nodes.blocks.inv.classList.toggle("idle", !arith);
  nodes.blocks.shift.classList.toggle("on", !arith);
  nodes.blocks.shift.classList.toggle("idle", arith);
  nodes.blocks.mux.classList.add("on");

  const bx = arith ? (op === 1 ? ~liveState.B & 255 : liveState.B) : liveState.B;
  const sum = Number(getWord(v, net.adder.sum));
  const L = nodes.labels;
  L.A.textContent = "0x" + hex(liveState.A, W);
  L.B.textContent = "0x" + hex(liveState.B, W);
  L.inv.textContent = "0x" + hex(bx, W);
  L.sum.textContent = "0x" + hex(sum, W);
  L.adder_val.textContent = `${t.opNames[op <= 1 ? op : 0]}`;
  L.shift_val.textContent = op === 3 ? "A ÷ 2" : "A × 2";
  const shiftVal = op === 3 ? (liveState.A >> 1) | (liveState.A & 128) : (liveState.A << 1) & 255;
  L.shift.textContent = "0x" + hex(shiftVal, W);
  const absA = net.outputs.absA ? Number(getWord(v, net.outputs.absA)) : 0;
  const absB = net.outputs.absB ? Number(getWord(v, net.outputs.absB)) : 0;
  L.absA.textContent = "0x" + hex(absA, W);
  L.absB.textContent = "0x" + hex(absB, W);
  L.cmp_val.textContent = `${absA} ${r.gt ? ">" : r.eq ? "=" : "<"} ${absB}`;
  L.op.textContent = op.toString(2).padStart(2, "0");
  L.result.textContent = "0x" + hex(r.result, W);
  L.cv.textContent = `${r.carry} · ${r.overflow}`;
  L.par.textContent = `${r.even} · ${r.odd}`;
  L.cmp.textContent = `${r.eq} ${r.ne} ${r.gt} ${r.ge} ${r.lt} ${r.le}`;

  const res = Number(r.result);
  const bin = res.toString(2).padStart(8, "0");
  document.getElementById("live-readout").innerHTML =
    `<div><span class="label">${t.readout.result}</span><div class="big">${bin.slice(0, 4)} ${bin.slice(4)}</div></div>` +
    `<div><span class="label">${t.readout.unsigned}</span><div class="big">${res}</div></div>` +
    `<div><span class="label">${t.readout.signed}</span><div class="big">${signedOf(res, W)}</div></div>` +
    `<div><span class="label">${t.opNames[op]}</span>${equation(op, res)}</div>`;

  const leds = document.getElementById("live-leds");
  leds.innerHTML = "";
  for (const key of ["carry", "overflow", "eq", "ne", "gt", "ge", "lt", "le", "even", "odd"]) {
    h("span", { class: "led" + (r[key] ? " on" : ""), text: t.leds[key] }, leds);
  }
  opControl.set(op);
}

export function initLive() {
  drawSchematic();
  words = {
    A: wordControl(document.querySelector('[data-word="A"]'), "A"),
    B: wordControl(document.querySelector('[data-word="B"]'), "B"),
  };
  opControl = segmented(document.getElementById("live-op"),
    t.ops.map((label, i) => ({ value: i, label, title: t.opNames[i] })), liveState.op, (op) => update({ op }));
  render();
}
