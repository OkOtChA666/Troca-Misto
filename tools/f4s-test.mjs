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
  console.log('RESULT: ' + (big.length ? 'LOGIN WORKS, flight table found' : 'LOGIN WORKS, but I need to find the flight table'));
} catch (e) {
  console.log('ERROR: ' + clip(e && e.message, 300));
} finally { await browser.close(); }
