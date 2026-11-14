// Small DOM helpers shared by the sections, plus the theme toggle and the shared design state.
import { t } from "./i18n.js";
import { DEFAULT_CONFIG, buildAlu, analyze } from "./netlist.js";

export const SVGNS = "http://www.w3.org/2000/svg";

export function h(tag, attrs = {}, parent) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

export function s(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A row of toggle buttons; returns a setter.
export function segmented(container, items, value, onChange) {
  container.innerHTML = "";
  const buttons = items.map(({ value: v, label, title }) =>
    h("button", { type: "button", "aria-pressed": String(v === value), text: label, ...(title ? { title } : {}),
      onclick: () => { set(v); onChange(v); } }, container));
  function set(v) {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(items[i].value === v)));
  }
  return { set, buttons };
}

// Theme: follows the system unless the user picked one.
const themeListeners = new Set();
export function onTheme(fn) {
  themeListeners.add(fn);
}
function emitTheme() {
  themeListeners.forEach((fn) => fn());
}
export function setupTheme() {
  const button = document.querySelector("[data-theme-toggle]");
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => document.documentElement.dataset.theme || (media.matches ? "dark" : "light");
  const label = () => button && (button.textContent = current() === "dark" ? t.themeLight : t.themeDark);
  label();
  button?.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (error) {}
    label();
    emitTheme();
  });
  media.addEventListener("change", () => { label(); emitTheme(); });
}

// Shared design (section 3 drives it; the title block, charts and network follow).
const cache = new Map();
export function design(config) {
  const key = JSON.stringify(config);
  let hit = cache.get(key);
  if (!hit) {
    const net = buildAlu(config);
    hit = { net, info: analyze(net) };
    cache.set(key, hit);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
  }
  return hit;
}

export const store = {
  config: { ...DEFAULT_CONFIG },
  listeners: new Set(),
  set(patch) {
    this.config = { ...this.config, ...patch };
    this.listeners.forEach((fn) => fn(this.config));
  },
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.config);
  },
};

export function hex(value, width) {
  return BigInt(value).toString(16).toUpperCase().padStart(Math.ceil(width / 4), "0");
}

export function signedOf(value, width) {
  const v = BigInt(value);
  const top = 1n << BigInt(width - 1);
  return v & top ? v - (top << 1n) : v;
}
