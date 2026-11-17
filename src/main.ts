import './ui/style.css';
import * as THREE from 'three';
import { loadTerrain, heightY, setRenderSurface } from './world/terrain';
import { Sim, cardTitle, PT_DONER, type FxEv } from './sim/sim';
import { TICK_MS, HQ, CARDS, UNITS, SIDE_NAME, Fx, HEROES as HERO_TYPES, RIDE, GOLEM, CHICKEN, WOU, ADMIN, ERSNO, type Side } from './sim/defs';
import { Stage, bindInput } from './render/scene';
import { terrainMesh, waterMesh } from './render/terrainMesh';
import { buildTin, tinHeight, paintTin } from './render/lowpoly';
import { buildVillages, buildTrees, buildBridges, mosque, HqBuilding, VillageMarker, drapedRing, keepOut } from './render/world';
import { buildRoads } from './render/roads';
import { Particles, Shots } from './render/fx';
import { UnitView } from './render/units';
import { buildDecor } from './render/decor';
import { AbilityFx } from './render/abilityFx';
import { PAL } from './render/models';
import { makePortraits } from './ui/portraits';
import { Hud } from './ui/hud';
import { Labels } from './ui/labels';
import { Minimap } from './ui/minimap';
import { renderMenu, type MenuState } from './ui/menu';
import { Sound } from './audio/sound';
import { Session, LocalBackend, loadLocal, clearLocal } from './net/session';
import { connectShared, type Shared } from './net/shared';
import { TICKER, HINTS, lore, type Line } from './data/lore';
import {
  HEROES, EVENTS as EVENT_LORE, DONER, FUJI, SUMMON_LINES, PACK_REACT, UNIT_LINES, CARD_TEXT, PERK_TEXT,
  heroForUnit, heroLine, pickLine, unitLine, placeLine, type HeroId, type LineBucket, type ExtraBucket, type EventId, type PerkId,
} from './data/heroes';
import { Achievements, AchToasts, achievedIds } from './ui/achievements';
import { DECK_KEYS } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const bootMsg = (s: string) => { $('boot-msg').textContent = s; };

interface Prefs { pid: string; diff: number; spicy: boolean; muted: boolean; music: boolean }
function loadPrefs(): Prefs {
  let p: Partial<Prefs> = {};
  try { p = JSON.parse(localStorage.getItem('vysotka.prefs') || '{}'); } catch { /* blocked storage */ }
  return { pid: p.pid || 'p' + Math.random().toString(36).slice(2, 10), diff: p.diff ?? 1, spicy: p.spicy ?? true, muted: p.muted ?? false, music: p.music ?? true };
}
function savePrefs(p: Prefs) { try { localStorage.setItem('vysotka.prefs', JSON.stringify(p)); } catch { /* blocked storage */ } }

/** Feed speakers: display name and pen colour (-1 = pencil, mercs take the colour of whoever fields them). */
const WHO: Record<string, { name: string; side: number }> = {
  islam: { name: 'Ислам #1 ranked chad', side: 0 },
  zurab: { name: 'Зураб легенда', side: 1 },
  chimaev: { name: 'Чимаев', side: 1 },
  bekhan: { name: 'Бекхан', side: 0 },
  wou: { name: 'Амин', side: -1 },
  admin: { name: 'админ', side: -1 },
  ersno: { name: 'ersno', side: -1 },
  adam: { name: 'Адам', side: -1 },
  mohmad: { name: 'Мохьмад', side: -1 },
};
const WHO_RE: [RegExp, string][] = [
  [/^Ислам/, 'islam'], [/^(Качок )?Зураб/, 'zurab'], [/^Чимаев/, 'chimaev'], [/^Бекхан/, 'bekhan'], [/^(Амин|WOU)/, 'wou'],
  [/^админ/i, 'admin'], [/^ersno/, 'ersno'], [/^Адам/, 'adam'], [/^Мохьмад/, 'mohmad'],
];
const pickOne = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** v3 sim events (steal, pack, comedown) as read by the feed before the sim types know them. */
interface V3Ev { e: string; s?: number; v?: number; n?: number; k?: string; x?: number; z?: number; r?: number; until?: number }
/** Feed priority: 0 chatter, 1 the other side, 2 our side, 3 must-see (events, bosses, wars). */
type Prio = 0 | 1 | 2 | 3;
interface FeedLine { who: string; text: string; side: number; prio: Prio; at: number; until: number }
const FEED_GAP = 1500, FEED_MAX = 6;

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
  const tin = buildTin(terrain);
  setRenderSurface((x, z) => tinHeight(tin, x, z)); // houses, units and labels sit on the drawn faces
  console.info(`low-poly map: ${tin.np} points, ${tin.nt} faces, ${tin.ms.toFixed(0)} ms`);
  scene.add(terrainMesh(terrain, tin));
  scene.add(waterMesh(terrain, tin));
  const world = new THREE.Group();
  scene.add(world);
  bootMsg('Строим сёла…');
  await new Promise(r => setTimeout(r, 16));
  buildRoads(world, terrain, { lowPower: stage.lowPower, tin, keep: keepOut(terrain, sim.st.pts) });
  const nh = buildVillages(terrain, sim.st.pts, world, !stage.lowPower);
  const nt = buildTrees(terrain, world, !stage.lowPower, tin);
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
  const decor = buildDecor(scene, sim);
  const afx = new AbilityFx(scene, particles, stage);

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
  let nextHint = performance.now() + 20000;
  let overEra = 0;
  const menuState: MenuState = { canContinue: null, diff: prefs.diff, spicy: prefs.spicy, shared: null, tab: 'play' };

  /** Card tap or key: select, or say why it can't be used now. */
  const pickCard = (t: number) => {
    sound.unlock();
    const why = hud.cardBlocked(t);
    if (why) { sound.deny(); hud.note(lore.deny(why, prefs.spicy)); return; }
    sound.click();
    hud.select(hud.selected === t ? -1 : t);
  };
  const hud = new Hud($('hud'), {
    portraits,
    onCard: t => pickCard(t),
    onTab: () => { sound.unlock(); sound.click(); },
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
  const minimap = new Minimap(hud.miniCanvas, (g, w, h) => paintTin(tin, g, w, h), terrain, sim, stage);
  const toasts = new AchToasts($('hud'), () => prefs.spicy, () => sound.achievement());
  const ach = new Achievements(a => toasts.push(a));
  /** Everything that follows the 18+ toggle. */
  const applySpicy = () => {
    hud.spicy = prefs.spicy;
    labels.setSpicy(prefs.spicy);
    decor.setSpicy(prefs.spicy);
  };
  applySpicy();

  // ---- беседа: a queue, at most one line every 1.5 s, our side first ------------------------
  const feedQ: FeedLine[] = [];
  let feedNext = 0;
  const speaker = (who: string) => { if (WHO[who]) return who; for (const [re, k] of WHO_RE) if (re.test(who)) return k; return ''; };
  const say = (who: string, text: string, prio: Prio = 2, sideOf?: number, delayMs = 0) => {
    const key = speaker(who), w = key ? WHO[key] : null;
    const now = performance.now();
    feedQ.push({ who: WHO[who] ? WHO[who].name : who || 'беседа', text, side: sideOf ?? w?.side ?? -1, prio, at: now + delayMs, until: now + delayMs + (prio >= 3 ? 14000 : 7000) });
    if (feedQ.length > FEED_MAX) { // drop the least important (oldest among equals)
      let k = 0;
      for (let i = 1; i < feedQ.length; i++) if (feedQ[i].prio < feedQ[k].prio) k = i;
      feedQ.splice(k, 1);
    }
  };
  /** A lore line; mercSide colours a mercenary speaker (Мохьмад about his Голем) by the side he plays for. */
  const sayLine = (l: Line | null, prio: Prio = 2, mercSide?: number, delayMs = 0) => {
    if (!l) return;
    const key = speaker(l.who ?? '');
    say(l.who ?? 'беседа', l.t, prio, key && WHO[key].side === -1 ? mercSide : undefined, delayMs);
  };
  function pumpFeed(now: number) {
    if (now < feedNext || !feedQ.length) return;
    for (let i = feedQ.length - 1; i >= 0; i--) if (feedQ[i].until < now) feedQ.splice(i, 1);
    let k = -1;
    for (let i = 0; i < feedQ.length; i++) if (feedQ[i].at <= now && (k < 0 || feedQ[i].prio > feedQ[k].prio)) k = i;
    if (k < 0) return;
    const q = feedQ.splice(k, 1)[0];
    hud.feedMsg(q.who, q.text, q.side);
    feedNext = now + FEED_GAP;
  }
  const pr = (s: number): Prio => (s === side ? 2 : 1);
  const cds = new Map<string, number>();
  /** true at most once per `ms` for this key (chatter throttling). */
  const cool = (key: string, ms: number) => { const now = performance.now(); if ((cds.get(key) ?? 0) > now) return false; cds.set(key, now + ms); return true; };
  /** A hero's line from src/data/heroes.ts; the hero's own lines take the pen of the side that fielded them. */
  const heroSay = (t: number, s: Side, bucket: LineBucket | ExtraBucket, prio: Prio = pr(s), delayMs = 0) => {
    const id: HeroId | null = heroForUnit(t, s);
    if (!id) return;
    const l = heroLine(id, bucket, prefs.spicy);
    say(l.who!, l.t, prio, l.who === HEROES[id].name ? s : undefined, delayMs);
  };
  /** Somebody on the field says an idle line now and then (our side more often). */
  const heroIdle = () => {
    if (Math.random() < 0.25) { // a Гелик or Спортики of ours, if any, gets a word in
      const u = sim.st.units.find(x => x.s === side && UNIT_LINES[x.t]);
      if (u) { sayLine(unitLine(u.t, 'idle', prefs.spicy), 0, u.s); return true; }
    }
    const mine: [number, Side][] = [], theirs: [number, Side][] = [];
    for (const s of [0, 1] as Side[]) {
      const sd = sim.st.sides[s], to = s === side ? mine : theirs;
      for (const t of HERO_TYPES) if (sd.hero[t] >= 0) to.push([t, s]);
      if (sd.boss >= 0) to.push([5, s]);
    }
    const pool = mine.length && (Math.random() < 0.7 || !theirs.length) ? mine : theirs;
    if (!pool.length) return false;
    const [t, s] = pickOne(pool);
    heroSay(t, s, 'idle', 0);
    return true;
  };
  const donerName = () => (prefs.spicy ? DONER.spicy : DONER.clean);
  // tips: the new ones (heroes, Донер Бей, rides) first, then everything in a shuffled loop
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let hintQ = [...shuffle(HINTS.slice(7)), ...shuffle(HINTS.slice(0, 7))];
  const nextTip = () => { if (!hintQ.length) hintQ = shuffle([...HINTS]); return hintQ.shift()!; };

  function beginSession(s: Side, sess: Session, fresh = false) {
    session = sess;
    side = s;
    hud.setSide(s);
    hud.hideOver();
    units.resetVis();
    afx.clear();
    labels.side = s; labels.reset();
    feedQ.length = 0; nextHint = performance.now() + 20000;
    hqs.forEach((b, i) => b.setFloors(sim.st.sides[i].floors, false));
    ach.begin(sim, s, fresh);
    syncPlaces();
    session.onStep = () => { units.capture(performance.now()); ach.step(); };
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
    beginSession(s, sess, true);
    sess.submit({ k: 'cfg', d: diff, hs: s, mp: 0 });
    sess.submit({ k: 'join', s });
    say('admin', 'Война №1. Чу вала!', 3);
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
    say('admin', 'Мир спал, пока тебя не было. Продолжаем', 3);
  }

  async function startShared(s: Side) {
    if (!shared) return;
    session?.backend.close?.();
    const sess = await shared.join(sim, s);
    if (!sess) { hud.banner('Общая война недоступна', 'Играем против ИИ', -1); return; }
    beginSession(s, sess);
    say('admin', `Ты в общей войне за ${SIDE_NAME[s]}. Чу вала!`, 3);
  }

  function openMenu() {
    playing = false;
    if (session && session.backend.kind === 'local') { session.pause(true); session.backend.checkpoint(sim.snapshot(), Date.now()); }
    const save = loadLocal();
    menuState.canContinue = save ? { era: save.st.era, side: save.side, wins: [save.st.sides[0].wins, save.st.sides[1].wins] } : null;
    menuState.shared = shared ? shared.menuInfo() : { available: false, online: [0, 0], era: 1, wins: [0, 0] };
    menuState.achieved = achievedIds();
    $('hud').hidden = true;
    renderMenu($('menu'), portraits, menuState, {
      start: (s, d) => { sound.unlock(); startLocal(s, d); },
      resume: () => { sound.unlock(); if (session && session.backend.kind === 'local' && session.paused) { session.pause(false); playing = true; $('menu').hidden = true; $('hud').hidden = false; } else resumeLocal(); },
      shared: s => { sound.unlock(); void startShared(s); },
      setDiff: d => { prefs.diff = d; savePrefs(prefs); },
      setSpicy: on => { prefs.spicy = on; savePrefs(prefs); applySpicy(); if (!on) feedQ.length = 0; },
    });
  }

  // ---- input ---------------------------------------------------------------------------------
  const keyPan = bindInput(stage, canvas, (x, y) => {
    sound.unlock();
    if (!playing || !session) return;
    lastTap = { x, y };
    const t = hud.selected;
    if (t < 0) { hud.note('Сначала выбери юнита внизу'); return; }
    const p = stage.pick(x, y);
    if (!p) return;
    const why = sim.canDeploy(side, t, p.x, p.z, sim.st.players[prefs.pid]);
    if (why) { sound.deny(); hud.tip(x, y, lore.deny(why, prefs.spicy)); return; }
    const cost = sim.cost(side, t);
    session.submit({ k: 'dep', s: side, u: t, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 });
    sound.deploy();
    hud.tip(x, y, `−${cost} ₽`);
    if (UNITS[t].hero) hud.select(-1); // one per side: the card goes «на поле»
  }, () => { /* hover preview could go here */ });
  addEventListener('keydown', e => {
    if (!playing) return;
    const k = e.ctrlKey || e.metaKey || e.altKey ? -1 : DECK_KEYS.indexOf(e.key);
    if (k >= 0 && hud.typeAt(k) >= 0) pickCard(hud.typeAt(k));
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
  const projTmp = { x: 0, y: 0, vis: false };
  /** Last known owner of each point, so a lost place can say its «lost» line. */
  const placeOwner = new Map<number, number>();
  function syncPlaces() { placeOwner.clear(); sim.st.pts.forEach((p, i) => placeOwner.set(i, p.owner)); }
  /**
   * v3 events, read loosely so this file compiles before the sim has them:
   * 'steal' {s thief side, v victim side, n ₽, k 'hit' | 'card'}, 'pack' {s, x, z, r, n scared},
   * 'comedown' {s} — «Закинуть снюс» wore off.
   */
  function v3Feed(e: V3Ev) {
    const s = (e.s === 1 ? 1 : 0) as Side, n = Math.round(e.n ?? 0);
    switch (e.e) {
      case 'steal': {
        if (n <= 0) break;
        const v = (1 - s) as Side;
        if (e.k === 'card') {
          if (v === side) hud.banner('Списание с карты', `ersno увёл ${n} ₽ из нашей кассы`, s, 2400);
          sayLine(heroLine('ersno', 'steal', prefs.spicy), pr(v), undefined, 1200);
        } else if (v === side && cool('steal', 30000)) sayLine(heroLine('ersno', 'steal', prefs.spicy), 1);
        if (e.x !== undefined && e.z !== undefined && near(e.x, e.z, 60) && (e.k === 'card' || s === side || v === side)) {
          stage.project(e.x, heightY(terrain, e.x, e.z) + 2.4, e.z, projTmp);
          if (projTmp.vis) hud.tip(projTmp.x, projTmp.y, `${s === side ? '+' : '−'}${n} ₽`);
        }
        break;
      }
      case 'pack': {
        if (cool('pack' + s, 8000)) heroSay(ADMIN, s, 'ult', s === side || n >= 6 ? 2 : 1);
        if (n >= 4 && Math.random() < 0.6 && cool('packr', 20000)) sayLine(pickLine(PACK_REACT, prefs.spicy), 1, undefined, 1800);
        if (n >= 8 && s === side) hud.banner('Курение убивает', `${n} разбежались`, s, 2200);
        if (e.x !== undefined && e.z !== undefined && near(e.x, e.z, 70)) {
          stage.project(e.x, heightY(terrain, e.x, e.z) + 3, e.z, projTmp);
          if (projTmp.vis) hud.tip(projTmp.x, projTmp.y, n > 0 ? `КУРЕНИЕ УБИВАЕТ ×${n}` : 'КУРЕНИЕ УБИВАЕТ', 'tip-n');
        }
        break;
      }
      case 'comedown':
        if (s === side) sayLine(pickLine(CARD_TEXT[30]?.after ?? [], prefs.spicy), 2);
        break;
    }
  }

  function handleFx(list: FxEv[]) {
    afx.handleAll(list);
    const now = performance.now();
    let back: Set<number> | null = null; // heroes coming back from «пары» this frame (their spawn is not news)
    for (const e of list) {
      ach.fx(e);
      switch (e.e) {
        case 'spawn': {
          const y = heightY(terrain, e.x, e.z);
          if (near(e.x, e.z)) particles.emit(e.x, y + 0.1, e.z, { n: e.t === 5 ? 40 : 6, color: '#d9cdb4', size: e.t === 5 ? 0.9 : 0.45, life: 0.7, spread: 1.4, up: 0.6, grav: 0.4, grow: 0.8 });
          if (UNITS[e.t].hero) {
            back ??= new Set(list.flatMap(x => (x.e === 'heroBack' && x.id > 0 ? [x.id] : [])));
            if (back.has(e.id)) break;
            if (e.s === side || near(e.x, e.z)) sound.heroIn(e.s);
            heroSay(e.t, e.s, 'spawn');
          } else if (e.t === RIDE && (e.s === side || near(e.x, e.z, 60))) sound.horn(e.s);
          else if (UNIT_LINES[e.t] && cool('u' + e.t + e.s, 20000)) sayLine(unitLine(e.t, 'spawn', prefs.spicy), pr(e.s), e.s);
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
          if (Math.random() < 0.3 && cool('kill', 14000)) { // a hero or boss next to the kill gloats
            const k = (1 - e.s) as Side, ks = sim.st.sides[k];
            for (const id of [...HERO_TYPES.map(t => ks.hero[t]), ks.boss]) {
              const u = id >= 0 ? sim.unit(id) : undefined;
              if (u && (u.x - e.x) ** 2 + (u.z - e.z) ** 2 < 20) { heroSay(u.t, k, 'kill', k === side ? 1 : 0); break; }
            }
          }
          if (!near(e.x, e.z)) break;
          const y = heightY(terrain, e.x, e.z) + 0.4;
          particles.emit(e.x, y, e.z, { n: 8, color: '#bdb3a2', size: 0.55, life: 0.8, spread: 1, up: 0.8, grav: 0.3, grow: 0.9 });
          particles.emit(e.x, y + 0.3, e.z, { n: 6, color: PAL.side[e.s], size: 0.18, life: 0.9, spread: 2, up: 2.4, grav: 6 });
          if (e.t === CHICKEN && cool('chickdie', 20000)) sayLine(pickLine(SUMMON_LINES.chicken.death, prefs.spicy), 0, e.s);
          if (e.t === GOLEM) sayLine(pickLine(SUMMON_LINES.golem.death, prefs.spicy), pr(e.s), e.s);
          if (UNIT_LINES[e.t] && cool('ud' + e.t, 25000)) sayLine(unitLine(e.t, 'death', prefs.spicy), e.s === side ? 1 : 0, e.s);
          if (Math.random() < 0.15 && cool('ukill', 30000)) {
            for (const u of sim.st.units) {
              if (u.s !== e.s && UNIT_LINES[u.t] && (u.x - e.x) ** 2 + (u.z - e.z) ** 2 < 12) { sayLine(unitLine(u.t, 'kill', prefs.spicy), u.s === side ? 1 : 0, u.s); break; }
            }
          }
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
          if (e.s === 0) say('chimaev', e.floors > 0 ? (prefs.spicy && Math.random() < 0.4 ? 'Бля, у меня член больше' : `${e.floors} ${e.floors === 1 ? 'этаж' : 'этажа'}`) : 'Куда лезет букашка', 2);
          else say('islam', prefs.spicy && Math.random() < 0.3 ? 'Выебали тебя, да' : pickOne(['Бурдж-Халифа просела', 'Для тебя это как небоскрёб… был', `Пятиэтажка уже ${e.floors}-этажка`]), 2);
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
          say('islam', 'Я СДЕЛАЛ ЭТО', 3);
          say('chimaev', 'Ладно, перегнул', 3, undefined, 1800);
          break;
        }
        case 'capture': {
          const p = sim.st.pts[e.p], doner = e.p === PT_DONER, name = doner ? donerName() : p.name;
          const perk = (p as { perk?: string }).perk, was = placeOwner.get(e.p) ?? -1;
          placeOwner.set(e.p, e.s);
          if (e.s < 0) { say('admin', `${name} теперь ничьё`, 1); if (perk && was >= 0) sayLine(placeLine(perk, 'lost', prefs.spicy), was === side ? 2 : 1, was, 1400); break; }
          sound.capture(e.s === side);
          const y = heightY(terrain, p.x, p.z) + 1;
          particles.emit(p.x, y, p.z, { n: 30, color: PAL.side[e.s], size: 0.3, life: 1.2, spread: 4, up: 3, grav: 5, jitter: 2 });
          if (doner) {
            if (e.s === side) hud.banner(`${name} наш`, 'Плюс 5 ₽ в секунду, свои рядом лечатся', e.s, 2400);
            sayLine(pickLine(DONER.lines, prefs.spicy), pr(e.s), e.s);
          } else if (perk) {
            if (e.s === side) hud.banner(`${p.name} наш`, PERK_TEXT[perk as PerkId] ?? '', e.s, 2400);
            sayLine(placeLine(perk, 'capture', prefs.spicy), pr(e.s), e.s);
            if (was >= 0 && was !== e.s) sayLine(placeLine(perk, 'lost', prefs.spicy), was === side ? 2 : 1, was, 1600);
          } else if (p.key === 'shali') say(e.s === 1 ? 'zurab' : 'islam', e.s === 1 ? 'У нас знаешь их сколько?' : 'Курчалой, ну как там, завидуете?', pr(e.s));
          else if (e.s === 0) say('islam', pickOne([`${p.name} наш. Тактика`, 'Мы в плюсе', 'Спасибо Исламу', 'Йоккха Атаг1а — центр мира']), pr(0));
          else say('chimaev', pickOne([`${p.name} наш. Я соло за Курчалой тащу`, 'Исход очевиден', 'Куда лезет букашка', 'Факты ☝🏿']), pr(1));
          break;
        }
        case 'vote':
          if (e.s === side) { sound.gavel(); say('admin', 'Админ издал указ: сход. Голосуем', 3); }
          break;
        case 'voteResult': {
          const card = CARDS[e.card], v3 = CARD_TEXT[e.card] ? hud.cardText(e.card) : null;
          if (v3) sayLine(pickLine(CARD_TEXT[e.card].react ?? [], prefs.spicy), pr(e.s), e.s, 2200);
          if (e.s === side) {
            sound.gavel();
            hud.banner(`Сход решил: ${v3 ? v3.title : e.title}`, v3 ? v3.desc : card.quote, e.s, 2800);
            if (card.fx === Fx.Focus) { const v = sim.st.votes[e.s]; if (v.focusPt >= 0) { const p = sim.st.pts[v.focusPt]; stage.flyTo(p.x, p.z, Math.min(stage.dist, 110)); } }
            if (card.fx === Fx.FocusDoner) { const p = sim.st.pts[PT_DONER]; stage.flyTo(p.x, p.z, Math.min(stage.dist, 110)); }
          } else {
            say('admin', `${SIDE_NAME[e.s]} решил: ${v3 ? v3.title : cardTitle(card, e.title.replace(/^Все на |!$/g, ''))}`, 1);
          }
          if (card.fx === Fx.Blackout && e.s !== side) say('chimaev', 'Свет яц. Я тут долго не протяну', 1);
          if (card.fx === Fx.EnemyN && e.s === side) say('admin', 'Всем Н. Страйк нельзя прерывать', 2);
          if (card.fx === Fx.Floor && e.s === 1) say('wou', 'Местный Бурдж-Халифа', 1);
          break;
        }
        case 'boss': {
          sound.boss(e.s);
          stage.shake = 0.6;
          hud.banner(e.s === 1 ? 'Финальный босс: Качок Зураб' : 'Выходит Ислам #1 ranked chad', e.s === 1 ? 'Баля ма зверь йу со' : 'Высокий. Барсетка. Перхоть', e.s, 3400);
          if (e.s === 1) say('zurab', lore.bossShout(1, prefs.spicy), 3); else { say('islam', 'Я копил ульту. Теперь отдыхайте, ребята', 3); say('wou', '+10000000000000000 aura', 2, undefined, 1500); }
          break;
        }
        case 'bossDown':
          hud.banner(e.s === 1 ? 'Зураб лёг' : 'Ислам лёг', e.s === 1 ? 'Счёт 1:0, вернётся сильнее' : 'Сегодня Ислама не трогаем', e.s === 1 ? 0 : 1);
          if (e.s === 1) say('chimaev', 'Тише.. Зураб.. успокойся.. я рядом..', 3); else say('zurab', 'Немощь', 3);
          break;
        case 'ult': {
          sound.ult();
          if (near(e.x, e.z)) stage.shake = 0.7;
          const y = heightY(terrain, e.x, e.z) + 0.3;
          for (let k = 0; k < 28; k++) {
            const a = (k / 28) * Math.PI * 2;
            particles.emit(e.x + Math.cos(a) * e.r * 0.5, y, e.z + Math.sin(a) * e.r * 0.5, { n: 2, color: e.s === 0 ? '#ffffff' : '#d9c9a5', size: 0.7, life: 0.8, spread: 3.5, up: 0.8, grav: 1, grow: 1 });
          }
          if (Math.random() < 0.5) say(e.s === 0 ? 'islam' : 'zurab', lore.bossShout(e.s, prefs.spicy), 1);
          break;
        }
        case 'victory': {
          const win = e.s === side;
          sound.victory(win);
          const taunt = win ? lore.win(prefs.spicy) : lore.lose(prefs.spicy);
          hud.showOver(sim, win, taunt);
          overEra = sim.st.era;
          say(e.s === 0 ? 'islam' : 'zurab', lore.win(prefs.spicy), 3);
          say(e.s === 0 ? 'zurab' : 'islam', lore.lose(prefs.spicy), 3, undefined, 1600);
          break;
        }
        case 'newWar':
          syncPlaces();
          hud.hideOver();
          hqs.forEach((b, i) => b.setFloors(sim.st.sides[i].floors, false));
          units.resetVis();
          labels.reset();
          hud.banner(`Война №${e.era}`, 'Чу вала!', -1, 2400);
          say('admin', `Война №${e.era}. Счёт ${sim.st.sides[0].wins}:${sim.st.sides[1].wins}`, 3);
          break;
        case 'deny':
          if (e.p === prefs.pid) { sound.deny(); hud.tip(lastTap.x, lastTap.y, lore.deny(e.why, prefs.spicy)); }
          break;
        case 'deployed':
          break;
        // ---- heroes, rides, summons, world events ------------------------------------------
        case 'ability': {
          const close = e.s === side || near(e.x, e.z);
          if (e.key === 'quake') { if (close) sound.quake(); if (cool('quake' + e.s, 12000)) heroSay(e.t, e.s, 'ability'); }
          else if (e.key === 'lagman') { if (close) sound.slurp(); heroSay(e.t, e.s, 'ability'); }
          else if (e.key === 'bolt') { if (close) sound.whoosh(); if (cool('bolt' + e.s, 25000)) heroSay(e.t, e.s, 'ability', e.s === side ? 1 : 0); }
          else if (e.key === 'card') { if (cool('card' + e.s, 10000)) heroSay(ERSNO, e.s, 'ability'); }
          // golem → 'summon', hack → 'hack', n → 'stunN' follow with the details
          break;
        }
        case 'event': {
          const L = EVENT_LORE[e.key as EventId];
          sound.jingle();
          hud.banner(e.title, e.quote, -1, 3400);
          if (L) { sayLine(L.quote, 3); sayLine(pickLine(L.reactions, prefs.spicy), 2, undefined, 2600); }
          break;
        }
        case 'unload':
          if (near(e.x, e.z, 70)) sound.door();
          if (cool('ride' + e.s, 20000)) sayLine(pickLine(SUMMON_LINES.ride[e.s], prefs.spicy), e.s === side ? 1 : 0, e.s);
          break;
        case 'summon': {
          const close = e.s === side || near(e.x, e.z);
          if (e.t === GOLEM) { if (close) sound.golem(); sayLine(pickLine(SUMMON_LINES.golem.spawn, prefs.spicy), pr(e.s), e.s); }
          else if (e.t === CHICKEN) { if (close) sound.cluck(5); sayLine(pickLine(SUMMON_LINES.chicken.spawn, prefs.spicy), pr(e.s), e.s); }
          else if (UNIT_LINES[e.t] && cool('u' + e.t + e.s, 20000)) sayLine(unitLine(e.t, 'spawn', prefs.spicy), pr(e.s), e.s);
          break;
        }
        case 'heroDown': {
          heroSay(e.t, e.s, 'death');
          const k = (1 - e.s) as Side, ks = sim.st.sides[k];
          const alive = HERO_TYPES.filter(t => ks.hero[t] >= 0);
          if (alive.length && Math.random() < 0.45) heroSay(pickOne(alive), k, 'kill', k === side ? 1 : 0, 1400);
          break;
        }
        case 'heroBack':
          if (e.id < 0) { if (e.s === side) { hud.flash(e.t); sound.coin(); } }
          else if (cool('back' + e.s, 8000)) heroSay(e.t, e.s, 'spawn', e.s === side ? 1 : 0);
          break;
        case 'poison':
          if (e.n <= 0) break;
          if (e.s === side) sound.sick();
          sayLine(pickLine(FUJI.lines, prefs.spicy), pr(e.s));
          break;
        case 'taunt':
          if (near(e.x, e.z, 60)) sound.jeer();
          if (e.n >= 3 && cool('taunt', 40000)) heroSay(WOU, e.s, 'ability', e.s === side ? 1 : 0);
          break;
        case 'hack':
          sound.hack();
          if (e.v === side) hud.banner('Пентагон взломан', 'Турель и доход выключены на 8 секунд', e.s, 2600);
          heroSay(WOU, e.s, 'ability', e.v === side ? 3 : pr(e.s));
          break;
        case 'stunN':
          if (e.s === side || near(e.x, e.z)) sound.stamp();
          if (e.n > 0) {
            if (near(e.x, e.z, 70)) { stage.project(e.x, heightY(terrain, e.x, e.z) + 2.6, e.z, projTmp); if (projTmp.vis) hud.tip(projTmp.x, projTmp.y, `Н ×${e.n}`, 'tip-n'); }
            if (cool('n' + e.s, 9000)) heroSay(ADMIN, e.s, 'ability');
          }
          break;
        case 'pulse':
          if (!near(e.x, e.z, 70)) break;
          if (e.key === 'quake') sound.rumble(); else if (e.key === 'golem') sound.golem(); else sound.pop();
          break;
        case 'gone':
          if (e.t === RIDE && near(e.x, e.z, 60)) sound.horn(e.s);
          break;
        case 'voteSkip':
          if (e.s === side) { sound.deny(); say('admin', 'Сход отменяется. Где наша обещанная четырёхдневка', 3); }
          else say('admin', `У ${e.s === 0 ? 'Атагов' : 'Курчалоя'} сход отменили. Четырёхдневка`, 1);
          break;
        case 'dodge':
          if (e.s === side && near(e.x, e.z, 50)) sound.swish();
          if (e.s === side && cool('dodge', 45000)) say('Ислам', 'Шампунь +40 к удаче', 1);
          break;
        default: v3Feed(e as unknown as V3Ev);
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
        if (Math.random() > 0.45 || !heroIdle()) {
          const pool = TICKER.filter(l => prefs.spicy || !l.spicy);
          const l = pickOne(pool);
          say(l.who ?? 'беседа', l.t, 0);
        }
      }
      if (playing && now > nextHint) { nextHint = now + 45000 + Math.random() * 20000; if (!hud.rotateTip(nextTip())) nextHint = now + 8000; }
      if (playing) pumpFeed(now);
      toasts.update(now, !playing || session.catchingUp);
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
    decor.update(dt); afx.update(dt);
    units.zoomK = Math.max(1, Math.min(2.4, stage.dist / 50));
    units.update(session ? session.alpha() : 1, now, dt, stage.camera);
    particles.setScale(stage.renderer.domElement.height / (2 * Math.tan((stage.camera.fov * Math.PI) / 360)));
    particles.update(dt, tnow);
    shots.update(now, s => {
      if (s.k === 2 && near(s.x1, s.z1)) particles.emit(s.x1, s.y1, s.z1, { n: 14, color: '#ffffff', size: 0.16, life: 1.4, spread: 1.6, up: 0.4, grav: 0.4, wob: 1 });
      if ((s.k === 4 || s.k === 5) && near(s.x1, s.z1)) particles.emit(s.x1, s.y1 + 0.4, s.z1, { n: 4, color: '#8fe08a', size: 0.25, life: 0.6, spread: 0.6, up: 1.4, grav: 0.5 });
    });
    if (playing) { labels.update(dt); minimap.draw(now); hud.update(sim, prefs.pid, now); }
    else labels.update(dt);
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
