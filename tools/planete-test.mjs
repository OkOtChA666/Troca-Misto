// Login test for planete-online. Prints ONLY yes/no steps and a count — never names or tasks
// (the log of a public repo can be read by anyone).
import { chromium } from 'playwright';

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
  // Diagnostics only: URL paths, status codes and lengths — never content.
  page.on('response', async (r) => {
    try {
      const u = new URL(r.url());
      if (/planete-online-server|saml|realms/i.test(u.pathname)) {
        let extra = '';
        if (/authentication\/login/i.test(u.pathname)) {
          try { const j = await r.json(); extra = ' isSso=' + String(j && j.isSso) + ' hasUser=' + String(!!(j && j.user)) + ' keys=' + Object.keys(j || {}).join(','); } catch (e) {}
        }
        if (/authentication\/login|saml|realms/i.test(u.pathname)) console.log('   [res] ' + u.pathname + ' -> ' + r.status() + extra);
      }
    } catch (e) {}
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { try { console.log('   [nav] ' + new URL(f.url()).pathname); } catch (e) {} } });
  console.log('   secret lengths: user=' + USER.length + ' pass=' + PASS.length);
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="current-password"]', PASS);
  console.log('   typed lengths: user=' + (await page.inputValue('input[name="username"]')).length + ' pass=' + (await page.inputValue('input[name="current-password"]')).length);
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
  if (!/\/planete-online\/app\//.test(nowPath)) {
    const msgs = await page.locator('.v-messages__message, .v-alert, .notification, [role="alert"], .snotify-item, .v-snack__content').allInnerTexts().catch(() => []);
    console.log('2. logged in: NO — ended on ' + nowPath);
    console.log('   messages on page: ' + JSON.stringify(msgs.map(m => m.replace(/\s+/g, ' ').slice(0, 150))));
    process.exit(2);
  }
  if (/double-authentification/.test(page.url())) { console.log('2. logged in: NO — two-step verification is required'); process.exit(2); }
  console.log('2. logged in: yes');

  step = 'open modules';
  await page.goto(BASE + '/planete-online/app/modules', { waitUntil: 'domcontentloaded' });
  await page.getByText('Horário', { exact: true }).first().waitFor();
  await page.waitForTimeout(1500);
  // There can be several "Horário" labels (sidebar, tooltips...). List them and mark the one in the main area.
  const found = await page.evaluate(() => {
    document.querySelectorAll('[data-pt-tile]').forEach(e => e.removeAttribute('data-pt-tile'));
    const leaves = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === 'Horário');
    const info = leaves.map((e, i) => {
      const r = e.getBoundingClientRect();
      const chain = []; let n = e;
      for (let k = 0; k < 7 && n && n.tagName; k++, n = n.parentElement) chain.push(n.tagName.toLowerCase() + '.' + String(n.className).split(/\s+/)[0]);
      const visible = r.width > 0 && r.height > 0;
      const inChrome = chain.some(c => /navigation-drawer|app-bar|toolbar|tooltip|v-menu|sidebar/i.test(c));
      return { i, visible, inChrome, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), chain: chain.join(' < ') };
    });
    const pick = info.find(o => o.visible && !o.inChrome) || info.find(o => o.visible) || info[0];
    if (pick) leaves[pick.i].setAttribute('data-pt-tile', '1');
    return { info, picked: pick ? pick.i : -1 };
  });
  console.log('   "Horário" labels found: ' + found.info.length + ', picked #' + found.picked);
  found.info.forEach(o => console.log('     #' + o.i + ' visible=' + o.visible + ' inChrome=' + o.inChrome + ' at ' + o.x + ',' + o.y + ' w=' + o.w + ' : ' + o.chain));
  const tile = page.locator('[data-pt-tile]').first();
  await tile.waitFor({ timeout: 10000 });
  console.log('3. modules page, "Horário" tile found: yes');

  step = 'open the tile menu';
  const REAL_SRC = 'tempo\\s*real|temps\\s*r[ée]el|real.?time|realtime';
  const REAL = new RegExp(REAL_SRC, 'i');
  // Any element (visible or not) whose own text says "tempo real": where is it, is it visible?
  const realProbe = () => page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const out = [];
    [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && re.test(e.textContent)).forEach((e, i) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      const chain = []; let n = e;
      for (let k = 0; k < 6 && n && n.tagName; k++, n = n.parentElement) chain.push(n.tagName.toLowerCase() + '.' + String(n.className).split(/\s+/)[0]);
      e.setAttribute('data-pt-real', String(i));
      out.push({ i, visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', x: Math.round(r.x), y: Math.round(r.y), chain: chain.join(' < ') });
    });
    return out;
  }, REAL_SRC);
  const coverInfo = () => page.evaluate(() => {
    const el = document.querySelector('[data-pt-tile]'); if (!el) return 'no tile';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const chain = []; let n = top;
    for (let k = 0; k < 8 && n && n.tagName; k++, n = n.parentElement) chain.push(n.tagName.toLowerCase() + '.' + String(n.className).split(/\s+/).slice(0, 2).join('.'));
    return 'cover chain: ' + chain.join(' < ') + ' | cover text: "' + String(top && top.innerText || '').replace(/\s+/g, ' ').slice(0, 60) + '" | viewport ' + innerWidth + 'x' + innerHeight;
  });
  console.log('   ' + await coverInfo());
  let reals = await realProbe();
  console.log('   "tempo real" elements before opening: ' + JSON.stringify(reals));

  // Trigger the tile's hover/click behaviour straight from the page (works even if something covers it).
  const fire = (types) => page.evaluate((types) => {
    let n = document.querySelector('[data-pt-tile]');
    for (let k = 0; k < 6 && n; k++, n = n.parentElement) {
      for (const t of types) n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }, types);
  if (!reals.some(r => r.visible)) {
    await fire(['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'mousemove']);
    await page.waitForTimeout(2000);
    reals = await realProbe();
    console.log('   after hover events: ' + JSON.stringify(reals));
  }
  if (!reals.some(r => r.visible)) {
    await fire(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    await page.waitForTimeout(2000);
    reals = await realProbe();
    console.log('   after click events: ' + JSON.stringify(reals));
  }
  if (!reals.length) { console.log('   no "tempo real" element appeared'); process.exit(4); }
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
  console.log(n > 0 ? 'RESULT: WORKS' : 'RESULT: opened but no agents found');
  process.exit(n > 0 ? 0 : 3);
} catch (e) {
  let where = '';
  try { where = new URL(page.url()).pathname; } catch (_) {}
  console.log('FAILED at step: ' + step + (where ? ' (page: ' + where + ')' : ''));
  console.log('reason: ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200));
  process.exit(1);
} finally {
  await browser.close();
}
