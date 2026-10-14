# Deploy guide — GitHub → live site

**Important distinction:** GitHub hosts the *code*. It cannot run the Node backend itself
(GitHub Pages is static-only), so the flow is:

```
this folder → push to GitHub → Render/Railway pulls from GitHub → live site + /admin
```

Every push to GitHub also runs the automated test suite (`.github/workflows/test.yml`, 28 checks).

## Step 1 — Create the GitHub repo
1. Go to github.com → **+ → New repository**
2. Name it e.g. `breaktime`
3. Set it **Public**, and do **NOT** tick "Add a README" (this project already has one — an initial commit from GitHub makes the first push messier)
4. Click **Create repository**. GitHub shows a repo URL like `https://github.com/YOURNAME/breaktime.git` — you'll need it in Step 2.

## Step 2 — Push this code
This folder is already a git repo with everything committed. From inside the folder, run:

```bash
git branch -M main
git remote add origin https://github.com/YOURNAME/breaktime.git
git push -u origin main
```

(Or, if you're reading this inside the Arena workspace: tell the assistant your repo URL
and it can show you the exact commands / check the state — it can't log in as you, so the
actual push is one command on your machine, or use GitHub Desktop / VS Code's GitHub sign-in.)

Then check the repo on GitHub: under the **Actions** tab, the "tests" workflow should go green.

## Step 3 — Go live on Render (free tier)
1. render.com → sign up with GitHub → **New → Web Service** → pick your `breaktime` repo
2. Build command: *(leave empty)* — Start command: `npm start`
3. Environment → add `ADMIN_PASSWORD` = a strong password you'll use for `/admin`
4. Create the service. Your site is live at `https://breaktime-xxxx.onrender.com` (+ `/admin`)
5. Later pushes to GitHub auto-deploy; the Actions tests run alongside

**Keep your edits/uploads permanent:** free services wipe the disk on redeploy.
Attach a Render Disk (or Railway Volume) mounted at `/var/data` and add env vars
`DATA_DIR=/var/data` and `UPLOAD_DIR=/var/data/uploads`. The server seeds itself from the
repo's defaults on first boot, so it starts with your current site either way.

## Step 4 — Custom domain (optional)
In Render: **Settings → Custom Domains** → add `breaktime.live` (or your domain) and follow
the DNS instructions. HTTPS is automatic. Same idea on Railway under **Settings → Networking**.

## Updating the site afterwards
- **Content/photos:** just use `/admin` on the live site — no GitHub needed.
- **Design/code changes:** edit locally, `npm test`, then `git add . && git commit -m "..." && git push`.
