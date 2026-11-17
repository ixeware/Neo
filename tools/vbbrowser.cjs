// Browser check of the Vercel backend through the real game page (dist/ served by tools/devserver.mjs,
// two hubs = two function instances): menu text, nickname prompt, shared-war join from the menu for two
// browsers, a deploy crossing instances, identical snapshots, the roster via session.backend.presence,
// the admin panel's server login (vercel AdminChannel) and an adm command reaching the other browser.
// Phase 2 (devserver --no-redis): the menu says the shared war is unavailable.
//   npm run build && npx tsx tools/devserver.mjs --test --instances 2 --cp-every 3000 &
//   node tools/vbbrowser.cjs [phase=1|2] [port=5243] [screenshot dir]      (Playwright on NODE_PATH)
//   npx tsx tools/devserver.mjs --no-redis &  then  node tools/vbbrowser.cjs 2
const { chromium } = require('playwright');
const fs = require('fs');
const DIR = (process.argv[4] || require('os').tmpdir()).replace(/\/?$/, '/');
// the test password (never printed): VY_PASS_FILE, else the workflow's scratchpad file
const PASS = fs.readFileSync(process.env.VY_PASS_FILE || '/tmp/claude-0/-home-user-Neo/2cf9b09d-ec36-5575-aa5a-ad87bc5d21e8/scratchpad/admin/.pass', 'utf8').trim();
const BASE = `http://127.0.0.1:${Number(process.argv[3] || 5243)}/`;
const PHASE = Number(process.argv[2] || 1);
let failed = 0;
const ok = (label, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const open = async (name, path = '?lq') => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 700 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/WebGL|GPU|favicon/i.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    await p.goto(BASE + path, { waitUntil: 'load' });
    await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 120000 });
    return p;
  };

  if (PHASE === 2) {
    const p = await open('solo');
    await p.waitForSelector('.m-mp', { timeout: 20000 });
    const t = await p.locator('.m-mp').textContent();
    ok('no Redis: the menu says the shared war is unavailable', /Общая война сейчас недоступна/.test(t) && !(await p.locator('[data-shared]').count()), t.slice(0, 120));
    await p.screenshot({ path: DIR + 'menu-noredis.png' });
    await p.evaluate(() => window.__game.start(0, 1));
    await wait(1500);
    ok('single player still starts', await p.evaluate(() => window.__game.session?.backend.kind === 'local' && window.__game.sim.st.tick > 3));
    ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await b.close();
    console.log(failed ? `${failed} FAILED` : 'BROWSER NO-REDIS OK');
    process.exit(failed ? 1 : 0);
  }

  const join = async (p, side, nick) => {
    await p.waitForSelector(`[data-shared="${side}"]`, { timeout: 30000 });
    await p.click(`[data-shared="${side}"]`);
    await p.waitForSelector('#vy-nick', { timeout: 10000 });
    await p.fill('#vy-nick', nick);
    await p.click('#vy-nick-ok');
    await p.waitForFunction(() => window.__game.session?.backend.kind === 'shared', null, { timeout: 30000 });
  };

  const A = await open('A');
  await A.waitForSelector('.m-mp', { timeout: 20000 });
  const menuA = await A.locator('.m-mp').textContent();
  ok('menu offers the shared war on the Vercel backend', /Общая война с пацанами/.test(menuA), menuA.slice(0, 100));
  await join(A, 0, 'Аслан <b>');
  const B = await open('B');
  await join(B, 1, 'Бекхан');
  const pidA = await A.evaluate(() => window.__game.session.pid), pidB = await B.evaluate(() => window.__game.session.pid);
  ok('two different players', pidA !== pidB);
  await A.waitForFunction(pb => !!window.__game.sim.st.players[pb], pidB, { timeout: 20000 }).catch(() => {});
  ok('A sees B join (across instances)', await A.evaluate(pb => !!window.__game.sim.st.players[pb], pidB));
  ok('B sees A', await B.evaluate(pa => !!window.__game.sim.st.players[pa], pidA));

  // a deploy from A reaches B
  const dep = await A.evaluate(() => {
    const g = window.__game, sim = g.sim, pl = sim.st.players[g.session.pid], hq = sim.st.pts[0];
    for (let u = 0; u < g.defs.UNITS.length; u++) for (let r = 4; r < 30; r += 3) for (let a = 0; a < 8; a++) {
      const x = Math.round((hq.x + Math.cos(a) * r) * 100) / 100, z = Math.round((hq.z + Math.sin(a) * r) * 100) / 100;
      if (!sim.canDeploy(0, u, x, z, pl)) { g.session.submit({ k: 'dep', s: 0, u, x, z }); return { u, x, z }; }
    }
    return null;
  });
  ok('A found a deploy spot', !!dep);
  await B.waitForFunction(() => window.__game.sim.st.sides[0].deployed >= 1, null, { timeout: 15000 }).catch(() => {});
  ok('A\'s deploy reaches B', await B.evaluate(() => window.__game.sim.st.sides[0].deployed >= 1));

  // roster through session.backend.presence; the nickname is plain text
  const roster = await B.evaluate(() => new Promise(res => {
    const pr = window.__game.session.backend.presence;
    if (!pr) { res(null); return; }
    let un = null;
    const t = setTimeout(() => { un?.(); res('timeout'); }, 12000);
    un = pr.onRoster(l => { if (l.length >= 2) { clearTimeout(t); un?.(); res(l); } });
  }));
  ok('roster lists both players with their nicknames (markup stripped)', Array.isArray(roster) && roster.length === 2 && roster.some(e => e.name === 'Аслан b') && roster.some(e => e.name === 'Бекхан' && e.me), JSON.stringify(roster));
  const players = await (await fetch(BASE + 'api/players')).json();
  ok('GET /api/players: both online', players.online?.[0] === 1 && players.online?.[1] === 1, JSON.stringify(players.online));

  // admin panel on A: the server login, then a command through the vercel channel reaches B
  const admBefore = await B.evaluate(() => window.__game.session.allCmds().filter(c => c.k === 'adm').length);
  await A.evaluate(() => { location.hash = '#admin'; });
  await A.waitForSelector('.adm-sheet:not([hidden]) #adm-pass', { timeout: 10000 });
  await A.fill('#adm-pass', PASS);
  await A.click('.adm-login button[type=submit]');
  await A.waitForSelector('.adm-tabs', { timeout: 20000 });
  await A.waitForFunction(() => /сервер принял вход/.test(document.querySelector('.adm-mode')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  const mode = await A.locator('.adm-mode').textContent();
  ok('admin panel: server login accepted (vercel channel)', /сервер принял вход/.test(mode), mode);
  await A.locator('.adm-body .adm-btn', { hasText: '+1 000' }).first().click();
  await B.waitForFunction(n => window.__game.session.allCmds().filter(c => c.k === 'adm').length > n, admBefore, { timeout: 15000 }).catch(() => {});
  const admB = await B.evaluate(() => window.__game.session.allCmds().filter(c => c.k === 'adm').map(c => ({ op: c.op, s: c.s, v: c.v })));
  ok('the admin command reaches the other browser', admB.some(c => c.op === 'money' && c.s === 0 && c.v === 1000), JSON.stringify(admB));
  await A.screenshot({ path: DIR + 'admin-vercel.png' });
  await A.evaluate(() => { location.hash = ''; });

  // identical worlds: the same snapshot JSON at a tick both still hold
  await wait(4000);
  const tA = await A.evaluate(() => window.__game.sim.st.tick), tB = await B.evaluate(() => window.__game.sim.st.tick);
  const T = Math.floor((Math.min(tA, tB) - 40) / 10) * 10;
  const sA = await A.evaluate(t => { const s = window.__game.session.snapAt(t); return s ? JSON.stringify(s) : null; }, T);
  const sB = await B.evaluate(t => { const s = window.__game.session.snapAt(t); return s ? JSON.stringify(s) : null; }, T);
  ok(`A and B hold the same world at tick ${T}`, !!sA && sA === sB, `${sA?.length} / ${sB?.length} bytes, ticks ${tA}/${tB}`);
  await B.screenshot({ path: DIR + 'shared-B.png' });

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  console.log(failed ? `${failed} FAILED` : 'BROWSER SHARED WAR OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
