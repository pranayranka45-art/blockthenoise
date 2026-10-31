// Popup UI: renders state from chrome.storage and sends commands to the background worker.

import { CHECKOUT_URL, PRICE_LABEL, TRIAL_DAYS } from "./config.js";
import {
  AppState,
  PHASE_LABELS,
  Settings,
  allTracks,
  formatMs,
  getAccess,
  isBlockingActive,
  loadState,
  normalizeSite,
  originPatterns,
  phaseDurationMs,
  remainingMs,
  sendToBackground,
  updateSettings,
} from "./shared.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
let state: AppState;

// ---------- tabs ----------

const TAB_KEY = "btn-popup-tab";

function showTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === name));
  });
  document.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
    panel.hidden = panel.id !== `tab-${name}`;
  });
  try {
    localStorage.setItem(TAB_KEY, name);
  } catch {
    // Remembering the tab is only a convenience.
  }
}

document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "focus"));
});

// ---------- rendering ----------

function renderTimer(): void {
  const { timer, settings } = state;
  const left = remainingMs(timer);
  const total = phaseDurationMs(settings, timer.phase);
  const progress = total > 0 ? 1 - left / total : 0;

  document.body.classList.toggle("on-break", timer.phase !== "focus");
  $("time").textContent = formatMs(left);
  const paused = !timer.running && left < total;
  $("phase").textContent = paused ? `${PHASE_LABELS[timer.phase]} · paused` : PHASE_LABELS[timer.phase];
  const ring = $<HTMLElement>("ring-progress");
  ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  $("btn-start").textContent = timer.running ? "Pause" : left < total ? "Resume" : "Start";

  const inCycle = timer.completedFocus % settings.longBreakEvery;
  $("sessions-dots").textContent = "●".repeat(inCycle) + "○".repeat(settings.longBreakEvery - inCycle);
  $("sessions-text").textContent = `${timer.completedFocus} session${timer.completedFocus === 1 ? "" : "s"} done`;
}

function renderBlocking(): void {
  const { settings, timer, license } = state;
  const active = isBlockingActive(settings, timer, license);
  const pill = $("block-pill");
  pill.textContent = active ? "Blocking on" : "Blocking off";
  pill.classList.toggle("on", active);

  $("block-status").textContent = !settings.blockingEnabled
    ? "Blocking is turned off."
    : active
      ? `${settings.blockedSites.length} site${settings.blockedSites.length === 1 ? " is" : "s are"} blocked right now.`
      : "Sites will be blocked when you start a focus session.";

  const list = $("site-list");
  list.replaceChildren(
    ...settings.blockedSites.map((site) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = site;
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.title = `Unblock ${site}`;
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        void updateSettings({ blockedSites: state.settings.blockedSites.filter((s) => s !== site) });
      });
      li.append(name, remove);
      return li;
    }),
  );
}

function renderMusic(): void {
  const { music, settings } = state;
  const tracks = allTracks(settings);
  const current = tracks.find((t) => t.id === music.trackId) ?? tracks[0];

  const playBtn = $<HTMLButtonElement>("btn-music");
  playBtn.textContent = music.playing ? "❚❚" : "▶";
  playBtn.setAttribute("aria-label", music.playing ? "Pause" : "Play");
  $("np-label").textContent = music.playing ? "Now playing" : "Paused";
  $("np-name").textContent = current.name;

  const error = $("music-error");
  error.hidden = !music.error;
  error.textContent = music.error ?? "";

  $("track-list").replaceChildren(
    ...tracks.map((track) => {
      const li = document.createElement("li");
      const isCurrent = track.id === current.id;
      li.classList.toggle("current", isCurrent);
      const eq = document.createElement("span");
      eq.className = "eq";
      eq.textContent = isCurrent && music.playing ? "♪" : "";
      const select = document.createElement("button");
      select.className = "select";
      select.textContent = track.name;
      select.title = track.url ?? "Generated in your browser";
      select.addEventListener("click", () => void sendToBackground({ target: "background", type: "music:play", trackId: track.id }));
      li.append(eq, select);
      if (track.custom) {
        const remove = document.createElement("button");
        remove.className = "remove";
        remove.title = "Remove track";
        remove.textContent = "×";
        remove.addEventListener("click", () => void removeTrack(track.id));
        li.append(remove);
      }
      return li;
    }),
  );
}

function setInputValue(id: string, value: string | number | boolean): void {
  const input = $<HTMLInputElement>(id);
  if (document.activeElement === input) return; // don't fight the user while typing
  if (input.type === "checkbox") input.checked = Boolean(value);
  else input.value = String(value);
}

function renderInputs(): void {
  const { settings, music } = state;
  setInputValue("set-focus", settings.focusMinutes);
  setInputValue("set-short", settings.shortBreakMinutes);
  setInputValue("set-long", settings.longBreakMinutes);
  setInputValue("set-every", settings.longBreakEvery);
  setInputValue("set-autostart", settings.autoStartNext);
  setInputValue("set-music-follow", settings.musicFollowsTimer);
  setInputValue("set-blocking", settings.blockingEnabled);
  setInputValue("set-focus-only", settings.blockOnlyDuringFocus);
  setInputValue("volume", music.volume);
  $<HTMLInputElement>("set-focus-only").disabled = !settings.blockingEnabled;
}

/** True while the user opened the unlock screen during the trial. */
let unlockOpen = false;

function renderLicense(): void {
  const access = getAccess(state.license);
  const showPaywall = access.status === "expired" || (access.status === "trial" && unlockOpen);

  $("app-main").hidden = showPaywall;
  $("paywall").hidden = !showPaywall;
  $("btn-close-unlock").hidden = access.status !== "trial";

  const banner = $("trial-banner");
  banner.hidden = access.status !== "trial" || showPaywall;
  if (access.status === "trial") {
    $("trial-text").textContent = `Free trial: ${access.daysLeft} day${access.daysLeft === 1 ? "" : "s"} left`;
    banner.classList.toggle("urgent", access.daysLeft <= 3);
  }

  $("paywall-title").textContent = access.status === "expired" ? "Your free trial has ended" : "Unlock BlockTheNoise";
  $("paywall-text").textContent =
    access.status === "expired"
      ? `Hope the last ${TRIAL_DAYS} days were focused! Unlock BlockTheNoise to keep blocking sites, timing sessions and playing focus music.`
      : "Keep the blocker, timer and focus music after your trial ends.";
  const buy = $<HTMLButtonElement>("btn-buy");
  buy.textContent = `Unlock for ${PRICE_LABEL}`;
  buy.disabled = !CHECKOUT_URL;
  buy.title = CHECKOUT_URL ? "" : "The checkout link isn't set up yet.";

  if (access.status === "licensed") unlockOpen = false;
}

function render(): void {
  renderLicense();
  renderTimer();
  renderBlocking();
  renderMusic();
  renderInputs();
}

// ---------- unlock ----------

$("btn-open-unlock").addEventListener("click", () => {
  unlockOpen = true;
  renderLicense();
});
$("btn-close-unlock").addEventListener("click", () => {
  unlockOpen = false;
  renderLicense();
});
$("btn-buy").addEventListener("click", () => {
  if (CHECKOUT_URL) void chrome.tabs.create({ url: CHECKOUT_URL });
});

$<HTMLFormElement>("license-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("license-key");
  const button = $<HTMLButtonElement>("btn-activate");
  const error = $("license-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Checking…";
  void sendToBackground({ target: "background", type: "license:activate", key: input.value }).then((response) => {
    button.disabled = false;
    button.textContent = "Activate";
    if (response?.ok) {
      input.value = "";
      unlockOpen = false;
      void refresh();
    } else {
      error.textContent = response?.error ?? "Activation failed. Please try again.";
      error.hidden = false;
    }
  });
});

// ---------- timer controls ----------

$("btn-start").addEventListener("click", () => {
  void sendToBackground({ target: "background", type: state.timer.running ? "timer:pause" : "timer:start" });
});
$("btn-reset").addEventListener("click", () => void sendToBackground({ target: "background", type: "timer:reset" }));
$("btn-skip").addEventListener("click", () => void sendToBackground({ target: "background", type: "timer:skip" }));
$("btn-reset-sessions").addEventListener("click", () => void sendToBackground({ target: "background", type: "timer:resetSessions" }));

function bindNumber(id: string, key: keyof Settings, min: number, max: number): void {
  $<HTMLInputElement>(id).addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value) || value < min || value > max) {
      input.value = String(state.settings[key]);
      return;
    }
    void updateSettings({ [key]: value });
  });
}

function bindCheckbox(id: string, key: keyof Settings): void {
  $<HTMLInputElement>(id).addEventListener("change", (event) => {
    void updateSettings({ [key]: (event.target as HTMLInputElement).checked });
  });
}

bindNumber("set-focus", "focusMinutes", 1, 180);
bindNumber("set-short", "shortBreakMinutes", 1, 60);
bindNumber("set-long", "longBreakMinutes", 1, 90);
bindNumber("set-every", "longBreakEvery", 1, 12);
bindCheckbox("set-autostart", "autoStartNext");
bindCheckbox("set-music-follow", "musicFollowsTimer");
bindCheckbox("set-blocking", "blockingEnabled");
bindCheckbox("set-focus-only", "blockOnlyDuringFocus");

// ---------- music controls ----------

$("btn-music").addEventListener("click", () => {
  void sendToBackground({ target: "background", type: state.music.playing ? "music:pause" : "music:play" });
});

let volumeTimer: number | undefined;
$<HTMLInputElement>("volume").addEventListener("input", (event) => {
  const volume = Number((event.target as HTMLInputElement).value);
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => void sendToBackground({ target: "background", type: "music:volume", volume }), 80);
});

$<HTMLFormElement>("add-track").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $<HTMLInputElement>("track-name").value.trim();
  const url = $<HTMLInputElement>("track-url").value.trim();
  if (!name || !/^https?:\/\//i.test(url)) return;
  const track = { id: `custom-${Date.now()}`, name, url, kind: "stream" as const, custom: true };
  void updateSettings({ customTracks: [...state.settings.customTracks, track] });
  (event.target as HTMLFormElement).reset();
});

async function removeTrack(id: string): Promise<void> {
  if (state.music.trackId === id && state.music.playing) {
    await sendToBackground({ target: "background", type: "music:pause" });
  }
  await updateSettings({ customTracks: state.settings.customTracks.filter((t) => t.id !== id) });
}

// ---------- block list ----------

$<HTMLFormElement>("add-site").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("site-input");
  const error = $("site-error");
  const site = normalizeSite(input.value);
  error.hidden = true;
  if (!site) {
    error.textContent = "That doesn't look like a website address.";
    error.hidden = false;
    return;
  }
  if (state.settings.blockedSites.includes(site)) {
    input.value = "";
    return;
  }
  // Redirecting a site to the blocked page needs host access; this must run inside the click.
  chrome.permissions.request({ origins: originPatterns(site) }).then((granted) => {
    if (!granted) {
      error.textContent = `BlockTheNoise needs access to ${site} to block it.`;
      error.hidden = false;
      return;
    }
    input.value = "";
    void updateSettings({ blockedSites: [...state.settings.blockedSites, site] });
  });
});

// ---------- start ----------

async function refresh(): Promise<void> {
  state = await loadState();
  render();
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") void refresh();
});

let initialTab = "focus";
try {
  initialTab = localStorage.getItem(TAB_KEY) ?? "focus";
} catch {
  // Fall back to the Focus tab.
}
showTab(initialTab);
void refresh().then(() => {
  window.setInterval(renderTimer, 500);
});
