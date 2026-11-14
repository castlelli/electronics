// Entry point: wires the sections together.
import { setupTheme } from "./ui.js";
import { initLive } from "./live.js";
import { initCarry } from "./carry.js";
import { initDesigner } from "./designer.js";
import { initCharts } from "./charts.js";
import { initNetwork } from "./network.js";

setupTheme();
initLive();
initCarry();
initDesigner();
initCharts();
initNetwork();
