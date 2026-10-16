// Test only: opens the "BOTH" view of Flights4Staff (arrival + departure on one row) and prints how it is built.
// It saves nothing and prints only public flight data.
import { chromium } from 'playwright';

const BASE = 'https://flights4staff.ana.pt/Flights4Staff/';
const USER = process.env.F4S_USER, PASS = process.env.F4S_PASS;
if (!USER || !PASS) { console.log('STOP: secrets F4S_USER / F4S_PASS are missing'); process.exit(1); }
const clip = (s, n = 40) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'pt-PT' })).newPage();
const tableInfo = async (label) => {
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
  console.log('   [' + label + '] url: ' + page.url().replace(/\?.*$/, '') + '  rows: ' + (main ? main.length : 0));
  if (!main) return;
  main.slice(0, 4).forEach((r, k) => console.log('     ' + (k === 0 ? 'HEAD ' : 'row' + k + ' ') + r.length + ' cols: ' + r.map((c) => clip(c, 14)).join(' | ')));
  const rows = main.filter((r) => r.length >= 10);
  const find = (re) => rows.filter((r) => r.some((c) => re.test(c))).slice(0, 2);
  ['HV ?5354', 'U2 ?8539', 'U2 ?3424'].forEach((p) => find(new RegExp(p)).forEach((r) => console.log('     ' + p + ' -> ' + r.map((c) => clip(c, 14)).join(' | '))));
};
try {
  await page.goto(BASE + 'Login.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.locator('input[type=text]:visible, input[type=email]:visible, input:not([type]):visible').first().fill(USER);
  const pb = page.locator('input[type=password]:visible').first(); await pb.fill(PASS);
  await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}), pb.press('Enter')]);
  await page.waitForTimeout(3500);
  await page.goto(BASE + 'Login.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (/login/i.test(page.url())) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(2500); }
  console.log('1. logged in, on: ' + new URL(page.url()).pathname);

  await page.goto(BASE + 'Departures.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  console.log('2. Departures page: looking for the "Both" control');
  const clickables = await page.$$eval('a, button, input[type=button], input[type=submit], li, span, label, div', (els) =>
    els.filter((e) => (e.offsetWidth || e.offsetHeight) && e.children.length === 0).map((e) => ({ t: (e.innerText || e.value || '').replace(/\s+/g, ' ').trim(), tag: e.tagName, h: e.getAttribute('href') || '', c: (e.className || '').toString().slice(0, 30) })).filter((x) => x.t && x.t.length < 25));
  const words = clickables.filter((x) => /both|ambos|arrival|departure|chegada|partida|flights|all/i.test(x.t));
  console.log('   related controls: ' + words.slice(0, 20).map((x) => x.tag + ':"' + x.t + '"' + (x.h ? '->' + x.h.replace(/\?.*$/, '').slice(0, 40) : '')).join(' | '));
  const links = await page.$$eval('a[href]', (els) => els.map((e) => e.getAttribute('href')).filter((h) => h && !/^javascript|^#/.test(h)));
  console.log('   page links: ' + [...new Set(links.map((h) => h.replace(/\?.*$/, '')))].slice(0, 25).join(' | '));

  const both = clickables.find((x) => /^(both|ambos)$/i.test(x.t));
  if (both) {
    console.log('3. clicking "' + both.t + '"');
    await page.getByText(both.t, { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(4000);
    await tableInfo('BOTH');
  } else {
    console.log('3. no "Both" control found by text; trying likely addresses');
    for (const u of ['Flights.aspx', 'Both.aspx', 'Rotations.aspx', 'Movements.aspx', 'Home.aspx']) {
      await page.goto(BASE + u, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
      console.log('   tried ' + u + ' -> ' + new URL(page.url()).pathname);
      if (/\/Flights4Staff\//i.test(page.url()) && !/login/i.test(page.url()) && (await page.$$('table tr')).length > 5) { await tableInfo(u); break; }
    }
  }
  console.log('RESULT: done');
} catch (e) { console.log('ERROR: ' + clip(e && e.message, 300)); }
finally { await browser.close(); }
