# BlockTheNoise

A Chrome (Manifest V3) extension written in TypeScript that helps you stay focused:

- **Blocks distracting sites**: Instagram, YouTube and Facebook by default, plus any site you add. Blocked pages redirect to a calm "back to work" screen. You can block all the time or only during focus sessions.
- **Pomodoro timer**: 25 / 5 / 15 minutes by default, with a long break every 4 sessions. Shows a countdown badge on the toolbar icon and a notification when each phase ends.
- **Flow music**: built-in ambient/lo-fi radio streams (SomaFM) plus offline brown and pink noise. You can add your own stream URLs. Music can start automatically when a focus session starts and stop on breaks.

## Build

```bash
npm install
npm run build
```

The built extension is in `dist/`. Use `npm run watch` to rebuild TypeScript as you edit (run `npm run build` again after changing files in `static/`).

## Load it in Chrome / Edge / Brave

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.
4. Pin BlockTheNoise to the toolbar.

After a rebuild, click the reload icon on the extension's card.

## Project layout

| Path | What it does |
| --- | --- |
| `src/background.ts` | Service worker: timer (via `chrome.alarms`), blocking rules (`declarativeNetRequest`), music control, badge, notifications |
| `src/popup.ts` | Popup UI with Focus / Music / Block tabs |
| `src/offscreen.ts` | Offscreen document that plays audio (MV3 service workers can't) |
| `src/blocked.ts` | The page shown instead of a blocked site |
| `src/config.ts` | Trial length, price and Dodo Payments settings |
| `src/shared.ts` | Types, defaults and storage helpers used everywhere |
| `static/` | Manifest, HTML, CSS and icons, copied into `dist/` |
| `scripts/make-icons.mjs` | Regenerates the PNG icons (`npm run icons`) |

State lives in `chrome.storage.local`. The popup writes settings there, and the background worker reacts to changes.

## Free trial and payments

Every feature is free for 14 days from install. After that the popup shows an unlock screen, and blocking, the timer and music stop until the user enters a license key. The key comes from a one-time ₹800 purchase through [Dodo Payments](https://dodopayments.com), which acts as merchant of record and handles tax.

Setup, all in [src/config.ts](src/config.ts):

1. In the Dodo dashboard, create a **one-time** product priced at ₹800 and turn on **license keys** for it, with an activation limit of your choice (for example 3 browsers).
2. Copy the product ID into `DODO_PRODUCT_ID` and the product's payment link into `CHECKOUT_URL`.
3. Test with `DODO_MODE = "test"`: buy with a test card, then paste the emailed key into the popup.
4. Switch to `DODO_MODE = "live"` before publishing. `npm run package` refuses to build until all three values are set and the mode is live.

Things to know:

- The trial is counted from the install date stored in the browser, so reinstalling the extension restarts it. Stopping that would need an account system and a server.
- After activation, the key is re-checked about once a week. A refunded or disabled key locks the extension again. If the check can't reach Dodo, it just tries again later.

## Website

The `docs/` folder is the BlockTheNoise website: a home page with features, pricing and FAQ, plus the privacy policy, terms of service and refund policy that Dodo Payments and the Chrome Web Store ask for. It's plain HTML and CSS, so it needs no build step.

The contact email on every page is pranayranka45@gmail.com. Once the extension is live, swap the "Coming soon" button in `docs/index.html` for a link to your Chrome Web Store page (there's a comment showing how).

To publish it free with GitHub Pages:

1. Create a public GitHub repository named `blockthenoise` and push this project to it.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then the `main` branch and the `/docs` folder, and save.
4. After a minute or two the site is live at `https://<your-github-username>.github.io/blockthenoise/`.

Use that address as the website in Dodo Payments, and `…/privacy.html` as the privacy policy URL in the Chrome Web Store.

## Notes

- Adding a new site asks for permission to access that site. Chrome needs this to redirect it to the blocked page.
- The radio streams need an internet connection. The noise tracks are generated locally and work offline.
