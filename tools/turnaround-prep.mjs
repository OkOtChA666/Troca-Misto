// Prepares the day's TURNAROUNDS in the TROCA-MISTO database (data/turnaround): for every arrival with a matching departure
// (same registration, else the next flight number) it saves an empty turnaround 1 hour before the arrival, marked _auto,
// so it stays in the app until midnight like one typed by hand. It never touches a turnaround that already exists.
// Reads only data/flightlist (saved by the Planete sync) and data/flightairlines. Needs no password or secret.
const PROJECT = 'troca-misto';
const API_KEY = 'AIzaSyDVJE3FwFC7mYuygtvZXPAzf6xYWgkLTMM'; // the same public web key the app itself uses
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/data/';
const HDR = { Referer: 'https://trocamisto.pt/', Origin: 'https://trocamisto.pt' };
const AIRLINES_DEFAULT = 'HV,TO,U2,EC,DS,AY,SK,DY,D8,DX,V7,SN,EW,E4,W6,W4,W9,LG,TB,X3,6B,OR,BY,FI,TS,BT,QS';   // used only if the app's own list cannot be read

const flSplit = (n) => { const m = /^([A-Z0-9]{2,3}?)(\d{1,4}[A-Z]?)$/.exec(String(n || '').toUpperCase()); return m ? { code: m[1], num: m[2] } : { code: '', num: String(n || '') }; };
const sfKey = (n) => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const flTime = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; };
const flMin = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const flToday = (t) => !/[+-]\d+\s*$/.test(String(t || '').trim());

// Same pairing as the app (taPairLookup): the departure with the same registration, else the next number of the same airline (only if unique)
function pairOf(data, arrRow) {
  const reg = String(arrRow.reg || '').trim().toUpperCase(), f = flSplit(arrRow.n), dep = data.dep || [];
  let m = reg ? dep.filter((r) => String(r.reg || '').trim().toUpperCase() === reg) : [];
  if (!m.length) {
    const num = parseInt(f.num, 10) + 1;
    m = dep.filter((r) => { const g = flSplit(r.n), rr = String(r.reg || '').trim().toUpperCase(); return g.code === f.code && parseInt(g.num, 10) === num && (!reg || !rr || rr === reg); });
  }
  return m.length === 1 ? m[0] : null;
}
// existing = Set of keys already in the turnaround document, plus every _arr / _dep they are linked to
export function prep(data, nowMin, airlines, existing) {
  const keep = {}; String(airlines).split(/[\s,;]+/).forEach((c) => { c = c.trim().toUpperCase(); if (c) keep[c] = 1; });
  const out = [];
  (data.arr || []).forEach((r) => {
    const f = flSplit(r.n);
    if (!f.code || !keep[f.code] || !flToday(r.sta)) return;
    const am = flMin(flTime(r.eta) || flTime(r.sta));
    if (am === null || nowMin < am - 60) return;
    const d = pairOf(data, r); if (!d) return;
    const arr = sfKey(r.n), dep = sfKey(d.n);
    const dm = flMin(flTime(d.etd) || flTime(d.std));
    if (dm !== null && nowMin > dm) return;
    if (existing.has(arr) || existing.has(dep)) return;
    out.push({ arr, dep, dm: dm === null ? 0 : dm });
  });
  return out;
}
const sv = (s) => ({ stringValue: String(s) });
const iv = (n) => ({ integerValue: String(Math.round(n)) });
function lisbon() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, min: +p.hour * 60 + +p.minute };
}
async function once() {
  const t = lisbon();
  const g = await fetch(BASE + 'flightlist?key=' + API_KEY, { headers: HDR });
  if (!g.ok) { console.log('FLIGHTLIST: HTTP ' + g.status); return; }
  const gj = await g.json(), f = (gj.fields || {});
  if (!f.json) { console.log('FLIGHTLIST: empty'); return; }
  const data = JSON.parse(f.json.stringValue);
  let airlines = AIRLINES_DEFAULT;
  try { const a = await fetch(BASE + 'flightairlines?key=' + API_KEY, { headers: HDR }); if (a.ok) { const aj = await a.json(); if (aj.fields && aj.fields.codes) airlines = aj.fields.codes.stringValue; } } catch (e) {}
  const existing = new Set();
  const r = await fetch(BASE + 'turnaround?key=' + API_KEY, { headers: HDR });
  if (r.ok) {
    const rf = (await r.json()).fields || {};
    Object.keys(rf).forEach((k) => {
      existing.add(k);
      const mf = rf[k] && rf[k].mapValue && rf[k].mapValue.fields || {};
      if (mf._arr && mf._arr.stringValue) existing.add(mf._arr.stringValue);
      if (mf._dep && mf._dep.stringValue) existing.add(mf._dep.stringValue);
    });
  } else if (r.status !== 404) { console.log('TURNAROUND: HTTP ' + r.status + ' (nothing written)'); return; }
  const todo = prep(data, t.min, airlines, existing);
  if (!todo.length) { console.log('PREP: nothing new (existing=' + existing.size + ')'); return; }
  const fields = {};
  todo.forEach((p) => { fields[p.arr] = { mapValue: { fields: { _day: sv(t.day), _createdAt: iv(Date.now()), _arr: sv(p.arr), _dep: sv(p.dep), _auto: { booleanValue: true }, _dm: iv(p.dm) } } }; });
  const mask = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent('`' + k + '`')).join('&');
  const w = await fetch(BASE + 'turnaround?key=' + API_KEY + '&' + mask, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...HDR }, body: JSON.stringify({ fields }) });
  console.log('PREP: ' + (w.ok ? 'saved ' + todo.map((p) => p.arr + '>' + p.dep).join(' ') : 'HTTP ' + w.status));
}
if (process.argv[1] && process.argv[1].endsWith('turnaround-prep.mjs')) {
  const RUN_MIN = parseInt(process.env.LOOP_MINUTES || '0', 10), t0 = Date.now();
  do {
    try { await once(); } catch (e) { console.log('PREP ERROR: ' + String(e && e.message ? e.message : e).slice(0, 160)); }
    if (!RUN_MIN) break;
    await new Promise((res) => setTimeout(res, 120000));
  } while (Date.now() - t0 < RUN_MIN * 60000);
  console.log('LOOP END');
}
