// Capture places (sim pts kind 3, pts[9..12]): a capture ring with the progress arc like the
// villages, a flag in the owner's colour with the perk drawn on it, and a deploy-zone ring that
// shows while a card is selected (an owned home place is a deploy zone). Reads the sim only.
import * as THREE from 'three';
import { heightY, type Terrain } from '../world/terrain';
import { drapedRing } from './world';
import { PAL } from './models';
import type { Pt } from '../sim/sim';

export type Perk = 'sportiki' | 'gelik' | 'gym' | 'market';

/**
 * The perk as a small pen drawing, centred on (cx, cy), about `s` px across: a running sportik,
 * a boxy Гелик, a dumbbell, a ruble sign. Used on the flags and the minimap.
 */
export function drawPerkGlyph(g: CanvasRenderingContext2D, perk: string, cx: number, cy: number, s: number, ink: string) {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = ink; g.fillStyle = ink;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const w = Math.max(1.2, s * 0.11);
  g.lineWidth = w;
  switch (perk) {
    case 'sportiki': { // a runner
      g.beginPath(); g.arc(s * 0.1, -s * 0.33, s * 0.11, 0, Math.PI * 2); g.fill();
      g.beginPath();
      g.moveTo(s * 0.05, -s * 0.2); g.lineTo(-s * 0.06, s * 0.08); // body
      g.moveTo(-s * 0.06, s * 0.08); g.lineTo(s * 0.16, s * 0.2); g.lineTo(s * 0.1, s * 0.42); // front leg
      g.moveTo(-s * 0.06, s * 0.08); g.lineTo(-s * 0.2, s * 0.26); g.lineTo(-s * 0.38, s * 0.24); // back leg
      g.moveTo(s * 0.02, -s * 0.13); g.lineTo(s * 0.28, -s * 0.02); // front arm
      g.moveTo(s * 0.02, -s * 0.13); g.lineTo(-s * 0.2, -s * 0.12); g.lineTo(-s * 0.3, s * 0.02); // back arm
      g.stroke();
      break;
    }
    case 'gelik': { // boxy SUV side-on
      g.beginPath();
      g.moveTo(-s * 0.44, s * 0.16); g.lineTo(-s * 0.44, -s * 0.06); g.lineTo(-s * 0.24, -s * 0.08);
      g.lineTo(-s * 0.2, -s * 0.32); g.lineTo(s * 0.26, -s * 0.32); g.lineTo(s * 0.3, -s * 0.08);
      g.lineTo(s * 0.44, -s * 0.06); g.lineTo(s * 0.44, s * 0.16); g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(-s * 0.14, -s * 0.27, s * 0.16, s * 0.14); g.fillRect(s * 0.06, -s * 0.27, s * 0.16, s * 0.14);
      g.fillStyle = ink;
      for (const x of [-0.25, 0.25]) { g.beginPath(); g.arc(x * s, s * 0.18, s * 0.12, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'gym': { // dumbbell
      g.lineWidth = w * 1.3;
      g.beginPath(); g.moveTo(-s * 0.3, 0); g.lineTo(s * 0.3, 0); g.stroke();
      for (const d of [-1, 1]) {
        g.fillRect(d * s * 0.3 - s * 0.07, -s * 0.24, s * 0.14, s * 0.48);
        g.fillRect(d * s * 0.42 - s * 0.05, -s * 0.16, s * 0.1, s * 0.32);
      }
      break;
    }
    case 'market': { // ₽
      g.lineWidth = w * 1.1;
      g.beginPath();
      g.moveTo(-s * 0.12, s * 0.38); g.lineTo(-s * 0.12, -s * 0.36);
      g.lineTo(s * 0.08, -s * 0.36); g.quadraticCurveTo(s * 0.32, -s * 0.34, s * 0.32, -s * 0.15);
      g.quadraticCurveTo(s * 0.32, s * 0.05, s * 0.08, s * 0.06); g.lineTo(-s * 0.26, s * 0.06);
      g.moveTo(-s * 0.26, s * 0.22); g.lineTo(s * 0.14, s * 0.22);
      g.stroke();
      break;
    }
    default:
      g.beginPath(); g.arc(0, 0, s * 0.2, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** Flag cloth: white with the perk glyph in dark ink (the material colour tints it to the owner's). */
function flagTexture(perk: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 80);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath(); g.arc(64, 40, 30, 0, Math.PI * 2); g.fill();
  drawPerkGlyph(g, perk, 64, 41, 56, '#1d1f24');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const NEUTRAL = new THREE.Color('#efe6d2'), RING_NEUTRAL = new THREE.Color('#f2ead8');

export class PlaceMarker {
  group = new THREE.Group();
  private ringMat: THREE.MeshBasicMaterial; private progMat: THREE.MeshBasicMaterial; private flagMat: THREE.MeshLambertMaterial;
  private zoneMat: THREE.MeshBasicMaterial;
  private progGeo: THREE.BufferGeometry;
  private flag: THREE.Mesh; private zone: THREE.Mesh;
  private lastArc = -1;
  private seg = 96;

  constructor(t: Terrain, public p: Pt, private live: () => Pt[]) {
    this.ringMat = new THREE.MeshBasicMaterial({ color: RING_NEUTRAL, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    this.progMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    this.zoneMat = new THREE.MeshBasicMaterial({ color: PAL.side[p.side === 1 ? 1 : 0], transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(drapedRing(t, p.x, p.z, p.r, 0.22, this.seg), this.ringMat);
    this.progGeo = drapedRing(t, p.x, p.z, p.r, 0.5, this.seg, 1);
    const prog = new THREE.Mesh(this.progGeo, this.progMat);
    this.zone = new THREE.Mesh(drapedRing(t, p.x, p.z, p.r + 0.35, 0.4, this.seg), this.zoneMat);
    this.zone.visible = false;
    ring.renderOrder = 2; prog.renderOrder = 3; this.zone.renderOrder = 3;
    this.group.add(ring, prog, this.zone);
    const y = heightY(t, p.x, p.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), new THREE.MeshLambertMaterial({ color: '#e9e4d8' }));
    pole.position.set(p.x, y + 1.6, p.z);
    this.flagMat = new THREE.MeshLambertMaterial({ color: NEUTRAL, map: flagTexture(p.perk ?? ''), side: THREE.DoubleSide });
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.8, 8, 1), this.flagMat);
    this.flag.position.set(p.x + 0.62, y + 2.75, p.z);
    pole.castShadow = true; this.flag.castShadow = true;
    this.group.add(pole, this.flag);
  }

  /** Deploy-zone ring: on while the player has a card selected and this home place is theirs. */
  setZone(on: boolean) { if (this.zone.visible !== on) this.zone.visible = on; }

  update(time: number) {
    const list = this.live();
    if (list.indexOf(this.p) < 0) { const q = list.find(o => o.key === this.p.key); if (q) this.p = q; }
    const p = this.p;
    const col = p.owner === 0 ? PAL.side[0] : p.owner === 1 ? PAL.side[1] : NEUTRAL;
    this.flagMat.color.copy(col);
    const lead = p.prog < 0 ? 0 : p.prog > 0 ? 1 : -1;
    this.progMat.color.copy(lead >= 0 ? PAL.side[lead] : col);
    const arc = Math.round((Math.abs(p.prog) / 100) * this.seg);
    if (arc !== this.lastArc) { this.lastArc = arc; this.progGeo.setDrawRange(0, arc * 6); }
    this.ringMat.color.copy(p.owner >= 0 ? PAL.side[p.owner] : RING_NEUTRAL);
    if (this.zone.visible) this.zoneMat.opacity = 0.55 + Math.sin(time * 4) * 0.2;
    const pa = this.flag.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const x = (i % 9) / 8; pa.setZ(i, Math.sin(time * 3.4 + x * 4 + p.x) * 0.12 * x); }
    pa.needsUpdate = true;
  }
}
