// Reads the Flights4Staff Departures and Arrivals pages (shared login) and returns the flights.
import { chromium } from 'playwright';

const BASE = 'https://flights4staff.ana.pt/Flights4Staff/';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const flightKey = (s) => norm(s).toUpperCase().replace(/\s/g, '');

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
  return { rows: main.slice(1).filter((r) => r.length >= 12 && r[col('FLTNr.')]), col };
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
      cki: norm(r[d.col('CKI1')]), gt: norm(r[d.col('GT')]), grem: norm(r[d.col('GREM')]), rem: norm(r[d.col('Remarks')]),
    }));

    await page.goto(BASE + 'Arrivals.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    let arr = [];
    try {
      const a = await readTable(page, ['FLTNr.', 'STA', 'POS']);
      arr = a.rows.map((r) => ({ n: flightKey(r[a.col('FLTNr.')]), sta: norm(r[a.col('STA')]), pos: norm(r[a.col('POS')]) }));
    } catch (e) { /* arrivals are a bonus; departures are enough */ }
    return { dep, arr };
  } finally { await browser.close(); }
}

// Matches the flights the agents have tasks on (key like "EW9643@17:50") with the flight lists.
// Returns { map: { key: {c,g,p,x,xt,e} }, wanted, matched }
export function buildFlightMap(taskKeys, { dep, arr }) {
  const bare = (t) => String(t || '').replace(/\+\d+$/, '');
  const pick = (list, n, tm, timeOf) => {
    const c = list.filter((f) => f.n === n);
    if (!c.length) return null;
    const exact = c.filter((f) => bare(timeOf(f)) === tm);
    if (exact.length) return exact.find((f) => !/\+/.test(timeOf(f))) || exact[0];
    return c.length === 1 ? c[0] : null;
  };
  const map = {}; let wanted = 0, matched = 0;
  [...new Set(taskKeys.filter(Boolean))].forEach((k) => {
    wanted++;
    const [n, tm] = k.split('@');
    const f = pick(dep, n, tm, (x) => x.std);
    if (f) {
      const o = {};
      if (f.cki) o.c = f.cki;
      if (f.gt) o.g = f.gt;
      if (f.pos) o.p = f.pos;
      if (/cancel/i.test(f.rem)) o.x = 'C';
      else if (/gate closed/i.test(f.rem)) { o.x = 'G'; const m = /(\d{1,2}:\d{2})/.exec(f.grem); if (m) o.xt = m[1]; }
      if (f.etd && bare(f.etd) !== bare(f.std)) o.e = bare(f.etd);
      map[k] = o; matched++; return;
    }
    const a = pick(arr, n, tm, (x) => x.sta);
    if (a) { map[k] = a.pos ? { p: a.pos } : {}; matched++; }
  });
  return { map, wanted, matched };
}
