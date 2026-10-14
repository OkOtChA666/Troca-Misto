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
  page.on('request', (r) => {
    try { const u = new URL(r.url()); if (/planete-online-server|saml|realms/i.test(u.pathname)) console.log('   [req] ' + r.method() + ' ' + u.pathname); } catch (e) {}
  });
  page.on('response', async (r) => {
    try {
      const u = new URL(r.url());
      if (/planete-online-server|saml|realms/i.test(u.pathname)) {
        let extra = '';
        if (/authentication\/login/i.test(u.pathname)) {
          try { const j = await r.json(); extra = ' isSso=' + String(j && j.isSso) + ' hasUser=' + String(!!(j && j.user)) + ' keys=' + Object.keys(j || {}).join(','); } catch (e) {}
        }
        console.log('   [res] ' + u.pathname + ' -> ' + r.status() + extra);
      }
    } catch (e) {}
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { try { console.log('   [nav] ' + new URL(f.url()).pathname); } catch (e) {} } });
  console.log('   secret lengths: user=' + USER.length + ' pass=' + PASS.length);
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="current-password"]', PASS);
  console.log('   typed lengths: user=' + (await page.inputValue('input[name="username"]')).length + ' pass=' + (await page.inputValue('input[name="current-password"]')).length);
  const loginBtn = page.locator('button[type="submit"].primary');
  console.log('   login buttons found: ' + (await loginBtn.count()));
  await loginBtn.first().click();
  await page.waitForTimeout(6000);
  if (/\/planete-online\/login/.test(page.url())) {
    console.log('   still on login page after click — pressing Enter as well');
    await page.press('input[name="current-password"]', 'Enter');
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
  const tile = page.getByText('Horário', { exact: true }).first();
  await tile.waitFor();
  await tile.hover();
  console.log('3. modules page, "Horário" tile found: yes');

  step = 'click tempo real';
  const entry = page.getByText(/tempo real/i).first();
  await entry.waitFor();
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
