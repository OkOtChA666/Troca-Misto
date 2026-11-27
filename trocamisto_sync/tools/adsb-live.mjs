// Live position of the planes near Faro, for the "CHEGADA EM ~X MIN" line on the app's flight cards.
// Free community ADS-B data (adsb.lol, adsb.fi as a backup) — no key, no cost. Planes are matched by registration.
// Everything here is best effort: if a source is down or a plane is not seen, the app simply shows no live line.
const FAO = { lat: 37.0144, lon: -7.9659 };
const NM = 3440.065;                 // earth radius in nautical miles
const RADIUS = 150;                  // nautical miles around the airport
const rad = (d) => (d * Math.PI) / 180;
export const regKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function distNm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * NM * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Returns an array of aircraft ({r, lat, lon, alt_baro, gs, track}) or null if no source answered.
export async function fetchAdsb(fetchFn = fetch) {
  const urls = [
    'https://api.adsb.lol/v2/point/' + FAO.lat + '/' + FAO.lon + '/' + RADIUS,
    'https://opendata.adsb.fi/api/v2/lat/' + FAO.lat + '/lon/' + FAO.lon + '/dist/' + RADIUS,
  ];
  for (const u of urls) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
      const r = await fetchFn(u, { signal: ctl.signal, headers: { 'User-Agent': 'troca-misto/1.0 (shift swap board)' } });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      const list = j.ac || j.aircraft;
      if (Array.isArray(list)) return list;
    } catch (e) { /* try the next source */ }
  }
  return null;
}

// Minutes until landing from distance (nm), ground speed (kt) and altitude (ft).
// A plane descends about 3 nm per 1000 ft and slows to ~280 kt on the way down; the rest is flown at its current speed.
// A few minutes are added for the turn onto final and the speed reduction (less when it is already close).
export function etaMin(d, gs, altFt) {
  const alt = typeof altFt === 'number' && altFt > 0 ? altFt : 0;
  const speed = Math.max(gs || 0, 130);
  const descDist = Math.min(d, (alt / 1000) * 3);
  const cruiseDist = d - descDist;
  const descSpeed = Math.max(150, Math.min(speed, 280));
  const hours = cruiseDist / speed + descDist / descSpeed;
  return Math.round(hours * 60 + Math.min(4, d / 5));
}

// The airline list writes registrations without the hyphen ("OOSBE"); the ADS-B sources want "OO-SBE".
const PFX2 = ['OO','EI','EC','CS','HB','PH','LN','SE','OY','OH','SP','OK','HA','YR','LY','ES','YL','TC','UR','SX','TF','LX','OE','EW','EK','ER','LZ','YU','9A','9H','4X','A6','A7','RA','VP','VQ','ZS','SU','TS','CN','5A','JY'];
const PFX1 = ['G','D','F','I'];
export function fmtReg(raw) {
  const k = regKey(raw);
  if (/-/.test(String(raw || ''))) return String(raw).toUpperCase();
  for (const p of PFX2) if (k.startsWith(p) && k.length > p.length + 1) return p + '-' + k.slice(p.length);
  for (const p of PFX1) if (k.startsWith(p) && k.length > 3) return p + '-' + k.slice(1);
  return k;
}

// Look up single planes by registration, so a plane can be followed long before it is inside the 150 nm circle.
// raw: { KEY: 'G-EZUA' } registrations as written by the airline list; sched: { KEY: 'HH:MM' scheduled arrival }.
// Only planes due within the next ~2 h (and not already seen) are asked for, at most 12 per call, one per second.
export async function fetchFar(sched, raw, seen, nowMs, fetchFn = fetch, maxN = 24, gapMs = 1100, dep = {}) {
  const lis = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(nowMs));
  const nowMin = parseInt(lis.slice(0, 2), 10) * 60 + parseInt(lis.slice(3, 5), 10);
  // who is worth asking for: due between 20 min ago and 100 min from now (the app only shows the last 90 min), the closest ones first
  let info_late = 0;
  const todo = [];
  for (const k of Object.keys(sched)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(sched[k] || '');
    if (!m || seen.has(k) || !raw[k]) continue;
    let diff = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - nowMin;
    if (diff > 720) diff -= 1440; if (diff < -720) diff += 1440;
    if (diff < -20 || diff > 100) continue;
    todo.push({ k, diff });
  }
  todo.sort((x, y) => Math.abs(x.diff) - Math.abs(y.diff));
  // a very late plane: its arrival time has long passed, but it leaves again soon (departure time = ETD if there is one) and it is not at Faro yet
  const late = [];
  for (const k of Object.keys(dep)) {
    if (seen.has(k) || !raw[k] || todo.some((x) => x.k === k)) continue;
    const m = /^(\d{1,2}):(\d{2})$/.exec(dep[k] || '');
    if (!m) continue;
    let dd = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - nowMin;
    if (dd > 720) dd -= 1440; if (dd < -720) dd += 1440;
    if (dd < -10 || dd > 150) continue;
    late.push({ k, diff: dd });
  }
  late.sort((x, y) => x.diff - y.diff);
  late.forEach((x) => { if (todo.length < maxN) { todo.push(x); sched[x.k] = sched[x.k] || ''; } });
  info_late = late.length;
  const out = [];
  const info = { due: todo.length, late: info_late, asked: 0, found: 0, missing: [] };
  for (const t of todo.slice(0, maxN)) {
    info.asked++;
    let got = 0;
    const forms = [fmtReg(raw[t.k]), regKey(raw[t.k])].filter((v, i, a) => a.indexOf(v) === i).map(encodeURIComponent);
    const urls = []; forms.forEach((reg) => urls.push('https://api.adsb.lol/v2/reg/' + reg, 'https://opendata.adsb.fi/api/v2/registration/' + reg));
    for (const u of urls) {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
        const r = await fetchFn(u, { signal: ctl.signal, headers: { 'User-Agent': 'troca-misto/1.0 (shift swap board)' } });
        clearTimeout(tm);
        if (!r.ok) continue;
        const j = await r.json();
        const list = j.ac || j.aircraft;
        if (Array.isArray(list)) { list.forEach((a) => out.push(a)); got = list.length; if (got) break; }
      } catch (e) { /* try the next source */ }
    }
    if (got) info.found++; else info.missing.push(raw[t.k] + '@' + sched[t.k]);
    await new Promise((res) => setTimeout(res, gapMs));
  }
  out.info = info;
  return out;
}

// prev: { REG: entry } from the last minute; ac: aircraft list; sched: { REG: 'HH:MM' scheduled arrival } (also tells which planes matter)
// entry: { d: distance nm, e: minutes to land, s: 'a' air | 'g' ground, i: 1 coming in to land, ld: landed at (ms), to: took off at (ms), sa: scheduled arrival, t: last seen (ms) }
export function updateLive(prev, ac, now, sched = {}) {
  const out = {};
  const wanted = Object.keys(sched).length ? (k) => k in sched : () => true;
  const seen = new Set();
  (ac || []).forEach((a) => {
    const k = regKey(a.r); if (!k || !wanted(k)) return;
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return;
    seen.add(k);
    const p = prev[k] || null;
    const d = distNm(a.lat, a.lon, FAO.lat, FAO.lon);
    const gs = typeof a.gs === 'number' ? a.gs : 0;
    const ground = a.alt_baro === 'ground' || (typeof a.alt_baro === 'number' && a.alt_baro < 150 && gs < 50 && d < 3);
    const toward = typeof a.track === 'number' && angDiff(a.track, bearing(a.lat, a.lon, FAO.lat, FAO.lon)) < 50;
    const e = { d: Math.round(d * 10) / 10, s: ground ? 'g' : 'a', t: now };
    if (sched[k]) e.sa = sched[k];
    if (p && p.ld) e.ld = p.ld;
    if (p && p.to) e.to = p.to;
    if (ground) {
      if (d < 4 && p && p.s === 'a' && p.i && !e.ld) e.ld = now;               // was coming in, now on the ground at Faro
    } else {
      if (toward && d > 1.5) {
        e.i = 1; delete e.ld; delete e.to;                                      // a new rotation: forget the earlier landing / take-off
        e.e = etaMin(d, gs, a.alt_baro);                                        // minutes to land (see etaMin)
      } else if (p && p.s === 'g' && d < 20 && !e.to) e.to = now;              // was on the ground, now airborne and leaving
    }
    out[k] = e;
  });
  // planes that vanish from the feed low and close to the airport: they landed (or took off) out of the receivers' sight
  Object.keys(prev).forEach((k) => {
    if (seen.has(k)) return;
    const p = prev[k];
    if (now - p.t > 3 * 3600 * 1000) return;                                  // forgotten after 3 hours without a signal
    const e = { ...p };
    if (p.i && p.s === 'a' && p.d < 8 && now - p.t < 15 * 60000 && !e.ld) { e.ld = p.t; e.s = 'g'; delete e.i; delete e.e; }
    else if (now - p.t > 3 * 60000) { delete e.e; delete e.i; }               // no fresh signal: stop promising a time
    out[k] = e;
  });
  return out;
}

// Firestore REST encoding of the document the app reads (data/flightlive)
export function toDoc(live, now) {
  return { fields: { json: { stringValue: JSON.stringify(live) }, at: { integerValue: String(now) } } };
}
export function fromDoc(j) {
  try {
    const f = j.fields || {};
    const live = JSON.parse(f.json.stringValue);
    return live && typeof live === 'object' ? live : {};
  } catch (e) { return {}; }
}
