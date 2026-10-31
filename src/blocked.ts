// The page shown in place of a blocked site.

import { AppState, PHASE_LABELS, formatMs, loadState, remainingMs } from "./shared.js";

const QUOTES = [
  "The scroll can wait. Your best work can't.",
  "Deep work is a superpower in a distracted world.",
  "Protect your attention like it's the most valuable thing you own. It is.",
  "Five more minutes of focus beats fifty of feed.",
  "Nothing in that tab is more interesting than what you're building.",
  "Flow starts where the noise stops.",
];

const $ = (id: string) => document.getElementById(id) as HTMLElement;
let state: AppState;

$("quote").textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];

function render(): void {
  const { timer, settings } = state;
  $("timer").hidden = false;
  $("timer-label").textContent = timer.running ? PHASE_LABELS[timer.phase] : `${PHASE_LABELS[timer.phase]} · paused`;
  $("timer-time").textContent = formatMs(remainingMs(timer));
  $("hint").textContent = settings.blockOnlyDuringFocus
    ? "This site unlocks when your focus session ends."
    : "This site stays blocked until you turn blocking off in BlockTheNoise.";
}

async function refresh(): Promise<void> {
  state = await loadState();
  render();
}

$("btn-close").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") void refresh();
});
void refresh().then(() => window.setInterval(render, 500));
