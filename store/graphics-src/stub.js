// Minimal chrome.* stand-in so popup.html and blocked.html render with sample data for store screenshots.
(() => {
  const view = new URLSearchParams(location.search).get("view") ?? "focus";
  const now = Date.now();
  const focusLeft = (18 * 60 + 42) * 1000;
  const data = {
    settings: {
      blockedSites: view === "block"
        ? ["instagram.com", "youtube.com", "facebook.com", "reddit.com", "x.com", "netflix.com"]
        : ["instagram.com", "youtube.com", "facebook.com", "reddit.com"],
    },
    timer: { phase: "focus", running: true, endsAt: now + focusLeft, remainingMs: focusLeft, completedFocus: 2 },
    music: { playing: true, trackId: view === "music" ? "soma-dronezone" : "soma-groovesalad", volume: 0.65 },
  };
  try {
    localStorage.setItem("btn-popup-tab", view === "blocked" ? "focus" : view);
  } catch {}
  const noop = { addListener() {} };
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (obj) => Object.assign(data, structuredClone(obj)),
      },
      onChanged: noop,
    },
    runtime: { sendMessage: async () => ({ ok: true }), getURL: (p) => "/" + p, onMessage: noop },
    permissions: { request: async () => true },
    tabs: { getCurrent: async () => null, remove: async () => {} },
  };
})();
