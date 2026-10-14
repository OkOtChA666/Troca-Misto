// Test only: logs in to Flights4Staff with the shared login and prints what the page looks like
// (column names, number of rows, a few sample rows). It saves nothing.
import { chromium } from 'playwright';

const LOGIN_URL = 'https://flights4staff.ana.pt/Flights4Staff/Login.aspx';
const USER = process.env.F4S_USER, PASS = process.env.F4S_PASS;
if (!USER || !PASS) { console.log('STOP: secrets F4S_USER / F4S_PASS are missing'); process.exit(1); }
const clip = (s, n = 60) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'pt-PT' })).newPage();
try {
  console.log('1. opening the login page');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
  const inputs = await page.$$eval('input', els => els.map(e => ({ type: e.type, name: e.name, id: e.id, vis: !!(e.offsetWidth || e.offsetHeight) })));
  console.log('   inputs: ' + inputs.filter(i => i.vis).map(i => i.type + ':' + (i.id || i.name)).join(', '));
  const userBox = page.locator('input[type=text]:visible, input[type=email]:visible, input:not([type]):visible').first();
  const passBox = page.locator('input[type=password]:visible').first();
  await userBox.fill(USER); await passBox.fill(PASS);
  console.log('2. submitting (Enter key)');
  await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}), passBox.press('Enter')]);
  await page.waitForTimeout(4000);
  let path = new URL(page.url()).pathname;
  if (/login/i.test(path)) {
    console.log('   still on login page, trying the button');
    const btn = page.locator('input[type=submit]:visible, button:visible').first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(5000); }
    path = new URL(page.url()).pathname;
  }
  console.log('3. now on: ' + path + '   title: ' + clip(await page.title()));
  if (/login/i.test(path)) { console.log('RESULT: LOGIN DID NOT WORK (still on the login page)'); process.exit(0); }

  if (/\/Enterprise\//i.test(path)) {
    console.log('   landed on the management page, going back to the Flights4Staff address and refreshing');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    path = new URL(page.url()).pathname;
    if (/\/Enterprise\//i.test(path) || /login/i.test(path)) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(3000); path = new URL(page.url()).pathname; }
    console.log('   now on: ' + path + '   title: ' + clip(await page.title()));
    if (/\/Enterprise\//i.test(path)) { console.log('RESULT: STILL ON THE MANAGEMENT PAGE — I need the real flight page address from you'); process.exit(0); }
  }
  console.log('4. menu / buttons on the page:');
  const nav = await page.$$eval('a:not([href^="javascript"]), a[href^="javascript"], input[type=submit], input[type=button], button', els =>
    els.filter(e => e.offsetWidth || e.offsetHeight).map(e => (e.innerText || e.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  console.log('   ' + [...new Set(nav)].slice(0, 40).map(t => clip(t, 30)).join(' | '));
  const sel = await page.$$eval('select', els => els.map(s => ({ id: s.id || s.name, opts: [...s.options].slice(0, 12).map(o => o.text.trim()) })));
  sel.forEach(s => console.log('   dropdown ' + s.id + ': ' + s.opts.join(' / ')));

  console.log('5. tables:');
  const tables = await page.$$eval('table', ts => ts.map(t => {
    const rows = [...t.querySelectorAll('tr')].map(r => [...r.children].map(c => c.innerText.replace(/\s+/g, ' ').trim()));
    return { rows: rows.filter(r => r.length > 1) };
  }));
  const big = tables.filter(t => t.rows.length >= 3).sort((a, b) => b.rows.length - a.rows.length).slice(0, 3);
  if (!big.length) console.log('   no table with 3+ rows found');
  big.forEach((t, i) => {
    console.log('   table ' + (i + 1) + ': ' + t.rows.length + ' rows');
    t.rows.slice(0, 4).forEach((r, k) => console.log('     ' + (k === 0 ? 'HEADER ' : 'row ' + k + ' ') + r.map(c => clip(c, 24)).join(' | ')));
  });
  console.log('RESULT (arrivals): ' + (big.length ? 'LOGIN WORKS, flight table found' : 'LOGIN WORKS, but I need to find the flight table'));

  // ---- step 6: find the departures page (gates, check-in) ----
  console.log('6. looking for the Departures page');
  const links = async () => page.$$eval('a', els => els.filter(e => e.offsetWidth || e.offsetHeight).map(e => ({ t: (e.innerText || '').replace(/\s+/g, ' ').trim(), h: e.getAttribute('href') || '' })).filter(x => x.t && x.t.length < 40));
  await page.getByText('Flights', { exact: true }).first().hover().catch(() => {});
  await page.getByText('Flights', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  const ls = await links();
  console.log('   links: ' + ls.filter(l => !/^[A-Z]{2,3} ?\d/.test(l.t)).slice(0, 25).map(l => l.t + ' -> ' + l.h.replace(/\?.*$/, '').slice(0, 50)).join(' | '));
  const dep = ls.find(l => /depart|partida/i.test(l.t) || /depart/i.test(l.h));
  if (!dep) { console.log('RESULT: could not find a Departures link — send me a screenshot of the Flights menu'); process.exit(0); }
  await page.getByText(dep.t, { exact: true }).first().click().catch(async () => { await page.goto(new URL(dep.h, page.url()).href).catch(() => {}); });
  await page.waitForTimeout(4000);
  console.log('7. now on: ' + new URL(page.url()).pathname + '   title: ' + clip(await page.title()));
  // load more rows (button "Get more records") until it stops growing
  const rowCount = async () => page.$$eval('table tr', r => r.length);
  let n0 = await rowCount();
  for (let i = 0; i < 12; i++) {
    const more = page.getByText('Get more records', { exact: true }).first();
    if (!(await more.count())) break;
    await more.click().catch(() => {});
    await page.waitForTimeout(2500);
    const n1 = await rowCount();
    if (n1 <= n0) break;
    n0 = n1;
  }
  console.log('   rows after loading more: ' + n0);
  const t2 = await page.$$eval('table', ts => ts.map(t => ({ rows: [...t.querySelectorAll('tr')].map(r => [...r.children].map(c => c.innerText.replace(/\s+/g, ' ').trim())).filter(r => r.length > 1) })));
  const main = t2.filter(t => t.rows.length >= 3).sort((a, b) => b.rows.length - a.rows.length)[0];
  const big2 = main ? [main] : [];
  if (main) {
    const H = main.rows[0];
    const flights = main.rows.slice(1).filter(r => r.length >= 15 && r[1]);
    console.log('   flights: ' + flights.length + '  first STD: ' + flights[0][4] + '  last STD: ' + flights[flights.length - 1][4]);
    const ix = (n) => H.findIndex(h => h.replace(/\s+/g, '') === n);
    const iC = ix('CKI1'), iG = ix('GT');
    console.log('   column positions: CKI1=' + iC + ' GT=' + iG + ' POS=' + ix('POS') + ' CHT=' + ix('CHT') + ' GREM=' + ix('GREM') + ' Remarks=' + ix('Remarks'));
    const withData = flights.filter(r => (iC >= 0 && r[iC]) || (iG >= 0 && r[iG]));
    console.log('   flights with a check-in or gate value: ' + withData.length);
    console.log('   sample rows with data (flight | STD | ETD | POS | CKI1 | CHT | GT | GREM | Remarks):');
    withData.slice(0, 8).forEach(r => console.log('     ' + [r[1], r[4], r[6], r[ix('POS')], r[iC], r[ix('CHT')], r[iG], r[ix('GREM')], r[ix('Remarks')]].join(' | ')));
    const odd = main.rows.filter(r => r.length === 1 || !r[1]).slice(0, 3);
    console.log('   in-between rows (' + main.rows.filter(r => r.length < 15 || !r[1]).length + '): ' + JSON.stringify(odd).slice(0, 300));
    console.log('   distinct Remarks: ' + [...new Set(flights.map(r => r[ix('Remarks')]))].join(', '));
  }
  console.log('RESULT: ' + (big2.length ? 'DEPARTURES TABLE FOUND' : 'departures page opened but no table found'));
} catch (e) {
  console.log('ERROR: ' + clip(e && e.message, 300));
} finally { await browser.close(); }
