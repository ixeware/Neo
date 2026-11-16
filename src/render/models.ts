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
export function houseGeometries() {
  const body = new THREE.BoxGeometry(1, 1, 1);
  body.translate(0, 0.5, 0);
  const roof = new THREE.ConeGeometry(0.78, 0.5, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.25, 0);
  return { body, roof };
}

/** Window-grid texture for a panel block / brick building floor. */
export function facadeTexture(kind: 'panel' | 'brick', side: 0 | 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  if (kind === 'panel') {
    g.fillStyle = '#d9d3c5'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#c9c2b2';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 1, 64);
    g.fillRect(0, 62, 256, 2);
    for (let i = 0; i < 8; i++) {
      const x = 6 + i * 32;
      const lit = (i * 7 + side) % 5 === 0;
      g.fillStyle = '#f4f1ea'; g.fillRect(x - 2, 14, 24, 32);
      g.fillStyle = lit ? '#ffd27a' : '#3d4a55'; g.fillRect(x, 16, 20, 28);
      g.fillStyle = '#f4f1ea'; g.fillRect(x + 9, 16, 2, 28);
      if (i % 2 === 1) { g.fillStyle = '#b8b0a0'; g.fillRect(x - 4, 40, 28, 10); }
    }
  } else {
    g.fillStyle = '#9b5236'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#8a4630';
    for (let y = 0; y < 64; y += 6) for (let x = (y / 6) % 2 ? 0 : 6; x < 256; x += 12) g.fillRect(x, y, 11, 1);
    for (let i = 0; i < 5; i++) {
      const x = 14 + i * 50;
      g.fillStyle = '#efe9dd'; g.fillRect(x - 3, 12, 30, 38);
      g.fillStyle = (i + side) % 3 === 0 ? '#ffd27a' : '#34404a'; g.fillRect(x, 15, 24, 32);
      g.fillStyle = '#efe9dd'; g.fillRect(x + 11, 15, 2, 32); g.fillRect(x, 28, 24, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
