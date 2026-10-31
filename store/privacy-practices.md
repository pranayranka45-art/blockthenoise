# Chrome Web Store Privacy tab: BlockTheNoise

Copy these answers into the Privacy tab of the Developer Dashboard. Each permission listed there gets its own text box.

## Single purpose

BlockTheNoise helps users stay focused while they work. It blocks distracting websites during focus time, times focus sessions and breaks with a Pomodoro timer, and plays background music suited to concentration. Each feature serves that one goal.

## Permission justifications

**storage**
Saves the user's settings in their own browser: timer lengths, the list of blocked sites, saved music tracks, the current timer state, the install date (to count the 14-day free trial) and the license key once the user buys one. Nothing is synced or sent to a server, apart from the license check described below.

**alarms**
Runs the Pomodoro timer. An alarm fires when a focus session or break ends so the extension can switch phases, even when the popup is closed. Other alarms update the minutes-remaining badge on the toolbar icon, end the free trial on time and re-check the license key once a week.

**notifications**
Tells the user when a focus session or break has ended so they know when to take a break or get back to work, and tells them once when their free trial ends.

**declarativeNetRequest**
Blocks distracting sites. When blocking is on, a single dynamic rule redirects top-level page loads of the user's blocked sites to the extension's own "blocked" page. The extension doesn't read, log or change any other web traffic.

**offscreen**
Plays focus music and ambient noise. Manifest V3 service workers can't play audio, so the extension opens an offscreen document with the AUDIO_PLAYBACK reason while music is playing and closes it when the music stops.

**Host permissions (instagram.com, youtube.com, facebook.com)**
These three sites are blocked by default. Host access lets the declarativeNetRequest rule redirect them to the blocked page, and lets the extension redirect tabs that are already open on them, including in-page navigation on single-page sites like YouTube. The extension never injects scripts into these sites and never reads their content.

**Host permissions (live.dodopayments.com, test.dodopayments.com)**
BlockTheNoise has a 14-day free trial followed by a one-time purchase sold through Dodo Payments. When the user enters the license key from their purchase email, the extension sends that key to Dodo's public license API to activate it, then re-checks it about once a week so refunded keys stop working. Only the license key, its activation ID and a fixed label ("BlockTheNoise for Chrome") are sent. Payment itself happens on Dodo's checkout page, never inside the extension.

**Optional host permissions (`*://*/*`)**
Nothing is granted at install. When the user adds a new site to their block list, the extension asks for access to that one site only, for example `*://*.reddit.com/*`, so it can redirect that site to the blocked page. The user approves each request in Chrome's own permission prompt and can refuse it.

## Remote code

**Are you using remote code?** No.

All JavaScript ships inside the extension package. The extension streams audio files (MP3 radio streams) for music playback, but it never downloads or runs code.

## Data usage

**What user data do you plan to collect?** Check **Authentication information** only.

The license key works like a credential that proves the user bought BlockTheNoise. It goes to Dodo Payments to activate and verify the purchase, and is used for nothing else. Declaring it is the safe choice, because reviewers reject listings that under-declare.

The extension doesn't collect or send:
- Personally identifiable information
- Health information
- Financial and payment information (payment happens on Dodo's checkout page, not in the extension)
- Personal communications
- Location
- Web history
- User activity
- Website content

It reads the URLs of open tabs only to check, inside the browser, whether a tab is on a blocked site. It never stores, logs or sends those URLs.

**Certifications:** check all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

The privacy policy is part of the BlockTheNoise website in `docs/` (see the README for publishing it with GitHub Pages). Paste the URL of `privacy.html`, for example `https://<your-github-username>.github.io/blockthenoise/privacy.html`, into this field.

## Notes for the reviewer (optional; paste into the "Notes" field on submission)

BlockTheNoise blocks sites with one declarativeNetRequest redirect rule that points to blocked.html, which is listed under web_accessible_resources for that reason. Music plays from an offscreen document because service workers can't play audio. The built-in radio streams are from SomaFM. No content scripts and no remote code.

Pricing: every feature is free for 14 days from install, so you can test everything without paying. After that, a one-time purchase through Dodo Payments unlocks it; the license key is checked against Dodo's public license API (live.dodopayments.com). [Optional: add a working test license key here so reviewers can try the unlock screen.]
