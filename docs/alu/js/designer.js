// Section 3: choose what the ALU must do and see the hardware it takes.
import { t, fmt } from "./i18n.js";
import { ADDERS, UNITS, DEFAULT_CONFIG, buildAlu } from "./netlist.js";
import { h, segmented, store, design, onTheme, reducedMotion } from "./ui.js";
import { Floorplan } from "./floorplan.js";

const TAU_PS = 15;
const PRESETS = {
  ep02: { ...DEFAULT_CONFIG },
  fast32: { ...DEFAULT_CONFIG, width: 32, adder: "KOGGE", cmpArch: "TREE", logic: true },
  tiny64: { ...DEFAULT_CONFIG, width: 64, adder: "RIPPLE", shift: false, cmp: false, parity: false },
  all64: { ...DEFAULT_CONFIG, width: 64, adder: "KOGGE", logic: true, cmpArch: "TREE" },
};
const reference = buildAlu({});
const base = design({ ...DEFAULT_CONFIG });

let floor;
let controls = {};
let growing = 0;

function delta(value, ref, lowerIsBetter = true) {
  if (Math.abs(value - ref) < 1e-9) return { text: t.same, cls: "" };
  const ratio = value / ref;
  const text = ratio >= 1.995 || ratio <= 0.5 ? `×${fmt(ratio, ratio < 1 ? 2 : 1)}` : `${ratio > 1 ? "+" : "−"}${fmt(Math.abs(ratio - 1) * 100)}%`;
  const worse = lowerIsBetter ? value > ref : value < ref;
  return { text: t.vsEp02(text), cls: worse ? "up" : "down" };
}

function renderSpecs(info) {
  const b = base.info;
  const fmax = 1000 / (info.delay * TAU_PS); // GHz
  const fmaxRef = 1000 / (b.delay * TAU_PS);
  const items = [
    [t.specs.gates, fmt(info.gates), "", delta(info.gates, b.gates)],
    [t.specs.transistors, fmt(info.transistors), "", delta(info.transistors, b.transistors)],
    [t.specs.delay, fmt(info.delay, info.delay % 1 ? 1 : 0), "τ", delta(info.delay, b.delay)],
    [t.specs.fmax, fmax >= 1 ? fmt(fmax, 2) : fmt(fmax * 1000), fmax >= 1 ? "GHz" : "MHz", delta(fmax, fmaxRef, false)],
  ];
  document.getElementById("d-specs").innerHTML = items
    .map(([label, num, unit, d]) =>
      `<div><span class="label">${label}</span><div class="num">${num}<small>${unit}</small></div><div class="delta ${d.cls}">${d.text}</div></div>`)
    .join("");
}

function renderPath(info) {
  const chips = info.pathUnits
    .map((u) => `<span class="chip" style="background:var(--u-${u})">${t.units[u]}</span>`)
    .join('<span class="arrow">→</span>');
  const hintKey = info.pathUnits.includes("compare") && !info.pathUnits.includes("adder")
    ? (info.pathUnits.includes("abs") ? "abs" : "compare") : "adder";
  const hint = store.config.cmpArch === "TREE" && hintKey !== "adder" ? "" : t.pathHint[hintKey];
  document.getElementById("d-path").innerHTML =
    `${t.pathVia} ${chips} <span style="color:var(--ink-3)">· ${t.pathEnds(t.outputs[info.worst], fmt(info.delay, info.delay % 1 ? 1 : 0))}</span>` +
    (hint ? `<div style="color:var(--crit)">${hint}</div>` : "");
}

function renderBar(info) {
  const bar = document.getElementById("d-bar");
  const keys = document.getElementById("d-bar-keys");
  if (!bar.children.length) {
    for (const u of UNITS) h("div", { style: `background:var(--u-${u});flex-grow:0`, title: t.units[u] }, bar);
  }
  UNITS.forEach((u, i) => (bar.children[i].style.flexGrow = String(info.byUnit[u].transistors)));
  keys.innerHTML = UNITS.filter((u) => info.byUnit[u].gates)
    .map((u) => `<div><i style="background:var(--u-${u})"></i>${t.units[u]}<b>${fmt(info.byUnit[u].transistors)}</b></div>`)
    .join("");
}

function renderTitleBlock(cfg, info) {
  document.getElementById("tb-part").textContent = `ALU-${cfg.width}`;
  document.getElementById("tb-adder").textContent = t.adderShort[cfg.adder];
  document.getElementById("tb-gates").textContent = fmt(info.gates);
  document.getElementById("tb-trans").textContent = fmt(info.transistors);
  document.getElementById("tb-delay").textContent = `${fmt(info.delay, info.delay % 1 ? 1 : 0)} τ`;
  document.getElementById("tb-ops").textContent = String(2 + (cfg.shift ? 2 : 0) + (cfg.logic ? 3 : 0));
}

function renderLegend(net) {
  const present = UNITS.filter((u) => net.gates.some((g) => g.unit === u));
  document.getElementById("floor-legend").innerHTML =
    present.map((u) => `<span><i style="background:var(--u-${u})"></i>${t.units[u]}</span>`).join("") +
    `<span class="crit"><i></i>${t.legendCrit}</span>` +
    `<span><i style="border:1px dashed var(--ink-3);background:none"></i>${t.legendRef}</span>`;
}

function sync(cfg) {
  controls.width.value = String(cfg.width);
  document.getElementById("d-width-out").textContent = t.bits(cfg.width);
  for (const input of controls.adders) input.checked = input.value === cfg.adder;
  controls.shift.checked = cfg.shift;
  controls.logic.checked = cfg.logic;
  controls.cmp.checked = cfg.cmp;
  controls.parity.checked = cfg.parity;
  controls.mode.set(cfg.cmpMode);
  controls.arch.set(cfg.cmpArch);
  document.getElementById("d-cmp-group").style.opacity = cfg.cmp ? "" : "0.4";
  [...controls.mode.buttons, ...controls.arch.buttons].forEach((b) => (b.disabled = !cfg.cmp));
}

function render(cfg) {
  const { net, info } = design(cfg);
  sync(cfg);
  renderSpecs(info);
  renderPath(info);
  renderBar(info);
  renderTitleBlock(cfg, info);
  renderLegend(net);
  floor.set(net, info, reference);
}

export function grow(button) {
  if (growing) return stopGrow();
  const buttons = document.querySelectorAll("#d-grow, #c-grow");
  buttons.forEach((b) => (b.textContent = t.stop));
  let w = 4;
  store.set({ width: w });
  const tick = () => {
    w += w < 16 ? 1 : 2;
    if (w > 64) return stopGrow();
    store.set({ width: w });
    growing = setTimeout(tick, reducedMotion() ? 0 : 110);
  };
  growing = setTimeout(tick, 300);
}
function stopGrow() {
  clearTimeout(growing);
  growing = 0;
  document.querySelectorAll("#d-grow, #c-grow").forEach((b) => (b.textContent = t.grow));
}

export function initDesigner() {
  floor = new Floorplan(document.getElementById("floor"), document.getElementById("floor-tip"));
  controls.width = document.getElementById("d-width");
  controls.width.addEventListener("input", () => { stopGrow(); store.set({ width: Number(controls.width.value) }); });

  const list = document.getElementById("d-adder");
  controls.adders = ADDERS.map((a) => {
    const label = h("label", {}, list);
    const input = h("input", { type: "radio", name: "adder", value: a }, label);
    h("span", { text: t.adders[a][0] }, label);
    h("small", { text: t.adders[a][1] }, label);
    input.addEventListener("change", () => store.set({ adder: a }));
    return input;
  });
  for (const key of ["shift", "logic", "cmp", "parity"]) {
    controls[key] = document.getElementById(`d-${key}`);
    controls[key].addEventListener("change", () => store.set({ [key]: controls[key].checked }));
  }
  controls.mode = segmented(document.getElementById("d-cmp-mode"),
    ["MAGNITUDE", "SIGNED", "UNSIGNED"].map((v) => ({ value: v, label: t.cmpMode[v] })), store.config.cmpMode,
    (v) => store.set({ cmpMode: v }));
  controls.arch = segmented(document.getElementById("d-cmp-arch"),
    ["SERIAL", "TREE"].map((v) => ({ value: v, label: t.cmpArch[v] })), store.config.cmpArch,
    (v) => store.set({ cmpArch: v }));

  const presets = document.getElementById("d-presets");
  for (const [key, cfg] of Object.entries(PRESETS)) {
    h("button", { class: "button", type: "button", text: t.presetNames[key],
      onclick: () => { stopGrow(); store.set(cfg); } }, presets);
  }
  document.getElementById("d-grow").addEventListener("click", grow);
  store.subscribe(render);
  onTheme(() => floor.draw(true));
}
