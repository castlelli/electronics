// Section 5: the carry network of ripple, Brent-Kung and Kogge-Stone adders, drawn as a
// prefix graph. Rows are gate levels, so height is delay; hovering a column shows its cone.
import { t, fmt } from "./i18n.js";
import { prefixLevels } from "./netlist.js";
import { s, segmented, store } from "./ui.js";

const state = { kind: "KOGGE", width: 16, follow: true };
let svg;

function render() {
  const W = state.width;
  const levels = prefixLevels(state.kind, W);
  const rippleLevels = W - 1;
  const VW = 900;
  const left = 46;
  const right = 20;
  const colW = (VW - left - right) / W;
  const rowH = Math.max(6, Math.min(30, 560 / (rippleLevels + 2)));
  const top = 34;
  const H = top + (levels.length + 1) * rowH + 34;
  svg.setAttribute("viewBox", `0 0 ${VW} ${H}`);
  svg.innerHTML = "";
  const x = (i) => left + (W - 1 - i + 0.5) * colW;
  const y = (lv) => top + lv * rowH;
  const r = Math.max(1.6, Math.min(5, colW * 0.22, rowH * 0.28));

  // inputs and column guides
  const every = colW < 9 ? 8 : colW < 16 ? 4 : colW < 26 ? 2 : 1;
  for (let i = 0; i < W; i++) {
    if (i % every === 0 || i === W - 1) {
      s("text", { x: x(i), y: top - 14, "text-anchor": "middle", class: "io", text: i }, svg);
      s("text", { x: x(i), y: y(levels.length) + 18, "text-anchor": "middle", class: "io", text: `c${i + 1}` }, svg);
    }
    s("rect", { x: x(i) - r, y: y(0) - r, width: 2 * r, height: 2 * r, class: "node pass", "data-k": `0:${i}` }, svg);
  }
  s("text", { x: 6, y: top - 14, class: "lvl", text: "bit" }, svg);
  s("text", { x: 6, y: y(0) + 3, class: "lvl", text: "g,p" }, svg);

  const edges = [];
  levels.forEach((pairs, lv) => {
    for (let c = 0; c < W; c++) {
      edges.push({ lv, i: c, j: c, e: s("line", { x1: x(c), x2: x(c), y1: y(lv), y2: y(lv + 1), class: "col" }, svg) });
    }
  });
  levels.forEach((pairs, lv) => {
    if (rowH >= 12 || lv % 4 === 0) s("text", { x: 6, y: y(lv + 1) + 3, class: "lvl", text: `L${lv + 1}` }, svg);
    for (const [i, j] of pairs) {
      const e = s("path", { d: `M${x(j)} ${y(lv)} L${x(i)} ${y(lv + 1)}`, class: "edge" }, svg);
      edges.push({ lv, i, j, e });
    }
  });
  const nodes = [];
  levels.forEach((pairs, lv) => {
    for (const [i] of pairs) nodes.push({ lv: lv + 1, i, n: s("circle", { cx: x(i), cy: y(lv + 1), r, class: "node" }, svg) });
  });

  // hover targets, one per column
  for (let i = 0; i < W; i++) {
    const hit = s("rect", { x: x(i) - colW / 2, y: 0, width: colW, height: H, class: "hit" }, svg);
    const title = s("title", { text: t.netCarry(i + 1) }, hit);
    hit.addEventListener("pointerenter", () => cone(i));
    hit.addEventListener("pointerleave", clearCone);
    void title;
  }

  function cone(col) {
    let set = new Set([col]);
    const marked = new Set();
    for (let lv = levels.length - 1; lv >= 0; lv--) {
      const next = new Set(set);
      for (const { lv: l, i, j, e } of edges) {
        if (l === lv && set.has(i)) {
          if (i !== j) next.add(j);
          marked.add(e);
        }
      }
      for (const nd of nodes) if (nd.lv === lv + 1 && set.has(nd.i)) marked.add(nd.n);
      set = next;
    }
    svg.classList.add("hovering");
    marked.forEach((el) => el.classList.add("cone"));
  }
  function clearCone() {
    svg.classList.remove("hovering");
    svg.querySelectorAll(".cone").forEach((el) => el.classList.remove("cone"));
  }

  const cells = levels.reduce((sum, p) => sum + p.length, 0);
  const wires = levels.reduce((sum, p) => sum + p.reduce((w, [i, j]) => w + (i - j), 0), 0);
  document.getElementById("net-stats").innerHTML = t.netStats(fmt(levels.length), fmt(cells), fmt(wires));
  document.getElementById("n-width-out").textContent = t.bits(W);
  document.getElementById("n-width").value = String(W);
}

export function initNetwork() {
  svg = document.getElementById("net");
  const kind = segmented(document.getElementById("n-kind"),
    ["RIPPLE", "BRENT", "KOGGE"].map((v) => ({ value: v, label: t.netKinds[v] })), state.kind,
    (v) => { state.kind = v; render(); });
  document.getElementById("n-width").addEventListener("input", (e) => {
    state.width = Number(e.target.value);
    state.follow = false;
    render();
  });
  // Follow the design's adder when it is one of the three drawn here.
  store.listeners.add((cfg) => {
    if (["RIPPLE", "BRENT", "KOGGE"].includes(cfg.adder) && cfg.adder !== state.kind) {
      state.kind = cfg.adder;
      kind.set(cfg.adder);
      render();
    }
  });
  render();
}
