#!/usr/bin/env node
/*
 * Break Time backend — zero-dependency Node server.
 * Serves the public site (rendered from public/template.html + editable content),
 * a password-protected admin panel at /admin, image uploads, and form submissions.
 *
 * Config (environment variables, or a local .env file):
 *   PORT            default 3000
 *   ADMIN_PASSWORD  admin login password (default "breaktime-admin" — CHANGE THIS)
 *   DATA_DIR        where content.json + submissions.json live (default ./data)
 *   UPLOAD_DIR      where uploaded images live (default ./uploads)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- tiny .env loader (real env vars win) ----------
const BASE = __dirname;
try {
  for (const line of fs.readFileSync(path.join(BASE, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — fine */ }

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(BASE, 'data'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(BASE, 'uploads'));
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const TEMPLATE = fs.readFileSync(path.join(BASE, 'public/template.html'), 'utf8');
const ADMIN_HTML = path.join(BASE, 'public/admin.html');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'breaktime-admin';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠  ADMIN_PASSWORD is not set — using default "breaktime-admin". Set it before going live!');
}
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();      // token -> expiresAt
const loginAttempts = new Map(); // ip -> [timestamps]

// ---------- first-boot seeding ----------
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const kind of ['gallery', 'poster', 'shop', 'misc']) fs.mkdirSync(path.join(UPLOAD_DIR, kind), { recursive: true });
if (!fs.existsSync(CONTENT_FILE)) {
  fs.copyFileSync(path.join(BASE, 'seed/content.json'), CONTENT_FILE);
  console.log('Seeded content.json from seed/content.json');
}
const defaultUploads = path.join(BASE, 'uploads');
if (path.resolve(defaultUploads) !== UPLOAD_DIR && fs.readdirSync(path.join(UPLOAD_DIR, 'gallery')).length === 0) {
  copyDir(defaultUploads, UPLOAD_DIR);
  console.log('Seeded uploads from ./uploads');
}
if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, '[]');

// ---------- content ----------
function loadContent() {
  const c = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
  c.event = c.event || {}; c.texts = c.texts || {};
  for (const k of ['rules', 'pastEvents', 'stats', 'shop', 'gallery']) if (!Array.isArray(c[k])) c[k] = [];
  return c;
}
function saveContent(content) {
  try { fs.copyFileSync(CONTENT_FILE, CONTENT_FILE + '.bak'); } catch { /* first save */ }
  const tmp = CONTENT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(content, null, 2));
  fs.renameSync(tmp, CONTENT_FILE);
}

// ---------- rendering ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeJson = obj => JSON.stringify(obj).replace(/</g, '\\u003c');
const lines = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);

function renderSite(content) {
  const ev = content.event, tx = content.texts;
  const lumaId = (String(ev.rsvpUrl || '').match(/evt-[A-Za-z0-9]+/) || [''])[0];
  let out = TEMPLATE;
  out = out.replace('__EVENT_JSON__', safeJson({
    name: ev.name, date: ev.date || null, end: ev.end || null, format: ev.format,
    venue: ev.venue, venueDetail: ev.venueDetail, code: ev.code, tag: ev.tag, rsvpUrl: ev.rsvpUrl,
  }));
  out = out.replace('__GALLERY_JSON__', safeJson(content.gallery.map(g => ({
    src: g.src, thumb: g.thumb || g.src, caption: g.caption || '', credit: g.credit || '', alt: g.alt || '',
  }))));
  out = out.replace('__SHOP_JSON__', safeJson(content.shop));
  out = out.replace('__POSTER_SRC__', esc(ev.poster || ''));
  out = out.replaceAll('%%POSTER_ALT%%', esc(ev.posterAlt || ''));
  out = out.replaceAll('%%RSVP_URL%%', esc(ev.rsvpUrl || '#'));
  out = out.replaceAll('%%LUMA_ID%%', esc(lumaId));
  out = out.replaceAll('%%DETAIL_LINE%%', esc(ev.detailLine || ''));
  out = out.replace('%%WHY_CMD1%%', lines(tx.whyCommands).map(l =>
    `<p><span class="p" aria-hidden="true">&gt; </span>${esc(l)}</p>`).join('\n            '));
  out = out.replace('%%WHY_CMD2%%', lines(tx.whyCommands2).map(l => `<p>${esc(l)}</p>`).join('\n            '));
  out = out.replace('%%RULES%%', '\n' + content.rules.map(r =>
    `          <li><span class="p" aria-hidden="true">&gt;</span><p><b>${esc(r.title)}</b>${r.body ? ' ' + esc(r.body) : ''}</p></li>`).join('\n') + '\n        ');
  out = out.replace('%%PAST_EVENTS%%', '\n' + content.pastEvents.map(p => {
    const link = p.linkUrl && p.linkUrl !== '#'
      ? `<a href="${esc(p.linkUrl)}" target="_blank" rel="noopener">${esc(p.linkText || 'Field report')}</a>`
      : `<a href="#" data-ph aria-disabled="true">${esc(p.linkText || 'Field report')}</a>`;
    const time = p.dateISO
      ? `<time datetime="${esc(p.dateISO)}">${esc(p.dateLabel)}</time>` : esc(p.dateLabel);
    return `          <li class="evrow" data-format="${esc(p.format)}">\n            <p class="code">${esc(p.code)}</p>\n            <div><h4>${esc(p.title)}</h4><p class="mono dim">${esc(p.meta)}</p></div>\n            <p class="mono">${time}</p>\n            <p><span class="tag">${esc(p.format)}</span></p>\n            ${link}\n          </li>`;
  }).join('\n') + '\n        ');
  out = out.replace('%%STATS%%', '\n' + content.stats.map(s =>
    `          <li><div class="num" data-n="${parseInt(s.value, 10) || 0}" role="img" aria-label="${parseInt(s.value, 10) || 0} plus"></div><p class="mono">${esc(s.label)}</p></li>`).join('\n') + '\n        ');
  out = out.replace(/%%TEXTBR:(\w+)%%/g, (_, k) => esc(tx[k] || '').replace(/\r?\n/g, '<br>'));
  out = out.replace(/%%TEXTATTR:(\w+)%%/g, (_, k) => esc(tx[k] || ''));
  out = out.replace(/%%TEXT:(\w+)%%/g, (_, k) => esc(tx[k] || ''));
  return out;
}

// ---------- HTTP helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) { return JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function isAdmin(req) {
  const token = cookies(req).bt_admin;
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();

// ---------- validation / cleaning for admin saves ----------
const str = (v, max = 5000) => String(v ?? '').slice(0, max);
const okUrl = u => !u || /^(https?:\/\/|\/|#)/i.test(u);
function cleanContent(input) {
  if (!input || typeof input !== 'object') throw new Error('content must be an object');
  const ev = input.event || {};
  for (const k of ['date', 'end']) {
    if (ev[k] && Number.isNaN(Date.parse(ev[k]))) throw new Error(`event.${k} is not a valid date/time — use e.g. 2026-11-01T16:00:00+01:00`);
  }
  if (!okUrl(str(ev.rsvpUrl, 1000))) throw new Error('event.rsvpUrl must be a web link (https://…)');
  const texts = {};
  for (const [k, v] of Object.entries(input.texts || {})) if (/^\w+$/.test(k)) texts[k] = str(v);
  const listOf = (arr, max, fn) => (Array.isArray(arr) ? arr.slice(0, max) : []).map(fn);
  return {
    version: 1,
    event: {
      name: str(ev.name, 200), date: str(ev.date, 100), end: str(ev.end, 100), format: str(ev.format, 200),
      venue: str(ev.venue, 300), venueDetail: str(ev.venueDetail, 500), detailLine: str(ev.detailLine, 500),
      code: str(ev.code, 100), tag: str(ev.tag, 100), rsvpUrl: str(ev.rsvpUrl, 1000),
      poster: str(ev.poster, 1000), posterAlt: str(ev.posterAlt, 1000),
    },
    texts,
    rules: listOf(input.rules, 100, r => ({ title: str(r.title, 300), body: str(r.body, 1000) })),
    pastEvents: listOf(input.pastEvents, 500, (p, i) => ({
      id: str(p.id, 100) || `past-${Date.now()}-${i}`, code: str(p.code, 100), title: str(p.title, 300),
      meta: str(p.meta, 300), dateLabel: str(p.dateLabel, 100), dateISO: str(p.dateISO, 100),
      format: str(p.format, 100) || 'Break Time', linkText: str(p.linkText, 200), linkUrl: str(p.linkUrl, 1000),
    })),
    stats: listOf(input.stats, 6, s => ({ value: parseInt(s.value, 10) || 0, label: str(s.label, 200) })),
    shop: listOf(input.shop, 100, (p, i) => ({
      id: str(p.id, 100) || `prod-${Date.now()}-${i}`, name: str(p.name, 300), price: str(p.price, 100),
      label: str(p.label, 300), image: str(p.image, 1000), link: str(p.link, 1000),
    })),
    gallery: listOf(input.gallery, 2000, (g, i) => ({
      id: str(g.id, 100) || `g-${Date.now()}-${i}`, src: str(g.src, 1000), thumb: str(g.thumb, 1000),
      caption: str(g.caption, 300), credit: str(g.credit, 300), alt: str(g.alt, 500),
    })).filter(g => g.src),
  };
}

// ---------- uploads (minimal multipart parser, images only) ----------
const IMG_MAGIC = [
  { ext: 'jpg', test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: 'png', test: b => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47])) },
  { ext: 'gif', test: b => b.slice(0, 4).toString() === 'GIF8' },
  { ext: 'webp', test: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];
function parseMultipart(body, boundary) {
  const delim = Buffer.from('--' + boundary);
  const parts = []; let pos = body.indexOf(delim);
  while (pos !== -1) {
    let start = pos + delim.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    if (body.slice(start, start + 2).toString() === '\r\n') start += 2;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = body.slice(start, headerEnd).toString();
    const next = body.indexOf(delim, headerEnd + 4);
    if (next === -1) break;
    let dataEnd = next; if (body.slice(dataEnd - 2, dataEnd).toString() === '\r\n') dataEnd -= 2;
    parts.push({ headers, data: body.slice(headerEnd + 4, dataEnd) });
    pos = next;
  }
  return parts;
}
async function handleUpload(req, res, kind) {
  const ct = String(req.headers['content-type'] || '');
  const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!bm) return sendJson(res, 400, { error: 'expected multipart/form-data' });
  const body = await readBody(req, 12 * 1024 * 1024).catch(() => null);
  if (!body) return sendJson(res, 413, { error: 'file too large (max 12 MB)' });
  const filePart = parseMultipart(body, bm[1] || bm[2]).find(p => /name="file"/.test(p.headers) && /filename="[^"]+"/.test(p.headers));
  if (!filePart) return sendJson(res, 400, { error: 'no file received (field name must be "file")' });
  const kindDir = ['gallery', 'poster', 'shop', 'misc'].includes(kind) ? kind : 'misc';
  const kindPath = path.join(UPLOAD_DIR, kindDir);
  fs.mkdirSync(kindPath, { recursive: true });
  const type = IMG_MAGIC.find(t => t.test(filePart.data));
  if (!type) return sendJson(res, 400, { error: 'only JPG, PNG, WebP or GIF images are allowed' });
  const name = `u${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(kindPath, name), filePart.data);
  return sendJson(res, 201, { url: `/uploads/${kindDir}/${name}` });
}

// ---------- form submissions (Club / newsletter / radio-notify) ----------
function storeSubmission(fields, req) {
  if (fields['bot-field']) return; // honeypot: pretend success, store nothing
  const form = fields['form-name'] || fields['form'] || 'unknown';
  const data = {};
  for (const [k, v] of Object.entries(fields)) if (!['form-name', 'bot-field'].includes(k)) data[k] = v;
  const all = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
  all.push({ id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), form, data });
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(all.slice(-5000), null, 2));
}
function submissionsCsv() {
  const all = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
  const keys = [...new Set(all.flatMap(s => Object.keys(s.data || {})))];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [['id', 'at', 'form', ...keys].join(','),
    ...all.map(s => [s.id, s.at, s.form, ...keys.map(k => (s.data || {})[k])].map(cell).join(','))].join('\n');
}

// ---------- server ----------
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/healthz') return send(res, 200, 'ok');

    // public site
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const body = renderSite(loadContent());
      const etag = '"' + crypto.createHash('sha1').update(body).digest('hex') + '"';
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', { ETag: etag });
      return send(res, 200, body, { 'Content-Type': 'text/html; charset=utf-8', ETag: etag, 'Cache-Control': 'no-cache' });
    }
    // uploaded images
    if (req.method === 'GET' && p.startsWith('/uploads/')) {
      const file = path.normalize(path.join(UPLOAD_DIR, decodeURIComponent(p.slice('/uploads/'.length))));
      if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
      return send(res, 200, fs.readFileSync(file), {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=604800',
      });
    }
    // admin page (login handled inside the page)
    if (req.method === 'GET' && (p === '/admin' || p === '/admin/')) {
      return send(res, 200, fs.readFileSync(ADMIN_HTML), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (p === '/api/content' && req.method === 'GET') return sendJson(res, 200, loadContent());
    if (p === '/api/me' && req.method === 'GET') return sendJson(res, 200, { admin: isAdmin(req) });

    // website forms (the site JS posts urlencoded to '/')
    if (req.method === 'POST' && (p === '/' || p === '/api/forms')) {
      const body = (await readBody(req, 100 * 1024)).toString('utf8');
      const fields = Object.fromEntries(new URLSearchParams(body));
      storeSubmission(fields, req);
      return send(res, 200, 'OK', { 'Content-Type': 'text/plain' });
    }

    // login / logout
    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (loginAttempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
      if (recent.length >= 10) return sendJson(res, 429, { error: 'too many attempts — wait 10 minutes' });
      const { password } = await readJson(req).catch(() => ({}));
      if (!crypto.timingSafeEqual(sha256(password || ''), sha256(ADMIN_PASSWORD))) {
        recent.push(now); loginAttempts.set(ip, recent);
        return sendJson(res, 401, { error: 'wrong password' });
      }
      loginAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, now + SESSION_MS);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, JSON.stringify({ ok: true }), {
        'Content-Type': 'application/json',
        'Set-Cookie': `bt_admin=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`,
      });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      sessions.delete(cookies(req).bt_admin);
      return send(res, 200, JSON.stringify({ ok: true }), {
        'Content-Type': 'application/json',
        'Set-Cookie': 'bt_admin=; HttpOnly; Path=/; Max-Age=0',
      });
    }

    // ---- everything below needs the admin login ----
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'not logged in' });
      if (p === '/api/admin/content' && req.method === 'GET') return sendJson(res, 200, loadContent());
      if (p === '/api/admin/content' && req.method === 'PUT') {
        try {
          const cleaned = cleanContent(await readJson(req));
          saveContent(cleaned);
          return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
        } catch (e) { return sendJson(res, 400, { error: e.message }); }
      }
      if (p === '/api/admin/upload' && req.method === 'POST') return handleUpload(req, res, url.searchParams.get('kind') || 'misc');
      if (p === '/api/admin/submissions' && req.method === 'GET') return sendJson(res, 200, JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')));
      if (p === '/api/admin/submissions' && req.method === 'DELETE') { fs.writeFileSync(SUBMISSIONS_FILE, '[]'); return sendJson(res, 200, { ok: true }); }
      if (p === '/api/admin/submissions.csv' && req.method === 'GET') {
        return send(res, 200, submissionsCsv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="breaktime-submissions.csv"' });
      }
      return sendJson(res, 404, { error: 'unknown admin endpoint' });
    }

    return send(res, 404, 'not found');
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: 'server error' });
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Break Time backend running:`);
  console.log(`  site  → http://0.0.0.0:${PORT}/`);
  console.log(`  admin → http://0.0.0.0:${PORT}/admin`);
});
