// DISPATCHERS: reads today's tasks from planete-online (the dispatcher login) and saves them to the TROCA-MISTO
// database in its OWN document (data/disptasks). It never touches data/tasks (the check-in copy).
// This file is separate from planete-sync.mjs on purpose: the check-in sync keeps working exactly as before.
// It only re-uses planete-fetch.mjs (login + page reader), unchanged.
// Prints only counts and status. If anything goes wrong it keeps the previous copy untouched.
import fs from 'node:fs';
import { fetchTasks } from './planete-fetch.mjs';
import { parseRegulation } from './parse-tasks.mjs';

const PROJECT = 'troca-misto';
const API_KEY = 'AIzaSyDVJE3FwFC7mYuygtvZXPAzf6xYWgkLTMM'; // the same public web key the app itself uses
const DOC = 'disptasks';
const URL = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/data/' + DOC + '?key=' + API_KEY;
const sv = (s) => ({ stringValue: String(s) });
const iv = (n) => ({ integerValue: String(Math.round(n)) });

export function buildDispDoc(parsed, now = Date.now()) {
  const a = {};
  parsed.agents.forEach((ag) => {
    const rec = { n: ag.name, t: ag.tasks.map((t) => [t.label, t.start, t.end, t.post, t.changed ? 1 : 0, t.fkey || '']) };
    if (/\bSWAP\b/i.test(ag.rmq || '')) rec.x = 'SWAP';
    if (ag.rmq) rec.r = String(ag.rmq).trim().slice(0, 40);        // the remark next to the name (CKI, FOR, SWAP, EZY…)
    if (ag.plan) rec.s = ag.plan;                                    // the service Planete has for the agent today [start, end]
    if (ag.punch && (ag.punch[0] || ag.punch[1])) rec.p = ag.punch;  // real clock-in / clock-out times
    a[ag.id] = sv(JSON.stringify(rec));
  });
  return { fields: {
    date: sv(parsed.date || ''),
    updatedAt: iv(now),
    updatedAtIso: sv(new Date(now).toISOString()),
    agentCount: iv(parsed.agents.length),
    taskCount: iv(parsed.taskCount),
    a: { mapValue: { fields: a } },
  } };
}

const HDR = { Referer: 'https://trocamisto.pt/', Origin: 'https://trocamisto.pt' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lisbonHour = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false }).format(new Date()), 10) % 24;
const isNight = () => { const h = lisbonHour(); return h >= 1 && h < 3; };   // nobody works 01:00-03:00

async function syncOnce(USER, PASS) {
  let parsed;
  try {
    parsed = await fetchTasks({ user: USER, pass: PASS, log: () => {} });
  } catch (e) {
    console.log('SKIPPED: could not read the platform — ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200));
    return false;
  }
  // a dispatcher day has about 15 people: anything much smaller means the page did not load properly
  if (!parsed.agents || parsed.agents.length < 3 || !parsed.date) {
    console.log('SKIPPED: the page looked incomplete (agents=' + (parsed.agents || []).length + ') — keeping the previous copy');
    return false;
  }
  const body = JSON.stringify(buildDispDoc(parsed));
  const res = await fetch(URL, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...HDR }, body });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
    console.log('SKIPPED: saving failed with HTTP ' + res.status + ' — ' + t);
    return false;
  }
  console.log('SAVED: date=' + parsed.date + ' agents=' + parsed.agents.length + ' tasks=' + parsed.taskCount + ' size=' + Math.round(body.length / 1024) + 'KB');
  return true;
}

async function main() {
  // test without any network: DRY_FILE=saved_page.html node tools/planete-sync-disp.mjs
  if (process.env.DRY_FILE) {
    const parsed = parseRegulation(fs.readFileSync(process.env.DRY_FILE, 'utf8'));
    const d = buildDispDoc(parsed);
    console.log('DRY RUN: date=' + parsed.date + ' agents=' + parsed.agents.length + ' tasks=' + parsed.taskCount + ' size=' + Math.round(JSON.stringify(d).length / 1024) + 'KB (nothing saved)');
    return;
  }
  const USER = process.env.PLANETE_DISP_USER;
  const PASS = process.env.PLANETE_DISP_PASS;
  if (!USER || !PASS) { console.log('STOP: secrets PLANETE_DISP_USER / PLANETE_DISP_PASS are missing'); process.exit(1); }
  const RUN_MIN = parseInt(process.env.LOOP_MINUTES || '0', 10);     // 0 = one read and stop (manual test)
  const EVERY_MS = 5 * 60 * 1000;
  const deadline = Date.now() + RUN_MIN * 60 * 1000;
  if (!RUN_MIN) { await syncOnce(USER, PASS); return; }
  while (Date.now() < deadline) {
    if (isNight()) {
      console.log('NIGHT PAUSE: waiting quietly until 03:00 (no reading)');
      while (Date.now() < deadline && isNight()) await sleep(30 * 1000);
      continue;
    }
    const t0 = Date.now();
    await syncOnce(USER, PASS);
    while (Date.now() < deadline && Date.now() - t0 < EVERY_MS) await sleep(15 * 1000);
  }
  console.log('LOOP END: handing over to the next run');
}
if (process.argv[1] && /planete-sync-disp\.mjs$/.test(process.argv[1])) main().then(() => process.exit(0));
