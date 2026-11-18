// Road surfaces of the toon style, drawn in the shader on the existing ribbons (uv.x runs along the road in
// dash periods, uv.y across it): asphalt with a kerb strip and a dashed centre line, village streets with a
// light kerb, field tracks with a grass strip between the wheel ruts. No texture, no extra triangles.
import * as THREE from 'three';
import { C, ground, native } from '../../style';

const v3 = (c: THREE.Color) => `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;

export type RoadKind = 'main' | 'street' | 'track';

export function toonRoadMaterial(kind: RoadKind, offset: number): THREE.MeshLambertMaterial {
  const m = ground(native(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })));
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -offset;
  const trim = C.trim, grass = C.grass[1];
  const body = kind === 'main' ? /* glsl */`
		vec3 rc = ${v3(C.asphalt)};
		float dash = ( 1.0 - smoothstep( 0.085, 0.085 + fv * 2.0, e ) ) * step( fract( vRuv.x ), 0.55 );
		rc = mix( rc, ${v3(C.roadLine)}, dash * lod );
		rc = mix( rc, ${v3(trim)}, smoothstep( 0.8 - fv * 2.0, 0.8, e ) * mix( 0.45, 1.0, lod ) );`
    : kind === 'street' ? /* glsl */`
		vec3 rc = ${v3(C.street)};
		rc = mix( rc, ${v3(trim)}, smoothstep( 0.78 - fv, 0.78, e ) * 0.5 * lod );`
      : /* glsl */`
		vec3 rc = ${v3(C.track)};
		rc = mix( rc, ${v3(grass)}, ( 1.0 - smoothstep( 0.3, 0.3 + fv * 2.0, e ) ) * 0.7 * lod );
		rc = mix( rc, ${v3(C.earth[1])}, smoothstep( 0.84 - fv * 2.0, 0.84, e ) * 0.8 );`;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRuv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRuv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRuv;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
	{
		float e = abs( vRuv.y - 0.5 ) * 2.0, fv = fwidth( vRuv.y ) * 2.0;
		float lod = 1.0 - smoothstep( 0.3, 0.7, fv ); // the fine lines go when the road is a few pixels wide
		${body}
		diffuseColor.rgb = rc;
	}`);
  };
  m.customProgramCacheKey = () => 'toon-road-' + kind;
  return m;
}
