# Break Time — website + backend

Your joined Break Time site, plus a small backend so you can **edit and upload without touching code**.
No database and no packages to install — it runs on plain Node.js (18+).

- **Public site:** `/` — same design as `Break Time (Joined).html`, but all content is injected by the server
- **Admin panel:** `/admin` — log in with one password, edit, hit save, and the live site updates instantly

## What you can edit in /admin

| Tab | What it controls |
|---|---|
| **Next event** | Name, dates, venue, code, RSVP/Luma link, detail line, and the **poster (upload a new one)**. Drives the hero status, countdown, both Next-event blocks, the Upcoming row and the Add-to-calendar file |
| **Gallery** | Upload photos (go to the front), edit captions/alt text, reorder, remove. Order = slideshow + photo strip + scrolling reel order. Your existing 222 photos are already in there as real files |
| **Past events** | Add/edit/reorder/delete past events, including format filters and field-report links |
| **Shop** | Products with photo upload, label, price and an optional buy link (Selar, Flutterwave, Instagram — any link) |
| **Page text & rules** | Hero lines, all “Why FEINVILLE” copy, About/mission/vision, club blurb, radio text, rules intro, the Ville rules list, and the “Community in numbers” stats |
| **Form submissions** | Club sign-ups, newsletter and radio-notify submissions from the site, with CSV download |

A few things stay fixed in the page template (section headings, layout, the Field Reports placeholder cards) — ask if you want those editable too.

## Run it on your computer

```bash
cd breaktime-backend
ADMIN_PASSWORD=[SECURITY_DATA] npm start
```

Then open http://localhost:3000 (site) and http://localhost:3000/admin (log in with that password).

To make the password permanent, copy `.env.example` to `.env` and set it there instead.

> If you don't set `ADMIN_PASSWORD`, the default is `breaktime-admin` and the server prints a warning.
> **Always set a strong one before putting this on the internet.**

## Put it live (pick one)

The backend and website are one app, so you deploy this folder and both go live together.

### Option A — Render (easiest, has a free tier)
1. Push this folder to a GitHub repo.
2. On render.com: **New → Web Service**, connect the repo. Build command: leave empty. Start command: `npm start`.
3. Add environment variable `ADMIN_PASSWORD` = your password.
4. Done — your site is at `https://your-name.onrender.com`, admin at `/admin`.

⚠️ **Storage warning (all hosts):** edits and uploads are saved to disk (`data/`, `uploads/`).
On free/ephemeral hosting they are wiped on every redeploy/restart. For permanence on Render,
attach a **Disk** mounted at `/var/data` (paid, ~$0.25/GB/month) and set:
`DATA_DIR=/var/data` and `UPLOAD_DIR=/var/data/uploads`. The server seeds itself from the
bundled defaults on first boot, so it comes up with your current site either way.
`render.yaml` in this folder is a starter blueprint with those lines commented in.

### Option B — Railway
1. New project → deploy from GitHub repo (it detects Node, runs `npm start`).
2. Set `ADMIN_PASSWORD` in Variables.
3. For permanent storage, add a **Volume** and set `DATA_DIR` / `UPLOAD_DIR` into it as above.

### Option C — VPS (Hetzner, DigitalOcean, Contabo…)
```bash
# on the server, with Node 18+ installed
git clone <your repo> breaktime && cd breaktime
ADMIN_PASSWORD=[SECURITY_DATA] npm start          # or use pm2: pm2 start server.js --name breaktime
```
Then point your domain at it with a reverse proxy (Caddy is one line: `breaktime.live { reverse_proxy localhost:3000 }`, and gives you HTTPS automatically).

## How it works

- `server.js` — the whole backend (no dependencies, so nothing to break or install)
- `public/template.html` — your site design with placeholders; the server fills them from…
- `data/content.json` — everything editable (event, texts, rules, past events, stats, shop, gallery list). A backup `content.json.bak` is kept on every save
- `uploads/` — poster + gallery + product photos as normal files (this is also where new uploads land)
- `public/admin.html` — the admin panel
- `data/submissions.json` — form submissions
- `seed/content.json` — factory defaults, used on first boot in a fresh environment
- `tools/build_from_joined.py` — the script that originally converted `Break Time (Joined).html` into this project (re-runnable if you ever want to regenerate from the static file; note it resets content to the static file's)

## Good to know

- **Forms:** the site's forms used to post to Netlify. On this backend they save into Form submissions instead (success messages work the same). If you deploy the *static* HTML to Netlify again, submissions go back to Netlify.
- **RSVP:** still runs through Luma — just paste the new event's Luma link in Next event when it changes.
- **Images:** uploads accept JPG/PNG/WebP/GIF up to 12 MB. Big phone photos will load slowly on the site — resizing them first (e.g. to ~1600px wide) keeps pages fast.
- **Backups:** copy `data/` and `uploads/` somewhere safe now and then — that *is* your website's content.
- **Security:** admin is one password + an HttpOnly session cookie, with login rate-limiting. Use a strong unique password, and serve over HTTPS (Render/Railway/Caddy all provide it) so the password is encrypted in transit.
