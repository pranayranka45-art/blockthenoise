// Renders the Chrome Web Store screenshots and promo tiles into store/graphics/ using headless Chrome.
// The real popup and blocked pages are served with a small chrome.* stub (store/graphics-src/stub.js) holding sample data.
import { execFile, execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const browser = BROWSERS.find((path) => existsSync(path));
if (!browser) throw new Error("No Chrome or Edge found. Set CHROME_PATH to your browser's executable.");

const SHOTS = [
  { file: "screenshot-1-focus.png", path: "/_g/shot.html?view=focus", size: [1280, 800] },
  { file: "screenshot-2-music.png", path: "/_g/shot.html?view=music", size: [1280, 800] },
  { file: "screenshot-3-block.png", path: "/_g/shot.html?view=block", size: [1280, 800] },
  { file: "screenshot-4-blocked-page.png", path: "/blocked.html?view=blocked", size: [1280, 800] },
  { file: "promo-small-440x280.png", path: "/_g/promo.html?size=small", size: [440, 280] },
  { file: "promo-marquee-1400x560.png", path: "/_g/promo.html?size=marquee", size: [1400, 560] },
];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const STUB_TAG = '<script src="/_g/stub.js"></script>';

execSync("npm run build", { stdio: "inherit" });
execFileSync("node", ["scripts/make-icons.mjs", "512", "store/graphics-src/icon512.png"], { stdio: "inherit" });

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const file = pathname.startsWith("/_g/")
    ? resolve("store/graphics-src", pathname.slice(4))
    : resolve("dist", pathname.slice(1) || "popup.html");
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  let body = readFileSync(file);
  // Load the stub before the page's own module script.
  if (file.endsWith("popup.html") || file.endsWith("blocked.html")) {
    body = body.toString().replace('<script type="module"', `${STUB_TAG}<script type="module"`);
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;

mkdirSync("store/graphics", { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "btn-graphics-"));
try {
  for (const shot of SHOTS) {
    const out = resolve("store/graphics", shot.file);
    // Run async so this process keeps serving pages while the browser renders.
    await new Promise((done, fail) => {
      execFile(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          "--force-color-profile=srgb",
          `--user-data-dir=${profile}`,
          `--window-size=${shot.size.join(",")}`,
          "--virtual-time-budget=4000",
          `--screenshot=${out}`,
          origin + shot.path,
        ],
        (err) => (err ? fail(err) : done()),
      );
    });
    console.log(`Wrote store/graphics/${shot.file}`);
  }
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
