// Section 2: an event-driven gate-delay simulation of the 8-bit adder, drawn as bit slices
// with their carries and as a logic-analyzer waveform you can scrub.
import { t, fmt } from "./i18n.js";
import { buildAlu, simulate } from "./netlist.js";
import { h, s, segmented, cssVar, onTheme, reducedMotion, hex } from "./ui.js";
import { liveState, onLive } from "./live.js";

const W = 8;
const nets = { RIPPLE: buildAlu({}), KOGGE: buildAlu({ adder: "KOGGE" }) };
const PRESETS = {
  long: { before: { A: 0, B: 0, op: 0 }, after: { A: 0xff, B: 0x01, op: 0 } },
  none: { before: { A: 0, B: 0, op: 0 }, after: { A: 0x55, B: 0x2a, op: 0 } },
  sub: { before: { A: 0, B: 0, op: 0 }, after: { A: 0x7f, B: 0x80, op: 1 } },
};

const state = { preset: "long", adder: "RIPPLE", time: 0, sim: null, tmax: 40, playing: false };
let canvas, chain, timeInput, timeOut, playButton;
const chainNodes = { boxes: [], carries: [], sums: [], ins: [] };

function signals(net) {
  const c = [];
  for (let i = 0; i <= W; i++) c.push(net.names[`c${i}`]);
  return { A: net.inputs.A, B: net.inputs.B, c, s: net.adder.sum };
}

function valueAt(sim, n, time) {
  if (n === 0 || n === 1) return n;
  const list = sim.changes.get(n);
  let v = sim.initial[n];
  if (list) for (const [tt, val] of list) { if (tt <= time) v = val; else break; }
  return v;
}

function lastChange(sim, n) {
  const list = sim.changes.get(n);
  return list ? list[list.length - 1][0] : 0;
}

function run() {
  const net = nets[state.adder];
  const p = state.preset === "live"
    ? { before: liveState.previous, after: { A: liveState.A, B: liveState.B, op: liveState.op } }
    : PRESETS[state.preset];
  state.sim = simulate(net, p.before, p.after);
  state.p = p;
  const longest = Math.max(...Object.values(nets).map((n) => simulate(n, PRESETS.long.before, PRESETS.long.after).settle));
  state.tmax = Math.ceil(Math.max(longest, state.sim.settle) + 4);
  timeInput.max = String(state.tmax);
  drawChain();
}

function drawChain() {
  chain.innerHTML = "";
  chainNodes.boxes = [];
  chainNodes.carries = [];
  chainNodes.sums = [];
  chainNodes.ins = [];
  const ripple = state.adder === "RIPPLE";
  const step = 102;
  const x0 = 70;
  const boxX = (i) => x0 + (W - 1 - i) * step;
  const y = 42;
  const bw = 74;
  const bh = 50;
  s("text", { x: 10, y: y + bh / 2 + 4, class: "clab", text: "cout" }, chain);
  for (let i = 0; i < W; i++) {
    const g = s("g", { class: "fa" }, chain);
    s("rect", { x: boxX(i), y, width: bw, height: bh, rx: 1 }, g);
    s("text", { x: boxX(i) + bw / 2, y: y + 22, "text-anchor": "middle", text: ripple ? `FA${i}` : `bit ${i}` }, g);
    s("text", { x: boxX(i) + bw / 2, y: y + 38, "text-anchor": "middle", class: "sub", text: ripple ? "full adder" : "p, g, sum" }, g);
    chainNodes.boxes[i] = g;
    chainNodes.ins[i] = s("text", { x: boxX(i) + bw / 2, y: y - 10, "text-anchor": "middle", class: "bitv" }, chain);
    chainNodes.sums[i] = s("text", { x: boxX(i) + bw / 2, y: y + bh + 22, "text-anchor": "middle", class: "bitv" }, chain);
  }
  if (ripple) {
    for (let i = 0; i <= W; i++) {
      // carry c_i enters box i from the right; c_W leaves box W-1 on the left
      const right = i < W ? boxX(i) + bw : null;
      const xa = i === 0 ? boxX(0) + bw + 26 : boxX(i - 1);
      const xb = i < W ? right : 44;
      chainNodes.carries[i] = s("path", { d: `M${xa} ${y + bh / 2} H${xb}`, class: "cw" }, chain);
      s("text", { x: (xa + xb) / 2, y: y + bh / 2 - 6, "text-anchor": "middle", class: "clab", text: `c${i}` }, chain);
    }
  } else {
    const ty = y + bh + 34;
    s("rect", { x: boxX(W - 1), y: ty, width: boxX(0) + bw - boxX(W - 1), height: 18, fill: "none", stroke: "var(--ink-3)", "stroke-dasharray": "3 3" }, chain);
    s("text", { x: (boxX(W - 1) + boxX(0) + bw) / 2, y: ty + 13, "text-anchor": "middle", class: "clab", text: "prefix network (3 levels)" }, chain);
    for (let i = 0; i <= W; i++) {
      const x = i < W ? boxX(i) + bw - 10 : boxX(W - 1) - 18;
      chainNodes.carries[i] = s("path", { d: i < W ? `M${x} ${ty} V${y + bh}` : `M${boxX(W - 1)} ${ty + 9} H${x} V${y + bh / 2} H44`, class: "cw" }, chain);
    }
    chain.setAttribute("viewBox", "0 0 900 160");
  }
  if (ripple) chain.setAttribute("viewBox", "0 0 900 150");
  renderAt(state.time);
}

function renderAt(time) {
  state.time = time;
  const sim = state.sim;
  const net = nets[state.adder];
  const sig = signals(net);
  for (let i = 0; i < W; i++) {
    const sv = valueAt(sim, sig.s[i], time);
    chainNodes.sums[i].textContent = `s${i}=${sv}`;
    chainNodes.sums[i].classList.toggle("on", !!sv);
    const a = valueAt(sim, sig.A[i], time);
    const b = valueAt(sim, sig.B[i], time);
    chainNodes.ins[i].textContent = `a${a} b${b}`;
    const busy = lastChange(sim, sig.s[i]) > time || lastChange(sim, sig.c[i + 1]) > time;
    chainNodes.boxes[i].classList.toggle("busy", busy && time > 0);
  }
  for (let i = 0; i <= W; i++) chainNodes.carries[i].classList.toggle("on", !!valueAt(sim, sig.c[i], time));
  timeInput.value = String(time);
  timeOut.textContent = `${fmt(time, 1)} τ`;
  drawWave();
}

function drawWave() {
  const sim = state.sim;
  const net = nets[state.adder];
  const sig = signals(net);
  const rows = [
    { name: "A", bus: sig.A },
    { name: state.p.after.op === 1 ? "B (sub)" : "B", bus: sig.B },
    ...sig.c.slice(1).map((n, i) => ({ name: i + 1 === W ? "cout" : `c${i + 1}`, net: n, carry: true })),
    ...sig.s.map((n, i) => ({ name: `s${i}`, net: n })).reverse(),
    { name: "S", bus: sig.s, sum: true },
  ];
  const rowH = 15;
  const top = 6;
  const left = 58;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 800;
  const cssH = top + rows.length * rowH + 24;
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const color = {
    ink: cssVar("--ink"), ink3: cssVar("--ink-3"), rule: cssVar("--rule-2"), hi: cssVar("--hi"),
    lo: cssVar("--lo"), carry: cssVar("--carry"), crit: cssVar("--crit"),
  };
  const tx = (tt) => left + (tt / state.tmax) * (cssW - left - 10);
  ctx.font = `500 11px ${cssVar("--font-mono")}`;
  ctx.textBaseline = "middle";

  // time grid
  ctx.strokeStyle = color.rule;
  ctx.lineWidth = 1;
  for (let tt = 0; tt <= state.tmax; tt += 2) {
    const x = Math.round(tx(tt)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + rows.length * rowH);
    ctx.stroke();
    if (tt % 10 === 0) {
      ctx.fillStyle = color.ink3;
      ctx.textAlign = "center";
      ctx.fillText(`${tt}τ`, x, top + rows.length * rowH + 12);
    }
  }

  let glitches = 0;
  rows.forEach((row, r) => {
    const y0 = top + r * rowH + 2;
    const y1 = y0 + rowH - 4;
    ctx.fillStyle = color.ink3;
    ctx.textAlign = "right";
    ctx.fillText(row.name, left - 8, (y0 + y1) / 2);
    if (row.net !== undefined) {
      const list = sim.changes.get(row.net) || [];
      if (!row.carry && list.length > 1) glitches += list.length - 1;
      let v = sim.initial[row.net];
      let x = tx(0);
      ctx.lineWidth = 1.6;
      const seg = (xa, xb, val) => {
        ctx.strokeStyle = val ? (row.carry ? color.carry : color.hi) : color.lo;
        ctx.beginPath();
        ctx.moveTo(xa, val ? y0 : y1);
        ctx.lineTo(xb, val ? y0 : y1);
        ctx.stroke();
        if (val) {
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = row.carry ? color.carry : color.hi;
          ctx.fillRect(xa, y0, xb - xa, y1 - y0);
          ctx.globalAlpha = 1;
        }
      };
      for (const [tt, val] of list) {
        const xn = tx(tt);
        seg(x, xn, v);
        ctx.strokeStyle = color.ink3;
        ctx.beginPath();
        ctx.moveTo(xn, y0);
        ctx.lineTo(xn, y1);
        ctx.stroke();
        x = xn;
        v = val;
      }
      seg(x, tx(state.tmax), v);
      if (!row.carry && list.length > 1) {
        ctx.fillStyle = color.crit;
        for (const [tt] of list.slice(0, -1)) ctx.fillRect(tx(tt) - 1.5, y1 + 1, 3, 2);
      }
    } else {
      const times = new Set([0]);
      for (const n of row.bus) for (const [tt] of sim.changes.get(n) || []) times.add(tt);
      const sorted = [...times].sort((a, b) => a - b);
      sorted.push(state.tmax);
      for (let k = 0; k < sorted.length - 1; k++) {
        const ta = sorted[k];
        const tb = sorted[k + 1];
        const xa = tx(ta);
        const xb = tx(tb);
        let word = 0;
        row.bus.forEach((n, i) => (word |= valueAt(sim, n, ta) << i));
        const mid = (y0 + y1) / 2;
        const final = k === sorted.length - 2;
        ctx.strokeStyle = row.sum && !final ? color.crit : color.ink3;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(xa, mid);
        ctx.lineTo(Math.min(xa + 3, xb), y0);
        ctx.lineTo(Math.max(xb - 3, xa), y0);
        ctx.lineTo(xb, mid);
        ctx.lineTo(Math.max(xb - 3, xa), y1);
        ctx.lineTo(Math.min(xa + 3, xb), y1);
        ctx.closePath();
        ctx.stroke();
        if (xb - xa > 22) {
          ctx.fillStyle = row.sum && !final ? color.crit : color.ink;
          ctx.textAlign = "center";
          ctx.fillText(hex(word, W), (xa + xb) / 2, mid + 0.5);
        }
      }
    }
  });

  // cursor
  const cx = Math.round(tx(state.time)) + 0.5;
  ctx.strokeStyle = color.ink;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top + rows.length * rowH);
  ctx.stroke();
  ctx.setLineDash([]);
  // settle marker
  const sx = tx(sim.settle);
  ctx.fillStyle = color.crit;
  ctx.textAlign = "left";
  ctx.fillRect(sx - 0.5, top, 1, rows.length * rowH);

  document.getElementById("carry-stats").innerHTML =
    `<span>${t.settles(fmt(sim.settle, 1))}</span><span>${t.glitches(glitches)}</span><span>${t.events(fmt(sim.events))}</span>`;
}

let raf = 0;
function play() {
  if (state.playing) return stop();
  state.playing = true;
  playButton.textContent = t.pause;
  if (reducedMotion()) {
    renderAt(state.tmax);
    return stop();
  }
  let start = null;
  const from = state.time >= state.tmax ? 0 : state.time;
  const speed = state.tmax / 3.2; // tau per second
  const frame = (now) => {
    if (start === null) start = now;
    const tt = Math.min(state.tmax, from + ((now - start) / 1000) * speed);
    renderAt(Math.round(tt * 2) / 2);
    if (tt < state.tmax && state.playing) raf = requestAnimationFrame(frame);
    else stop();
  };
  raf = requestAnimationFrame(frame);
}
function stop() {
  state.playing = false;
  cancelAnimationFrame(raf);
  playButton.textContent = t.play;
}

export function initCarry() {
  canvas = document.getElementById("wave");
  chain = document.getElementById("carry-chain");
  timeInput = document.getElementById("carry-time");
  timeOut = document.getElementById("carry-time-out");
  playButton = document.getElementById("carry-play");
  playButton.textContent = t.play;

  segmented(document.getElementById("carry-preset"),
    ["long", "none", "sub", "live"].map((k) => ({ value: k, label: t.presets[k] })), state.preset,
    (v) => { state.preset = v; stop(); run(); state.time = 0; play(); });
  segmented(document.getElementById("carry-adder"),
    ["RIPPLE", "KOGGE"].map((k) => ({ value: k, label: t.adders[k][0] })), state.adder,
    (v) => { state.adder = v; stop(); run(); state.time = 0; play(); });
  playButton.addEventListener("click", play);
  timeInput.addEventListener("input", () => { stop(); renderAt(Number(timeInput.value)); });

  const scrub = (e) => {
    const rect = canvas.getBoundingClientRect();
    const left = 58;
    const frac = (e.clientX - rect.left - left) / (rect.width - left - 10);
    stop();
    renderAt(Math.max(0, Math.min(state.tmax, Math.round(frac * state.tmax * 2) / 2)));
  };
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); scrub(e); });
  canvas.addEventListener("pointermove", (e) => { if (e.buttons) scrub(e); });

  onLive(() => { if (state.preset === "live") { stop(); run(); renderAt(state.tmax); } });
  onTheme(drawWave);
  new ResizeObserver(() => drawWave()).observe(canvas);

  run();
  state.time = state.tmax;
  renderAt(state.tmax);
  // Play once when the section scrolls into view.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      state.time = 0;
      play();
    }
  }, { threshold: 0.4 });
  io.observe(chain);
}
