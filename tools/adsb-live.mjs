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
        e.e = Math.round((d / Math.max(gs, 130)) * 60);                        // minutes: distance / speed (never slower than 130 kt)
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
