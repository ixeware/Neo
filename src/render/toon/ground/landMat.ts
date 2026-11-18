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
export function toonLandMaterial(mask: GroundMask, hq: THREE.Vector4[]): THREE.MeshLambertMaterial {
  const m = ground(native(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  // gHq: the two high-rise plazas (x, z, radius, rotation)
  const uni = { gMask: { value: mask.texture }, gMaskT: { value: new THREE.Vector4(...mask.transform) }, gHq: { value: hq } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 fld;\nvarying vec4 vFld;\nvarying vec2 vWxz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFld = fld;\nvWxz = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D gMask;\nuniform vec4 gMaskT;\nuniform vec4 gHq[ 2 ];\nvarying vec4 vFld;\nvarying vec2 vWxz;\nfloat gHash( vec2 q ) { return fract( sin( dot( q, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }')
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
		// garden lawns behind the houses, with flowers (dots that go when they would be under a pixel)
		float lawn = 1.0 - smoothstep( -px, px, sd.b );
		if ( lawn > 0.0 ) {
			vec3 gc = ${v3(GC.garden)};
			vec2 fq = vWxz / 0.19, fi = floor( fq );
			float fh = gHash( fi );
			vec2 fo = fq - fi - 0.5 - ( vec2( fh, fract( fh * 7.13 ) ) - 0.5 ) * 0.5;
			float dot_ = ( 1.0 - smoothstep( 0.2, 0.2 + px / 0.19, length( fo ) ) ) * step( 0.62, fh ) * ( 1.0 - smoothstep( 0.035, 0.07, px ) ) * step( 0.1, -sd.b );
			vec3 fc = fh > 0.9 ? ${v3(GC.flower[0])} : fh > 0.8 ? ${v3(GC.flower[1])} : fh > 0.7 ? ${v3(GC.flower[3])} : ${v3(GC.flower[2])};
			base = mix( base, mix( gc, fc, dot_ ), lawn );
		}
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
		// the high-rise plazas: a sunburst of two paving tones in rings, a white kerb, a dark rim
		for ( int i = 0; i < 2; i ++ ) {
			vec2 hd = vWxz - gHq[ i ].xy;
			float hr = length( hd ), R = gHq[ i ].z;
			if ( hr < R + 0.4 && R > 0.0 ) {
				float a = atan( hd.x, hd.y ) - gHq[ i ].w;
				float sec = a / 0.3926991, band = hr / 1.45;
				float aw = px / max( hr * 0.3927, 1e-3 ), bw = px / 1.45;
				float sa = smoothstep( 0.5 - aw, 0.5 + aw, abs( fract( sec * 0.5 ) - 0.5 ) * 2.0 );
				float sb = smoothstep( 0.5 - bw, 0.5 + bw, abs( fract( band * 0.5 ) - 0.5 ) * 2.0 );
				float chk = abs( sa - sb );
				chk = mix( chk, 0.5, smoothstep( 0.25, 0.6, max( aw, bw ) ) );
				vec3 pc = mix( ${v3(GC.plaza[0])}, ${v3(GC.plaza[1])}, chk );
				pc = mix( pc, ${v3(GC.kerb)}, smoothstep( R - 0.3 - px, R - 0.3 + px, hr ) );
				pc = mix( pc, ${v3(GC.rim)}, smoothstep( R - 0.07 - px, R - 0.07 + px, hr ) );
				base = mix( base, pc, 1.0 - smoothstep( R - px, R + px, hr ) );
			}
		}
		diffuseColor.rgb = base;
	}`);
  };
  m.customProgramCacheKey = () => 'toon-land';
  return m;
}
