// Toon water for the Аргун and the ponds: one flat blue, lighter glints drifting over it and a white foam
// line along the banks. No specular highlight, no outline. Drawn on the water faces of the TIN
// (terrainMesh.ts waterMesh); the foam needs to know where the bank is, which toonWaterShore() bakes into
// a vertex attribute.
import * as THREE from 'three';
import { LC } from '../../world/terrain';
import type { Tin } from '../lowpoly';
import { TOON_HEX } from './palette';

/**
 * `shore` per vertex of the water geometry (same face order as terrainMesh.ts faceGeometry): 1 on a
 * vertex shared with land, 0 in open water. Faces that touch land with all three corners (narrow streams)
 * get a flat 0.4 so they do not turn into solid foam.
 */
function shoreAttribute(tin: Tin): THREE.BufferAttribute {
  const land = new Uint8Array(tin.np);
  const T = tin.tri;
  let n = 0;
  for (let f = 0; f < tin.nt; f++) {
    if (tin.cls[f] === LC.WATER) { n++; continue; }
    land[T[f * 3]] = 1; land[T[f * 3 + 1]] = 1; land[T[f * 3 + 2]] = 1;
  }
  const out = new Float32Array(n * 3);
  let o = 0;
  for (let f = 0; f < tin.nt; f++) {
    if (tin.cls[f] !== LC.WATER) continue;
    const a = land[T[f * 3]], b = land[T[f * 3 + 1]], c = land[T[f * 3 + 2]];
    if (a && b && c) { out[o] = out[o + 1] = out[o + 2] = 0.4; } else { out[o] = a; out[o + 1] = b; out[o + 2] = c; }
    o += 3;
  }
  return new THREE.BufferAttribute(out, 1);
}

/** Add the `shore` attribute to the water geometry built from `tin`. */
export function toonWaterShore(geo: THREE.BufferGeometry, tin: Tin): THREE.BufferGeometry {
  const a = shoreAttribute(tin);
  if (a.count === geo.getAttribute('position').count) geo.setAttribute('shore', a);
  return geo;
}

/** The water material (vertex colours carry the water tones of the land palette). */
export function toonWater(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.defines = { STYLE_NATIVE: '', STYLE_GROUND: '' };
  const glint = new THREE.Color(TOON_HEX.water[1]).lerp(new THREE.Color('#ffffff'), 0.45), foam = new THREE.Color(TOON_HEX.foam);
  const v3 = (c: THREE.Color) => `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shore;\nvarying float vShore;\nvarying vec2 vWxz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShore = shore;\nvWxz = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShore;\nvarying vec2 vWxz;')
      // the banks slope: light the whole river as one flat sheet
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
	{
		float t = toonA.x;
		vec2 p = vWxz * vec2( 2.3, 2.0 );
		float a = sin( p.x * 1.3 + p.y * 0.7 + t * 1.1 ) + sin( p.x * 0.6 - p.y * 1.5 - t * 0.8 ) + 0.6 * sin( p.x * 2.9 + p.y * 2.3 + t * 1.7 );
		diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(glint)}, smoothstep( 1.9, 1.98, a ) * 0.75 );
		float edge = 0.74 + 0.07 * sin( t * 1.6 + vWxz.x * 2.3 + vWxz.y * 1.9 );
		diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(foam)}, smoothstep( edge, edge + 0.04, vShore ) );
	}`);
  };
  m.customProgramCacheKey = () => 'toon-water';
  return m;
}
