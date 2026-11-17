// Scene, lights, RTS camera rig and ground picking.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';

/** Phones, small screens and `?lq`: fewer trees, no shadows, lighter effects. */
export function isLowPower(): boolean {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
  return mobile || new URLSearchParams(location.search).has('lq');
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  target = new THREE.Vector3(200, 0, 150);
  dist = 70; yaw = 0.0; minDist = 7; maxDist = 300;
  private goal: { x: number; z: number; d: number; t: number } | null = null;
  lowPower: boolean;
  private shakeAmt = 0;
  private shakeT = 0;
  private calm = false; // prefers-reduced-motion: no camera shake at all

  /**
   * Camera shake. `stage.shake(0.4)` adds a small decaying kick (quakes, bursts);
   * the older `stage.shake = 1` form still sets it outright (floor collapse, boss).
   */
  get shake(): (amount: number) => void { return this.kick; }
  set shake(v: number) { this.shakeAmt = Math.max(0, Math.min(1.2, v)); }
  private kick = (amount: number) => { this.shakeAmt = Math.min(1.2, Math.max(amount, this.shakeAmt + amount * 0.5)); };

  constructor(public canvas: HTMLCanvasElement, public t: Terrain) {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.lowPower = isLowPower();
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq) { this.calm = mq.matches; mq.addEventListener?.('change', () => { this.calm = mq.matches; }); }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile || devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.75 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const sky = new THREE.Color('#d9c9a8');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 160, 520);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1400);
    const hemi = new THREE.HemisphereLight('#fff4e0', '#6d6a4c', 1.6);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffe2b0', 1.9);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    sh.camera.near = 1; sh.camera.far = 160;
    sh.bias = -0.0008; sh.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get pitch() {
    const k = (this.dist - this.minDist) / (this.maxDist - this.minDist);
    return 0.62 + Math.pow(Math.max(0, k), 0.6) * 0.62; // radians from horizontal
  }

  flyTo(x: number, z: number, d = this.dist, ms = 900) { this.goal = { x, z, d, t: ms }; }

  pan(dx: number, dz: number) {
    const s = this.dist * 0.0018;
    const c = Math.cos(this.yaw), n = Math.sin(this.yaw);
    this.target.x += (dx * c + dz * n) * s;
    this.target.z += (-dx * n + dz * c) * s;
    this.goal = null;
    this.clamp();
  }

  zoom(f: number) { this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * f)); this.goal = null; }
  rotate(a: number) { this.yaw += a; }

  clamp() {
    this.target.x = Math.max(0, Math.min(this.t.W, this.target.x));
    this.target.z = Math.max(0, Math.min(this.t.H, this.target.z));
  }

  /** First person (src/render/fpcam.ts): places the camera and `target` itself instead of the RTS rig. */
  fp: ((dt: number) => void) | null = null;

  update(dt: number) {
    if (this.fp) { this.fp(dt); this.light(); return; }
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 5);
      this.target.x += (this.goal.x - this.target.x) * k;
      this.target.z += (this.goal.z - this.target.z) * k;
      this.dist += (this.goal.d - this.dist) * k;
      this.goal.t -= dt * 1000;
      const close = Math.abs(this.goal.x - this.target.x) + Math.abs(this.goal.z - this.target.z) < 0.3 && Math.abs(this.goal.d - this.dist) < 0.5;
      if (close || this.goal.t < -6000) this.goal = null;
    }
    const gy = heightY(this.t, this.target.x, this.target.z);
    this.target.y += (gy - this.target.y) * Math.min(1, dt * 6);
    const p = this.pitch;
    const cx = this.target.x + Math.sin(this.yaw) * Math.cos(p) * this.dist;
    const cz = this.target.z + Math.cos(this.yaw) * Math.cos(p) * this.dist;
    let cy = this.target.y + Math.sin(p) * this.dist;
    cy = Math.max(cy, heightY(this.t, cx, cz) + 2);
    this.camera.position.set(cx, cy, cz);
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
      this.shakeT += dt;
      if (!this.calm) {
        // smooth, decaying wobble (two detuned sines) rather than per-frame noise
        const a = this.shakeAmt * this.shakeAmt * 0.14 * Math.min(1.5, 0.5 + this.dist / 80);
        const t = this.shakeT * 38;
        this.camera.position.x += Math.sin(t) * a; this.camera.position.y += Math.sin(t * 1.31 + 1.7) * a * 0.8;
        this.camera.position.z += Math.sin(t * 0.87 + 0.6) * a * 0.6;
      }
    }
    this.camera.lookAt(this.target);
    this.light();
  }

  /** Sun, shadows and fog follow `target` and the zoom. */
  private light() {
    // sun follows the view so shadows stay crisp where you look
    const span = Math.min(90, 18 + this.dist * 0.55);
    const s = this.sun.shadow.camera as THREE.OrthographicCamera;
    s.left = -span; s.right = span; s.top = span; s.bottom = -span; s.updateProjectionMatrix();
    this.sun.position.set(this.target.x - 45, this.target.y + 70, this.target.z + 40);
    this.sun.target.position.copy(this.target);
    this.renderer.shadowMap.enabled = !this.lowPower && this.dist < 160;
    const fogNear = Math.max(120, this.dist * 1.6);
    (this.scene.fog as THREE.Fog).near = fogNear;
    (this.scene.fog as THREE.Fog).far = fogNear + 380;
  }

  /** Ray-march the heightfield (fast, no triangle tests). */
  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let prev = 0;
    const step = Math.max(0.25, this.dist / 300);
    for (let s = 0; s < 2000; s += step) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (x < -50 || z < -50 || x > this.t.W + 50 || z > this.t.H + 50) { if (s > 50) break; prev = s; continue; }
      const h = heightY(this.t, x, z);
      if (y <= h) {
        let a = prev, b = s;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
          if (my <= heightY(this.t, mx, mz)) b = m; else a = m;
        }
        const px = o.x + d.x * b, pz = o.z + d.z * b;
        if (px < 0 || pz < 0 || px > this.t.W || pz > this.t.H) return null;
        return new THREE.Vector3(px, heightY(this.t, px, pz), pz);
      }
      prev = s;
    }
    return null;
  }

  project(x: number, y: number, z: number, out: { x: number; y: number; vis: boolean }) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    out.x = (v.x * 0.5 + 0.5) * r.width; out.y = (-v.y * 0.5 + 0.5) * r.height;
    out.vis = v.z < 1 && v.z > -1 && out.x > -60 && out.y > -60 && out.x < r.width + 60 && out.y < r.height + 60;
    return out;
  }
}

/** Modifier keys and pointer kind of a click / tap. */
export interface InputMods { shift: boolean; ctrl: boolean; touch: boolean; /** The event's timeStamp (performance.now() time base): double taps go by when they happened, not when a busy frame got to them. */ at?: number }

/** What the game does with pointer and keyboard input beyond moving the camera (src/ui/control.ts). */
export interface InputHooks {
  /** Left click or tap (no drag, under 600 ms). */
  tap(x: number, y: number, m: InputMods): void;
  /** Short right click (mouse): an order for the selection. */
  order?(x: number, y: number, m: InputMods): void;
  /** Rubber band: mouse left-drag, or touch long-press (350 ms) then drag. */
  box?(phase: 'start' | 'move' | 'end' | 'cancel', x0: number, y0: number, x1: number, y1: number, m: InputMods): void;
  /** Mouse moved over the map with no button down. */
  hover?(x: number, y: number): void;
  /** This key is a command right now: it must not pan, rotate or zoom the camera. */
  keyBusy?(code: string): boolean;
  /** First person: drags on the map look around, the left button / a tap on the map hits. */
  look?: { on(): boolean; drag(dx: number, dy: number, touch: boolean): void; press(down: boolean): void };
}

/**
 * Mouse, touch and keyboard → camera moves, taps, orders and rubber bands.
 * Mouse: left click = tap, left drag = box, right click = order, right / middle drag = pan,
 * Alt + drag = rotate, wheel = zoom, a pointer at the window edge scrolls. Touch: one finger pans,
 * two zoom and rotate, a long press then drag draws a box. Keys: WASD / arrows pan (unless
 * keyBusy), Q / E rotate, R F + − zoom.
 */
export function bindInput(stage: Stage, el: HTMLElement, hooks: InputHooks) {
  const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let pinch0 = 0, ang0 = 0, moved = false, button = 0, touch = false;
  let mode: 'none' | 'pan' | 'rot' | 'box' | 'pinch' | 'look' = 'none';
  let lp = 0, mods: InputMods = { shift: false, ctrl: false, touch: false };
  const first = () => pts.values().next().value!;
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerdown', e => {
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (hooks.look?.on()) {
      mode = 'look'; touch = e.pointerType !== 'mouse'; button = e.button; moved = false;
      if (!touch && e.button === 0) hooks.look.press(true);
      return;
    }
    if (pts.size === 1) {
      moved = false; button = e.button; touch = e.pointerType !== 'mouse'; mode = 'none';
      mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, touch };
      clearTimeout(lp);
      if (touch && hooks.box) {
        lp = window.setTimeout(() => {
          if (moved || pts.size !== 1 || mode !== 'none') return;
          const p = first();
          mode = 'box';
          try { navigator.vibrate?.(10); } catch { /* not allowed */ }
          hooks.box!('start', p.sx, p.sy, p.x, p.y, mods);
        }, 350);
      }
    }
    if (pts.size === 2) {
      clearTimeout(lp);
      if (mode === 'box') hooks.box?.('cancel', 0, 0, 0, 0, mods);
      mode = 'pinch';
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y); ang0 = Math.atan2(b.y - a.y, b.x - a.x);
      moved = true;
    }
  });
  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse' && !e.buttons) hooks.hover?.(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7) moved = true;
    if (mode === 'look') { hooks.look?.drag(dx, dy, touch); return; }
    if (pts.size === 1) {
      if (mode === 'box') { hooks.box?.('move', p.sx, p.sy, p.x, p.y, mods); return; }
      if (!moved) return;
      clearTimeout(lp);
      if (mode === 'none') {
        if (!touch && e.altKey) mode = 'rot';
        else if (!touch && button === 0 && hooks.box) { mode = 'box'; hooks.box('start', p.sx, p.sy, p.x, p.y, mods); return; }
        else mode = 'pan';
      }
      if (mode === 'rot') stage.rotate(-dx * 0.006);
      else if (mode === 'pan') stage.pan(-dx, -dy);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (pinch0 > 0) stage.zoom(pinch0 / d);
      stage.rotate(-(ang - ang0));
      pinch0 = d; ang0 = ang;
    }
  });
  const end = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    clearTimeout(lp);
    if (mode === 'look') {
      if (!touch && button === 0) hooks.look?.press(false);
      else if (touch && p && !moved && performance.now() - p.t < 400) { hooks.look?.press(true); setTimeout(() => hooks.look?.press(false), 220); }
      if (!pts.size) mode = 'none';
      return;
    }
    if (mode === 'box') {
      if (!pts.size) { if (p) hooks.box?.('end', p.sx, p.sy, e.clientX, e.clientY, mods); mode = 'none'; }
      return;
    }
    if (p && !moved && pts.size === 0 && performance.now() - p.t < 600) {
      if (button === 0) hooks.tap(e.clientX, e.clientY, { ...mods, at: e.timeStamp });
      else if (button === 2) hooks.order?.(e.clientX, e.clientY, mods);
    }
    if (pts.size < 2) pinch0 = 0;
    if (pts.size === 1 && mode === 'pinch') mode = 'pan';
    if (!pts.size) mode = 'none';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', e => {
    pts.delete(e.pointerId);
    clearTimeout(lp);
    if (mode === 'box') hooks.box?.('cancel', 0, 0, 0, 0, mods);
    if (mode === 'look') hooks.look?.press(false);
    if (!pts.size) mode = 'none';
  });
  el.addEventListener('wheel', e => { e.preventDefault(); if (!hooks.look?.on()) stage.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  // edge scroll: the mouse resting in the outer few pixels of the window
  const mouse = { x: 0, y: 0, in: false };
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; } }, { passive: true });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) mouse.in = false; });
  const keys = new Set<string>();
  addEventListener('keydown', e => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; keys.add(e.code); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.in = false; });
  const k = (code: string) => keys.has(code) && !hooks.keyBusy?.(code);
  return (dt: number) => {
    const sp = 900 * dt;
    if (k('KeyW') || k('ArrowUp')) stage.pan(0, -sp);
    if (k('KeyS') || k('ArrowDown')) stage.pan(0, sp);
    if (k('KeyA') || k('ArrowLeft')) stage.pan(-sp, 0);
    if (k('KeyD') || k('ArrowRight')) stage.pan(sp, 0);
    if (k('KeyQ')) stage.rotate(dt * 1.6);
    if (k('KeyE')) stage.rotate(-dt * 1.6);
    if (k('KeyR') || k('Equal')) stage.zoom(1 - dt * 1.5);
    if (k('KeyF') || k('Minus')) stage.zoom(1 + dt * 1.5);
    if (mouse.in && !pts.size && !hooks.look?.on() && document.hasFocus()) {
      const E = 6, w = innerWidth, h = innerHeight;
      if (mouse.x <= E) stage.pan(-sp, 0); else if (mouse.x >= w - 1 - E) stage.pan(sp, 0);
      if (mouse.y <= E) stage.pan(0, -sp); else if (mouse.y >= h - 1 - E) stage.pan(0, sp);
    }
  };
}
