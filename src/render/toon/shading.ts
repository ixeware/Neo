// The toon look for every lit material in the game, applied once by patching three's shader chunks
// (only when the toon style is chosen: classic never calls patchShaders(), so its programs are the stock ones).
//
// What every MeshLambertMaterial / MeshPhongMaterial gets:
//   · a stepped light ramp (shade / half / lit) instead of the smooth N·L;
//   · drifting cloud shadows on the sun term (world-space, no geometry);
//   · a colour remap that pushes the old muted vertex colours into the new palette (saturated colours get
//     purer and brighter, neutrals and darks stay) — skipped by materials marked `native()`;
//   · the toon output curve through three's CustomToneMapping hook.
// And every opaque material (unlit ones too) writes the outline mask into alpha while the main stage draws
// (TOON_U.a[3] = 1): 0 = «ink allowed here», 1 = «no ink» for materials marked `ground()`. Transparent
// effects blend alpha up, so the outline pass (post.ts) fades the ink under smoke, rings and sprites.
// Flags are plain `material.defines` (STYLE_NATIVE, STYLE_GROUND), set by style.ts.
import * as THREE from 'three';

/**
 * Uniforms shared by every patched material. The arrays are handed to three by reference (it does not
 * clone typed arrays), so writing into them once a frame updates all programs.
 * a = [time s, cloud shadow strength 0..1, cloud scale, mask pass 0 | 1]; cam = camera matrixWorld (view → world).
 */
export const TOON_U = { a: new Float32Array([0, 0, 0.07, 0]), cam: new Float32Array(16) };
TOON_U.cam[0] = TOON_U.cam[5] = TOON_U.cam[10] = TOON_U.cam[15] = 1;

/** Ramp thresholds (N·L): below LO shade, up to HI half, above lit; W is the soft edge. */
export const RAMP = { lo: 0.1, hi: 0.52, w: 0.03 };
/** Remap: saturation curve exponent, value lift exponent, and the dark range that is left alone. */
const REMAP = { sat: 1.5, lift: 0.7, dark0: 0.22, dark1: 0.5 };

const f = (n: number) => n.toFixed(4);

const COMMON = /* glsl */`
// ---- toon style (src/render/toon/shading.ts) ----
uniform vec4 toonA;
vec3 toonRemap( vec3 c ) {
	vec3 g = sqrt( max( c, vec3( 0.0 ) ) );
	float mx = max( g.r, max( g.g, g.b ) );
	float mn = min( g.r, min( g.g, g.b ) );
	float s = ( mx - mn ) / max( mx, 1e-4 );
	float s2 = 1.0 - pow( 1.0 - s, ${f(REMAP.sat)} );
	g = mx - ( mx - g ) * ( s2 / max( s, 1e-4 ) );
	g *= mix( mx, pow( mx, ${f(REMAP.lift)} ), s2 * smoothstep( ${f(REMAP.dark0)}, ${f(REMAP.dark1)}, mx ) ) / max( mx, 1e-4 );
	return g * g;
}
`;

const LIGHT_PARS = /* glsl */`
uniform mat4 toonCam;
float toonRamp( float d ) {
	return 0.5 * smoothstep( ${f(RAMP.lo - RAMP.w)}, ${f(RAMP.lo + RAMP.w)}, d ) + 0.5 * smoothstep( ${f(RAMP.hi - RAMP.w)}, ${f(RAMP.hi + RAMP.w)}, d );
}
float toonCloud( vec3 viewPos ) {
	if ( toonA.y <= 0.0 ) return 1.0;
	vec2 w = ( toonCam * vec4( viewPos, 1.0 ) ).xz * toonA.z + toonA.x * vec2( 0.021, -0.012 );
	float n = sin( w.x * 1.7 + sin( w.y * 1.3 ) * 1.8 ) + sin( w.y * 2.1 + sin( w.x * 0.9 + 1.7 ) * 1.6 ) + sin( ( w.x + w.y ) * 1.1 + 2.3 );
	return 1.0 - toonA.y * smoothstep( 1.05, 1.45, n );
}
`;

let patched = false;

/** Patch three's shader chunks for the toon style. Call before the first material compiles. */
export function patchShaders() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  const swap = (chunk: string, from: string, to: string) => {
    if (!C[chunk].includes(from)) throw new Error('toon style: three.js chunk changed: ' + chunk);
    C[chunk] = C[chunk].replace(from, to);
  };
  C.common += COMMON;
  for (const chunk of ['lights_lambert_pars_fragment', 'lights_phong_pars_fragment']) {
    swap(chunk, 'vec3 irradiance = dotNL * directLight.color;', 'vec3 irradiance = toonRamp( dotNL ) * toonCloud( geometryPosition ) * directLight.color;');
    C[chunk] = LIGHT_PARS + C[chunk];
  }
  C.color_fragment += /* glsl */`
#if ( defined( LAMBERT ) || defined( PHONG ) ) && ! defined( STYLE_NATIVE )
	diffuseColor.rgb = toonRemap( diffuseColor.rgb );
#endif
`;
  C.opaque_fragment += /* glsl */`
#ifdef OPAQUE
	#ifdef STYLE_GROUND
	gl_FragColor.a = mix( gl_FragColor.a, 1.0, toonA.w );
	#else
	gl_FragColor.a = mix( gl_FragColor.a, 0.0, toonA.w );
	#endif
	#ifdef NEAR_FADE
	// first person: what fpcam.ts dithers away next to the camera gets no ink, or the dither turns to soot
	gl_FragColor.a = mix( gl_FragColor.a, 1.0, toonA.w * step( distance( vNfW, uNfPos ), uNfR ) );
	#endif
#endif
`;
  // what you author is what you see: no filmic curve, only a soft shoulder for the brightest values
  swap('tonemapping_pars_fragment', 'vec3 CustomToneMapping( vec3 color ) { return color; }', /* glsl */`vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	vec3 over = max( color - 0.78, vec3( 0.0 ) );
	return color - over + over / ( 1.0 + over * 1.5 );
}`);
  // the shared uniforms for every built-in material (the chunks above are included by all of them)
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, THREE.IUniform> }[]) {
    lib.uniforms.toonA = { value: TOON_U.a };
    lib.uniforms.toonCam = { value: TOON_U.cam };
  }
}

/** The same remap as the shader's toonRemap(), for colours handled in JS (linear working space in and out). */
export function remapColor(c: THREE.Color, out = c): THREE.Color {
  let r = Math.sqrt(Math.max(0, c.r)), g = Math.sqrt(Math.max(0, c.g)), b = Math.sqrt(Math.max(0, c.b));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = (mx - mn) / Math.max(mx, 1e-4), s2 = 1 - Math.pow(1 - s, REMAP.sat), k = s2 / Math.max(s, 1e-4);
  r = mx - (mx - r) * k; g = mx - (mx - g) * k; b = mx - (mx - b) * k;
  const e = Math.max(0, Math.min(1, (mx - REMAP.dark0) / (REMAP.dark1 - REMAP.dark0))), lift = s2 * e * e * (3 - 2 * e);
  const v = (mx + (Math.pow(mx, REMAP.lift) - mx) * lift) / Math.max(mx, 1e-4);
  r *= v; g *= v; b *= v;
  return out.setRGB(r * r, g * g, b * b);
}
