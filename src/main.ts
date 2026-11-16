import './ui/style.css';
import * as THREE from 'three';
import { loadTerrain, heightY } from './world/terrain';
import { Sim, cardTitle, type FxEv } from './sim/sim';
import { TICK_MS, HQ, CARDS, UNITS, SIDE_NAME, Fx, type Side } from './sim/defs';
import { Stage, bindInput } from './render/scene';
import { paintMap, terrainMesh, waterMesh } from './render/terrainMesh';
import { buildVillages, buildTrees, buildBridges, mosque, HqBuilding, VillageMarker, drapedRing } from './render/world';
import { Particles, Shots } from './render/fx';
import { UnitView } from './render/units';
import { PAL } from './render/models';
import { makePortraits } from './ui/portraits';
import { Hud } from './ui/hud';
import { Labels } from './ui/labels';
import { Minimap } from './ui/minimap';
import { renderMenu, type MenuState } from './ui/menu';
import { Sound } from './audio/sound';
import { Session, LocalBackend, loadLocal, clearLocal } from './net/session';
import { connectShared, type Shared } from './net/shared';
import { TICKER, lore } from './data/lore';

const $ = (id: string) => document.getElementById(id)!;
const bootMsg = (s: string) => { $('boot-msg').textContent = s; };

interface Prefs { pid: string; diff: number; spicy: boolean; muted: boolean; music: boolean }
function loadPrefs(): Prefs {
  let p: Partial<Prefs> = {};
  try { p = JSON.parse(localStorage.getItem('vysotka.prefs') || '{}'); } catch { /* blocked storage */ }
  return { pid: p.pid || 'p' + Math.random().toString(36).slice(2, 10), diff: p.diff ?? 1, spicy: p.spicy ?? true, muted: p.muted ?? false, music: p.music ?? true };
}
function savePrefs(p: Prefs) { try { localStorage.setItem('vysotka.prefs', JSON.stringify(p)); } catch { /* blocked storage */ } }

const WHO: Record<string, { name: string; side: number }> = {
  islam: { name: 'Ислам #1 ranked chad', side: 0 },
  zurab: { name: 'Зураб легенда', side: 1 },
  chimaev: { name: 'Чимаев 5.5', side: 1 },
  wou: { name: 'WOU', side: -1 },
  admin: { name: 'админ', side: -1 },
};
const pickOne = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function boot() {
  const prefs = loadPrefs();
  savePrefs(prefs);
  bootMsg('Грузим рельеф Аргунской долины…');
  const terrain = await loadTerrain();
  const sim = new Sim(terrain);
  sim.init(1);
  const canvas = $('c') as HTMLCanvasElement;
  const stage = new Stage(canvas, terrain);
  const scene = stage.scene;

  bootMsg('Рисуем поля, лес и Аргун…');
  await new Promise(r => setTimeout(r, 16));
  const painted = paintMap(terrain);
  scene.add(terrainMesh(terrain, painted.texture));
  scene.add(waterMesh(terrain));
  const world = new THREE.Group();
  scene.add(world);
  bootMsg('Строим сёла…');
  await new Promise(r => setTimeout(r, 16));
  const nh = buildVillages(terrain, sim.st.pts, world, !stage.lowPower);
  const nt = buildTrees(terrain, world, !stage.lowPower);
  console.info(`houses ${nh}, trees ${nt}`);
  buildBridges(terrain, world);
  const shali = sim.st.pts.find(p => p.key === 'shali')!;
  const bigMosque = mosque(true);
  bigMosque.position.set(shali.x, heightY(terrain, shali.x, shali.z) - 0.05, shali.z);
  bigMosque.rotation.y = 0.3;
  world.add(bigMosque);
  const hqs = [new HqBuilding(0, HQ.maxFloors[0]), new HqBuilding(1, HQ.maxFloors[1])];
  hqs.forEach((b, s) => {
    b.place(terrain, sim.st.pts[s]);
    b.setFloors(sim.st.sides[s].floors, false);
    world.add(b.group);
    const m = mosque(false);
    const p = sim.st.pts[s];
    const mx = p.x + (s === 0 ? -6 : 7), mz = p.z + 4;
    m.position.set(mx, heightY(terrain, mx, mz) - 0.05, mz);
    world.add(m);
  });
  const markers = sim.st.pts.filter(p => p.kind === 1).map(p => new VillageMarker(terrain, p));
  markers.forEach(m => world.add(m.group));
  const zoneMat = [0, 1].map(s => new THREE.MeshBasicMaterial({ color: PAL.side[s], transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
  const hqZones = [0, 1].map(s => { const p = sim.st.pts[s]; const m = new THREE.Mesh(drapedRing(terrain, p.x, p.z, HQ.zone, 0.45, 128), zoneMat[s]); m.visible = false; m.renderOrder = 3; world.add(m); return m; });

  const particles = new Particles();
  scene.add(particles.points);
  const shots = new Shots();
  scene.add(shots.group);
  const units = new UnitView(terrain, sim, particles);
  units.hqPos = hqs.map(b => ({ x: b.group.position.x, z: b.group.position.z, rot: b.group.rotation.y }));
  scene.add(units.group);

  bootMsg('Лепим Зураба и Ислама…');
  await new Promise(r => setTimeout(r, 16));
  const portraits = makePortraits();
  const sound = new Sound();
  sound.muted = prefs.muted; sound.musicOn = prefs.music;

  // ---- game state ----------------------------------------------------------------------
  let session: Session | null = null;
  let shared: Shared | null = null;
  let side: Side = 0;
  let playing = false;
  let lastSave = 0;
  let lastTap = { x: innerWidth / 2, y: innerHeight / 2 };
  let nextChatter = performance.now() + 9000;
  let overEra = 0;
  const menuState: MenuState = { canContinue: null, diff: prefs.diff, spicy: prefs.spicy, shared: null };

  const hud = new Hud($('hud'), {
    portraits,
    onCard: i => { sound.unlock(); sound.click(); hud.select(hud.selected === i ? -1 : i); },
    onVote: o => {
      sound.unlock();
      if (!session || !sim.st.votes[side].open) return;
      sound.click();
      session.submit({ k: 'vote', s: side, o });
    },
    onMenu: () => openMenu(),
    onSound: () => { prefs.muted = !prefs.muted; sound.setMuted(prefs.muted); savePrefs(prefs); return !prefs.muted; },
    onMusic: () => { sound.unlock(); prefs.music = !prefs.music; sound.setMusic(prefs.music); savePrefs(prefs); return prefs.music; },
    onHome: () => { const p = sim.st.pts[side]; stage.flyTo(p.x, p.z, 38); },
  });
  const labels = new Labels($('labels'), terrain, sim, stage, hqs, units);
  const minimap = new Minimap(hud.miniCanvas, painted.canvas, terrain, sim, stage);

  const say = (who: keyof typeof WHO | string, text: string) => {
    const key = WHO[who] ? who : /^Ислам/.test(who) ? 'islam' : /^Зураб/.test(who) ? 'zurab' : /^Чимаев/.test(who) ? 'chimaev' : /^WOU/.test(who) ? 'wou' : '';
    const w = key ? WHO[key] : { name: who === 'Бекхан' ? 'Бекхан' : 'беседа', side: -1 };
    hud.feedMsg(w.name, text, w.side);
  };

  function beginSession(s: Side, sess: Session) {
    session = sess;
    side = s;
    hud.setSide(s);
    hud.hideOver();
    units.resetVis();
    hqs.forEach((b, i) => b.setFloors(sim.st.sides[i].floors, false));
    session.onStep = () => units.capture(performance.now());
    playing = true;
    $('menu').hidden = true;
    $('hud').hidden = false;
    const p = sim.st.pts[s];
    stage.flyTo(p.x + (s === 0 ? 6 : -6), p.z + 4, 38, 2600);
    stage.yaw = s === 0 ? -0.5 : 0.5;
  }

  function startLocal(s: Side, diff: number) {
    shared?.leave();
    clearLocal();
    sim.init((Math.random() * 2 ** 31) | 0);
    const sess = new Session(sim, new LocalBackend(prefs.pid, s), prefs.pid);
    sess.setClock(0, Date.now());
    beginSession(s, sess);
    sess.submit({ k: 'cfg', d: diff, hs: s, mp: 0 });
    sess.submit({ k: 'join', s });
    say('admin', 'Война №1. Чу вала!');
  }

  function resumeLocal() {
    const save = loadLocal();
    if (!save) return;
    shared?.leave();
    sim.load(save.st);
    const sess = new Session(sim, new LocalBackend(prefs.pid, save.side), prefs.pid);
    sess.setClock(save.st.tick, Date.now());
    beginSession(save.side, sess);
    if (!sim.st.players[prefs.pid]) sess.submit({ k: 'join', s: save.side });
    say('admin', 'Мир спал, пока тебя не было. Продолжаем');
  }

  async function startShared(s: Side) {
    if (!shared) return;
    session?.backend.close?.();
    const sess = await shared.join(sim, s);
    if (!sess) { hud.banner('Общая война недоступна', 'Играем против ИИ', -1); return; }
    beginSession(s, sess);
    say('admin', `Ты в общей войне за ${SIDE_NAME[s]}. Чу вала!`);
  }

  function openMenu() {
    playing = false;
    if (session && session.backend.kind === 'local') { session.pause(true); session.backend.checkpoint(sim.snapshot(), Date.now()); }
    const save = loadLocal();
    menuState.canContinue = save ? { era: save.st.era, side: save.side, wins: [save.st.sides[0].wins, save.st.sides[1].wins] } : null;
    menuState.shared = shared ? shared.menuInfo() : { available: false, online: [0, 0], era: 1, wins: [0, 0] };
    $('hud').hidden = true;
    renderMenu($('menu'), portraits, menuState, {
      start: (s, d) => { sound.unlock(); startLocal(s, d); },
      resume: () => { sound.unlock(); if (session && session.backend.kind === 'local' && session.paused) { session.pause(false); playing = true; $('menu').hidden = true; $('hud').hidden = false; } else resumeLocal(); },
      shared: s => { sound.unlock(); void startShared(s); },
      setDiff: d => { prefs.diff = d; savePrefs(prefs); },
      setSpicy: on => { prefs.spicy = on; savePrefs(prefs); },
    });
  }

  // ---- input ---------------------------------------------------------------------------------
  const keyPan = bindInput(stage, canvas, (x, y) => {
    sound.unlock();
    if (!playing || !session) return;
    lastTap = { x, y };
    if (hud.selected < 0) { hud.hint('Сначала выбери юнита внизу'); return; }
    const p = stage.pick(x, y);
    if (!p) return;
    const why = sim.canDeploy(side, hud.selected, p.x, p.z, sim.st.players[prefs.pid]);
    if (why) { sound.deny(); hud.tip(x, y, lore.deny(why, prefs.spicy)); return; }
    session.submit({ k: 'dep', s: side, u: hud.selected, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 });
    sound.deploy();
    hud.tip(x, y, `−${UNITS[hud.selected].cost[side]} ₽`);
  }, () => { /* hover preview could go here */ });
  addEventListener('keydown', e => {
    if (!playing) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 5) { sound.unlock(); hud.select(hud.selected === n - 1 ? -1 : n - 1); }
    if (e.key === 'Escape') hud.select(-1);
    if (e.code === 'Space') { const p = sim.st.pts[side]; stage.flyTo(p.x, p.z, 38); e.preventDefault(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!session || session.backend.kind !== 'local') return;
    if (document.hidden) { session.backend.checkpoint(sim.snapshot(), Date.now()); session.pause(true); }
    else if (playing) session.pause(false);
  });

  // ---- sim events → effects, sound, chat -------------------------------------------------------
  const near = (x: number, z: number, r = 90) => { const t = stage.target; return (t.x - x) ** 2 + (t.z - z) ** 2 < r * r && stage.dist < 200; };
  function handleFx(list: FxEv[]) {
    const now = performance.now();
    for (const e of list) {
      switch (e.e) {
        case 'spawn': {
          const y = heightY(terrain, e.x, e.z);
          if (near(e.x, e.z)) particles.emit(e.x, y + 0.1, e.z, { n: e.t === 5 ? 40 : 6, color: '#d9cdb4', size: e.t === 5 ? 0.9 : 0.45, life: 0.7, spread: 1.4, up: 0.6, grav: 0.4, grow: 0.8 });
          break;
        }
        case 'hit': {
          if (!near(e.x, e.z)) break;
          const y = heightY(terrain, e.x, e.z) + 0.6;
          particles.emit(e.x, y, e.z, { n: e.big ? 10 : 3, color: e.big ? '#e8d9b8' : '#fff1b0', size: e.big ? 0.5 : 0.22, life: 0.35, spread: 2.2, up: 1.2, grav: 4 });
          sound.hit(e.big);
          break;
        }
        case 'die': {
          if (!near(e.x, e.z)) break;
          const y = heightY(terrain, e.x, e.z) + 0.4;
          particles.emit(e.x, y, e.z, { n: 8, color: '#bdb3a2', size: 0.55, life: 0.8, spread: 1, up: 0.8, grav: 0.3, grow: 0.9 });
          particles.emit(e.x, y + 0.3, e.z, { n: 6, color: PAL.side[e.s], size: 0.18, life: 0.9, spread: 2, up: 2.4, grav: 6 });
          break;
        }
        case 'shot': {
          const y0 = heightY(terrain, e.x, e.z) + (e.k === 3 ? 3 : e.k === 2 ? 2.2 : 0.75);
          const y1 = heightY(terrain, e.tx, e.tz) + 0.6;
          shots.add(e.k, e.x, y0, e.z, e.tx, y1, e.tz, now, now + Math.max(1, e.at - sim.st.tick) * TICK_MS);
          if (near(e.x, e.z, 60)) sound.shot(e.k);
          break;
        }
        case 'floor': {
          const b = hqs[e.s];
          b.setFloors(e.floors, true);
          const p = sim.st.pts[e.s];
          const y = heightY(terrain, p.x, p.z) + b.height + 0.5;
          particles.emit(p.x, y, p.z, { n: 70, color: '#cfc4ae', size: 1.6, life: 2.2, spread: 3.5, up: 0.9, grav: 0.25, grow: 1.4, jitter: 3 });
          if (near(p.x, p.z, 70)) stage.shake = 1;
          sound.collapse();
          if (e.s === 0) say('chimaev', e.floors > 0 ? (prefs.spicy && Math.random() < 0.4 ? 'Бля, у меня член больше' : `${e.floors} ${e.floors === 1 ? 'этаж' : 'этажа'}`) : 'Куда лезет букашка');
          else say('islam', prefs.spicy && Math.random() < 0.3 ? 'Выебали тебя, да' : pickOne(['Бурдж-Халифа просела', 'Для тебя это как небоскрёб… был', `Пятиэтажка уже ${e.floors}-этажка`]));
          if (e.floors === 1) hud.banner(`${SIDE_NAME[e.s]}: последний этаж`, e.s === 0 ? 'Нам сельским не впервой' : 'Местный Бурдж-Халифа шатается', e.s);
          break;
        }
        case 'floorUp': {
          hqs[e.s].setFloors(e.floors, true);
          sound.floorUp();
          break;
        }
        case 'found4': {
          hud.banner('Ислам нашёл 4-й этаж', 'Я СДЕЛАЛ ЭТО', 0, 3600);
          say('islam', 'Я СДЕЛАЛ ЭТО');
          setTimeout(() => say('chimaev', 'Ладно, перегнул'), 1800);
          break;
        }
        case 'capture': {
          const p = sim.st.pts[e.p];
          if (e.s < 0) { say('admin', `${p.name} теперь ничьё`); break; }
          sound.capture(e.s === side);
          const y = heightY(terrain, p.x, p.z) + 1;
          particles.emit(p.x, y, p.z, { n: 30, color: PAL.side[e.s], size: 0.3, life: 1.2, spread: 4, up: 3, grav: 5, jitter: 2 });
          if (p.key === 'shali') say(e.s === 1 ? 'zurab' : 'islam', e.s === 1 ? 'У нас знаешь их сколько?' : 'Курчалой, ну как там, завидуете?');
          else if (e.s === 0) say('islam', pickOne([`${p.name} наш. Тактика`, 'Мы в плюсе', 'Спасибо Исламу', 'Йоккха Атаг1а — центр мира']));
          else say('chimaev', pickOne([`${p.name} наш. Я соло за Курчалой тащу`, 'Исход очевиден', 'Куда лезет букашка', 'Факты ☝🏿']));
          break;
        }
        case 'vote':
          if (e.s === side) { sound.gavel(); say('admin', 'Админ издал указ: сход. Голосуем'); }
          break;
        case 'voteResult': {
          const card = CARDS[e.card];
          if (e.s === side) {
            sound.gavel();
            hud.banner(`Сход решил: ${e.title}`, card.quote, e.s, 2800);
            if (card.fx === Fx.Focus) { const v = sim.st.votes[e.s]; if (v.focusPt >= 0) { const p = sim.st.pts[v.focusPt]; stage.flyTo(p.x, p.z, Math.min(stage.dist, 110)); } }
          } else {
            say('admin', `${SIDE_NAME[e.s]} решил: ${cardTitle(card, e.title.replace(/^Все на |!$/g, ''))}`);
          }
          if (card.fx === Fx.Blackout && e.s !== side) say('chimaev', 'Свет яц. Я тут долго не протяну');
          if (card.fx === Fx.EnemyN && e.s === side) say('admin', 'Всем Н. Страйк нельзя прерывать');
          if (card.fx === Fx.Floor && e.s === 1) say('wou', 'Местный Бурдж-Халифа');
          break;
        }
        case 'boss': {
          sound.boss(e.s);
          stage.shake = 0.6;
          hud.banner(e.s === 1 ? 'Финальный босс: Качок Зураб' : 'Выходит Ислам #1 ranked chad', e.s === 1 ? 'Баля ма зверь йу со' : 'Высокий. Барсетка. Перхоть', e.s, 3400);
          if (e.s === 1) say('zurab', lore.bossShout(1, prefs.spicy)); else { say('islam', 'Я копил ульту. Теперь отдыхайте, ребята'); setTimeout(() => say('wou', '+10000000000000000 aura'), 1500); }
          break;
        }
        case 'bossDown':
          hud.banner(e.s === 1 ? 'Зураб лёг' : 'Ислам лёг', e.s === 1 ? 'Счёт 1:0, вернётся сильнее' : 'Сегодня Ислама не трогаем', e.s === 1 ? 0 : 1);
          if (e.s === 1) say('chimaev', 'Тише.. Зураб.. успокойся.. я рядом..'); else say('zurab', 'Немощь');
          break;
        case 'ult': {
          sound.ult();
          if (near(e.x, e.z)) stage.shake = 0.7;
          const y = heightY(terrain, e.x, e.z) + 0.3;
          for (let k = 0; k < 28; k++) {
            const a = (k / 28) * Math.PI * 2;
            particles.emit(e.x + Math.cos(a) * e.r * 0.5, y, e.z + Math.sin(a) * e.r * 0.5, { n: 2, color: e.s === 0 ? '#ffffff' : '#d9c9a5', size: 0.7, life: 0.8, spread: 3.5, up: 0.8, grav: 1, grow: 1 });
          }
          if (Math.random() < 0.5) say(e.s === 0 ? 'islam' : 'zurab', lore.bossShout(e.s, prefs.spicy));
          break;
        }
        case 'victory': {
          const win = e.s === side;
          sound.victory(win);
          const taunt = win ? lore.win(prefs.spicy) : lore.lose(prefs.spicy);
          hud.showOver(sim, win, taunt);
          overEra = sim.st.era;
          say(e.s === 0 ? 'islam' : 'zurab', lore.win(prefs.spicy));
          setTimeout(() => say(e.s === 0 ? 'zurab' : 'islam', lore.lose(prefs.spicy)), 1600);
          break;
        }
        case 'newWar':
          hud.hideOver();
          hqs.forEach((b, i) => b.setFloors(sim.st.sides[i].floors, false));
          units.resetVis();
          hud.banner(`Война №${e.era}`, 'Чу вала!', -1, 2400);
          say('admin', `Война №${e.era}. Счёт ${sim.st.sides[0].wins}:${sim.st.sides[1].wins}`);
          break;
        case 'deny':
          if (e.p === prefs.pid) { sound.deny(); hud.tip(lastTap.x, lastTap.y, lore.deny(e.why, prefs.spicy)); }
          break;
        case 'deployed':
          break;
      }
    }
    list.length = 0;
  }

  // ---- shared war (artifact runtime) ------------------------------------------------------------
  connectShared(prefs.pid).then(s => {
    shared = s;
    if (!playing && !$('menu').hidden) openMenu();
  }).catch(() => { shared = null; });

  // ---- loop --------------------------------------------------------------------------------------------
  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    keyPan(dt);
    if (session && !session.paused) {
      session.advance(12);
      handleFx(sim.fx);
      if (session.backend.kind === 'local' && now - lastSave > 5000) { lastSave = now; session.backend.checkpoint(sim.snapshot(), Date.now()); }
      if (session.backend.kind === 'shared') shared?.tick(session);
      if (playing && now > nextChatter) {
        nextChatter = now + 15000 + Math.random() * 12000;
        const pool = TICKER.filter(l => prefs.spicy || !l.spicy);
        const l = pickOne(pool);
        say(l.who ?? 'беседа', l.t);
      }
      sound.intensity = Math.min(1, sim.st.units.length / 140);
      // reconcile with state (events are muted while a tab catches up)
      if (sim.st.winner === -1 && hud.overOpen) hud.hideOver();
      if (playing && sim.st.winner !== -1 && overEra !== sim.st.era) { overEra = sim.st.era; hud.showOver(sim, sim.st.winner === side, sim.st.winner === side ? lore.win(prefs.spicy) : lore.lose(prefs.spicy)); }
    } else {
      sim.fx.length = 0;
      if (!playing) { stage.yaw += dt * 0.035; if (!session) { stage.target.set(205, 0, 140); stage.dist = 230; } }
    }
    const sel = playing && hud.selected >= 0;
    hqZones.forEach((m, s) => { m.visible = sel && s === side && sim.st.pts[s].owner === side; });
    stage.update(dt);
    const tnow = now / 1000;
    hqs.forEach((b, s) => { b.update(dt, tnow); if (b.floors.length !== sim.st.sides[s].floors && !b.falling.length) b.setFloors(sim.st.sides[s].floors, true); });
    markers.forEach(m => m.update(tnow));
    units.zoomK = Math.max(1, Math.min(2.4, stage.dist / 50));
    units.update(session ? session.alpha() : 1, now, dt, stage.camera);
    particles.setScale(stage.renderer.domElement.height / (2 * Math.tan((stage.camera.fov * Math.PI) / 360)));
    particles.update(dt, tnow);
    shots.update(now, s => {
      if (s.k === 2 && near(s.x1, s.z1)) particles.emit(s.x1, s.y1, s.z1, { n: 14, color: '#ffffff', size: 0.16, life: 1.4, spread: 1.6, up: 0.4, grav: 0.4, wob: 1 });
      if ((s.k === 4 || s.k === 5) && near(s.x1, s.z1)) particles.emit(s.x1, s.y1 + 0.4, s.z1, { n: 4, color: '#8fe08a', size: 0.25, life: 0.6, spread: 0.6, up: 1.4, grav: 0.5 });
    });
    if (playing) { labels.update(); minimap.draw(now); hud.update(sim, prefs.pid, now); }
    else labels.update();
    stage.renderer.render(scene, stage.camera);
    requestAnimationFrame(frame);
  };
  $('boot').classList.add('done');
  openMenu();
  requestAnimationFrame(frame);
  // debug handle for automated checks
  (window as unknown as { __game: unknown }).__game = { sim, stage, get session() { return session; }, hud, start: startLocal, units };
}

boot().catch(err => {
  console.error(err);
  bootMsg('Не загрузилось: ' + (err?.message ?? err) + '. Обнови страницу.');
});
