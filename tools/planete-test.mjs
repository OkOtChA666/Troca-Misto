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
  const REAL = /tempo\s*real|temps\s*r[ée]el|real.?time|realtime/i;
  const menuTexts = async () => (await page.locator('.v-menu__content, .menuable__content__active, [role="menu"], [role="listbox"]').allInnerTexts().catch(() => [])).map(t => t.replace(/\s+/g, ' ').slice(0, 120));
  // 1) Something may be covering the page (news pop-up, cookie bar...). Look, then try to close it.
  const probe = async () => page.evaluate(() => {
    const el = document.querySelector('[data-pt-tile]');
    if (!el) return 'tile element not found';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const desc = (n) => n ? (n.tagName + '.' + String(n.className).replace(/\s+/g, '.').slice(0, 80)) : 'none';
    const dlg = [...document.querySelectorAll('.v-dialog--active, [role="dialog"], .v-overlay--active')].map(d => desc(d) + ' "' + d.innerText.replace(/\s+/g, ' ').slice(0, 80) + '"');
    return 'on top of tile: ' + desc(top) + (el.contains(top) || top.contains(el) ? ' (same area, ok)' : ' (DIFFERENT element)') + ' | dialogs: ' + JSON.stringify(dlg);
  });
  console.log('   ' + await probe());
  await page.keyboard.press('Escape').catch(() => {});
  for (const label of [/^(fechar|close|fermer|sluiten)$/i, /^(ok|entendido|aceitar|accept|compris)$/i]) {
    const b = page.getByRole('button', { name: label }).first();
    if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); console.log('   closed a pop-up button'); }
  }
  await page.waitForTimeout(1500);
  console.log('   ' + await probe());

  // 2) Open the menu: real mouse move first, forced hover/click as fallbacks (short timeouts).
  const box = await tile.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(2000);
  let m = await menuTexts();
  console.log('   after mouse move, menu texts: ' + JSON.stringify(m));
  if (!(await page.getByText(REAL).count())) {
    await tile.hover({ force: true, timeout: 8000 }).catch((e) => console.log('   forced hover failed'));
    await page.waitForTimeout(2000);
    m = await menuTexts();
    console.log('   after forced hover, menu texts: ' + JSON.stringify(m));
  }
  if (!(await page.getByText(REAL).count())) {
    await tile.click({ force: true, timeout: 8000 }).catch((e) => console.log('   forced click failed'));
    await page.waitForTimeout(2000);
    m = await menuTexts();
    console.log('   after forced click, menu texts: ' + JSON.stringify(m));
  }
  const entry = page.getByText(REAL).first();
  await entry.waitFor({ timeout: 20000 });
  console.log('   found the "tempo real" entry');

  step = 'click tempo real';
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 45000 }).catch(() => null),
    entry.click(),
  ]);
  const target = popup || page;
  await target.waitForLoadState('domcontentloaded');
  console.log('4. tasks window opened: ' + (popup ? 'yes (new window)' : 'yes (same tab)'));

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
