// Logs in to planete-online, opens "Horário → tempo real" and returns the parsed tasks.
// Never prints names or tasks (the log of a public repo is public).
import { chromium } from 'playwright';
import { parseRegulation } from './parse-tasks.mjs';

const BASE = 'https://portway.planete-online.fr';

async function attempt(user, pass, log) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'pt-PT', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);

    await page.goto(BASE + '/planete-online/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name="username"]');
    await page.fill('input[name="username"]', user);
    await page.fill('input[name="current-password"]', pass);
    await page.press('input[name="current-password"]', 'Enter');
    await page.waitForTimeout(6000);
    if (/\/planete-online\/login/.test(page.url())) {
      await page.locator('button[type="submit"].primary').first().click();
    }
    await page.waitForURL(/\/planete-online\/app\//, { timeout: 40000 }).catch(() => null);
    await page.waitForTimeout(3000);
    if (!/\/planete-online\/app\//.test(new URL(page.url()).pathname)) throw new Error('login did not complete (page: ' + new URL(page.url()).pathname + ')');
    log('logged in');

    await page.goto(BASE + '/planete-online/app/modules', { waitUntil: 'domcontentloaded' });
    await page.getByText('Horário', { exact: true }).first().waitFor();
    await page.waitForTimeout(1500);
    const picked = await page.evaluate(() => {
      document.querySelectorAll('[data-pt-tile]').forEach(e => e.removeAttribute('data-pt-tile'));
      const leaves = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === 'Horário');
      const ok = leaves.find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || leaves[0];
      if (ok) ok.setAttribute('data-pt-tile', '1');
      return !!ok;
    });
    if (!picked) throw new Error('"Horário" tile not found');

    const REAL_SRC = 'tempo\\s*real|temps\\s*r[ée]el|real.?time|realtime';
    const markReal = () => page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      document.querySelectorAll('[data-pt-real]').forEach(e => e.removeAttribute('data-pt-real'));
      const hits = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && re.test(e.textContent));
      hits.forEach(e => e.setAttribute('data-pt-real', '1'));
      return hits.map(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    }, REAL_SRC);
    const fire = (types) => page.evaluate((types) => {
      let n = document.querySelector('[data-pt-tile]');
      for (let k = 0; k < 6 && n; k++, n = n.parentElement) {
        for (const t of types) n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
      }
    }, types);
    let hits = await markReal();
    if (!hits.some(Boolean)) { await fire(['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'mousemove']); await page.waitForTimeout(2000); hits = await markReal(); }
    if (!hits.some(Boolean)) { await fire(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']); await page.waitForTimeout(2000); hits = await markReal(); }
    if (!hits.length) throw new Error('"tempo real" entry did not appear');

    const pageEvent = context.waitForEvent('page', { timeout: 45000 }).catch(() => null);
    await page.evaluate(() => {
      const el = document.querySelector('[data-pt-real]');
      const target = el.closest('.v-list-item, a, button, [role="menuitem"]') || el;
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    });
    await pageEvent;
    log('tasks window opened');

    // wait until agent rows are there, then until the count stops growing
    const deadline = Date.now() + 90000;
    let n = 0;
    while (Date.now() < deadline) {
      for (const p of context.pages()) { try { n = Math.max(n, await p.locator('.trigInfo').count()); } catch (e) {} }
      if (n > 0) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!n) throw new Error('no agents appeared on the tasks page');
    await new Promise(r => setTimeout(r, 4000));
    for (const p of context.pages()) {
      try { if (await p.locator('.trigInfo').count()) return parseRegulation(await p.content()); } catch (e) {}
    }
    throw new Error('could not read the tasks page');
  } finally {
    await browser.close();
  }
}

export async function fetchTasks({ user, pass, log = () => {}, tries = 2 }) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await attempt(user, pass, log); }
    catch (e) { lastErr = e; log('attempt ' + i + ' failed: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 160)); }
  }
  throw lastErr;
}
