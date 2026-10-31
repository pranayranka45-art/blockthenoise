// Service worker: owns the Pomodoro timer, the site-blocking rules, the music player and the trial/license.
// chrome.storage.local is the source of truth; everything else reacts to changes in it.

import { DODO_API_BASE, DODO_PRODUCT_ID, PRICE_LABEL, TRIAL_DAYS } from "./config.js";
import {
  AppState,
  BackgroundMessage,
  LicenseState,
  MusicState,
  OffscreenMessage,
  PHASE_LABELS,
  Phase,
  Settings,
  TimerState,
  allTracks,
  getAccess,
  hasAccess,
  hostMatchesSite,
  isBlockingActive,
  isFocusRunning,
  loadState,
  phaseDurationMs,
  remainingMs,
} from "./shared.js";

const TIMER_ALARM = "btn-timer";
const BADGE_ALARM = "btn-badge";
const TRIAL_ALARM = "btn-trial-end";
const LICENSE_ALARM = "btn-license-check";
const LICENSE_RECHECK_MS = 7 * 86_400_000;
const BLOCK_RULE_ID = 1;
const BLOCKED_PAGE = "blocked.html";

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());

async function init(): Promise<void> {
  // Persist merged defaults so every context sees a complete state.
  const state = await loadState();
  await chrome.storage.local.set(state);
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(LICENSE_ALARM, { periodInMinutes: 24 * 60 });

  const access = getAccess(state.license);
  if (access.status === "trial") chrome.alarms.create(TRIAL_ALARM, { when: access.endsAt });
  if (access.status === "expired") {
    await lockFeatures(false);
    return;
  }
  void revalidateLicense();

  // Catch up on a phase that ended while the browser was closed.
  if (state.timer.running && state.timer.endsAt !== null && state.timer.endsAt <= Date.now()) {
    await advancePhase(true);
  } else if (state.timer.running && state.timer.endsAt !== null) {
    chrome.alarms.create(TIMER_ALARM, { when: state.timer.endsAt });
  }
  await syncBlocking();
  await updateBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMER_ALARM) void advancePhase(true);
  if (alarm.name === BADGE_ALARM) void updateBadge();
  if (alarm.name === TRIAL_ALARM) void lockFeatures(true);
  if (alarm.name === LICENSE_ALARM) void revalidateLicense();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  void onStateChanged(changes);
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message?.target !== "background") return false;
  handleMessage(message)
    .then(() => sendResponse({ ok: true }))
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function handleMessage(message: BackgroundMessage): Promise<void> {
  const gated = ["timer:start", "timer:skip", "music:play"];
  if (gated.includes(message.type) && !hasAccess((await loadState()).license)) {
    throw new Error(`Your ${TRIAL_DAYS}-day trial has ended. Unlock BlockTheNoise to keep using it.`);
  }
  switch (message.type) {
    case "timer:start":
      return startTimer();
    case "timer:pause":
      return pauseTimer();
    case "timer:reset":
      return resetTimer();
    case "timer:skip":
      return advancePhase(false);
    case "timer:resetSessions":
      return saveTimer({ ...(await loadState()).timer, completedFocus: 0 });
    case "license:activate":
      return activateLicense(message.key);
    case "music:play":
      return playMusic(message.trackId);
    case "music:pause":
      return stopMusic();
    case "music:volume":
      return setVolume(message.volume);
    case "music:error":
      await stopMusic(message.message);
      return;
  }
}

async function onStateChanged(changes: Record<string, chrome.storage.StorageChange>): Promise<void> {
  const oldSettings = changes.settings?.oldValue as Settings | undefined;
  const newSettings = changes.settings?.newValue as Settings | undefined;
  const oldTimer = changes.timer?.oldValue as TimerState | undefined;
  const newTimer = changes.timer?.newValue as TimerState | undefined;

  if (oldSettings && newSettings) await applyDurationChange(oldSettings, newSettings);
  if (changes.settings || changes.timer || changes.license) {
    await syncBlocking();
    await updateBadge();
  }
  if (newTimer && (oldTimer ? isFocusRunning(oldTimer) : false) !== isFocusRunning(newTimer)) {
    await followTimerWithMusic(isFocusRunning(newTimer));
  }
}

// ---------- timer ----------

async function saveTimer(timer: TimerState): Promise<void> {
  await chrome.storage.local.set({ timer });
}

async function startTimer(): Promise<void> {
  const { timer } = await loadState();
  if (timer.running) return;
  const endsAt = Date.now() + timer.remainingMs;
  chrome.alarms.create(TIMER_ALARM, { when: endsAt });
  await saveTimer({ ...timer, running: true, endsAt });
}

async function pauseTimer(): Promise<void> {
  const { timer } = await loadState();
  if (!timer.running) return;
  await chrome.alarms.clear(TIMER_ALARM);
  await saveTimer({ ...timer, running: false, endsAt: null, remainingMs: remainingMs(timer) });
}

async function resetTimer(): Promise<void> {
  const { settings, timer } = await loadState();
  await chrome.alarms.clear(TIMER_ALARM);
  await saveTimer({ ...timer, running: false, endsAt: null, remainingMs: phaseDurationMs(settings, timer.phase) });
}

/** Moves to the next phase. `completed` is false when the user skips. */
async function advancePhase(completed: boolean): Promise<void> {
  const { settings, timer } = await loadState();
  let completedFocus = timer.completedFocus;
  let next: Phase;
  if (timer.phase === "focus") {
    if (completed) completedFocus += 1;
    next = completed && completedFocus % settings.longBreakEvery === 0 ? "longBreak" : "shortBreak";
  } else {
    next = "focus";
  }

  const autoStart = completed ? settings.autoStartNext : timer.running;
  const duration = phaseDurationMs(settings, next);
  const endsAt = autoStart ? Date.now() + duration : null;

  await chrome.alarms.clear(TIMER_ALARM);
  if (endsAt !== null) chrome.alarms.create(TIMER_ALARM, { when: endsAt });
  await saveTimer({ phase: next, running: autoStart, endsAt, remainingMs: duration, completedFocus });

  if (completed) notifyPhaseEnd(timer.phase, next, autoStart);
}

/** If the timer is idle at a full phase, pick up newly edited durations. */
async function applyDurationChange(oldSettings: Settings, newSettings: Settings): Promise<void> {
  const { timer } = await loadState();
  if (timer.running) return;
  const oldDuration = phaseDurationMs(oldSettings, timer.phase);
  const newDuration = phaseDurationMs(newSettings, timer.phase);
  if (timer.remainingMs === oldDuration && oldDuration !== newDuration) {
    await saveTimer({ ...timer, remainingMs: newDuration });
  }
}

function notifyPhaseEnd(finished: Phase, next: Phase, autoStarted: boolean): void {
  const title = finished === "focus" ? "Focus session complete 🎉" : "Break's over";
  const message =
    finished === "focus"
      ? `Nice work. Time for a ${PHASE_LABELS[next].toLowerCase()}.`
      : "Back to it — the noise stays blocked.";
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message: autoStarted ? message : `${message} Open BlockTheNoise to start.`,
    priority: 2,
  });
}

async function updateBadge(): Promise<void> {
  const { settings, timer } = await loadState();
  const left = remainingMs(timer);
  const idle = !timer.running && timer.remainingMs === phaseDurationMs(settings, timer.phase);
  const text = idle ? "" : `${Math.ceil(left / 60_000)}m`;
  const color = !timer.running ? "#6b7280" : timer.phase === "focus" ? "#e5484d" : "#30a46c";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// ---------- site blocking ----------

async function syncBlocking(): Promise<void> {
  const { settings, timer, license } = await loadState();
  const active = isBlockingActive(settings, timer, license);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();

  const addRules: chrome.declarativeNetRequest.Rule[] = active
    ? [
        {
          id: BLOCK_RULE_ID,
          priority: 1,
          action: {
            type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
            redirect: { extensionPath: `/${BLOCKED_PAGE}` },
          },
          condition: {
            requestDomains: settings.blockedSites,
            resourceTypes: ["main_frame" as chrome.declarativeNetRequest.ResourceType],
          },
        },
      ]
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules,
  });

  // Rules only catch new navigations, so also redirect tabs that are already open.
  if (active) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.url && hostMatchesSite(tab.url, settings.blockedSites)) {
        void chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(BLOCKED_PAGE) });
      }
    }
  }
}

// Single-page apps (YouTube, Instagram) change URLs without a full navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;
  void loadState().then(({ settings, timer, license }) => {
    if (isBlockingActive(settings, timer, license) && hostMatchesSite(url, settings.blockedSites)) {
      void chrome.tabs.update(tabId, { url: chrome.runtime.getURL(BLOCKED_PAGE) });
    }
  });
});

// ---------- music (played from an offscreen document) ----------

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK" as chrome.offscreen.Reason],
      justification: "Plays focus music and ambient noise while you work.",
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function sendToOffscreen(message: OffscreenMessage): Promise<void> {
  // The offscreen script may need a moment to register its listener after creation.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = (await chrome.runtime.sendMessage(message)) as { ok: boolean; error?: string } | undefined;
      if (response && !response.ok) throw new Error(response.error ?? "Playback failed");
      return;
    } catch (err) {
      if (!String(err).includes("Receiving end does not exist") || attempt === 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function saveMusic(music: MusicState): Promise<void> {
  await chrome.storage.local.set({ music });
}

async function playMusic(trackId?: string): Promise<void> {
  const { settings, music } = await loadState();
  const tracks = allTracks(settings);
  const track = tracks.find((t) => t.id === (trackId ?? music.trackId)) ?? tracks[0];
  await ensureOffscreen();
  try {
    await sendToOffscreen({ target: "offscreen", type: "play", track, volume: music.volume });
    await saveMusic({ ...music, playing: true, trackId: track.id, error: undefined });
  } catch (err) {
    await stopMusic(`Couldn't play "${track.name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function stopMusic(error?: string): Promise<void> {
  const { music } = await loadState();
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  await saveMusic({ ...music, playing: false, error });
}

async function setVolume(volume: number): Promise<void> {
  const { music } = await loadState();
  await saveMusic({ ...music, volume });
  if (music.playing && (await chrome.offscreen.hasDocument())) {
    await sendToOffscreen({ target: "offscreen", type: "volume", volume });
  }
}

async function followTimerWithMusic(focusRunning: boolean): Promise<void> {
  const state: AppState = await loadState();
  if (!state.settings.musicFollowsTimer) return;
  if (focusRunning && !state.music.playing) await playMusic();
  if (!focusRunning && state.music.playing) await stopMusic();
}

// ---------- free trial and license (Dodo Payments) ----------

async function saveLicense(license: LicenseState): Promise<void> {
  await chrome.storage.local.set({ license });
}

/** Stops everything once the trial is over and no license is active. */
async function lockFeatures(notify: boolean): Promise<void> {
  const { license } = await loadState();
  if (hasAccess(license)) return;
  await chrome.alarms.clear(TRIAL_ALARM);
  await pauseTimer();
  await stopMusic();
  await syncBlocking();
  await updateBadge();
  if (notify) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Your free trial has ended",
      message: `Thanks for trying BlockTheNoise! Unlock it for a one-time ${PRICE_LABEL} to keep blocking the noise.`,
      priority: 2,
    });
  }
}

async function callLicenseApi(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${DODO_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function activateLicense(rawKey: string): Promise<void> {
  const key = rawKey.trim();
  if (!key) throw new Error("Enter the license key from your purchase email.");

  let response: Response;
  try {
    response = await callLicenseApi("/licenses/activate", { license_key: key, name: "BlockTheNoise for Chrome" });
  } catch {
    throw new Error("Couldn't reach the license server. Check your internet connection and try again.");
  }
  if (!response.ok) {
    const reasons: Record<number, string> = {
      404: "That license key wasn't found. Check it against your purchase email.",
      403: "That license key isn't active. If you were refunded, it no longer works.",
      422: "That license key has already been activated the maximum number of times.",
    };
    throw new Error(reasons[response.status] ?? `Activation failed (error ${response.status}). Please try again.`);
  }

  const instance = (await response.json()) as { id: string; product?: { product_id?: string } };
  if (DODO_PRODUCT_ID && instance.product?.product_id !== DODO_PRODUCT_ID) {
    // A key for some other product: undo the activation so it isn't used up.
    void callLicenseApi("/licenses/deactivate", { license_key: key, license_key_instance_id: instance.id }).catch(() => {});
    throw new Error("That license key is for a different product.");
  }

  const { license } = await loadState();
  const now = Date.now();
  await saveLicense({ ...license, key, instanceId: instance.id, activatedAt: now, lastValidatedAt: now });
  await chrome.alarms.clear(TRIAL_ALARM);
}

/** Re-checks the license weekly so refunded or disabled keys stop working. Offline failures are ignored. */
async function revalidateLicense(): Promise<void> {
  const { license } = await loadState();
  if (!license.key || !license.instanceId) return;
  if (Date.now() - (license.lastValidatedAt ?? 0) < LICENSE_RECHECK_MS) return;

  let valid: boolean;
  try {
    const response = await callLicenseApi("/licenses/validate", {
      license_key: license.key,
      license_key_instance_id: license.instanceId,
    });
    if (response.status === 404) valid = false;
    else if (!response.ok) return; // server trouble: try again tomorrow
    else valid = Boolean(((await response.json()) as { valid?: boolean }).valid);
  } catch {
    return; // offline: try again tomorrow
  }

  if (valid) {
    await saveLicense({ ...license, lastValidatedAt: Date.now() });
  } else {
    await saveLicense({ installedAt: license.installedAt });
    await lockFeatures(true);
  }
}
