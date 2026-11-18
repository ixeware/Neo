// Small things of the new style that mark places on the map (placeMarks.ts uses them behind TOON).
import * as THREE from 'three';
import { C } from '../../style';
import { Kit } from '../kit';

let pole: THREE.BufferGeometry | null = null;
/** The flagpole of a capture place: a stepped stone foot, a chunky white mast with gold rings and a gold ball. Stands on y = 0, 3.3 tall. */
export function toonFlagPole(): THREE.BufferGeometry {
  if (pole) return pole;
  const k = new Kit();
  k.bev(C.concrete, 0, -0.03, 0, 0.8, 0.34, 0.8, 0.2);
  k.bev(C.trim, 0, 0.2, 0, 0.5, 0.14, 0.5, 0.2);
  k.cyl(C.gold, 0, 0.32, 0, 0.26, 0.1, 6);
  k.box(C.trim, 0, 1.75, 0, 0.11, 2.9, 0.11);
  k.cyl(C.gold, 0, 2.28, 0, 0.2, 0.07, 6);
  k.ball(C.gold, 0, 3.26, 0, 0.26);
  k.dropBottoms(0.2);
  return (pole = k.build());
}
