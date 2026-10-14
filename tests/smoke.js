#!/usr/bin/env node
/*
 * Smoke tests: boots the server in an isolated temp copy (your real data/uploads
 * are never touched), exercises the site + admin APIs, prints PASS/FAIL per check.
 * Run: npm test
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-test-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'seed/content.json'), path.join(tmp, 'data/content.json'));
fs.cpSync(path.join(ROOT, 'uploads'), path.join(tmp, 'uploads'), { recursive: true });

const env = { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: 'test-pw', DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: path.join(tmp, 'uploads') };
const server = spawn('node', [path.join(ROOT, 'server.js')], { env, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', d => serverLog += d);
server.stderr.on('data', d => serverLog += d);

let passed = 0, failed = 0, cookie = '';
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}
async function req(method, url, { body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + url, { method, headers, body, redirect: 'manual' });
  return { status: res.status, headers: res.headers, body: raw ? Buffer.from(await res.arrayBuffer()) : await res.text() };
}
const json = async (method, url, data) => {
  const r = await req(method, url, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  try { r.json = JSON.parse(r.body); } catch { r.json = null; }
  return r;
};
async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await req('GET', '/healthz'); if (r.status === 200) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start:\n' + serverLog);
}

(async () => {
  try {
    await waitUp();

    // --- public site ---
    let r = await req('GET', '/');
    check('site loads (200)', r.status === 200);
    check('site shows current event FEINVILLE', r.body.includes('FEINVILLE'));
    check('no template placeholders left', !/__\w+_JSON__|%%(TEXT|RULES|PAST_EVENTS|STATS|RSVP)/.test(r.body));
    check('gallery uses uploaded files, not base64', r.body.includes('/uploads/gallery/') && !r.body.includes('src:"data:image'));
    check('poster served as file', r.body.includes('/uploads/poster/feinville-poster.jpg'));
    check('past events rendered', r.body.includes('IF ART COULD RUN'));
    check('rules rendered', r.body.includes('No swag, no entry'));
    r = await req('GET', '/uploads/gallery/g001.webp');
    check('gallery image downloads', r.status === 200 && r.body.length > 1000);
    r = await req('GET', '/uploads/../server.js');
    check('path traversal blocked', r.status === 404);
    r = await req('GET', '/api/content');
    const pub = JSON.parse(r.body);
    check('public content API: 222 gallery photos', pub.gallery.length === 222, `got ${pub.gallery.length}`);

    // --- auth ---
    r = await json('GET', '/api/admin/content');
    check('admin API rejects anonymous', r.status === 401);
    r = await json('POST', '/api/login', { password: 'wrong' });
    check('wrong password rejected', r.status === 401);
    r = await json('POST', '/api/login', { password: 'test-pw' });
    check('correct password logs in', r.status === 200 && r.json.ok === true);
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    check('session cookie set (HttpOnly)', !!cookie && (r.headers.get('set-cookie') || '').includes('HttpOnly'));

    // --- editing goes live ---
    r = await json('GET', '/api/admin/content');
    const content = r.json;
    check('admin can read content', r.status === 200 && content.event.name === 'FEINVILLE');
    content.event.name = 'TESTVILLE';
    content.texts.heroLine1 = 'meet TEST people';
    content.shop[0].name = 'Test Tee';
    r = await json('PUT', '/api/admin/content', content);
    check('content save accepted', r.status === 200 && r.json.ok === true);
    r = await req('GET', '/');
    check('edit is live on the site', r.body.includes('TESTVILLE') && r.body.includes('meet TEST people') && r.body.includes('Test Tee'));
    const bad = JSON.parse(JSON.stringify(content)); bad.event.date = 'not-a-date';
    r = await json('PUT', '/api/admin/content', bad);
    check('invalid event date rejected (400)', r.status === 400 && /date/.test(r.json.error || ''));
    r = await req('GET', '/');
    check('rejected save did not corrupt site', r.body.includes('TESTVILLE'));

    // --- uploads ---
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
    r = await req('POST', '/api/admin/upload?kind=gallery', { headers: { Cookie: cookie }, body: fd, raw: true });
    const up = JSON.parse(r.body.toString());
    check('image upload works', r.status === 201 && /^\/uploads\/gallery\/.+\.png$/.test(up.url || ''), `got ${r.status} ${r.body}`);
    r = await req('GET', up.url);
    check('uploaded image is served', r.status === 200);
    const badFd = new FormData(); badFd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'bad.txt');
    r = await req('POST', '/api/admin/upload?kind=gallery', { headers: { Cookie: cookie }, body: badFd });
    check('non-image upload rejected', r.status === 400);
    r = await req('POST', '/api/admin/upload?kind=gallery', { body: badFd });
    check('upload requires login', r.status === 401);

    // --- website forms ---
    r = await req('POST', '/', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'form-name=club&name=Test+Person&email=t%40e.com&craft=Music&consent=on' });
    check('club form accepts submission', r.status === 200);
    r = await json('GET', '/api/admin/submissions');
    check('submission stored for admin', r.status === 200 && r.json.length === 1 && r.json[0].data.email === 't@e.com');
    r = await req('GET', '/api/admin/submissions.csv', { headers: { Cookie: cookie } });
    check('submissions CSV exports', r.status === 200 && r.body.includes('t@e.com'));
    // honeypot: filled bot-field must be silently dropped
    r = await req('POST', '/', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'form-name=club&name=Bot&email=b%40b.com&bot-field=x' });
    const after = await json('GET', '/api/admin/submissions');
    check('honeypot spam dropped', r.status === 200 && after.json.length === 1);

    // --- persistence across restart ---
    server.kill();
    await new Promise(r => setTimeout(r, 400));
    const server2 = spawn('node', [path.join(ROOT, 'server.js')], { env, stdio: 'pipe' });
    try {
      for (let i = 0; i < 50; i++) { try { const h = await req('GET', '/healthz'); if (h.status === 200) break; } catch { await new Promise(r => setTimeout(r, 200)); } }
      r = await req('GET', '/');
      check('edits survive a restart', r.body.includes('TESTVILLE'));
    } finally { server2.kill(); }
  } catch (e) {
    failed++;
    console.log('FAIL  test run crashed:', e.message, '\n' + serverLog);
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
