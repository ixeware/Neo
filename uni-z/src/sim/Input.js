import { clamp } from '../util/math.js';

// Keyboard, gamepad and touch → normalized driver input. Discrete actions are delivered as events.
export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, select: null };
    this.steerSmooth = 0;
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.listeners = [];
    this.enabled = true;
    target.addEventListener('keydown', (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.emit(e.code, e);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrev = [];
  }

  on(fn) { this.listeners.push(fn); }
  emit(code, e) { for (const fn of this.listeners) fn(code, e); }

  // Gamepad buttons → same action codes as the keyboard
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((g) => g && g.connected);
    if (!p) return null;
    const map = { 5: 'KeyE', 4: 'KeyQ', 3: 'KeyC', 8: 'KeyR', 9: 'Escape', 14: 'KeyZ', 15: 'KeyX', 12: 'KeyL', 13: 'KeyH' };
    p.buttons.forEach((b, i) => { if (b.pressed && !this.padPrev[i] && map[i]) this.emit(map[i]); this.padPrev[i] = b.pressed; });
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : v);
    return { steer: -dz(p.axes[0] || 0), throttle: p.buttons[7]?.value || 0, brake: p.buttons[6]?.value || 0, handbrake: !!p.buttons[0]?.pressed };
  }

  update(dt, speedMps = 0) {
    const k = this.keys, s = this.state;
    if (!this.enabled) { s.throttle = s.brake = 0; s.steer *= 0.8; return s; }
    const pad = this.pollGamepad();
    const kbT = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kbB = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const kbS = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    // keyboard steering ramps in, faster back to centre, slower at speed
    const rate = 2.6 / (1 + speedMps / 25);
    const target = kbS;
    if (target !== 0) this.steerSmooth += clamp(target - this.steerSmooth, -rate * dt, rate * dt);
    else this.steerSmooth += clamp(-this.steerSmooth, -4 * dt, 4 * dt);
    s.throttle = Math.max(kbT, pad?.throttle || 0, this.touch.throttle);
    s.brake = Math.max(kbB, pad?.brake || 0, this.touch.brake);
    const padSteer = pad?.steer || 0;
    s.steer = clamp(Math.abs(padSteer) > 0.01 ? padSteer : Math.abs(this.touch.steer) > 0.01 ? this.touch.steer : this.steerSmooth, -1, 1);
    s.handbrake = k.has('Space') || !!pad?.handbrake || this.touch.handbrake;
    return s;
  }
}
