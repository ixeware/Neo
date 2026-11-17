// The graphics style switch: 'toon' (the new look, default) or 'classic' (the game as it was before v5).
// Resolved once at start — `?gfx=classic|toon` in the URL wins, then the saved preference — and changed
// only by reloading the page (setGfx). Everything a model builder needs is exported from here:
//
//   TOON                 guard for toon-only code: `TOON ? toonThing() : oldThing()`
//   C.<role>             the palette of the current style (docs/v5/ART.md §2), as THREE.Color
//   mat.solid() …        the material factory
//   native(m), ground(m) flags for the toon shader patch and the outline pass
//   restyle(c)           an old colour → the current style
//
// Classic contract: nothing here changes a classic frame. patchShaders() is never called, the factory
// returns the same kind of material the old builders made, native() / ground() / restyle() do nothing.
import * as THREE from 'three';
import { TOON_HEX, CLASSIC_HEX, type Role } from './toon/palette';
import { patchShaders, remapColor } from './toon/shading';
import { ToonStage } from './toon/stage';

export type Gfx = 'toon' | 'classic';
const PREFS = 'vysotka.prefs';
const isGfx = (v: unknown): v is Gfx => v === 'toon' || v === 'classic';

function readGfx(): Gfx {
  try {
    const q = new URLSearchParams(location.search).get('gfx');
    if (isGfx(q)) return q;
    const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
    if (isGfx(p.gfx)) return p.gfx;
  } catch { /* no window (tools under node) or blocked storage */ }
  return 'toon';
}

/** The style of this page load. */
export const GFX: Gfx = readGfx();
/** True in the new style. Every toon-only hook is behind this. */
export const TOON = GFX === 'toon';

/** Phones, small screens and `?lq` (the same test as scene.ts isLowPower). */
function lowPower(): boolean {
  try {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
    return mobile || new URLSearchParams(location.search).has('lq');
  } catch { return false; }
}

/** Facts about the running style that builders may branch on. */
export const STYLE = {
  gfx: GFX,
  /** 'phone' is the low-power tier (phones, small screens, `?lq`): no sun shadows, lighter outline. */
  tier: (lowPower() ? 'phone' : 'desktop') as 'phone' | 'desktop',
  /** Real sun shadows are drawn (desktop tier). Models bring fake ground shadows when this is false. */
  get shadows() { return this.tier === 'desktop'; },
  /** 'full' | 'lite' | 'off' in toon (a slow device steps down while playing); 'off' in classic. */
  get outline() { return toonStage?.pipeline.mode ?? 'off'; },
};

if (TOON && typeof document !== 'undefined') document.documentElement.classList.add('gfx-toon'); // HUD skin: src/render/toon/hud.css

/**
 * Save the choice and reload into it. `before` runs first (checkpoint the war); a `?gfx=` override in the
 * URL is dropped so the saved choice wins after the reload.
 */
export function setGfx(g: Gfx, before?: () => void) {
  if (g === GFX) return;
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
    p.gfx = g;
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch { /* blocked storage: the reload below would not change anything */ return; }
  before?.();
  const u = new URL(location.href);
  u.searchParams.delete('gfx');
  location.replace(u.toString());
}

// ---- palette ---------------------------------------------------------------------------------------------
type Pal = { [K in Role]: (typeof TOON_HEX)[K] extends string ? THREE.Color : THREE.Color[] };
function palette(hex: Record<string, string | readonly string[]>): Pal {
  const out: Record<string, THREE.Color | THREE.Color[]> = {};
  for (const k in hex) { const v = hex[k]; out[k] = typeof v === 'string' ? new THREE.Color(v) : v.map(h => new THREE.Color(h)); }
  return out as Pal;
}
/** Palette of the current style by role (ART.md §2). Shared objects: clone before changing one. */
export const C: Pal = palette(TOON ? TOON_HEX : CLASSIC_HEX);
/** The same roles as hex strings (canvas textures, CSS). */
export const HEX = (TOON ? TOON_HEX : CLASSIC_HEX) as { [K in Role]: (typeof TOON_HEX)[K] extends string ? string : readonly string[] };
/** Team colour by side (0 Атаги, 1 Курчалой): main, dark, light. */
export const TEAM = [
  { main: C.team0, dark: C.team0Dark, light: C.team0Light },
  { main: C.team1, dark: C.team1Dark, light: C.team1Light },
];

// ---- material flags --------------------------------------------------------------------------------------
function define<T extends THREE.Material>(m: T, name: string): T {
  if (!TOON) return m;
  m.defines = { ...(m.defines ?? {}), [name]: '' };
  m.needsUpdate = true;
  return m;
}
/**
 * «These colours are already toon palette»: the material skips the remap that old, muted vertex colours
 * get in the toon style. Factory materials are native; call it yourself only for a hand-made material.
 */
export function native<T extends THREE.Material>(m: T): T { return define(m, 'STYLE_NATIVE'); }
/**
 * «This lies on the ground»: no ink outline on it or along its facets (terrain, roads, water, decals, fake
 * shadows). Works for opaque materials; a transparent one never gets an outline anyway.
 */
export function ground<T extends THREE.Material>(m: T): T { return define(m, 'STYLE_GROUND'); }

/** An old (classic) colour in the current style: remapped in toon, returned as it is in classic. */
export function restyle(c: THREE.Color | string): THREE.Color {
  const col = typeof c === 'string' ? new THREE.Color(c) : c;
  return TOON ? remapColor(col, new THREE.Color()) : col;
}
/**
 * Remap the `color` attribute of an old vertex-coloured geometry in place (toon only), so it can be drawn
 * with a native() material next to new palette-coloured parts. Returns the geometry.
 */
export function restyleGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const a = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!TOON || !a) return g;
  const c = new THREE.Color();
  for (let i = 0; i < a.count; i++) { remapColor(c.setRGB(a.getX(i), a.getY(i), a.getZ(i))); a.setXYZ(i, c.r, c.g, c.b); }
  a.needsUpdate = true;
  return g;
}

// ---- material factory ------------------------------------------------------------------------------------
const shared = new Map<string, THREE.Material>();
function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = shared.get(key) as T | undefined;
  if (!m) shared.set(key, (m = make()));
  return m;
}
interface LitOpts { side?: THREE.Side; ground?: boolean }
const flag = <T extends THREE.Material>(m: T, o: LitOpts) => (o.ground ? ground(native(m)) : native(m));

/**
 * Materials for new models. The lit ones are flat-shaded Lambert in both styles (toon turns them into the
 * stepped look by itself) and are shared: the same options return the same instance, so don't mutate one.
 */
export const mat = {
  /** Vertex-coloured, flat-shaded: every merged model (Builder) and instanced kits with a `color` attribute. */
  solid(o: LitOpts = {}): THREE.MeshLambertMaterial {
    return once(`solid|${o.side ?? 0}|${o.ground ? 1 : 0}`, () => flag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: o.side ?? THREE.FrontSide }), o));
  },
  /** One flat colour (white by default: an InstancedMesh then shows its instance colours). */
  plain(color: THREE.Color | string = '#ffffff', o: LitOpts = {}): THREE.MeshLambertMaterial {
    const c = typeof color === 'string' ? new THREE.Color(color) : color;
    return once(`plain|${c.getHexString()}|${o.side ?? 0}|${o.ground ? 1 : 0}`, () => flag(new THREE.MeshLambertMaterial({ color: c, flatShading: true, side: o.side ?? THREE.FrontSide }), o));
  },
  /** Lit colour that also glows (lit windows, screens, lamps): `k` is the emissive strength. */
  glow(color: THREE.Color | string, k = 1): THREE.MeshLambertMaterial {
    const c = typeof color === 'string' ? new THREE.Color(color) : color;
    return once(`glow|${c.getHexString()}|${k}`, () => native(new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: k, flatShading: true })));
  },
  /** Unlit colour (rings, icons, fake shadows). Not shared: the caller may animate opacity or colour. */
  unlit(color: THREE.Color | string, o: { transparent?: boolean; opacity?: number; side?: THREE.Side; depthWrite?: boolean; ground?: boolean } = {}): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, transparent: o.transparent ?? (o.opacity !== undefined && o.opacity < 1), opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, depthWrite: o.depthWrite ?? !(o.transparent ?? (o.opacity !== undefined && o.opacity < 1)) });
    return o.ground ? ground(m) : m;
  },
};

// ---- sun and fake ground shadows ---------------------------------------------------------------------------
/** Unit vector from the ground towards the sun (the same sun as scene.ts: west-south-west, about 49° up). */
export const SUN_DIR = new THREE.Vector3(-45, 70, 40).normalize();

let shadowMat: THREE.MeshBasicMaterial | null = null;
/**
 * Fake ground shadow for the phone tier, where the renderer draws no sun shadows: a dark flat sheet in
 * the shape a `w` × `d` × `h` box would cast, in the local frame of a building turned by `ry` (rotation.y),
 * lying at y = 0.03. Add it to the building's group. Returns null when real shadows are on or in classic,
 * so the call site needs no branch: `const s = groundShadow(w, d, h, ry); if (s) group.add(s);`
 */
export function groundShadow(w: number, d: number, h: number, ry = 0): THREE.Mesh | null {
  if (!TOON || STYLE.shadows) return null;
  // where the top of the box lands, in world axes, then turned into the building's frame
  const k = h / SUN_DIR.y, wx = -SUN_DIR.x * k, wz = -SUN_DIR.z * k;
  const c = Math.cos(ry), s = Math.sin(ry), ox = wx * c - wz * s, oz = wx * s + wz * c;
  const hw = w / 2, hd = d / 2;
  const pts: [number, number][] = [];
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) pts.push([x, z], [x + ox, z + oz]);
  // convex hull (gift wrapping: eight points)
  let start = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[start][0] || (pts[i][0] === pts[start][0] && pts[i][1] < pts[start][1])) start = i;
  const hull: number[] = [];
  let p = start;
  do {
    hull.push(p);
    let q = (p + 1) % pts.length;
    for (let i = 0; i < pts.length; i++) {
      const cr = (pts[q][0] - pts[p][0]) * (pts[i][1] - pts[p][1]) - (pts[q][1] - pts[p][1]) * (pts[i][0] - pts[p][0]);
      if (cr < -1e-9) q = i;
    }
    p = q;
  } while (p !== start && hull.length <= pts.length);
  const pos: number[] = [];
  for (let i = 1; i + 1 < hull.length; i++) for (const j of [hull[0], hull[i + 1], hull[i]]) pos.push(pts[j][0], 0.03, pts[j][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shadowMat ??= ground(new THREE.MeshBasicMaterial({ color: TOON_HEX.ink, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const m = new THREE.Mesh(g, shadowMat);
  m.renderOrder = 1;
  return m;
}

// ---- renderer, lights, stage -----------------------------------------------------------------------------
/** Any WebGLRenderer that draws game models (the stage, portraits, the model viewer). Classic: untouched. */
export function styleRenderer(r: THREE.WebGLRenderer) {
  if (!TOON) return;
  patchShaders();
  r.toneMapping = THREE.CustomToneMapping;
  r.toneMappingExposure = 1;
}
/**
 * Sun and sky light of the style. Lit faces come out at the authored colour (ambient + sun = 1), shade is
 * about 62% of it and cool (the sky fills it).
 */
export function styleLights(hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight) {
  if (!TOON) return;
  hemi.color.set(TOON_HEX.ambientSky); hemi.groundColor.set(TOON_HEX.ambientGround); hemi.intensity = 0.74 * Math.PI;
  sun.color.set(TOON_HEX.sun); sun.intensity = 0.42 * Math.PI;
  sun.shadow.intensity = 0.9;
}

let toonStage: ToonStage | null = null;
/** The toon frame of the game's main renderer (scene.ts); null in classic. */
export function styleStage(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, low: boolean, msaa: boolean, opts: { clouds?: boolean; pin?: boolean } = {}): ToonStage | null {
  if (!TOON) return null;
  styleRenderer(renderer);
  styleLights(hemi, sun);
  return (toonStage = new ToonStage(renderer, scene, low, msaa, opts));
}

export { ToonStage };
export type { Role };
