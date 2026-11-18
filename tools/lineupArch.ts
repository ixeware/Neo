// Lineup views of the architecture track (hooked into tools/lineup.ts with one line):
//   base[&side=0|1][&fam=def|wall|trap|eco|sup|super]  every base building, three levels in a column
//   base1&k=rogatka[&side=]                             one building: three levels, both sides
//   basegame[&dist=38][&side=]                          a mock base at the game camera, units for scale
//   basewall                                            wall runs of the three materials, corners and a gate gap
//   arch (see archView for the rest: houses, high-rises…)
import * as THREE from 'three';
import { BASE_KEYS, baseModel, baseModelInfo, wallKit } from '../src/render/toon/base/models';
import { TEAM, mat } from '../src/render/style';

export interface LineupApi {
  scene: THREE.Scene;
  placed: THREE.Object3D[];
  labels: { text: string; sub: string; at: THREE.Vector3; side: number }[];
  addObj: (o: THREE.Object3D, x: number, z: number, ry?: number) => THREE.Object3D;
  unit: (type: number, side: 0 | 1, x: number, z: number, yaw?: number, label?: boolean) => void;
}
export interface LineupCam { pitch?: number; tight?: number; gameCam?: { x: number; z: number; dist: number } | null }

const FAMS: [string, string, string[]][] = [
  ['def', 'Защита', ['rogatka', 'sebozol', 'sperm', 'tesla', 'gantel', 'antidron', 'kamera', 'kuryatnik', 'bukva_n']],
  ['wall', 'Стены', ['zabor', 'shlagbaum']],
  ['trap', 'Ловушки', ['grabli', 'yama', 'lezhak', 'nychka', 'sobaka']],
  ['eco', 'Хозяйство', ['larek', 'shaurma', 'seyf', 'zagon']],
  ['sup', 'Особое', ['prorab', 'kachalka', 'garazh', 'vyshka', 'generator']],
  ['super', 'Супероружие', ['sabvufer', 'arbuzomet']],
];
const NAME: Record<string, string> = {
  rogatka: 'Рогатка', sebozol: 'Пушка Себозола', sperm: 'Сгущёнкомёт', tesla: 'Тесла', gantel: 'Гантелемёт', antidron: 'Антидрон', kamera: 'Камера «60»', kuryatnik: 'Курятник', bukva_n: 'Вышка «Н»',
  zabor: 'Забор', shlagbaum: 'Шлагбаум', grabli: 'Грабли', yama: 'Яма', lezhak: 'Лежачий полицейский', nychka: 'Нычка', sobaka: 'Злая собака',
  larek: 'Ларёк', shaurma: 'Шаурмечная', seyf: 'Сейф', zagon: 'Бараний загон', prorab: 'Прорабская', kachalka: 'Качалка', garazh: 'Гараж', vyshka: 'Вышка связи', generator: 'Генератор',
  sabvufer: 'Сабвуфер', arbuzomet: 'Арбузомёт',
};

/** A wall run through the given cells (cell = 2 units), instanced the way baseView does it. */
function wallRun(api: LineupApi, cells: [number, number][], lv: number, side: 0 | 1, ox: number, oz: number) {
  const kit = wallKit(lv), hh = 0.8 + lv * 0.15, has = (x: number, z: number) => cells.some(c => c[0] === x && c[1] === z);
  const posts = new THREE.InstancedMesh(kit.post, mat.solid(), cells.length), arms = new THREE.InstancedMesh(kit.arm, mat.solid(), cells.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), white = new THREE.Color(1, 1, 1);
  let na = 0;
  cells.forEach(([cx, cz], i) => {
    const p = new THREE.Vector3(ox + cx * 2, 0, oz + cz * 2);
    posts.setMatrixAt(i, m.compose(p, q.identity(), new THREE.Vector3(1, hh + 0.2, 1)));
    posts.setColorAt(i, TEAM[side].main);
    let any = 0;
    const arm = (dx: number, dz: number) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz)); arms.setMatrixAt(na, m.compose(p, q, new THREE.Vector3(1, hh / 0.86, 1))); arms.setColorAt(na++, white); };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (has(cx + dx, cz + dz)) { arm(dx, dz); any++; }
    if (!any) { arm(1, 0); arm(-1, 0); }
  });
  arms.count = na;
  for (const im of [posts, arms]) { im.castShadow = true; im.receiveShadow = true; api.scene.add(im); api.placed.push(im); }
}

export function archView(view: string, q: URLSearchParams, api: LineupApi): LineupCam | null {
  const side = (Number(q.get('side') ?? 0) ? 1 : 0) as 0 | 1;
  const put = (key: string, lv: number, s: 0 | 1, x: number, z: number, label = true, yaw = s === 0 ? Math.PI / 2 : -Math.PI / 2) => {
    const o = baseModel(key, lv, s);
    if (!o) return;
    const head = o.getObjectByName('head');
    if (head) head.rotation.y = yaw; // as baseView leaves a tower that has no target
    api.addObj(o, x, z);
    const info = baseModelInfo(key, lv, s)!;
    if (label) api.labels.push({ text: lv === 1 ? NAME[key] ?? key : `ур. ${lv}`, sub: `${info.tris} тр · h ${info.h.toFixed(1)}`, at: new THREE.Vector3(x, info.h + 0.3, z), side: s });
  };
  if (view === 'base') {
    const fam = q.get('fam');
    let x = 0;
    for (const [f, , keys] of FAMS) {
      if (fam && fam !== f) continue;
      for (const key of keys) { for (let lv = 1; lv <= 3; lv++) put(key, lv, side, x, (2 - lv) * 4.6, true); x += 3.3; }
      x += 1.2;
    }
    return { pitch: Number(q.get('pitch') ?? 0.5), tight: 0.97 };
  }
  if (view === 'base1') {
    const key = q.get('k') ?? 'rogatka';
    for (let lv = 1; lv <= 3; lv++) { put(key, lv, 0, (lv - 2) * 3.4, 2.4); put(key, lv, 1, (lv - 2) * 3.4, -2.6); }
    api.unit(0, side, 5.6, 2.4, -0.4, false);
    return { pitch: Number(q.get('pitch') ?? 0.42), tight: 0.95 };
  }
  if (view === 'basegame') {
    // a mock base: towers in front, economy and support behind, a wall line with a corner, traps outside
    const lay: [string, number, number, number][] = [
      ['prorab', 3, 0, -4], ['larek', 2, -4, -4], ['shaurma', 2, 4, -4], ['seyf', 1, -8, -4], ['zagon', 3, 8, -4], ['kachalka', 2, -12, -4], ['garazh', 2, 12, -4],
      ['rogatka', 1, -10, 0], ['sebozol', 2, -6, 0], ['tesla', 2, -2, 0], ['gantel', 3, 2, 0], ['sperm', 2, 6, 0], ['antidron', 2, 10, 0], ['kamera', 1, 14, 0], ['bukva_n', 3, -14, 0],
      ['kuryatnik', 2, -14, -4], ['vyshka', 2, 16, -4], ['generator', 2, -4, -8], ['sabvufer', 2, 4, -8], ['arbuzomet', 3, 0, -8], ['rogatka', 3, 8, -8], ['kamera', 3, -8, -8],
      ['grabli', 1, -8, 6], ['yama', 2, -4, 6], ['lezhak', 1, 0, 6], ['nychka', 2, 4, 6], ['sobaka', 2, 8, 6], ['shlagbaum', 2, 12, 4],
    ];
    for (const [key, lv, x, z] of lay) put(key, lv, side, x, z, false);
    const run: [number, number][] = [];
    for (let i = -8; i <= 4; i++) run.push([i, 2]);
    wallRun(api, run.slice(0, 5), 1, side, 0, 0); wallRun(api, run.slice(5, 9), 2, side, 0, 0); wallRun(api, run.slice(9), 3, side, 0, 0);
    wallRun(api, [[8, 2], [8, 1], [8, 0], [9, 2]], 2, side, 0, 0);
    for (const [t, x, z] of [[0, -3, 3], [1, -1, 3.4], [6, 1.5, 3], [17, 3.4, 3.6], [16, 6, 8.4], [0, -11, 3]] as const) api.unit(t, side, x, z, 0.5, false);
    for (const [t, x, z] of [[0, -6, 8], [1, 2, 8.6], [2, 10, 8]] as const) api.unit(t, (1 - side) as 0 | 1, x, z, 3, false);
    return { gameCam: { x: Number(q.get('x') ?? 0), z: Number(q.get('z') ?? 0), dist: Number(q.get('dist') ?? 38) } };
  }
  if (view === 'basewall') {
    for (let lv = 1; lv <= 3; lv++) for (const s of [0, 1] as const) {
      const cells: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [5, 0]];
      wallRun(api, cells, lv, s, (lv - 2) * 14, s ? -8 : 0);
      api.labels.push({ text: ['профнастил', 'кирпич', 'бетон'][lv - 1], sub: `ур. ${lv}`, at: new THREE.Vector3((lv - 2) * 14 + 3, 1.8, s ? -8 : 0), side: s });
    }
    api.unit(0, 0, -4, 2.4, 0.4, false);
    return { pitch: Number(q.get('pitch') ?? 0.5), tight: 0.97 };
  }
  return null;
}
/** Nav links of this module. */
export const ARCH_NAV: [string, string][] = [['base', 'база: все'], ['base&side=1', 'база: Курчалой'], ['base1&k=rogatka', 'база крупно'], ['basegame', 'база в игре'], ['basewall', 'заборы']];
export const ARCH_KEYS = BASE_KEYS;
