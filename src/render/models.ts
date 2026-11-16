// Procedural low-poly models. Everything is built from primitives and merged into
// one vertex-coloured geometry per unit type so crowds render as a few instanced meshes.
import * as THREE from 'three';

export const PAL = {
  side: [new THREE.Color('#2a52d1'), new THREE.Color('#d8361f')],
  sideDark: [new THREE.Color('#18307e'), new THREE.Color('#8a1d10')],
  skin: new THREE.Color('#c98d66'),
  skin2: new THREE.Color('#b57a55'),
  hair: new THREE.Color('#1c1612'),
  pants: new THREE.Color('#23252b'),
  white: new THREE.Color('#f2efe6'),
  shoe: new THREE.Color('#ece8de'),
  black: new THREE.Color('#121212'),
  glass: new THREE.Color('#1a2026'),
  wool: new THREE.Color('#e8dfc9'),
  steel: new THREE.Color('#b9bec4'),
  bread: new THREE.Color('#d9a45a'),
  grey: new THREE.Color('#5d6066'),
};

type V3 = [number, number, number];

export class Builder {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(g: THREE.BufferGeometry, color: THREE.Color, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    this.e.set(r[0], r[1], r[2]);
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(...p), this.q, new THREE.Vector3(...s));
    geo.applyMatrix4(this.m);
    geo.computeVertexNormals();
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    for (let i = 0; i < P.length; i += 3) {
      this.pos.push(P[i], P[i + 1], P[i + 2]);
      this.nor.push(N[i], N[i + 1], N[i + 2]);
      this.col.push(color.r, color.g, color.b);
    }
    geo.dispose();
    return this;
  }
  box(c: THREE.Color, p: V3, s: V3, r: V3 = [0, 0, 0]) { return this.add(BOX, c, p, r, s); }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const CYL10 = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
const ICO1 = new THREE.IcosahedronGeometry(0.5, 1);

// A boxy, big-headed villager. Faces +z.
function person(b: Builder, o: {
  shirt: THREE.Color; pants?: THREE.Color; stripe?: THREE.Color; skin?: THREE.Color;
  hat?: 'cap' | 'chef' | 'none'; wide?: number; coat?: THREE.Color; beard?: boolean;
}) {
  const w = o.wide ?? 1;
  const skin = o.skin ?? PAL.skin;
  const pants = o.pants ?? PAL.pants;
  // legs + shoes
  b.box(pants, [-0.08 * w, 0.17, 0], [0.12 * w, 0.3, 0.14]);
  b.box(pants, [0.08 * w, 0.17, 0], [0.12 * w, 0.3, 0.14]);
  b.box(PAL.shoe, [-0.08 * w, 0.03, 0.025], [0.13 * w, 0.06, 0.19]);
  b.box(PAL.shoe, [0.08 * w, 0.03, 0.025], [0.13 * w, 0.06, 0.19]);
  if (o.stripe) {
    b.box(o.stripe, [-0.145 * w, 0.18, 0], [0.012, 0.28, 0.02]);
    b.box(o.stripe, [0.145 * w, 0.18, 0], [0.012, 0.28, 0.02]);
  }
  // torso
  b.box(o.shirt, [0, 0.47, 0], [0.36 * w, 0.32, 0.22]);
  if (o.coat) b.box(o.coat, [0, 0.4, 0], [0.38 * w, 0.42, 0.235]);
  if (o.stripe) {
    b.box(o.stripe, [0, 0.47, 0.112], [0.025, 0.3, 0.01]);
    b.box(o.stripe, [-0.235 * w, 0.47, 0], [0.012, 0.28, 0.1]);
    b.box(o.stripe, [0.235 * w, 0.47, 0], [0.012, 0.28, 0.1]);
  }
  // arms
  const arm = o.coat ?? o.shirt;
  b.box(arm, [-0.23 * w, 0.46, 0], [0.09 * w, 0.3, 0.11]);
  b.box(arm, [0.23 * w, 0.46, 0], [0.09 * w, 0.3, 0.11]);
  b.box(skin, [-0.23 * w, 0.29, 0], [0.08, 0.06, 0.09]);
  b.box(skin, [0.23 * w, 0.29, 0], [0.08, 0.06, 0.09]);
  // head
  b.box(skin, [0, 0.79, 0], [0.27, 0.27, 0.25]);
  b.box(PAL.black, [-0.06, 0.81, 0.126], [0.04, 0.035, 0.01]);
  b.box(PAL.black, [0.06, 0.81, 0.126], [0.04, 0.035, 0.01]);
  if (o.beard !== false) b.box(PAL.skin2, [0, 0.7, 0.03], [0.275, 0.09, 0.23]);
  if (o.hat === 'cap') {
    b.box(PAL.grey, [0, 0.95, -0.01], [0.29, 0.07, 0.27]);
    b.box(PAL.grey, [0, 0.925, 0.15], [0.26, 0.025, 0.09]);
  } else if (o.hat === 'chef') {
    b.add(CYL10, PAL.white, [0, 1.0, 0], [0, 0, 0], [0.26, 0.2, 0.26]);
  } else {
    b.box(PAL.hair, [0, 0.94, -0.01], [0.28, 0.05, 0.26]);
  }
}

export function unitGeometry(type: number, side: 0 | 1): THREE.BufferGeometry {
  const b = new Builder();
  const team = PAL.side[side], dark = PAL.sideDark[side];
  switch (type) {
    case 0: // Пацаны
      person(b, { shirt: team, stripe: PAL.white, hat: side === 0 ? 'cap' : 'none' });
      break;
    case 1: { // Борец
      person(b, { shirt: team, wide: 1.45, pants: dark, hat: 'none' });
      // bare shoulders + traps
      b.box(PAL.skin, [-0.3, 0.6, 0], [0.16, 0.12, 0.16]);
      b.box(PAL.skin, [0.3, 0.6, 0], [0.16, 0.12, 0.16]);
      b.box(PAL.skin, [0, 0.65, -0.02], [0.3, 0.08, 0.14]);
      break;
    }
    case 2: // Снайпер / Метатель гантелей
      if (side === 0) {
        person(b, { shirt: team, pants: new THREE.Color('#4b5236'), hat: 'none' });
        b.box(dark, [0, 0.93, -0.02], [0.3, 0.1, 0.29]); // hood/beanie
        b.box(PAL.black, [0.17, 0.52, 0.32], [0.04, 0.05, 0.75]); // rifle
        b.box(PAL.black, [0.17, 0.57, 0.12], [0.03, 0.05, 0.1]);
      } else {
        person(b, { shirt: team, hat: 'none', wide: 1.15 });
        b.box(PAL.skin, [0.27, 0.6, 0], [0.1, 0.32, 0.11]);
        b.add(CYL6, PAL.steel, [0.27, 0.86, 0.0], [0, 0, Math.PI / 2], [0.07, 0.36, 0.07]);
        b.add(CYL10, PAL.black, [0.11, 0.86, 0], [0, 0, Math.PI / 2], [0.16, 0.06, 0.16]);
        b.add(CYL10, PAL.black, [0.43, 0.86, 0], [0, 0, Math.PI / 2], [0.16, 0.06, 0.16]);
      }
      break;
    case 3: // Баран / Камри
      if (side === 0) {
        b.add(ICO1, PAL.wool, [0, 0.48, 0], [0, 0, 0], [0.62, 0.5, 0.92]);
        b.add(ICO, PAL.wool, [0, 0.6, -0.1], [0.3, 0.2, 0], [0.5, 0.42, 0.6]);
        b.box(team, [0, 0.72, -0.05], [0.5, 0.06, 0.42]); // попона в цвет села
        b.box(PAL.hair, [0, 0.6, 0.52], [0.22, 0.24, 0.3]); // голова
        b.box(PAL.wool, [0, 0.74, 0.47], [0.24, 0.08, 0.2]);
        const horn = new THREE.TorusGeometry(0.1, 0.04, 5, 8, Math.PI * 1.5);
        b.add(horn, PAL.bread, [-0.15, 0.66, 0.5], [0, Math.PI / 2, 0], [1, 1, 1]);
        b.add(horn, PAL.bread, [0.15, 0.66, 0.5], [0, -Math.PI / 2, 0], [1, 1, 1]);
        horn.dispose();
        for (const [x, z] of [[-0.17, 0.28], [0.17, 0.28], [-0.17, -0.28], [0.17, -0.28]]) b.box(PAL.hair, [x, 0.14, z], [0.08, 0.28, 0.08]);
        b.box(team, [0, 0.47, 0.42], [0.3, 0.06, 0.06]); // ошейник
      } else {
        b.box(team, [0, 0.27, 0], [0.74, 0.24, 1.7]);
        b.box(team, [0, 0.33, 0.62], [0.72, 0.12, 0.4]);
        b.box(PAL.glass, [0, 0.5, -0.08], [0.66, 0.24, 0.92]);
        b.box(team, [0, 0.63, -0.08], [0.62, 0.03, 0.78]);
        b.box(PAL.white, [-0.26, 0.29, 0.86], [0.14, 0.06, 0.02]);
        b.box(PAL.white, [0.26, 0.29, 0.86], [0.14, 0.06, 0.02]);
        b.box(PAL.white, [0, 0.22, 0.86], [0.22, 0.07, 0.02]); // номер
        b.box(new THREE.Color('#8a1c12'), [-0.28, 0.32, -0.86], [0.14, 0.06, 0.02]);
        b.box(new THREE.Color('#8a1c12'), [0.28, 0.32, -0.86], [0.14, 0.06, 0.02]);
        for (const [x, z] of [[-0.37, 0.52], [0.37, 0.52], [-0.37, -0.52], [0.37, -0.52]]) b.add(CYL10, PAL.black, [x, 0.13, z], [0, 0, Math.PI / 2], [0.26, 0.1, 0.26]);
      }
      break;
    case 4: // Бежни лор / Шаурмист
      if (side === 0) {
        person(b, { shirt: team, coat: PAL.white, hat: 'none' });
        b.add(CYL10, PAL.steel, [0.27, 0.32, 0.08], [0, 0, 0], [0.13, 0.22, 0.13]); // бидон
        b.add(CYL10, PAL.steel, [0.27, 0.45, 0.08], [0, 0, 0], [0.08, 0.05, 0.08]);
        b.box(team, [0, 0.47, 0.12], [0.1, 0.1, 0.01]); // крест-нашивка
      } else {
        person(b, { shirt: team, hat: 'chef' });
        b.box(PAL.white, [0, 0.36, 0.115], [0.3, 0.38, 0.02]); // фартук
        b.add(CYL10, PAL.bread, [0.27, 0.36, 0.12], [Math.PI / 2.4, 0, 0], [0.1, 0.26, 0.1]); // шаурма
      }
      break;
  }
  return b.build();
}

export function unitScale(type: number, side: 0 | 1): number {
  if (type === 1) return 1.15;
  if (type === 3) return side === 0 ? 1.05 : 1.0;
  return 1.0;
}

// ---- bosses (articulated groups) ----------------------------------------------------
export interface Rig { root: THREE.Group; body: THREE.Group; armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group; head: THREE.Group; height: number }

function part(b: Builder, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  return m;
}

export function islamRig(mat: THREE.Material): Rig {
  const team = PAL.side[0], dark = PAL.sideDark[0];
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const jeans = new THREE.Color('#2b3448');
  const mk = (fn: (b: Builder) => void) => { const b = new Builder(); fn(b); return part(b, mat); };
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, 1.25, 0); legR.position.set(0.13, 1.25, 0);
  legL.add(mk(b => { b.box(jeans, [0, -0.6, 0], [0.17, 1.2, 0.19]); b.box(PAL.shoe, [0, -1.21, 0.05], [0.18, 0.08, 0.3]); }));
  legR.add(mk(b => { b.box(jeans, [0, -0.6, 0], [0.17, 1.2, 0.19]); b.box(PAL.shoe, [0, -1.21, 0.05], [0.18, 0.08, 0.3]); }));
  body.add(legL, legR);
  body.add(mk(b => {
    b.box(team, [0, 1.6, 0], [0.48, 0.72, 0.27]); // худи
    b.box(dark, [0, 1.6, 0.137], [0.03, 0.66, 0.01]);
    b.box(PAL.black, [0, 1.62, 0.142], [0.06, 0.92, 0.02], [0, 0, 0.72]); // ремень барсетки
    b.box(PAL.black, [0.22, 1.28, 0.1], [0.24, 0.17, 0.08]); // барсетка
    b.box(new THREE.Color('#c8a24a'), [0.22, 1.3, 0.145], [0.05, 0.02, 0.01]); // замок
    b.box(PAL.skin, [0, 2.0, 0], [0.13, 0.1, 0.13]); // шея
  }));
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.3, 1.92, 0); armR.position.set(0.3, 1.92, 0);
  armL.add(mk(b => { b.box(team, [0, -0.35, 0], [0.13, 0.7, 0.15]); b.box(PAL.skin, [0, -0.76, 0], [0.11, 0.13, 0.12]); }));
  armR.add(mk(b => { b.box(team, [0, -0.35, 0], [0.13, 0.7, 0.15]); b.box(PAL.skin, [0, -0.76, 0], [0.11, 0.13, 0.12]); }));
  body.add(armL, armR);
  const head = new THREE.Group();
  head.position.set(0, 2.05, 0);
  head.add(mk(b => {
    b.box(PAL.skin, [0, 0.2, 0], [0.34, 0.38, 0.32]);
    b.box(PAL.black, [-0.075, 0.23, 0.161], [0.05, 0.035, 0.01]);
    b.box(PAL.black, [0.075, 0.23, 0.161], [0.05, 0.035, 0.01]);
    b.box(PAL.skin2, [0, 0.07, 0.03], [0.345, 0.12, 0.3]);
    // сальная чёлка + перхоть, вкрапленная прямо в волосы
    b.box(PAL.hair, [0, 0.42, -0.01], [0.37, 0.1, 0.35]);
    b.box(PAL.hair, [-0.08, 0.36, 0.16], [0.2, 0.08, 0.04], [0, 0, 0.25]);
    b.box(PAL.hair, [0.1, 0.47, -0.05], [0.12, 0.06, 0.2]);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996, r = 0.05 + (i % 5) * 0.03;
      b.box(PAL.white, [Math.cos(a) * r, 0.475, Math.sin(a) * r * 0.9], [0.025, 0.012, 0.025]);
    }
  }));
  body.add(head);
  return { root, body, armL, armR, legL, legR, head, height: 2.55 };
}

export function zurabRig(mat: THREE.Material): Rig {
  const team = PAL.side[1];
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const mk = (fn: (b: Builder) => void) => { const b = new Builder(); fn(b); return part(b, mat); };
  const shorts = new THREE.Color('#2a2c33');
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.3, 0.8, 0); legR.position.set(0.3, 0.8, 0);
  const leg = (b: Builder) => {
    b.box(shorts, [0, -0.2, 0], [0.38, 0.42, 0.4]);
    b.add(ICO1, PAL.skin, [0, -0.55, 0.02], [0, 0, 0], [0.3, 0.42, 0.32]);
    b.box(PAL.shoe, [0, -0.75, 0.08], [0.3, 0.12, 0.44]);
  };
  legL.add(mk(leg)); legR.add(mk(leg));
  body.add(legL, legR);
  body.add(mk(b => {
    // V-образный торс: майка в цвет Курчалоя
    b.add(new THREE.CylinderGeometry(0.8, 0.48, 1.0, 6), team, [0, 1.38, 0], [0, Math.PI / 6, 0], [1, 1, 0.66]);
    b.add(new THREE.CylinderGeometry(0.62, 0.8, 0.22, 6), PAL.skin, [0, 1.98, 0], [0, Math.PI / 6, 0], [1, 1, 0.62]);
    b.add(ICO1, PAL.skin, [-0.2, 1.62, 0.25], [0, 0, 0], [0.42, 0.32, 0.22]); // грудь
    b.add(ICO1, PAL.skin, [0.2, 1.62, 0.25], [0, 0, 0], [0.42, 0.32, 0.22]);
    b.add(new THREE.ConeGeometry(0.5, 0.42, 6), PAL.skin, [0, 2.2, -0.03], [0, 0, 0], [1, 1, 0.6]); // трапеции
    b.box(PAL.black, [0, 0.93, 0], [0.98, 0.1, 0.62]); // пояс
    b.box(new THREE.Color('#d7b44a'), [0, 0.93, 0.31], [0.24, 0.13, 0.03]);
  }));
  const arm = (b: Builder) => {
    b.add(ICO1, PAL.skin, [0, -0.08, 0], [0, 0, 0], [0.5, 0.46, 0.48]); // дельта
    b.add(ICO1, PAL.skin, [0, -0.4, 0.04], [0, 0, 0], [0.36, 0.5, 0.38]); // бицепс
    b.add(ICO1, PAL.skin2, [0, -0.78, 0.04], [0, 0, 0], [0.3, 0.46, 0.3]);
    b.box(PAL.skin2, [0, -1.06, 0.04], [0.26, 0.22, 0.24]); // кулак
  };
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.86, 2.05, 0); armR.position.set(0.86, 2.05, 0);
  armL.add(mk(arm)); armR.add(mk(arm));
  body.add(armL, armR);
  const head = new THREE.Group();
  head.position.set(0, 2.32, 0.05);
  head.add(mk(b => {
    b.box(PAL.skin, [0, 0.18, 0], [0.36, 0.38, 0.34]);
    b.box(PAL.skin2, [-0.19, 0.2, 0], [0.06, 0.12, 0.08]); // уши борца
    b.box(PAL.skin2, [0.19, 0.2, 0], [0.06, 0.12, 0.08]);
    b.box(PAL.black, [-0.08, 0.22, 0.171], [0.06, 0.03, 0.01]);
    b.box(PAL.black, [0.08, 0.22, 0.171], [0.06, 0.03, 0.01]);
    b.box(PAL.hair, [0, 0.06, 0.05], [0.37, 0.14, 0.3]); // борода
    b.box(PAL.hair, [0, 0.39, -0.01], [0.37, 0.05, 0.35]);
  }));
  body.add(head);
  return { root, body, armL, armR, legL, legR, head, height: 2.75 };
}

// ---- buildings --------------------------------------------------------------------
// Village houses after Старые Атаги / Курчалой / Шали street photos: 1–2-storey brick or plastered
// boxes under low hip roofs of coloured profiled metal, the plot closed to the street by a solid
// fence with a big metal gate. Instanced: `body` takes the instance colour (wall; the fence is the
// same brick/plaster), `roof` takes the second instance colour (roof; the gate is the same profiled
// sheet, as it usually is). Unit footprint centred on the origin, walls 0..1, roof above y = 1, the
// street front is +z. Hidden faces (wall tops, bottoms, the roof underside) are not built.

/** One house kit: two geometries for two instanced meshes. `tris` is the per-house triangle count. */
export interface HouseKit { kind: 'plain' | 'gate' | 'gateL'; body: THREE.BufferGeometry; roof: THREE.BufferGeometry; tris: number }

class Flat {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  tri(a: V3, b: V3, c: V3, out: V3, k = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(k, k, k); }
  }
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, k = 1) { this.tri(a, b, c, out, k); this.tri(a, c, d, out, k); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    // a soft plinth / ground shade if the material turns vertexColors on; ignored otherwise
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const WALL0 = -0.25; // walls reach a little below the ground so slopes never show a gap
/** Four walls of the unit box (8 tris); the lower triangle of each wall is a shade darker (plinth). */
function walls(f: Flat) {
  const lo = WALL0, sides: [V3, V3, V3][] = [
    [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 0, 1]], [[0.5, 0, -0.5], [-0.5, 0, -0.5], [0, 0, -1]],
    [[0.5, 0, 0.5], [0.5, 0, -0.5], [1, 0, 0]], [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-1, 0, 0]],
  ];
  for (const [a, b, n] of sides) {
    f.tri([a[0], lo, a[2]], [b[0], lo, b[2]], [b[0], 1, b[2]], n, 0.9);
    f.tri([a[0], lo, a[2]], [b[0], 1, b[2]], [a[0], 1, a[2]], n, 0.96);
  }
}
/** Low hip roof with a short ridge along x and a small overhang (6 tris). */
function hipRoof(f: Flat, h = 0.42, eave = 0.56, ridge = 0.2) {
  const y0 = 1, y1 = 1 + h, e = eave;
  const A: V3 = [-e, y0, e], B: V3 = [e, y0, e], C: V3 = [e, y0, -e], D: V3 = [-e, y0, -e];
  const R0: V3 = [-ridge, y1, 0], R1: V3 = [ridge, y1, 0];
  f.quad(A, B, R1, R0, [0, 0.6, 0.8]);
  f.quad(C, D, R0, R1, [0, 0.6, -0.8]);
  f.tri(B, C, R1, [0.8, 0.6, 0]);
  f.tri(D, A, R0, [-0.8, 0.6, 0]);
}
/**
 * Street fence across the front of the plot (4 tris, both faces; same brick/plaster as the house) and the
 * metal gate in it (2 tris, street side, roof-coloured profiled sheet). `gx` shifts the gate along the fence.
 */
function fenceGate(body: Flat, roof: Flat, gx: number) {
  const z = 0.98, x0 = -0.78, x1 = 0.78, top = 0.6;
  for (const n of [1, -1]) body.quad([x0, WALL0, z], [x1, WALL0, z], [x1, top, z], [x0, top, z], [0, 0, n], n > 0 ? 0.86 : 0.8);
  const g0 = gx - 0.27, g1 = gx + 0.27, gz = z + 0.012;
  roof.quad([g0, WALL0, gz], [g1, WALL0, gz], [g1, top + 0.08, gz], [g0, top + 0.08, gz], [0, 0, 1], 0.92);
}

let houseCache: { body: THREE.BufferGeometry; roof: THREE.BufferGeometry; variants: HouseKit[] } | null = null;
/**
 * House kits for the villages. `body` / `roof` are the plain house (walls + hip roof, 14 tris; it was a
 * 20-tri box + pyramid), so code that only knows those two keeps working. `variants` adds the street-front
 * houses: fence + gate on +z (20 tris) — rotate them so +z faces the street; 'gateL' has the gate on the
 * other side. Geometries are shared: don't dispose them.
 */
export function houseGeometries() {
  if (houseCache) return houseCache;
  const make = (kind: HouseKit['kind']): HouseKit => {
    const b = new Flat(), r = new Flat();
    walls(b);
    hipRoof(r);
    if (kind !== 'plain') fenceGate(b, r, kind === 'gate' ? 0.3 : -0.3);
    return { kind, body: b.build(), roof: r.build(), tris: (b.pos.length + r.pos.length) / 9 };
  };
  const variants = [make('plain'), make('gate'), make('gateL')];
  houseCache = { body: variants[0].body, roof: variants[0].roof, variants };
  return houseCache;
}

/**
 * One floor of the high-rise façades, 256 × 64.
 * 'panel' (Курчалой, a хрущёвка): `long` is one entrance section — two window bays, the stairwell column
 * (small windows half a floor down, over the entrance), two more bays, balconies of corrugated sheet on
 * the inner bays; repeat it once per entrance. `end` is the blind end wall of big beige panels.
 * 'brick' (Атаги, a three-storey brick block): `long` is the whole front — four windows, the stairwell
 * over the central entrance, four windows (repeat 1); `end` has three windows.
 */
export function facadeTexture(kind: 'panel' | 'brick', side: 0 | 1, part: 'long' | 'end' = 'long'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  const rect = (col: string, x: number, y: number, w: number, h: number) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  /** Double-hung window: white frame, glass (lit or dark), mullion and transom. */
  const win = (x: number, y: number, w: number, h: number, lit: boolean, frame = '#f4f1ea') => {
    rect(frame, x - 2, y - 2, w + 4, h + 4);
    rect(lit ? '#ffd27a' : '#3d4a55', x, y, w, h);
    rect(frame, x + w / 2 - 1, y, 2, h);
    rect(frame, x, y + Math.round(h * 0.32), w, 2);
  };
  if (kind === 'panel' && part === 'end') {
    // blind end wall: 2 × 1 big panels per floor, alternating tones, deep seams
    for (let i = 0; i < 2; i++) rect(i ? '#d4cdbd' : '#ddd7c9', i * 128, 0, 128, 64);
    rect('#bdb6a6', 0, 61, 256, 3); rect('#c3bcac', 127, 0, 2, 64);
    rect('#cfc8b8', 0, 0, 256, 2);
  } else if (kind === 'panel') {
    rect('#dbd5c7', 0, 0, 256, 64);
    const bays = [0, 56, 144, 200];
    bays.forEach((x, i) => {
      rect(i % 2 ? '#d6d0c1' : '#dcd6c8', x, 0, 56, 64);
      rect('#c4bdad', x, 0, 1, 64);
      const lit = (i * 7 + side * 3) % 5 === 0;
      win(x + 10, 14, 36, 30, lit);
      if (i === 1 || i === 2) {
        // balcony: slab and corrugated screen over the lower part of the window bay
        rect('#a9a293', x + 3, 41, 50, 3);
        for (let k = 0; k < 50; k += 4) rect(k % 8 ? '#c9c2b2' : '#b5ad9d', x + 3 + k, 44, 4, 14);
        rect('#8e877a', x + 3, 57, 50, 2);
      }
    });
    // stairwell: a plain strip with a small window half a floor down
    rect('#e2ddd1', 112, 0, 32, 64);
    rect('#c4bdad', 112, 0, 1, 64); rect('#c4bdad', 143, 0, 1, 64);
    win(119, 40, 18, 18, (side + 1) % 3 === 0);
    rect('#bdb6a6', 0, 62, 256, 2);
  } else {
    rect('#9b5236', 0, 0, 256, 64);
    g.fillStyle = '#8a4630';
    for (let y = 0; y < 64; y += 6) for (let x = (y / 6) % 2 ? 0 : 6; x < 256; x += 12) g.fillRect(x, y, 11, 1);
    // white-washed cornice band at the top of each floor
    rect('#c98e70', 0, 0, 256, 3);
    const end = part === 'end', n = end ? 3 : 8, slot = end ? 256 / 3 : 27, ww = end ? 30 : 20;
    for (let i = 0; i < n; i++) {
      const x0 = end ? i * slot : i < 4 ? i * slot : 148 + (i - 4) * slot;
      const x = Math.round(x0 + slot / 2 - ww / 2), lit = (i * 5 + side) % 4 === 0;
      win(x, 14, ww, 34, lit, '#efe9dd');
      rect('#d9cfc0', x - 3, 49, ww + 6, 3); // sill
      rect('#7d3f2a', x - 2, 9, ww + 4, 3); // brick lintel
    }
    if (part === 'long') {
      // stairwell over the central entrance
      rect('#a35a3d', 108, 0, 40, 64);
      win(120, 34, 16, 24, side === 0, '#efe9dd');
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
