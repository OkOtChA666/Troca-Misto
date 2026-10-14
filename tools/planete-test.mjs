// Test for planete-online: log in, open "Horário → tempo real", read the tasks page.
// Prints ONLY yes/no steps and counts — never names or tasks (the log of a public repo is public).
import { chromium } from 'playwright';
import { parseRegulation } from './parse-tasks.mjs';

const USER = process.env.PLANETE_USER;
const PASS = process.env.PLANETE_PASS;
const BASE = 'https://portway.planete-online.fr';
if (!USER || !PASS) { console.log('STOP: secrets PLANETE_USER / PLANETE_PASS are missing'); process.exit(1); }

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'pt-PT', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(45000);
let step = 'start';
try {
  step = 'open login page';
  await page.goto(BASE + '/planete-online/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="username"]');
  console.log('1. login page opened: yes');

  step = 'log in';
  page.on('response', async (r) => {
    try {
      const u = new URL(r.url());
      if (/authentication\/login|saml|realms/i.test(u.pathname)) console.log('   [res] ' + u.pathname + ' -> ' + r.status());
    } catch (e) {}
  });
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="current-password"]', PASS);
  await page.press('input[name="current-password"]', 'Enter');
  await page.waitForTimeout(6000);
  if (/\/planete-online\/login/.test(page.url())) {
    console.log('   still on login page after Enter — clicking the button');
    await page.locator('button[type="submit"].primary').first().click();
  }
  await Promise.race([
    page.waitForURL(/\/planete-online\/app\//, { timeout: 30000 }).catch(() => null),
    page.waitForURL(/saml|realms/, { timeout: 30000 }).catch(() => null),
  ]);
  await page.waitForTimeout(3000);
  const nowPath = new URL(page.url()).pathname;
  if (!/\/planete-online\/app\//.test(nowPath)) { console.log('2. logged in: NO — ended on ' + nowPath); process.exit(2); }
  if (/double-authentification/.test(page.url())) { console.log('2. logged in: NO — two-step verification is required'); process.exit(2); }
  console.log('2. logged in: yes');

  step = 'open modules';
  await page.goto(BASE + '/planete-online/app/modules', { waitUntil: 'domcontentloaded' });
  await page.getByText('Horário', { exact: true }).first().waitFor();
  await page.waitForTimeout(1500);
  // mark the "Horário" tile (the one in the main area)
  const picked = await page.evaluate(() => {
    document.querySelectorAll('[data-pt-tile]').forEach(e => e.removeAttribute('data-pt-tile'));
    const leaves = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === 'Horário');
    const ok = leaves.find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || leaves[0];
    if (ok) ok.setAttribute('data-pt-tile', '1');
    return !!ok;
  });
  if (!picked) throw new Error('"Horário" tile not found');
  console.log('3. modules page, "Horário" tile found: yes');

  step = 'open the tile menu';
  const REAL_SRC = 'tempo\\s*real|temps\\s*r[ée]el|real.?time|realtime';
  // mark any element saying "tempo real" (visible or not)
  const markReal = () => page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    document.querySelectorAll('[data-pt-real]').forEach(e => e.removeAttribute('data-pt-real'));
    const hits = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && re.test(e.textContent));
    hits.forEach(e => e.setAttribute('data-pt-real', '1'));
    return hits.map(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  }, REAL_SRC);
  // Trigger the tile's hover/click behaviour straight from the page (works even if something covers it).
  const fire = (types) => page.evaluate((types) => {
    let n = document.querySelector('[data-pt-tile]');
    for (let k = 0; k < 6 && n; k++, n = n.parentElement) {
      for (const t of types) n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }, types);
  let hits = await markReal();
  if (!hits.some(Boolean)) {
    await fire(['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'mousemove']);
    await page.waitForTimeout(2000);
    hits = await markReal();
  }
  if (!hits.some(Boolean)) {
    await fire(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    await page.waitForTimeout(2000);
    hits = await markReal();
  }
  if (!hits.length) { console.log('   no "tempo real" element appeared'); process.exit(4); }
  console.log('   found the "tempo real" entry');

  step = 'click tempo real';
  const pageEvent = context.waitForEvent('page', { timeout: 45000 }).catch(() => null);
  await page.evaluate(() => {
    const el = document.querySelector('[data-pt-real]');
    const target = el.closest('.v-list-item, a, button, [role="menuitem"]') || el;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
  });
  const popup = await pageEvent;
  const target = popup || page;
  await target.waitForLoadState('domcontentloaded').catch(() => {});
  console.log('4. tasks window opened: ' + (popup ? 'yes (new window)' : 'no new window — same tab'));

  step = 'wait for tasks';
  // The tasks page marks every agent row with .trigInfo (the staff number).
  const deadline = Date.now() + 90000;
  let n = 0;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      try { n = Math.max(n, await p.locator('.trigInfo').count()); } catch (e) {}
    }
    if (n > 0) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('5. agents found on the tasks page: ' + n);

  step = 'parse tasks';
  let parsed = null;
  for (const pg of context.pages()) {
    try { if (await pg.locator('.trigInfo').count()) { parsed = parseRegulation(await pg.content()); break; } } catch (e) {}
  }
  if (parsed) {
    const withTasks = parsed.agents.filter(a => a.tasks.length).length;
    const changed = parsed.agents.flatMap(a => a.tasks).filter(t => t.changed).length;
    console.log('6. parsed: date=' + parsed.date + ' agents=' + parsed.agents.length + ' with tasks=' + withTasks + ' tasks=' + parsed.taskCount + ' changed-by-coordinator=' + changed + ' unmatched=' + parsed.orphan);
  } else {
    console.log('6. could not parse the page');
  }
  console.log(n > 0 && parsed ? 'RESULT: WORKS' : 'RESULT: opened but not parsed');
  process.exit(n > 0 && parsed ? 0 : 3);
} catch (e) {
  let where = '';
  try { where = new URL(page.url()).pathname; } catch (_) {}
  console.log('FAILED at step: ' + step + (where ? ' (page: ' + where + ')' : ''));
  console.log('reason: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200));
  process.exit(1);
} finally {
  await browser.close();
}
