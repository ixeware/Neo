// The land material of the toon style: the TIN's flat face colours plus what makes the ground look worked —
// the ground paint (mask.ts: plazas, paths and yards with a rim line, earth and gravel, garden lawns,
// vegetable plots), furrow rows on the fields and a dirt strip along every parcel border. All of it is drawn
// in the fragment shader under the stepped toon light, so it costs no triangles and no draw calls.
import * as THREE from 'three';
import { ground, native } from '../../style';
import { MASK_RANGE, type GroundMask } from './mask';
import { GC } from './colors';

const v3 = (hex: string) => { const c = new THREE.Color(hex); return `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`; };

/** Needs the `fld` attribute (vec4 per vertex: tin.fld.xyz of the face + tin.edge of the corner). */
export function toonLandMaterial(mask: GroundMask): THREE.MeshLambertMaterial {
  const m = ground(native(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  const uni = { gMask: { value: mask.texture }, gMaskT: { value: new THREE.Vector4(...mask.transform) } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 fld;\nvarying vec4 vFld;\nvarying vec2 vWxz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFld = fld;\nvWxz = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D gMask;\nuniform vec4 gMaskT;\nvarying vec4 vFld;\nvarying vec2 vWxz;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
	{
		vec3 base = diffuseColor.rgb;
		float px = max( length( fwidth( vWxz ) ) * 0.7071, 1e-4 ); // world units per pixel
		vec4 sd = ( texture2D( gMask, vWxz * gMaskT.xy + gMaskT.zw ) * 255.0 - 128.0 ) * ${(MASK_RANGE / 127).toFixed(6)};
		// village ground: a lawn; the yards and streets are painted over it below
		if ( vFld.z < -0.5 ) {
			vec2 q = floor( vWxz / 7.0 );
			base = mix( ${v3(GC.lawn[0])}, ${v3(GC.lawn[1])}, step( 0.5, fract( sin( dot( q, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) ) );
		}
		// fields: furrow rows, then a dirt strip along the parcel border
		if ( vFld.z > 0.0 ) {
			float u = dot( vWxz, vFld.xy ), fw = fwidth( u );
			float st = smoothstep( 0.5 - fw, 0.5 + fw, abs( fract( u ) - 0.5 ) * 2.0 );
			st = mix( st, 0.5, smoothstep( 0.3, 0.7, fw ) );
			base *= 1.0 + vFld.z * ( 1.0 - 2.0 * st );
			float bw = ${GC.borderW.toFixed(3)};
			float b = ( 1.0 - smoothstep( bw - px, bw + px, abs( vFld.w ) ) ) * min( 1.0, 2.5 * bw / px );
			base = mix( base, ${v3(GC.border)}, b * 0.85 );
		}
		// garden lawns behind the houses
		base = mix( base, ${v3(GC.garden)}, 1.0 - smoothstep( -px, px, sd.b ) );
		// vegetable plots: dark soil with green rows
		float plot = 1.0 - smoothstep( -px, px, sd.a );
		if ( plot > 0.0 ) {
			float u = dot( vWxz, vec2( 0.8, 0.6 ) ) / 0.17, fw = fwidth( u );
			float st = mix( smoothstep( 0.5 - fw, 0.5 + fw, abs( fract( u ) - 0.5 ) * 2.0 ), 0.5, smoothstep( 0.3, 0.7, fw ) );
			base = mix( base, mix( ${v3(GC.soil)}, ${v3(GC.plotGreen)}, st ), plot );
		}
		// bare earth, river gravel
		base = mix( base, ${v3(GC.gravel)}, 1.0 - smoothstep( -px, px, sd.g ) );
		// plazas, paths and yards: light beige with a darker rim just inside the edge
		float pave = 1.0 - smoothstep( -px, px, sd.r );
		float rw = ${GC.rimW.toFixed(3)};
		float rim = ( 1.0 - smoothstep( rw - px, rw + px, abs( sd.r + rw ) ) ) * min( 1.0, 1.6 * rw / px );
		base = mix( base, mix( ${v3(GC.pave)}, ${v3(GC.rim)}, rim ), pave );
		diffuseColor.rgb = base;
	}`);
  };
  m.customProgramCacheKey = () => 'toon-land';
  return m;
}
