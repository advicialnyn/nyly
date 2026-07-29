# linkstore

A short link dashboard + redirector + Telegram bot, running on **Cloudflare
Pages** (project: `nyly.pages.dev`). `links.json` lives in a GitHub repo;
Pages Functions read/write it via the GitHub API using a token stored as a
Cloudflare secret — never sent to any visitor's browser.

## File structure

```
your-repo/
├── README.md
├── public/                  ← the site itself
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── functions/                ← Pages Functions (server-side logic)
    ├── [slug].js              → handles /:slug redirects
    ├── _lib/
    │   ├── github.js           → read/write links.json via GitHub API
    │   └── telegram.js         → send messages / channel announcements
    └── api/
        ├── links.js            → /api/links (website create/list/delete)
        └── telegram.js         → /api/telegram (bot webhook)
```

## One-time project setup

This is done once, on the existing `nyly.pages.dev` project — no need to
create anything new.

1. **Settings → Build output directory** → set to `public`. This is the
   setting that was missing before; without it, Pages deploys the whole
   repo instead of just the site.
2. **Settings → Environment variables** — add:
   - `GITHUB_TOKEN` — fine-grained PAT, Contents: Read & write, scoped to
     the repo holding `links.json` → mark **Secret**
   - `GITHUB_OWNER` — your GitHub username
   - `GITHUB_REPO` — the repo holding `links.json`
   - `GITHUB_BRANCH` — usually `main`
   - `ADMIN_PASSWORD` — a passphrase you choose, to unlock the dashboard → mark **Secret**
   - Telegram variables below, if using the bot
3. **Redeploy** — env var changes only apply to new deployments.

## Telegram bot (optional)

1. `@BotFather` on Telegram → `/newbot` → copy the token.
2. Optionally make a private channel for a log of created links, add the
   bot as admin, get its ID (forward a message from it to `@userinfobot`).
3. Get your own chat ID the same way, so only you can create links via the
   bot.
4. Add env vars:
   - `TELEGRAM_BOT_TOKEN` → **Secret**
   - `TELEGRAM_ALLOWED_CHAT_ID` — your chat ID (comma-separate for more)
   - `TELEGRAM_CHANNEL_ID` — channel ID, if wanted
   - `TELEGRAM_WEBHOOK_SECRET` — random string you make up → **Secret**
   - `SITE_URL` — `https://nyly.pages.dev`
5. Redeploy.
6. Register the webhook — open once in a browser:
   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://nyly.pages.dev/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
   ```
   `{"ok":true}` means it's connected.

**Using the bot:** send a bare URL for a random slug, or `myslug
https://example.com` for a custom one. It replies with the short link, and
(if configured) logs it to the channel.

## Installing as an app

Already wired up — `manifest.json`, `sw.js`, and icons are in `public/`.
Android/Chrome shows an automatic Install banner; iOS shows manual Share →
Add to Home Screen instructions instead.

## Using it

- Short links: `https://nyly.pages.dev/<slug>`
- The dashboard passphrase lasts for the browser session.
- Anyone can follow a short link; only creating/deleting needs the
  passphrase.
- Rotate the token or passphrase any time via the environment variables —
  nothing to change on your phone.
