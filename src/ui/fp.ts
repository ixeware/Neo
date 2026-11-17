// «Вселиться»: drive one own unit from its eyes (or over its shoulder, V). The sim moves it from
// Cmd 'ctl' (a quantised stick, the attack button and the facing); this sends one only when they
// change (at most ~6 a second) and a keep-alive every 10 s (the sim lets go after 30 s of silence).
// Desktop: WASD / arrows walk, mouse drag or Q / E turn, left button or Space hits, V view, Esc out.
// Phone: joystick bottom left, «Удар» bottom right, swipe the map to look, «Выйти» on top.
import { OM, type Sim } from '../sim/sim';
import type { Side } from '../sim/defs';
import type { Stage } from '../render/scene';
import type { UnitView } from '../render/units';
import { FpCam } from '../render/fpcam';
import type { Session, CmdBody } from '../net/session';
import type { Hud } from './hud';
import { unitLabel } from './hud';
import type { Terrain } from '../world/terrain';

export interface PossessDeps {
  sim: Sim; stage: Stage; units: UnitView; hud: Hud; terrain: Terrain; root: HTMLElement;
  session(): Session | null;
  side(): Side;
  pid(): string;
  sound: { click(): void; deny(): void };
  onPresence?(p: { ctl?: number }): void;
}

const MIN_GAP = 166, KEEP_ALIVE = 10000, CONFIRM_MS = 4000;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'];
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export class Possess {
  cam: FpCam;
  id = -1;
  private since = 0; private confirmed = false;
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private atkHeld = false; private atkKey = false; private atkUntil = 0;
  private last = { dx: 99, dz: 99, atk: -1, fx: 99, fz: 99, at: 0 };
  private el: HTMLElement; private nameEl: HTMLElement; private hpEl: HTMLElement; private hitBtn: HTMLButtonElement;
  private knob: HTMLElement;

  constructor(private d: PossessDeps) {
    this.cam = new FpCam(d.stage, d.units, d.terrain);
    const el = this.el = h('div', 'fp-hud');
    el.hidden = true;
    el.innerHTML = `
      <div class="fp-cross" aria-hidden="true"></div>
      <div class="fp-top paper"><div class="fp-who"><b class="fp-name"></b><span class="fp-hp"><i></i></span></div>
        <button type="button" class="fp-btn fp-view" title="Вид: глаза / из-за плеча (V)">Вид</button>
        <button type="button" class="fp-btn fp-exit" title="Выйти (Esc)">Выйти</button></div>
      <div class="fp-help">WASD — идти · мышь / Q E — смотреть · клик / пробел — удар · V — вид · Esc — выйти</div>
      <div class="fp-stick" aria-label="Джойстик"><div class="fp-knob"></div></div>
      <button type="button" class="fp-hit" aria-label="Удар">Удар</button>`;
    this.nameEl = el.querySelector('.fp-name')!; this.hpEl = el.querySelector('.fp-hp i')!;
    this.hitBtn = el.querySelector('.fp-hit')!; this.knob = el.querySelector('.fp-knob')!;
    for (const b of el.querySelectorAll('button')) b.addEventListener('pointerdown', e => e.stopPropagation());
    el.querySelector('.fp-exit')!.addEventListener('click', () => this.exit(true));
    el.querySelector('.fp-view')!.addEventListener('click', () => this.cam.toggleMode());
    // «Удар»: held = keeps hitting
    const hit = (on: boolean) => (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); this.atkHeld = on; this.hitBtn.classList.toggle('on', on); if (on) this.atkUntil = performance.now() + 200; };
    this.hitBtn.addEventListener('pointerdown', e => { try { this.hitBtn.setPointerCapture(e.pointerId); } catch { /* synthetic */ } hit(true)(e); });
    this.hitBtn.addEventListener('pointerup', hit(false)); this.hitBtn.addEventListener('pointercancel', hit(false));
    // joystick
    const base = el.querySelector('.fp-stick') as HTMLElement;
    let sid = -1;
    const at = (e: PointerEvent) => {
      const r = base.getBoundingClientRect(), R = r.width / 2;
      let x = (e.clientX - (r.left + R)) / R, y = (e.clientY - (r.top + R)) / R;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this.stick.x = x; this.stick.y = y;
      this.knob.style.transform = `translate(${(x * R * 0.62).toFixed(1)}px, ${(y * R * 0.62).toFixed(1)}px)`;
    };
    base.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); sid = e.pointerId; try { base.setPointerCapture(sid); } catch { /* synthetic */ } at(e); });
    base.addEventListener('pointermove', e => { if (e.pointerId === sid) at(e); });
    const up = (e: PointerEvent) => { if (e.pointerId !== sid) return; sid = -1; this.stick.x = this.stick.y = 0; this.knob.style.transform = ''; };
    base.addEventListener('pointerup', up); base.addEventListener('pointercancel', up);
    d.root.append(el);
    addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'Space') this.atkKey = false; });
    addEventListener('blur', () => { this.keys.clear(); this.atkKey = false; this.atkHeld = false; });
    addEventListener('pagehide', () => { if (this.on) this.exit(true); });
  }

  get on() { return this.id >= 0; }

  private myN() { return this.d.sim.st.players[this.d.pid()]?.n ?? -1; }
  private ctl(b: Record<string, unknown>) {
    const s = this.d.session();
    if (!s) return;
    // a shorter lead than the default in a shared war: the driver feels the stick sooner (late peers roll back)
    s.submit({ k: 'ctl', s: this.d.side(), u: this.id, ...b } as unknown as CmdBody, Math.min(s.lead, 3));
  }

  enter(id: number) {
    const s = this.d.session();
    if (!s) return;
    if (this.on) this.exit(true);
    this.id = id; this.since = performance.now(); this.confirmed = false;
    this.last = { dx: 99, dz: 99, atk: -1, fx: 99, fz: 99, at: 0 };
    this.keys.clear(); this.stick.x = this.stick.y = 0; this.atkHeld = this.atkKey = false;
    s.submit({ k: 'ord', s: this.d.side(), ids: [id], m: 'possessed' } as unknown as CmdBody);
    this.cam.enter(id, () => this.d.session()?.alpha() ?? 1);
    this.el.hidden = false;
    this.d.root.classList.add('fp');
    document.body.classList.add('fp-on');
    this.d.sound.click();
    this.d.onPresence?.({ ctl: id });
    const u = this.d.sim.unit(id);
    if (u) this.nameEl.textContent = unitLabel(u.t, u.s as Side);
  }

  /** Back to the RTS view; release = tell the sim to let go (the unit then holds where it stands). */
  exit(release: boolean) {
    if (!this.on) return;
    if (release) {
      const u = this.d.sim.unit(this.id);
      if (u && u.hp > 0) this.ctl({ dx: 0, dz: 0, atk: 0, rel: 1 });
    }
    this.cam.exit();
    this.id = -1;
    this.el.hidden = true;
    this.d.root.classList.remove('fp');
    document.body.classList.remove('fp-on');
    this.d.onPresence?.({ ctl: 0 });
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') { this.exit(true); return true; }
    if (e.code === 'KeyV' && !e.repeat) { this.cam.toggleMode(); return true; }
    if (e.code === 'Space') { e.preventDefault(); if (!this.atkKey) { this.atkKey = true; this.atkUntil = performance.now() + 200; } return true; }
    if (MOVE_KEYS.includes(e.code)) { this.keys.add(e.code); e.preventDefault(); return true; }
    return /^(Digit|Key|Numpad)/.test(e.code); // nothing else of the RTS (deck keys, groups) while riding
  }

  /** Map drag while riding: look around. */
  look(dx: number, dy: number, touch: boolean) {
    const k = touch ? 0.006 : 0.0042;
    this.cam.turn(-dx * k, -dy * k * 0.8);
  }
  /** Map press while riding (left button / a tap): hit. */
  press(down: boolean) { this.atkHeld = down; if (down) this.atkUntil = performance.now() + 200; }

  update(now: number, dt: number) {
    if (!this.on) return;
    const sim = this.d.sim, u = sim.unit(this.id);
    if (!u || u.hp <= 0) {
      const name = this.nameEl.textContent || 'Он';
      this.exit(false);
      this.d.hud.note(`${name} выбыл`, 2400);
      return;
    }
    const o = u.o, mine = !!o && o.m === OM.POSSESS && o.p === this.myN();
    if (mine) this.confirmed = true;
    else if (this.confirmed || now - this.since > CONFIRM_MS) {
      this.exit(false);
      this.d.sound.deny();
      this.d.hud.note(this.confirmed ? 'Управление потеряно' : 'Не вышло: им уже управляет другой', 2600);
      return;
    }
    // turning with the keys
    const turn = (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
    if (turn) this.cam.turn(turn * dt * 2.2, 0);
    // the stick in camera space → world, quantised to −8..8
    const fwd = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - this.stick.y;
    const side = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.stick.x;
    const ax = this.cam.axes();
    let vx = ax.fx * fwd + ax.rx * side, vz = ax.fz * fwd + ax.rz * side;
    const l = Math.hypot(vx, vz);
    if (l < 0.2) { vx = 0; vz = 0; } else { vx /= l; vz /= l; }
    const dx = Math.round(vx * 8), dz = Math.round(vz * 8);
    const fx = Math.round(ax.fx * 8), fz = Math.round(ax.fz * 8);
    const atk = this.atkHeld || this.atkKey || now < this.atkUntil ? 1 : 0;
    const L = this.last;
    const changed = dx !== L.dx || dz !== L.dz || atk !== L.atk || Math.abs(fx - L.fx) + Math.abs(fz - L.fz) >= 2;
    if ((changed && now - L.at >= MIN_GAP) || now - L.at > KEEP_ALIVE) {
      this.ctl({ dx, dz, atk, fx, fz });
      this.last = { dx, dz, atk, fx, fz, at: now };
    }
    // HUD: name and health
    const f = Math.max(0, u.hp / u.mhp);
    this.hpEl.style.width = `${(f * 100).toFixed(1)}%`;
    this.hpEl.classList.toggle('low', f < 0.3);
    this.el.classList.toggle('tps', this.cam.mode === 'tps');
    this.el.classList.toggle(`s${u.s}`, true);
    this.el.classList.toggle(`s${1 - u.s}`, false);
  }
}
