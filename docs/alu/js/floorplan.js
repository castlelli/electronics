// Floorplan in the spirit of die photos: one column per bit (MSB on the left) plus a control
// column, one row per unit, every gate a tile whose area is proportional to its transistors.
// The critical path is drawn through the tiles it crosses.
import { t } from "./i18n.js";
import { UNITS, TRANSISTORS } from "./netlist.js";
import { cssVar, reducedMotion } from "./ui.js";

const TILE = 12; // transistors per unit of area (one column is one unit wide)
const GAP_COL = 0.14;
const GAP_ROW = 0.45;

export function layout(net) {
  const W = net.width;
  const rows = [];
  const cells = new Map(); // `${unit}:${bit}` -> gates
  for (const [k, g] of net.gates.entries()) {
    const key = `${g.unit}:${g.bit}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(k);
  }
  const hasCtrl = net.gates.some((g) => g.bit < 0);
  const ctrlW = hasCtrl ? 1.6 : 0;
  const colX = (bit) => (bit < 0 ? 0 : ctrlW + (hasCtrl ? 0.4 : 0) + (W - 1 - bit));
  const rects = new Array(net.gates.length);
  let y = 0;
  for (const unit of UNITS) {
    let rowH = 0;
    const present = [...cells.keys()].filter((k) => k.startsWith(unit + ":"));
    if (!present.length) continue;
    for (const key of present) {
      const bit = Number(key.split(":")[1]);
      const width = (bit < 0 ? ctrlW : 1) - GAP_COL;
      let yy = y;
      for (const k of cells.get(key)) {
        const hgt = TRANSISTORS[net.gates[k].type] / TILE / width;
        rects[k] = { x: colX(bit), y: yy, w: width, h: hgt, unit, bit };
        yy += hgt;
      }
      rowH = Math.max(rowH, yy - y);
    }
    rows.push({ unit, y, h: rowH });
    y += rowH + GAP_ROW;
  }
  return { rows, rects, cells, width: colX(0) + 1, height: Math.max(0, y - GAP_ROW), hasCtrl, ctrlW };
}

export class Floorplan {
  constructor(canvas, tip) {
    this.canvas = canvas;
    this.tip = tip;
    this.scale = null;
    this.anim = 0;
    canvas.addEventListener("pointermove", (e) => this.hover(e));
    canvas.addEventListener("pointerleave", () => (this.tip.hidden = true));
    new ResizeObserver(() => this.draw(true)).observe(canvas);
  }

  set(net, info, reference) {
    this.net = net;
    this.info = info;
    this.lay = layout(net);
    this.ref = reference ? layout(reference) : null;
    this.onPath = new Set(info.path);
    this.draw();
  }

  geometry() {
    const cssW = this.canvas.clientWidth || 600;
    const cssH = Math.max(300, Math.min(520, cssW * 0.62));
    const gutter = cssW < 520 ? 70 : 126;
    const lay = this.lay;
    const target = Math.min((cssW - gutter - 8) / lay.width, (cssH - 26) / Math.max(lay.height, 1));
    return { cssW, cssH, gutter, target };
  }

  draw(immediate = false) {
    if (!this.lay) return;
    const { target } = this.geometry();
    cancelAnimationFrame(this.anim);
    if (this.scale === null || immediate || reducedMotion()) {
      this.scale = target;
      this.paint();
      return;
    }
    const from = this.scale;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 380);
      const e = 1 - Math.pow(1 - k, 3);
      this.scale = from * Math.pow(target / from, e);
      this.paint();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  paint() {
    const { cssW, cssH, gutter } = this.geometry();
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    c.style.height = cssH + "px";
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const sc = this.scale;
    const ox = gutter;
    const oy = 18;
    this.view = { sc, ox, oy };
    const lay = this.lay;
    const mono = cssVar("--font-mono");
    const ink3 = cssVar("--ink-3");
    const rule = cssVar("--rule");
    const crit = cssVar("--crit");
    const sheet = cssVar("--sheet");
    const W = this.net.width;

    // bit labels
    ctx.font = `500 10px ${mono}`;
    ctx.fillStyle = ink3;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const every = sc < 9 ? 8 : sc < 16 ? 4 : sc < 28 ? 2 : 1;
    for (let bit = 0; bit < W; bit++) {
      if (bit % every && bit !== W - 1) continue;
      const x = ox + (lay.width - 1 - bit + 0.5 - GAP_COL / 2) * sc;
      ctx.fillText(String(bit), x, oy - 6);
    }
    if (lay.hasCtrl && lay.ctrlW * sc > 22) ctx.fillText("ctl", ox + (lay.ctrlW / 2) * sc, oy - 6);

    // row labels and row guides
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `500 10.5px ${mono}`;
    for (const row of lay.rows) {
      const y = oy + (row.y + row.h / 2) * sc;
      ctx.fillStyle = cssVar(`--u-${row.unit}`);
      ctx.fillRect(gutter - 10, oy + row.y * sc, 3, Math.max(2, row.h * sc));
      ctx.fillStyle = ink3;
      if (row.h * sc > 9) ctx.fillText((cssW < 520 ? t.unitsShort : t.units)[row.unit], gutter - 16, y);
    }

    // reference outline: the original 8-bit design at the same scale
    if (this.ref) {
      ctx.strokeStyle = ink3;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, this.ref.width * sc, this.ref.height * sc);
      ctx.setLineDash([]);
    }

    // tiles
    const colors = Object.fromEntries(UNITS.map((u) => [u, cssVar(`--u-${u}`)]));
    const rects = lay.rects;
    for (let k = 0; k < rects.length; k++) {
      const r = rects[k];
      if (!r) continue;
      const x = ox + r.x * sc;
      const y = oy + r.y * sc;
      const w = r.w * sc;
      const hh = r.h * sc;
      ctx.fillStyle = colors[r.unit];
      ctx.globalAlpha = 0.78;
      ctx.fillRect(x, y, w, hh);
      ctx.globalAlpha = 1;
      if (hh > 3 && w > 4) {
        ctx.fillStyle = sheet;
        ctx.fillRect(x, y + hh - Math.min(1, hh * 0.2), w, Math.min(1, hh * 0.2));
      }
    }
    // die outline
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 4.5, oy - 4.5, lay.width * sc + 8, lay.height * sc + 8);

    // critical path
    const path = this.info.path.map((k) => rects[k]).filter(Boolean);
    if (path.length) {
      ctx.strokeStyle = crit;
      ctx.lineWidth = Math.max(1.5, Math.min(3, sc * 0.12));
      for (const r of path) ctx.strokeRect(ox + r.x * sc + 0.5, oy + r.y * sc + 0.5, Math.max(1, r.w * sc - 1), Math.max(1, r.h * sc - 1));
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      path.forEach((r, i) => {
        const x = ox + (r.x + r.w / 2) * sc;
        const y = oy + (r.y + r.h / 2) * sc;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      const last = path[path.length - 1];
      ctx.fillStyle = crit;
      ctx.beginPath();
      ctx.arc(ox + (last.x + last.w / 2) * sc, oy + (last.y + last.h / 2) * sc, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  hover(e) {
    if (!this.view) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { sc, ox, oy } = this.view;
    const ux = (px - ox) / sc;
    const uy = (py - oy) / sc;
    const hit = this.lay.rects.find((r) => r && ux >= r.x && ux <= r.x + r.w && uy >= r.y && uy <= r.y + r.h);
    if (!hit) {
      this.tip.hidden = true;
      return;
    }
    const gates = this.lay.cells.get(`${hit.unit}:${hit.bit}`);
    const tr = gates.reduce((sum, k) => sum + TRANSISTORS[this.net.gates[k].type], 0);
    this.tip.innerHTML = t.tip(t.units[hit.unit], hit.bit, gates.length, tr);
    this.tip.hidden = false;
    this.tip.style.left = px + 16 + "px";
    this.tip.style.top = py + 12 + "px";
  }
}
