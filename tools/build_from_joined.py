#!/usr/bin/env python3
"""Builds public/template.html + seed/content.json from '../Break Time (Joined).html'.
Extracts the embedded gallery/poster into uploads/ so they become real, editable files.
Re-running is safe: it overwrites the template/content seed and re-extracts images."""
import base64, html as htmlmod, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "Break Time (Joined).html"
if not SRC.exists():
    sys.exit(f"source not found: {SRC}")
raw = SRC.read_text(encoding="utf-8")

def must_replace(old, new, label, count=1):
    global raw
    found = raw.count(old)
    assert found == count, f"{label}: expected {count}, found {found}"
    raw = raw.replace(old, new)
    print(f"OK {label}")

EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}

def save_data_uri(uri, dest_base):
    m = re.match(r"data:([^;]+);base64,(.+)$", uri, re.S)
    mime, b64 = m.group(1), m.group(2)
    ext = EXT.get(mime, "bin")
    dest = dest_base.with_suffix("." + ext)
    dest.write_bytes(base64.b64decode(b64))
    return dest

def js_unescape(s):
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s).replace('\\"', '"').replace("\\'", "'")

# ---------- 1. Gallery: extract 222 embedded photos ----------
gal_m = re.search(r"const GALLERY = \[(.*?)\n\];", raw, re.S)
assert gal_m, "GALLERY not found"
entry_re = re.compile(r'\{src:"(data:[^"]+)",thumb:"(data:[^"]+)",caption:"((?:[^"\\]|\\.)*)",credit:"((?:[^"\\]|\\.)*)",alt:"((?:[^"\\]|\\.)*)"\}')
gallery = []
for i, e in enumerate(entry_re.finditer(gal_m.group(1)), start=1):
    src_uri, thumb_uri, caption, credit, alt = e.groups()
    gid = f"g{i:03d}"
    src_path = save_data_uri(src_uri, ROOT / "uploads/gallery" / gid)
    if thumb_uri == src_uri:
        thumb_rel = f"/uploads/gallery/{src_path.name}"
    else:
        thumb_path = save_data_uri(thumb_uri, ROOT / "uploads/gallery" / f"{gid}-thumb")
        thumb_rel = f"/uploads/gallery/{thumb_path.name}"
    gallery.append({
        "id": gid,
        "src": f"/uploads/gallery/{src_path.name}",
        "thumb": thumb_rel,
        "caption": js_unescape(caption),
        "credit": js_unescape(credit),
        "alt": js_unescape(alt),
    })
print(f"OK gallery extracted: {len(gallery)} photos")
raw = raw[:gal_m.start()] + "const GALLERY = __GALLERY_JSON__;" + raw[gal_m.end():]

# ---------- 2. Poster ----------
poster_m = re.search(r'<img id="posterHome" src="(data:[^"]+)"', raw)
assert poster_m, "poster not found"
poster_path = save_data_uri(poster_m.group(1), ROOT / "uploads/poster" / "feinville-poster")
poster_rel = f"/uploads/poster/{poster_path.name}"
raw = raw.replace(poster_m.group(1), "__POSTER_SRC__", 1)
poster_alt = "Breaktime Presents FEINVILLE poster: a many-eyed chrome spider over a red-lit crowd and palm trees, 01.11.26, 4–10PM, DavSavana, Obirikwere, Port Harcourt."
must_replace(f'alt="{poster_alt}"', 'alt="%%POSTER_ALT%%"', "poster alts (home + events)", count=2)
print(f"OK poster extracted: {poster_rel}")

# ---------- 3. Next event (EVENT const, Luma links, ICS, detail lines) ----------
event_block = re.search(r"const EVENT = \{.*?\};", raw, re.S)
assert event_block
raw = raw.replace(event_block.group(0),
    "const EVENT = __EVENT_JSON__; /* editable in /admin: name, dates, venue, RSVP link, poster */", 1)
print("OK EVENT -> placeholder")
must_replace('href="https://luma.com/event/evt-WYhVJvdFPHYNrN8"', 'href="%%RSVP_URL%%"', "luma hrefs", count=2)
must_replace('data-luma-event-id="evt-WYhVJvdFPHYNrN8"', 'data-luma-event-id="%%LUMA_ID%%"', "luma ids", count=2)
must_replace('<p class="mono dim">01.11.26 · 4–10PM · DavSavana, 1st left on Minita Rd, Obirikwere, Port Harcourt</p>',
             '<p class="mono dim">%%DETAIL_LINE%%</p>', "event detail lines", count=2)
# ICS: use editable venue/RSVP instead of hardcoded strings
ics_loc = re.search(r"'LOCATION:[^']*'", raw)
assert ics_loc, "ICS location not found"
raw = raw.replace(ics_loc.group(0), "'LOCATION:' + String(EVENT.venueDetail || EVENT.venue || '').replace(/,/g, '\\\\,')", 1)
ics_desc = re.search(r"'DESCRIPTION:NO SWAG NO ENTRY\. Register: ' \+ '[^']*'", raw)
assert ics_desc, "ICS description not found"
raw = raw.replace(ics_desc.group(0), "'DESCRIPTION:NO SWAG NO ENTRY. Register: ' + (EVENT.rsvpUrl || '')", 1)
print("OK ICS uses editable event fields")

# ---------- 4. Page text placeholders ----------
T = "%%TEXT:{}%%"; TB = "%%TEXTBR:{}%%"
must_replace("&gt; </span>meet cool people</span>", f"&gt; </span>{T.format('heroLine1')}</span>", "hero line 1")
must_replace("&gt; </span>get inspired</span>", f"&gt; </span>{T.format('heroLine2')}</span>", "hero line 2")
must_replace("&gt; </span>break time<span class=\"cursor\"", f"&gt; </span>{T.format('heroLine3')}<span class=\"cursor\"", "hero line 3")
must_replace("<p>FIENVILLE is a Garden City underground experience.</p>", f"<p>{T.format('whyIntro1')}</p>", "why intro 1")
must_replace("<p>A collaboration between Break Time &amp; Nairaboyz, bringing together their people, their friends, and some of the best young creatives coming out of Port Harcourt.</p>", f"<p>{T.format('whyIntro2')}</p>", "why intro 2")
must_replace('<p class="big">One night.<br>Everybody outside.</p>', f'<p class="big">{TB.format("whyBig")}</p>', "why big")
must_replace("<p>Expect live performances, DJs, mosh pits, heavy sounds, crazy energy and a room full of Garden City people going all the way out.</p>", f"<p>{T.format('whyExpect')}</p>", "why expect")
must_replace("<p>This is where the underground comes together.</p>", f"<p>{T.format('whyClosing')}</p>", "why closing")
must_replace('<p class="t">FIENVILLE.<br>Garden City, all out.</p>', f'<p class="t">{TB.format("whySignTitle")}</p>', "why sign title")
must_replace('<p class="when">01.11.26<br>4–10PM<br>Port Harcourt, Nigeria</p>', f'<p class="when">{TB.format("whySignWhen")}</p>', "why sign when")
must_replace('<p class="by">BREAK TIME × NAIRABOYZ<br>🕷️ NO SWAG. NO ENTRY.</p>', f'<p class="by">{TB.format("whySignBy")}</p>', "why sign by")
# command lists (first has "> " markers, second is plain)
cmd_blocks = list(re.finditer(r'<div class="cmd">(.*?)</div>', raw, re.S))
assert len(cmd_blocks) == 2, f"cmd blocks: {len(cmd_blocks)}"
raw = raw.replace(cmd_blocks[0].group(0), '<div class="cmd">%%WHY_CMD1%%</div>', 1)
# re-find second after first replacement
cmd2 = re.search(r'<div class="cmd">.*?</div>', raw, re.S)
raw = raw.replace(cmd2.group(0), '<div class="cmd">%%WHY_CMD2%%</div>', 1)
print("OK why command lists")
# about
must_replace('data-t="Break Time is a Port Harcourt creative community', 'data-t="%%TEXTATTR:aboutReveal%%" data-t-src="Break Time is a Port Harcourt creative community', "about reveal attr (part 1)") if False else None
reveal_m = re.search(r'<p class="reveal" id="reveal" data-t="([^"]*)"></p>', raw)
assert reveal_m, "reveal not found"
raw = raw.replace(reveal_m.group(0), '<p class="reveal" id="reveal" data-t="%%TEXTATTR:aboutReveal%%"></p>', 1)
print("OK about reveal")
must_replace("<h3>Put Port Harcourt's creatives in the same room.</h3>", f"<h3>{T.format('missionTitle')}</h3>", "mission title")
must_replace("<p>We run nights, sessions, listening parties and open discussions for people who make things, so they can meet, get inspired and build with each other.</p>", f"<p>{T.format('missionBody')}</p>", "mission body")
must_replace("<h3>A Port Harcourt scene that is connected and visible.</h3>", f"<h3>{T.format('visionTitle')}</h3>", "vision title")
must_replace("<p>A creative community that backs its own, shows up for each other, and keeps growing well beyond any single night.</p>", f"<p>{T.format('visionBody')}</p>", "vision body")
must_replace("<p>Mixes, sessions and listening parties are coming. We'll say when it's on.</p>", f"<p>{T.format('radioStripText')}</p>", "radio strip text")
must_replace('<p class="lede">Break Time editions, sessions and listening parties in Port Harcourt.</p>', f'<p class="lede">{T.format("eventsLede")}</p>', "events lede")
must_replace('<p class="lede" style="margin:0 0 24px">Read these before you come. They apply to everyone in the room.</p>', f'<p class="lede" style="margin:0 0 24px">{T.format("rulesIntro")}</p>', "rules intro")
club_m = re.search(r'<p style="margin-top:16px;max-width:44ch">Creatives in Port Harcourt[^<]*</p>', raw)
assert club_m, "club blurb not found"
raw = raw.replace(club_m.group(0), f'<p style="margin-top:16px;max-width:44ch">{T.format("clubBlurb")}</p>', 1)
print("OK club blurb")

# ---------- 5. Rules / past events / stats: server-rendered lists ----------
rules_m = re.search(r'(<ul class="rules">).*?(</ul>)', raw, re.S)
assert rules_m
raw = raw.replace(rules_m.group(0), '<ul class="rules">%%RULES%%</ul>', 1)
print("OK rules -> placeholder")
past_m = re.search(r'(<ul class="evlist" id="pastList">).*?(</ul>)', raw, re.S)
assert past_m
past_html = past_m.group(0)
raw = raw.replace(past_html, '<ul class="evlist" id="pastList">%%PAST_EVENTS%%</ul>', 1)
print("OK past events -> placeholder")
stats_m = re.search(r'<ul class="counters">.*?</ul>', raw, re.S)
assert stats_m
raw = raw.replace(stats_m.group(0), '<ul class="counters">%%STATS%%</ul>', 1)
print("OK stats -> placeholder")
raw = raw.replace('aria-label="All 222 photos"', 'aria-label="All photos"', 1)

# parse past events defaults from the extracted HTML
past_events = []
for li in re.finditer(r'<li class="evrow" data-format="([^"]*)">(.*?)</li>', past_html, re.S):
    fmt, body = li.groups()
    def grab(pat, default=""):
        m = re.search(pat, body, re.S)
        return htmlmod.unescape(re.sub(r"<[^>]+>", "", m.group(1)).strip()) if m else default
    time_m = re.search(r'<time[^>]*?(?:datetime="([^"]*)")?[^>]*>(.*?)</time>', body, re.S)
    link_m = re.search(r'<a href="([^"]*)"[^>]*>(.*?)</a>', body, re.S)
    past_events.append({
        "id": f"past-{len(past_events)+1}",
        "code": grab(r'<p class="code">(.*?)</p>'),
        "title": grab(r"<h4>(.*?)</h4>"),
        "meta": grab(r'<p class="mono dim">(.*?)</p>'),
        "dateLabel": htmlmod.unescape(time_m.group(2).strip()) if time_m else grab(r'<p class="mono">(.*?)</p>'),
        "dateISO": (time_m.group(1) or "") if time_m else "",
        "format": htmlmod.unescape(fmt),
        "linkText": htmlmod.unescape(re.sub(r"<[^>]+>", "", link_m.group(2)).strip()) if link_m else "",
        "linkUrl": link_m.group(1) if link_m else "",
    })
print(f"OK past events parsed: {len(past_events)}")

# parse rules defaults
rules = []
for li in re.finditer(r"<li>.*?<p><b>(.*?)</b>(.*?)</p></li>", rules_m.group(0), re.S):
    rules.append({"title": htmlmod.unescape(li.group(1).strip()), "body": htmlmod.unescape(li.group(2).strip())})
print(f"OK rules parsed: {len(rules)}")

# ---------- 6. Shop: render from editable data ----------
shop_old = re.search(r"document\.getElementById\('shopList'\)\.innerHTML = Array\.from\(\{length:4\}.*?\}\)\.join\(''\);", raw, re.S)
assert shop_old, "shop placeholder JS not found"
shop_new = """const SHOP = __SHOP_JSON__; /* editable in /admin */
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.getElementById('shopList').innerHTML = SHOP.length ? SHOP.map((p, i) => {
  const n = pad(i + 1);
  const media = p.image
    ? `<div class="ph"><img src="${escHtml(p.image)}" alt="${escHtml(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`
    : `<div class="ph" role="img" aria-label="${escHtml(p.name || 'product ' + n)}">[IMG ${n}]</div>`;
  const name = p.link ? `<a href="${escHtml(p.link)}" target="_blank" rel="noopener">${escHtml(p.name)}</a>` : escHtml(p.name);
  return `<li>${media}<p class="mono dim">${escHtml(p.label)}</p><p class="pname">${name}</p><p class="mono">${escHtml(p.price)}</p></li>`;
}).join('') : '<li><p class="mono dim">&gt; shop restocking soon.</p></li>';"""
raw = raw.replace(shop_old.group(0), shop_new, 1)
print("OK shop -> editable rendering")

# ---------- 7. Write template + default content ----------
(ROOT / "public/template.html").write_text(raw, encoding="utf-8")

content = {
    "version": 1,
    "event": {
        "name": "FEINVILLE",
        "date": "2026-11-01T16:00:00+01:00",
        "end": "2026-11-01T22:00:00+01:00",
        "format": "Break Time V6",
        "venue": "DavSavana, Obirikwere, Port Harcourt",
        "venueDetail": "DavSavana, 1st left on Minita Rd, Obirikwere, Port Harcourt",
        "detailLine": "01.11.26 · 4–10PM · DavSavana, 1st left on Minita Rd, Obirikwere, Port Harcourt",
        "code": "REL/BT/006",
        "tag": "Break Time",
        "rsvpUrl": "https://luma.com/event/evt-WYhVJvdFPHYNrN8",
        "poster": poster_rel,
        "posterAlt": poster_alt,
    },
    "texts": {
        "heroLine1": "meet cool people",
        "heroLine2": "get inspired",
        "heroLine3": "break time",
        "whyIntro1": "FIENVILLE is a Garden City underground experience.",
        "whyIntro2": "A collaboration between Break Time & Nairaboyz, bringing together their people, their friends, and some of the best young creatives coming out of Port Harcourt.",
        "whyBig": "One night.\nEverybody outside.",
        "whyCommands": "Come to hang out.\nCome to rage.\nCome to dance.\nCome to hear something new.\nCome with your people.\nLeave with new ones.",
        "whyExpect": "Expect live performances, DJs, mosh pits, heavy sounds, crazy energy and a room full of Garden City people going all the way out.",
        "whyCommands2": "No stiff crowd.\nNo standing at the back.\nGet involved.",
        "whyClosing": "This is where the underground comes together.",
        "whySignTitle": "FIENVILLE.\nGarden City, all out.",
        "whySignWhen": "01.11.26\n4–10PM\nPort Harcourt, Nigeria",
        "whySignBy": "BREAK TIME × NAIRABOYZ\n🕷️ NO SWAG. NO ENTRY.",
        "aboutReveal": reveal_m.group(1),
        "missionTitle": "Put Port Harcourt's creatives in the same room.",
        "missionBody": "We run nights, sessions, listening parties and open discussions for people who make things, so they can meet, get inspired and build with each other.",
        "visionTitle": "A Port Harcourt scene that is connected and visible.",
        "visionBody": "A creative community that backs its own, shows up for each other, and keeps growing well beyond any single night.",
        "radioStripText": "Mixes, sessions and listening parties are coming. We'll say when it's on.",
        "eventsLede": "Break Time editions, sessions and listening parties in Port Harcourt.",
        "rulesIntro": "Read these before you come. They apply to everyone in the room.",
        "clubBlurb": "Creatives in Port Harcourt and across Nigeria. Music, fashion, art, tech. [PERKS: ONE LINE]",
    },
    "rules": rules,
    "pastEvents": past_events,
    "stats": [
        {"value": 111, "label": "community members"},
        {"value": 100, "label": "attendance per session"},
        {"value": 10, "label": "creatives collaborating"},
    ],
    "shop": [
        {"id": f"prod-{i}", "name": "[PRODUCT NAME]", "price": "₦[PRICE]", "label": "[DROP LABEL / SOLD OUT]", "image": "", "link": ""}
        for i in range(1, 5)
    ],
    "gallery": gallery,
}
for dest in [ROOT / "seed/content.json", ROOT / "data/content.json"]:
    dest.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nTemplate: {(ROOT/'public/template.html').stat().st_size:,} bytes")
print(f"Content: {len(gallery)} gallery, {len(past_events)} past events, {len(rules)} rules")
print("Done.")
