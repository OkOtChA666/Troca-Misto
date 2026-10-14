// Reads today's tasks from planete-online and saves them to the TROCA-MISTO database (data/tasks).
// Prints only counts and status. If anything goes wrong it keeps the previous copy untouched.
import { fetchTasks } from './planete-fetch.mjs';
import { fetchFlights, buildFlightMap } from './f4s-fetch.mjs';


const PROJECT = 'troca-misto';
const API_KEY = 'AIzaSyDVJE3FwFC7mYuygtvZXPAzf6xYWgkLTMM'; // the same public web key the app itself uses
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/data/';
const URL = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/data/tasks?key=' + API_KEY;

// Firestore REST value encoding
export const sv = (s) => ({ stringValue: String(s) });
export const iv = (n) => ({ integerValue: String(Math.round(n)) });
// ---- change detection: compares the new read with the previous one, per agent ----
const norm = (l) => String(l || '').replace(/^<\s*/, '').trim();
const tup = (t) => ({ l: norm(t[0]), s: t[1], e: t[2], c: t[4] ? 1 : 0 });
const key = (x) => [x.l, x.s, x.e, x.c].join('|');
export function diffTasks(prevT, newT) {
  const P = prevT.map(tup), N = newT.map(tup);
  const pool = new Map();
  P.forEach((x) => { const k = key(x); (pool.get(k) || pool.set(k, []).get(k)).push(x); });
  const added = [];
  N.forEach((x) => { const l = pool.get(key(x)); if (l && l.length) l.pop(); else added.push(x); });
  const removed = []; pool.forEach((l) => l.forEach((x) => removed.push(x)));
  const out = [];
  removed.forEach((r) => {
    const i = added.findIndex((a) => a.l === r.l);
    if (i >= 0) {
      const a = added.splice(i, 1)[0];
      if (r.s !== a.s || r.e !== a.e) out.push(r.l + ': ' + r.s + '–' + r.e + ' → ' + a.s + '–' + a.e);
      else out.push(r.l + (a.c ? ': alterada pelo coordenador' : ': atualizada'));
    } else out.push('Removida: ' + r.l + ' ' + r.s + '–' + r.e);
  });
  added.forEach((a) => out.push('Nova: ' + a.l + ' ' + a.s + '–' + a.e));
  return out;
}
// prev = { date, a:{id:jsonString}, ch:{id:jsonString} } read back from the database (or null)
export function buildChanges(parsed, prev, now = Date.now()) {
  const ch = {};
  if (!prev || prev.date !== parsed.date) return ch;       // new day: start clean
  parsed.agents.forEach((ag) => {
    let hist = [];
    try { hist = prev.ch && prev.ch[ag.id] ? JSON.parse(prev.ch[ag.id]) : []; } catch (e) { hist = []; }
    const before = prev.a && prev.a[ag.id];
    if (before) {
      try {
        const pt = JSON.parse(before).t || [];
        const nt = ag.tasks.map((t) => [t.label, t.start, t.end, t.post, t.changed ? 1 : 0]);
        diffTasks(pt, nt).forEach((txt) => hist.push([now, txt]));
      } catch (e) {}
    }
    hist = hist.slice(-8);
    if (hist.length) ch[ag.id] = hist;
  });
  return ch;
}
export function readPrev(json) {
  try {
    const f = json.fields || {};
    const mapStr = (m) => { const o = {}; const ff = (m && m.mapValue && m.mapValue.fields) || {}; Object.keys(ff).forEach((k) => { o[k] = ff[k].stringValue; }); return o; };
    return { date: f.date && f.date.stringValue, a: mapStr(f.a), ch: mapStr(f.ch), flights: f.flights && f.flights.stringValue, flightsAt: f.flightsAt && parseInt(f.flightsAt.integerValue, 10) };
  } catch (e) { return null; }
}

export function buildDoc(parsed, now = Date.now(), changes = {}, fl = null) {
  const a = {};
  parsed.agents.forEach((ag) => {
    a[ag.id] = sv(JSON.stringify({ n: ag.name, t: ag.tasks.map(t => [t.label, t.start, t.end, t.post, t.changed ? 1 : 0, t.fkey || '']) }));
  });
  return {
    fields: {
      date: sv(parsed.date || ''),
      updatedAt: iv(now),
      updatedAtIso: sv(new Date(now).toISOString()),
      agentCount: iv(parsed.agents.length),
      taskCount: iv(parsed.taskCount),
      a: { mapValue: { fields: a } },
      ...(fl ? { flights: sv(fl.json), flightsAt: iv(fl.at) } : {}),
      ch: { mapValue: { fields: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, sv(JSON.stringify(v))])) } },
    },
  };
}

const HDR = { Referer: 'https://trocamisto.pt/', Origin: 'https://trocamisto.pt' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lisbonHour = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false }).format(new Date()), 10) % 24;
const isNight = () => { const h = lisbonHour(); return h >= 1 && h < 3; };   // nobody works 01:00-03:00

// One read of the platform + one save. Returns true if saved.
async function syncOnce(USER, PASS) {
  let parsed;
  try {
    parsed = await fetchTasks({ user: USER, pass: PASS, log: () => {} });
  } catch (e) {
    console.log('SKIPPED: could not read the platform — ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200));
    return false;   // keep the last good copy; the app shows its age
  }
  if (!parsed.agents || parsed.agents.length < 20 || !parsed.taskCount || !parsed.date) {
    console.log('SKIPPED: the page looked incomplete (agents=' + (parsed.agents || []).length + ', tasks=' + parsed.taskCount + ') — keeping the previous copy');
    return false;
  }
  let prev = null;
  try {
    const g = await fetch(URL, { headers: HDR });
    if (g.ok) prev = readPrev(await g.json());
  } catch (e) {}
  const now = Date.now();
  // gates / check-in desks / stands from Flights4Staff (if it fails, the last copy is kept)
  let fl = prev && prev.flights ? { json: prev.flights, at: prev.flightsAt || 0 } : null;
  const FU = process.env.F4S_USER, FP = process.env.F4S_PASS;
  if (FU && FP) {
    try {
      const f = await fetchFlights({ user: FU, pass: FP });
      const keys = []; parsed.agents.forEach((ag) => ag.tasks.forEach((t) => keys.push(t.fkey)));
      const r = buildFlightMap(keys, f);
      fl = { json: JSON.stringify(r.map), at: now };
      console.log('FLIGHTS: dep=' + f.dep.length + ' arr=' + f.arr.length + ' wanted=' + r.wanted + ' matched=' + r.matched);
    } catch (e) {
      console.log('FLIGHTS SKIPPED: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160) + ' — keeping the previous copy');
    }
  }
  const changes = buildChanges(parsed, prev, now);
  const nChanges = Object.values(changes).reduce((n, h) => n + h.filter((x) => x[0] === now).length, 0);
  const body = JSON.stringify(buildDoc(parsed, now, changes, fl));
  const res = await fetch(URL, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...HDR }, body });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
    console.log('SKIPPED: saving failed with HTTP ' + res.status + ' — ' + t);
    return false;
  }
  console.log('SAVED: date=' + parsed.date + ' agents=' + parsed.agents.length + ' tasks=' + parsed.taskCount + ' new-changes=' + nChanges + ' size=' + Math.round(body.length / 1024) + 'KB');
  return true;
}

// "Atualizar" button in the app writes a time to data/taskreq. Returns that time (ms) or 0.
async function readRequest() {
  try {
    const r = await fetch(BASE + 'taskreq?key=' + API_KEY, { headers: HDR });
    if (!r.ok) return 0;
    const j = await r.json();
    return parseInt((j.fields && j.fields.t && j.fields.t.integerValue) || '0', 10) || 0;
  } catch (e) { return 0; }
}

async function main() {
  const USER = process.env.PLANETE_USER;
  const PASS = process.env.PLANETE_PASS;
  if (!USER || !PASS) { console.log('STOP: secrets PLANETE_USER / PLANETE_PASS are missing'); process.exit(1); }
  const RUN_MIN = parseInt(process.env.LOOP_MINUTES || '0', 10);     // 0 = one read and stop (manual test)
  const EVERY_MS = 5 * 60 * 1000, MIN_GAP_MS = 60 * 1000, POLL_MS = 15 * 1000;
  const deadline = Date.now() + RUN_MIN * 60 * 1000;
  if (!RUN_MIN) { await syncOnce(USER, PASS); return; }
  let lastStart = 0, lastReq = await readRequest();
  while (Date.now() < deadline) {
    if (isNight()) { console.log('NIGHT PAUSE: stopping until the next run'); return; }
    lastStart = Date.now();
    await syncOnce(USER, PASS);
    const lastEnd = Date.now();
    let pending = false;
    // wait for the next 5-minute mark, or an "Atualizar" request (at most one read per minute)
    while (Date.now() < deadline && Date.now() - lastStart < EVERY_MS) {
      await sleep(POLL_MS);
      const req = await readRequest();
      if (req > lastReq) { lastReq = req; pending = true; }
      if (pending && Date.now() - lastEnd >= MIN_GAP_MS) { console.log('REFRESH requested from the app'); break; }
    }
  }
  console.log('LOOP END: handing over to the next run');
}
if (process.argv[1] && /planete-sync\.mjs$/.test(process.argv[1])) main().then(() => process.exit(0));
