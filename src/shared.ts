// Types, defaults and helpers shared by the background worker, popup, offscreen and blocked pages.

import { TRIAL_DAYS } from "./config.js";

export type Phase = "focus" | "shortBreak" | "longBreak";
export type NoiseColor = "white" | "pink" | "brown";

export interface Track {
  id: string;
  name: string;
  kind: "stream" | "noise";
  url?: string;
  noise?: NoiseColor;
  custom?: boolean;
}

export interface Settings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  autoStartNext: boolean;
  blockingEnabled: boolean;
  blockOnlyDuringFocus: boolean;
  blockedSites: string[];
  musicFollowsTimer: boolean;
  customTracks: Track[];
}

export interface TimerState {
  phase: Phase;
  running: boolean;
  /** Epoch ms when the current phase ends; only set while running. */
  endsAt: number | null;
  /** Time left in the phase; authoritative while paused. */
  remainingMs: number;
  completedFocus: number;
}

export interface MusicState {
  playing: boolean;
  trackId: string;
  volume: number;
  error?: string;
}

export interface LicenseState {
  /** Epoch ms of first install; the free trial counts from here. */
  installedAt: number;
  key?: string;
  /** Dodo Payments license key instance created when this browser activated the key. */
  instanceId?: string;
  activatedAt?: number;
  lastValidatedAt?: number;
}

export type Access =
  | { status: "licensed" }
  | { status: "trial"; daysLeft: number; endsAt: number }
  | { status: "expired"; endsAt: number };

export interface AppState {
  settings: Settings;
  timer: TimerState;
  music: MusicState;
  license: LicenseState;
}

export type BackgroundMessage =
  | { target: "background"; type: "timer:start" | "timer:pause" | "timer:reset" | "timer:skip" }
  | { target: "background"; type: "timer:resetSessions" }
  | { target: "background"; type: "music:play"; trackId?: string }
  | { target: "background"; type: "music:pause" }
  | { target: "background"; type: "music:volume"; volume: number }
  | { target: "background"; type: "music:error"; message: string }
  | { target: "background"; type: "license:activate"; key: string };

export interface BackgroundResponse {
  ok: boolean;
  error?: string;
}

export type OffscreenMessage =
  | { target: "offscreen"; type: "play"; track: Track; volume: number }
  | { target: "offscreen"; type: "volume"; volume: number };

export const DEFAULT_SITES = ["instagram.com", "youtube.com", "facebook.com"];

export const BUILTIN_TRACKS: Track[] = [
  { id: "soma-groovesalad", name: "Groove Salad · ambient downtempo", kind: "stream", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  { id: "soma-dronezone", name: "Drone Zone · atmospheric textures", kind: "stream", url: "https://ice1.somafm.com/dronezone-128-mp3" },
  { id: "soma-deepspaceone", name: "Deep Space One · deep ambient", kind: "stream", url: "https://ice1.somafm.com/deepspaceone-128-mp3" },
  { id: "soma-fluid", name: "Fluid · instrumental hip-hop", kind: "stream", url: "https://ice1.somafm.com/fluid-128-mp3" },
  { id: "noise-brown", name: "Brown noise · works offline", kind: "noise", noise: "brown" },
  { id: "noise-pink", name: "Pink noise · works offline", kind: "noise", noise: "pink" },
];

export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartNext: true,
  blockingEnabled: true,
  blockOnlyDuringFocus: false,
  blockedSites: DEFAULT_SITES,
  musicFollowsTimer: true,
  customTracks: [],
};

export const DEFAULT_MUSIC: MusicState = {
  playing: false,
  trackId: BUILTIN_TRACKS[0].id,
  volume: 0.6,
};

export const PHASE_LABELS: Record<Phase, string> = {
  focus: "Focus",
  shortBreak: "Short break",
  longBreak: "Long break",
};

export function phaseDurationMs(settings: Settings, phase: Phase): number {
  const minutes =
    phase === "focus" ? settings.focusMinutes : phase === "shortBreak" ? settings.shortBreakMinutes : settings.longBreakMinutes;
  return minutes * 60_000;
}

export function initialTimer(settings: Settings): TimerState {
  return { phase: "focus", running: false, endsAt: null, remainingMs: phaseDurationMs(settings, "focus"), completedFocus: 0 };
}

export function remainingMs(timer: TimerState, now = Date.now()): number {
  if (timer.running && timer.endsAt !== null) return Math.max(0, timer.endsAt - now);
  return timer.remainingMs;
}

export function formatMs(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function isFocusRunning(timer: TimerState): boolean {
  return timer.running && timer.phase === "focus";
}

export function getAccess(license: LicenseState, now = Date.now()): Access {
  if (license.key && license.instanceId) return { status: "licensed" };
  const endsAt = license.installedAt + TRIAL_DAYS * 86_400_000;
  if (now < endsAt) return { status: "trial", daysLeft: Math.ceil((endsAt - now) / 86_400_000), endsAt };
  return { status: "expired", endsAt };
}

export function hasAccess(license: LicenseState, now = Date.now()): boolean {
  return getAccess(license, now).status !== "expired";
}

export function isBlockingActive(settings: Settings, timer: TimerState, license: LicenseState): boolean {
  if (!hasAccess(license)) return false;
  if (!settings.blockingEnabled || settings.blockedSites.length === 0) return false;
  return settings.blockOnlyDuringFocus ? isFocusRunning(timer) : true;
}

export function allTracks(settings: Settings): Track[] {
  return [...BUILTIN_TRACKS, ...settings.customTracks];
}

/** Turns user input like "https://www.Twitter.com/home" into "twitter.com". */
export function normalizeSite(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (!/^[a-z]+:\/\//.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function hostMatchesSite(url: string, sites: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

export function originPatterns(site: string): string[] {
  return [`*://${site}/*`, `*://*.${site}/*`];
}

export async function loadState(): Promise<AppState> {
  const stored = (await chrome.storage.local.get(["settings", "timer", "music", "license"])) as Partial<AppState>;
  const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  return {
    settings,
    timer: stored.timer ?? initialTimer(settings),
    music: { ...DEFAULT_MUSIC, ...stored.music },
    // The background worker saves this on install; the fallback only covers the moment before that.
    license: stored.license ?? { installedAt: Date.now() },
  };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const { settings } = await loadState();
  const next = { ...settings, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function sendToBackground(message: BackgroundMessage): Promise<BackgroundResponse | undefined> {
  return chrome.runtime.sendMessage(message);
}
