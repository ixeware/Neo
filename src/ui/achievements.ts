// Achievements: a UI-side tracker. It only reads sim state and fx events and never writes to
// the sim, so it cannot affect determinism. Unlocked ids live in localStorage ('vysotka.ach.v1').
//
// step() runs after every sim tick (Session.onStep), also during quiet catch-up, so anything
// that can be read from state is checked there. fx() sees the events the sim emitted while not
// quiet; absent, bird55, chicken, and from v3 thief, pack and snus need them.
//
// v3 (Гелик, Спортики, places with perks, ersno's «переводы», the admin's pack, «Закинуть снюс»):
// the sim fields and events may be missing in an older sim, so every read of them is optional
// and the FxEv 'steal' / 'pack' are matched loosely by their `e` string.
import { ACHIEVEMENTS, GELIK_T, SPORTIK_T, type Achievement } from '../data/heroes';
import { HQ, WOU, ADAM, BEKHAN, ERSNO, CHIMAEV, GOLEM, CHICKEN, UNITS, type Side } from '../sim/defs';
import { PT_DONER, UF, type FxEv, type Sim } from '../sim/sim';

const KEY = 'vysotka.ach.v1';
const MIN8 = 8 * 60 * 10; // ticks
const HOLD = 1800; // Донер Бей: 3 min in a row

interface Store { ids: string[]; win?: { seed: number; era: number; s: number } }

function load(): Store {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(j)) return { ids: j.filter(x => typeof x === 'string') };
    if (j && Array.isArray(j.ids)) return { ids: j.ids.filter((x: unknown) => typeof x === 'string'), win: j.win };
  } catch { /* blocked or broken storage */ }
  return { ids: [] };
}
function save(s: Store) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked storage */ } }

/** Unlocked ids as stored (for the menu). */
export function achievedIds(): Set<string> { return new Set(load().ids); }

const BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]));
const d2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2;

/** Unit type by key, falling back to the agreed index (GELIK = 16, SPORTIK = 17). */
const typeOf = (keys: string[], fallback: number) => { const i = UNITS.findIndex(d => keys.includes(d.key)); return i >= 0 ? i : fallback; };
const GELIK = typeOf(['gelik'], GELIK_T), SPORTIK = typeOf(['sportik', 'sportiki'], SPORTIK_T);
/** «Закинуть снюс» / «Энергетик в ларьке» in CARDS. */
const CARD_SNUS = 30;
const STOLEN = 500; // ₽ in one war
const SCARED = 10; // enemies under one pack
/** v3 events read loosely: they are not in FxEv until the sim has them. */
interface V3Ev { e: string; s?: number; v?: number; n?: number; x?: number; z?: number; r?: number; card?: number }

export class Achievements {
  private store = load();
  private got = new Set(this.store.ids);
  private sim: Sim | null = null;
  private me: Side = 0;
  // per war
  private era = -1; private warStart = -1; private full = false; private winner = -1;
  private lostFloor = false; private minFloors = 99; private floors = [0, 0];
  private prevHack = 0; private hacks = 0;
  private ersnoId = -1; private ersnoCd = 0; private knocks = 0;
  private rides = 0; private chickenKills = 0;
  private stolen = 0; private snusWar = false; private prevSnus = 0;
  private pulses: { x: number; z: number; r: number; t: number }[] = [];
  private owners: number[] = [];
  private donerSince = -1;
  private bossId = -1; private bossX = 0; private bossZ = 0;
  // per life
  private wouId = -1; private wouHp = 0; private wouDmg = 0;
  private adamId = -1; private adamCaps = 0;
  private bekId = -1; private lagAt = -1;

  constructor(private onUnlock: (a: Achievement) => void) {}

  has(id: string) { return this.got.has(id); }
  get ids() { return new Set(this.got); }

  /** A session starts. fresh: this war is watched from its first tick (new local game). */
  begin(sim: Sim, side: Side, fresh: boolean) {
    this.sim = sim; this.me = side;
    this.resetWar(fresh);
  }

  private resetWar(fresh: boolean) {
    const st = this.sim!.st, me = this.me, en = (1 - me) as Side;
    this.era = st.era; this.warStart = fresh ? st.tick : -1; this.full = fresh; this.winner = st.winner;
    this.lostFloor = false; this.minFloors = st.sides[me].floors;
    this.floors = [st.sides[0].floors, st.sides[1].floors];
    this.prevHack = st.sides[en].hack; this.hacks = 0;
    this.ersnoId = -1; this.knocks = 0; this.rides = 0; this.chickenKills = 0; this.pulses = [];
    this.stolen = 0; this.snusWar = false; this.prevSnus = (st.sides[me] as { snus?: number }).snus ?? 0;
    this.owners = st.pts.map(p => p.owner);
    this.donerSince = -1; this.bossId = -1;
    this.wouId = -1; this.adamId = -1; this.bekId = -1; this.lagAt = -1;
  }

  private unlock(id: string) {
    if (this.got.has(id)) return;
    const a = BY_ID.get(id);
    if (!a) return;
    this.got.add(id);
    this.store.ids = [...this.got];
    save(this.store);
    this.onUnlock(a);
  }

  /** After every sim step. */
  step() {
    const sim = this.sim;
    if (!sim) return;
    const st = sim.st, me = this.me, en = (1 - me) as Side, now = st.tick;
    if (st.era !== this.era) this.resetWar(true); // a new war began on this very tick
    const sd = st.sides[me], ed = st.sides[en];

    // floors: own history, enemy floor removed by our Чимаев
    if (sd.floors < this.floors[me]) this.lostFloor = true;
    if (sd.floors < this.minFloors) this.minFloors = sd.floors;
    if (ed.floors < this.floors[en] && sd.hero[CHIMAEV] >= 0) {
      const c = sim.unit(sd.hero[CHIMAEV]), p = st.pts[en], R = HQ.radius[en] + 7;
      if (c && d2(c.x, c.z, p.x, p.z) <= R * R) this.unlock('hog');
    }
    this.floors[0] = st.sides[0].floors; this.floors[1] = st.sides[1].floors;
    if (me === 0 && sd.floors >= 4) this.unlock('floor4');

    if (st.winner !== -1) {
      if (this.winner === -1) this.victory(st.winner);
      this.winner = st.winner;
      return;
    }
    this.winner = -1;

    // «Взломать Пентагон»: the enemy's hack timer only grows when our WOU hacks
    if (ed.hack > this.prevHack && ed.hack > now) { if (++this.hacks >= 3) this.unlock('pentagon'); }
    this.prevHack = ed.hack;

    // WOU: damage taken in one life
    const wid = sd.hero[WOU];
    if (wid !== this.wouId) { this.wouId = wid; this.wouDmg = 0; this.wouHp = wid >= 0 ? (sim.unit(wid)?.hp ?? 0) : 0; }
    else if (wid >= 0) {
      const u = sim.unit(wid);
      if (u) { if (u.hp < this.wouHp) this.wouDmg += this.wouHp - u.hp; this.wouHp = u.hp; if (this.wouDmg >= 3000) this.unlock('ragebait'); }
    }

    // ersno: every swing that lands on a unit knocks it back
    const eid = sd.hero[ERSNO];
    if (eid >= 0) {
      const u = sim.unit(eid);
      if (u) {
        if (eid === this.ersnoId && u.cd > this.ersnoCd && u.tg >= 0 && ++this.knocks >= 30) this.unlock('kachok');
        this.ersnoCd = u.cd;
      }
    }
    this.ersnoId = eid;

    // Бекхан: lived 30 s after «ест лагман»
    const bid = sd.hero[BEKHAN];
    if (bid !== this.bekId) { this.bekId = bid; this.lagAt = -1; }
    if (bid >= 0) {
      const b = sim.unit(bid);
      if (b && b.f & UF.LAGMAN) { if (this.lagAt < 0) this.lagAt = now; else if (now - this.lagAt >= 300) this.unlock('lagman'); }
    }

    // villages changing hands: Адам's captures in one life
    const aid = sd.hero[ADAM];
    if (aid !== this.adamId) { this.adamId = aid; this.adamCaps = 0; }
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i];
      if (p.owner === this.owners[i]) continue;
      this.owners[i] = p.owner;
      if (p.owner !== me || p.kind === 0 || aid < 0) continue;
      const a = sim.unit(aid), R = p.r + 1.5;
      if (a && d2(a.x, a.z, p.x, p.z) <= R * R && ++this.adamCaps >= 3) this.unlock('bolt');
    }

    // Донер Бей held 3 minutes in a row
    const dp = st.pts[PT_DONER];
    if (dp && dp.owner === me) { if (this.donerSince < 0) this.donerSince = now; else if (now - this.donerSince >= HOLD) this.unlock('doner'); }
    else this.donerSince = -1;

    // enemy boss: remember where it stands; when it is gone, count our crowd there
    const xb = ed.boss;
    if (xb >= 0) { const b = sim.unit(xb); if (b) { this.bossId = xb; this.bossX = b.x; this.bossZ = b.z; } }
    else if (this.bossId >= 0) {
      let n = 0;
      for (const u of st.units) if (u.s === me && d2(u.x, u.z, this.bossX, this.bossZ) <= 64) n++;
      if (n >= 10) this.unlock('tolpoy');
      this.bossId = -1;
    }

    // «Закинуть снюс» taken by our сход this war: the buff timer moves forward (read-only, optional)
    const snus = (sd as { snus?: number }).snus;
    if (typeof snus === 'number') { if (snus > this.prevSnus && snus > now) this.snusWar = true; this.prevSnus = snus; }

    if (now % 10 !== 0) return;
    if (sd.kills >= 60) this.unlock('prisoner6000');
    // v3: two Гелики / 16 спортиков alive at once; every capture place ours
    let geliks = 0, sportiki = 0;
    for (const u of st.units) if (u.s === me && u.hp > 0) { if (u.t === GELIK) geliks++; else if (u.t === SPORTIK) sportiki++; }
    if (geliks >= 2) this.unlock('kra');
    if (sportiki >= 16) this.unlock('sportiki');
    let places = 0, held = 0;
    for (const p of st.pts) if ((p as { perk?: string }).perk) { places++; if (p.owner === me) held++; }
    if (places >= 4 && held === places) this.unlock('rayon');
    let vil = 0, mine = 0;
    for (const p of st.pts) if (p.kind === 1) { vil++; if (p.owner === me) mine++; }
    if (vil && mine === vil) this.unlock('center');
    for (const u of st.units) if (u.s === me && u.t === GOLEM && now - u.born >= HOLD) { this.unlock('golem'); break; }
  }

  private victory(w: number) {
    const st = this.sim!.st, me = this.me;
    const dur = this.warStart >= 0 ? st.overAt - this.warStart : -1;
    if (w === me) {
      if (dur >= 0 && dur < MIN8) this.unlock('obvious');
      if (this.full && !this.lostFloor) this.unlock('lightest');
      if (this.minFloors <= 1) this.unlock('comeback');
      if (this.snusWar) this.unlock('snus');
      const prev = this.store.win;
      if (prev && prev.seed === st.seed && prev.era === st.era - 1 && prev.s === me) this.unlock('b2b');
    } else if (dur >= 0 && dur < MIN8) this.unlock('shame');
    this.store.win = { seed: st.seed, era: st.era, s: w };
    save(this.store);
  }

  /** Sim events (only those emitted while not quiet). */
  fx(e: FxEv) {
    const sim = this.sim;
    if (!sim) return;
    const me = this.me, now = sim.st.tick;
    switch (e.e) {
      case 'stunN': if (e.s === me && e.n >= 8) this.unlock('absent'); break;
      case 'unload': if (e.s === me && (this.rides += e.n) >= 30) this.unlock('bird55'); break;
      case 'pulse':
        if (e.s === me && e.key === 'chicken') { this.pulses.push({ x: e.x, z: e.z, r: e.r, t: now }); if (this.pulses.length > 16) this.pulses.shift(); }
        break;
      case 'voteResult':
        if (e.s === me && e.card === CARD_SNUS) this.snusWar = true;
        break;
      case 'die': {
        if (e.s === me) break;
        let hit = this.pulses.some(p => now - p.t <= 3 && d2(p.x, p.z, e.x, e.z) <= (p.r + 0.4) ** 2);
        if (!hit) for (const u of sim.st.units) if (u.s === me && u.t === CHICKEN && u.hp > 0 && d2(u.x, u.z, e.x, e.z) <= 3.3) { hit = true; break; }
        if (hit && ++this.chickenKills >= 10) this.unlock('chicken');
        break;
      }
      default: this.fxV3(e as unknown as V3Ev);
    }
  }

  /** ersno's «переводы» and the admin's pack («Курение убивает»). */
  private fxV3(e: V3Ev) {
    const sim = this.sim!, me = this.me;
    if (e.s !== me) return;
    if (e.e === 'steal') {
      if (typeof e.n === 'number' && e.n > 0 && (this.stolen += e.n) >= STOLEN) this.unlock('thief');
    } else if (e.e === 'pack') {
      let n = typeof e.n === 'number' ? e.n : -1;
      if (n < 0 && typeof e.x === 'number' && typeof e.z === 'number') { // older event without a count: who is under it now
        const R = (e.r ?? 7) ** 2;
        n = 0;
        for (const u of sim.st.units) if (u.s !== me && u.hp > 0 && d2(u.x, u.z, e.x, e.z) <= R) n++;
      }
      if (n >= SCARED) this.unlock('pack');
    }
  }
}

// ---- toasts: a paper sticker with a stamp. At most two per burst, the rest summed up. ----------
export class AchToasts {
  private q: Achievement[] = [];
  private busyUntil = 0;
  private shown = 0; private lastAt = -1e9;
  constructor(private root: HTMLElement, private spicy: () => boolean, private onShow?: () => void) {}

  push(a: Achievement) { this.q.push(a); }

  /** hold: don't show now (menu open, catching up). */
  update(now: number, hold: boolean) {
    if (hold || !this.q.length || now < this.busyUntil) return;
    if (now - this.lastAt > 12000) this.shown = 0;
    if (this.shown >= 2) {
      const n = this.q.length;
      this.q = [];
      this.render('Ещё ачивки', `+${n} — смотри в меню, «Ачивки»`, '');
    } else {
      const a = this.q.shift()!;
      const title = this.spicy() && a.spicyTitle ? a.spicyTitle : a.title;
      const q = a.quote && (this.spicy() || !a.quote.spicy) ? `«${a.quote.t}»${a.quote.who ? ` — ${a.quote.who}` : ''}` : a.desc;
      this.render(title, q, a.desc);
    }
    this.shown++; this.lastAt = now;
    this.busyUntil = now + 4300;
    this.onShow?.();
  }

  private render(title: string, line: string, desc: string) {
    const el = document.createElement('div');
    el.className = 'ach-toast paper';
    el.setAttribute('role', 'status');
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    el.innerHTML = `<span class="ach-stamp">ачивка</span><b class="ach-t">${esc(title)}</b><span class="ach-q">${esc(line)}</span>${desc && desc !== line ? `<span class="ach-d">${esc(desc)}</span>` : ''}`;
    this.root.append(el);
    setTimeout(() => el.classList.add('out'), 3700);
    setTimeout(() => el.remove(), 4200);
  }

  clear() { this.q = []; }
}
