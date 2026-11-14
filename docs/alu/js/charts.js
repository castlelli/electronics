// Section 4: delay and transistor count against width, one line per adder, log-log axes.
import { t, fmt } from "./i18n.js";
import { ADDERS } from "./netlist.js";
import { s, segmented, store, design, onTheme } from "./ui.js";
import { grow } from "./designer.js";

export const ADDER_COLOR = { RIPPLE: "--u-abs", CLA: "--u-invert", SELECT: "--u-logic", BRENT: "--u-decode", KOGGE: "--u-compare" };
const WIDTHS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];
const state = { scope: "adder", hidden: new Set() };
const seriesCache = new Map();

function metrics(info) {
  return state.scope === "alu"
    ? { delay: info.delay, area: info.transistors }
    : { delay: info.latest.adder.delay, area: info.byUnit.adder.transistors + info.byUnit.invert.transistors };
}

function series(cfg) {
  const { width, adder, ...rest } = cfg;
  const key = state.scope + JSON.stringify(rest);
  if (seriesCache.has(key)) return seriesCache.get(key);
  const out = {};
  for (const a of ADDERS) out[a] = WIDTHS.map((w) => ({ w, ...metrics(design({ ...rest, width: w, adder: a }).info) }));
  seriesCache.set(key, out);
  return out;
}

function niceLogTicks(min, max) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v);
    }
  }
  return ticks;
}

function drawChart(svg, data, field, title, current) {
  svg.innerHTML = "";
  const Wd = 520;
  const Ht = 330;
  const m = { l: 54, r: 112, t: 40, b: 36 };
  const visible = ADDERS.filter((a) => !state.hidden.has(a));
  const values = visible.flatMap((a) => data[a].map((p) => p[field]));
  values.push(current[field]);
  let lo = Math.min(...values) * 0.85;
  let hi = Math.max(...values) * 1.15;
  const x = (w) => m.l + ((Math.log2(w) - 2) / 4) * (Wd - m.l - m.r);
  const y = (v) => Ht - m.b - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (Ht - m.t - m.b);

  s("text", { x: m.l, y: 18, class: "title", text: title }, svg);
  s("text", { x: m.l, y: 32, class: "sub", text: t.chartSubLog }, svg);
  const grid = s("g", { class: "grid" }, svg);
  const axis = s("g", { class: "axis" }, svg);
  for (const v of niceLogTicks(lo, hi)) {
    s("line", { x1: m.l, x2: Wd - m.r, y1: y(v), y2: y(v) }, grid);
    s("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", text: v >= 10000 ? `${v / 1000}k` : fmt(v) }, axis);
  }
  for (const w of [4, 8, 16, 32, 64]) {
    s("line", { x1: x(w), x2: x(w), y1: m.t, y2: Ht - m.b }, grid);
    s("text", { x: x(w), y: Ht - m.b + 16, "text-anchor": "middle", text: w }, axis);
  }
  s("path", { d: `M${m.l} ${m.t} V${Ht - m.b} H${Wd - m.r}`, fill: "none" }, axis);

  const labels = [];
  for (const a of ADDERS) {
    if (state.hidden.has(a)) continue;
    const pts = data[a];
    const color = `var(${ADDER_COLOR[a]})`;
    s("path", {
      d: pts.map((p, i) => `${i ? "L" : "M"}${x(p.w).toFixed(1)} ${y(p[field]).toFixed(1)}`).join(" "),
      class: "series" + (a === current.adder ? " current" : ""), stroke: color,
    }, svg);
    labels.push({ a, y: y(pts[pts.length - 1][field]), color });
  }
  // keep end labels from overlapping
  labels.sort((p, q) => p.y - q.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
  for (const l of labels) s("text", { x: Wd - m.r + 6, y: l.y + 4, class: "end-label", fill: l.color, text: t.adders[l.a][0] }, svg);

  s("circle", { cx: x(current.width), cy: y(current[field]), r: 6, class: "dot", fill: `var(${ADDER_COLOR[current.adder]})` }, svg);
  s("text", {
    x: x(current.width), y: y(current[field]) - 11, "text-anchor": "middle", class: "end-label", fill: "var(--ink)",
    text: field === "delay" ? `${fmt(current.delay, current.delay % 1 ? 1 : 0)} τ` : fmt(current.area),
  }, svg);
}

function render() {
  const cfg = store.config;
  const data = series(cfg);
  const current = { ...metrics(design(cfg).info), width: cfg.width, adder: cfg.adder };
  drawChart(document.getElementById("chart-delay"), data, "delay", t.chartDelay, current);
  drawChart(document.getElementById("chart-area"), data, "area", t.chartArea, current);
  document.getElementById("c-note").textContent = t.scalingNote(state.scope);
}

export function initCharts() {
  segmented(document.getElementById("c-scope"), ["adder", "alu"].map((v) => ({ value: v, label: t.scope[v] })), state.scope,
    (v) => { state.scope = v; render(); });
  const keys = document.getElementById("chart-keys");
  for (const a of ADDERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", "true");
    b.innerHTML = `<i style="background:var(${ADDER_COLOR[a]})"></i>${t.adders[a][0]}`;
    b.addEventListener("click", () => {
      if (state.hidden.has(a)) state.hidden.delete(a);
      else if (state.hidden.size < ADDERS.length - 1) state.hidden.add(a);
      b.setAttribute("aria-pressed", String(!state.hidden.has(a)));
      render();
    });
    keys.appendChild(b);
  }
  document.getElementById("c-grow").addEventListener("click", grow);
  store.listeners.add(render);
  onTheme(render);
  render();
}
