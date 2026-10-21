// Reads the Flights4Staff Departures and Arrivals pages (shared login) and returns the flights.
import { chromium } from 'playwright';

const BASE = 'https://flights4staff.ana.pt/Flights4Staff/';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const flightKey = (s) => norm(s).toUpperCase().replace(/[^A-Z0-9]/g, '');   // also drops hidden characters, not only spaces

async function readTable(page, wanted) {
  // "Get more records" loads the rest of the day, a bit at a time
  const rowCount = async () => page.$$eval('table tr', (r) => r.length);
  let n0 = await rowCount();
  for (let i = 0; i < 14; i++) {
    const more = page.getByText('Get more records', { exact: true }).first();
    if (!(await more.count())) break;
    await more.click().catch(() => {});
    let grew = false;
    for (let w = 0; w < 8; w++) { await page.waitForTimeout(700); const n1 = await rowCount(); if (n1 > n0) { n0 = n1; grew = true; break; } }
    if (!grew) break;
  }
  const tables = await page.$$eval('table', (ts) => ts.map((t) => [...t.querySelectorAll('tr')].map((r) => [...r.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))));
  const main = tables.filter((t) => t.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (!main) throw new Error('no table on the page');
  const H = main[0].map((h) => h.replace(/\s+/g, ''));
  const col = (n) => H.indexOf(n);
  const need = wanted.map(col);
  if (need.some((i) => i < 0)) throw new Error('columns changed: ' + H.join(','));
  // aircraft registration: an optional column, found by its header name (never breaks the read if there is none)
  const regIdx = H.findIndex((h) => /^(reg|regn|rego|regist|acreg|a\/creg|tail|ac|a\/c)$|^(reg|regist|tail)/i.test(h));
  return { rows: main.slice(1).filter((r) => r.length >= 12 && r[col('FLTNr.')]), col, H, regIdx };
}

// optional column (never breaks the read if the site renames it)
function opt(t, r, names) {
  for (const nm of names) { const i = t.col(nm); if (i >= 0 && r[i]) return norm(r[i]).slice(0, 4); }
  return '';
}

export async function fetchFlights({ user, pass }) {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'pt-PT' })).newPage();
    await page.goto(BASE + 'Login.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1200);
    const userBox = page.locator('input[type=text]:visible, input[type=email]:visible, input:not([type]):visible').first();
    const passBox = page.locator('input[type=password]:visible').first();
    await userBox.fill(user); await passBox.fill(pass);
    await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}), passBox.press('Enter')]);
    await page.waitForTimeout(3500);
    // after the login the site first shows a management page; going back to the address fixes it
    await page.goto(BASE + 'Login.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (!/\/Flights4Staff\//i.test(new URL(page.url()).pathname) || /login/i.test(page.url())) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(2500); }
    if (/\/Enterprise\//i.test(page.url()) || /login/i.test(page.url())) throw new Error('login did not work');

    await page.goto(BASE + 'Departures.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const d = await readTable(page, ['FLTNr.', 'STD', 'ETD', 'POS', 'CKI1', 'GT', 'GREM', 'Remarks']);
    const dep = d.rows.map((r) => ({
      n: flightKey(r[d.col('FLTNr.')]), std: norm(r[d.col('STD')]), etd: norm(r[d.col('ETD')]), pos: norm(r[d.col('POS')]),
      reg: d.regIdx >= 0 ? norm(r[d.regIdx]).slice(0, 10) : '', des: opt(d, r, ['DES','DEST','Destination']), cki: norm(r[d.col('CKI1')]), gt: norm(r[d.col('GT')]), grem: norm(r[d.col('GREM')]), rem: norm(r[d.col('Remarks')]),
    }));

    await page.goto(BASE + 'Arrivals.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    let arr = [];
    try {
      const a = await readTable(page, ['FLTNr.', 'STA', 'POS']);
      arr = a.rows.map((r) => ({ reg: a.regIdx >= 0 ? norm(r[a.regIdx]).slice(0, 10) : '', n: flightKey(r[a.col('FLTNr.')]), sta: norm(r[a.col('STA')]), org: opt(a, r, ['ORG','ORIG','Origin']), gate: opt(a, r, ['GT','GATE','EXIT','Exit Door','DOOR']), pos: norm(r[a.col('POS')]) }));
    } catch (e) { /* arrivals are a bonus; departures are enough */ }
    return { dep, arr, cols: { dep: d.H, regDep: d.regIdx >= 0 ? d.H[d.regIdx] : '' } };
  } finally { await browser.close(); }
}

// Matches the flights the agents have tasks on with the flight lists.
// items: [{ key, car, n1, n2, tm }]  (n2 = the departure number when the aircraft turns around: arrives as n1, leaves as n2)
// Returns { map: { key: {c,g,p,pa,x,xt,e} }, wanted, matched }
export function buildFlightMap(items, { dep, arr }) {
  const bare = (t) => String(t || '').replace(/\+\d+$/, '');
  const pick = (list, n, tm, timeOf) => {
    const c = list.filter((f) => f.n === n);
    if (!c.length) return null;
    const exact = c.filter((f) => bare(timeOf(f)) === tm);
    if (exact.length) return exact.find((f) => !/\+/.test(timeOf(f))) || exact[0];
    if (c.length === 1) return c[0];
    // several rows (e.g. today and tomorrow) and no exact time: take the nearest one within 6 hours, today's (first listed) on a tie
    const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(bare(t)); return m ? (+m[1]) * 60 + (+m[2]) : null; };
    const want = mins(tm); if (want === null) return null;
    let best = null, bestD = 361;
    c.forEach((f) => {
      const v = mins(timeOf(f)); if (v === null) return;
      let dd = Math.abs(v - want); dd = Math.min(dd, 1440 - dd);
      if (/[+-]\d+$/.test(String(timeOf(f)).trim())) dd += 720;   // rows for other days (+1 tomorrow, -3 three days ago) are the last choice
      if (dd < bestD) { best = f; bestD = dd; }
    });
    return best;
  };
  const map = {}, miss = []; let wanted = 0, matched = 0;
  const seen = new Set();
  items.filter((it) => it && it.key && !seen.has(it.key) && seen.add(it.key)).forEach((it) => {
    wanted++;
    const first = it.car + it.n1, second = it.n2 ? it.car + it.n2 : '';
    const d = pick(dep, second || first, it.tm, (x) => x.std);
    const a = it.n2 || !d ? pick(arr, first, it.tm, (x) => x.sta) : null;
    if (!d && !a) {
      const nd = dep.filter((f) => f.n === (second || first)).length, na = arr.filter((f) => f.n === first).length;
      miss.push(it.key + (nd + na === 0 ? ' (not in the lists)' : ' (' + (nd + na) + ' rows, none at ' + it.tm + ')'));
      return;
    }
    const o = {};
    if (d) {
      if (d.des) o.d = d.des;
      if (d.cki) o.c = d.cki;
      if (d.gt) o.g = d.gt;
      if (d.pos) o.p = d.pos;
      if (/cancel/i.test(d.rem)) o.x = 'C';
      else if (/gate closed/i.test(d.rem)) { o.x = 'G'; const m = /(\d{1,2}:\d{2})/.exec(d.grem); if (m) o.xt = m[1]; }
      if (d.etd && bare(d.etd) !== bare(d.std)) o.e = bare(d.etd);
    }
    if (a && a.org) o.o = a.org;
    if (a && a.gate) o.ga = a.gate;
    if (a && a.pos) { o.pa = a.pos; if (!o.p) o.p = a.pos; }
    { const rg = (d && d.reg) || (a && a.reg); if (rg) o.r = rg; }
    map[it.key] = o; matched++;
  });
  return { map, wanted, matched, miss };
}
