// Toon frame: the scene goes to an off-screen target, then one full-screen triangle draws it to the
// canvas with ink outlines and the sky.
//
// Outlines come from the depth buffer alone: the Laplacian of the raw (non-linear) depth is zero on any
// flat surface at any angle and non-zero at silhouettes and at creases between faces — so one colour
// target and its depth texture are enough (no normal pass, no second draw of the scene). The alpha channel
// of the colour target is the «no ink» mask (shading.ts): opaque materials write 0, the ones marked
// ground() write 1 (terrain, roads, water), and transparent effects blend it up, so smoke, rings and
// sprites hide the ink of what is behind them.
//
// Modes: 'full' (4 depth + 4 mask neighbours), 'lite' (4 depth neighbours, mask from the centre: thinner
// line, 6 fetches) and 'off' (straight to the canvas: no extra pass at all). A slow device steps down by
// itself; `?ol=full|lite|off` pins a mode.
import * as THREE from 'three';
import { TOON_HEX } from './palette';
import { TOON_U } from './shading';

export type OutlineMode = 'full' | 'lite' | 'off';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec4 uPx;      // x, y: outline sample offset in uv; z: pixel angle (radians per pixel); w: time
uniform vec4 uCam;     // near, far, strength, unused
uniform vec4 uFade;    // view depth of full ink, falloff exponent, weakest factor, threshold scale
uniform vec3 uInk;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uCloud; uniform vec3 uCloudShade;
uniform mat4 uInvProj; uniform mat4 uCamWorld;
varying vec2 vUv;

float cloudField( vec2 p ) {
	return sin( p.x * 1.7 + sin( p.y * 1.3 ) * 1.8 ) + sin( p.y * 2.1 + sin( p.x * 0.9 + 1.7 ) * 1.6 ) + sin( ( p.x + p.y ) * 1.1 + 2.3 );
}

vec3 sky() {
	vec4 v = uInvProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
	vec3 dir = normalize( ( uCamWorld * vec4( v.xyz / v.w, 0.0 ) ).xyz );
	// the map floats in the sky: the same blue above and below, a pale band at the horizon
	float h = abs( dir.y );
	vec3 col = mix( uHorizon, uZenith, smoothstep( 0.0, 0.42, h ) );
	if ( dir.y > 0.015 ) {
		vec3 cam = uCamWorld[ 3 ].xyz;
		float t = ( 420.0 - cam.y ) / dir.y;
		vec2 p = ( cam.xz + dir.xz * t ) * 0.0042 + uPx.w * vec2( 0.006, -0.0035 );
		float n = cloudField( p );
		float body = smoothstep( 1.25, 1.33, n );
		float lit = smoothstep( 1.18, 1.3, cloudField( p + vec2( 0.05, -0.035 ) ) );
		vec3 c = mix( uCloudShade, uCloud, lit );
		col = mix( col, c, body * smoothstep( 0.015, 0.1, dir.y ) );
	}
	return col;
}

void main() {
	vec4 c = texture2D( tColor, vUv );
	float d = texture2D( tDepth, vUv ).x;
	if ( d >= 0.9999995 ) { gl_FragColor = vec4( sky(), 1.0 ); return; }
	vec2 ox = vec2( uPx.x, 0.0 ), oy = vec2( 0.0, uPx.y );
	float dl = texture2D( tDepth, vUv - ox ).x, dr = texture2D( tDepth, vUv + ox ).x;
	float dd = texture2D( tDepth, vUv - oy ).x, du = texture2D( tDepth, vUv + oy ).x;
	float lap = abs( dl + dr - 2.0 * d ) + abs( dd + du - 2.0 * d );
	float near = uCam.x, far = uCam.y;
	float dn = min( d, min( min( dl, dr ), min( dd, du ) ) );
	float z = near * far / ( far - dn * ( far - near ) );
	// depth step (or change of slope) in units of one pixel's footprint at that distance
	float k = lap * z * ( far - near ) / ( near * far * uPx.z );
	float edge = smoothstep( 0.55 * uFade.w, 1.25 * uFade.w, k );
	// alpha: 0 on outlined objects, 1 on the ground and under opaque effects; MSAA leaves fractions at edges
#ifdef LITE
	float mask = clamp( 2.2 * ( 1.0 - c.a ), 0.0, 1.0 );
#else
	float mask = clamp( 2.2 * ( 1.0 - min( c.a, min( min( texture2D( tColor, vUv - ox ).a, texture2D( tColor, vUv + ox ).a ), min( texture2D( tColor, vUv - oy ).a, texture2D( tColor, vUv + oy ).a ) ) ) ), 0.0, 1.0 );
#endif
	// a line cannot get thinner than a pixel, so far away it gets lighter instead (villages must not turn to soot)
	float fade = clamp( pow( uFade.x / z, uFade.y ), uFade.z, 1.0 );
	gl_FragColor = vec4( mix( c.rgb, uInk, edge * mask * fade * uCam.z ), 1.0 );
}
`;

/** A palette colour as display (sRGB-encoded) numbers: the composite writes straight to the canvas. */
const srgb = (hex: string) => { const o = { r: 0, g: 0, b: 0 }; new THREE.Color(hex).getRGB(o, THREE.SRGBColorSpace); return new THREE.Vector3(o.r, o.g, o.b); };

export class ToonPipeline {
  mode: OutlineMode;
  /** Ink strength 0..1 (the menu and tools can dim it). */
  strength = 0.92;
  private rt: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private pinned: boolean;
  private bg = new THREE.Color(TOON_HEX.skyHorizon);
  // frame-time governor
  private last = 0; private acc = 0; private n = 0; private warm = 0;

  constructor(private renderer: THREE.WebGLRenderer, private samples: number, lowPower: boolean, pin = false) {
    let q: string | null = null;
    try { q = new URLSearchParams(location.search).get('ol'); } catch { /* no location */ }
    const asked = q === 'full' || q === 'lite' || q === 'off';
    this.pinned = asked || pin;
    this.mode = asked ? (q as OutlineMode) : lowPower ? 'lite' : 'full';
    if (!this.pinned) try { const s = sessionStorage.getItem('vysotka.ol'); if (s === 'lite' && this.mode === 'full') this.mode = 'lite'; else if (s === 'off') this.mode = 'off'; } catch { /* blocked storage */ }
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uPx: { value: new THREE.Vector4() }, uCam: { value: new THREE.Vector4() }, uFade: { value: new THREE.Vector4(44, 1.15, 0.12, 1) },
        uInk: { value: srgb(TOON_HEX.ink) }, uZenith: { value: srgb(TOON_HEX.skyZenith) }, uHorizon: { value: srgb(TOON_HEX.skyHorizon) },
        uCloud: { value: srgb(TOON_HEX.cloud) }, uCloudShade: { value: srgb(TOON_HEX.cloudShade) },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      },
    });
    this.setDefines();
    // one triangle that covers the screen
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private setDefines() {
    this.mat.defines = this.mode === 'lite' ? { LITE: '' } : {};
    this.mat.needsUpdate = true;
  }

  /** `pin` stops the frame-time governor from changing the mode afterwards. */
  setMode(m: OutlineMode, pin = false) {
    if (pin) this.pinned = true;
    if (m === this.mode) return;
    this.mode = m;
    this.setDefines();
    if (m === 'off') { this.rt?.depthTexture?.dispose(); this.rt?.dispose(); this.rt = null; }
  }

  private target(): THREE.WebGLRenderTarget {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    if (this.rt && (this.rt.width !== w || this.rt.height !== h)) { this.rt.setSize(w, h); }
    if (!this.rt) {
      const depth = new THREE.DepthTexture(w, h);
      depth.type = THREE.UnsignedIntType;
      this.rt = new THREE.WebGLRenderTarget(w, h, { samples: this.samples, depthTexture: depth, depthBuffer: true, stencilBuffer: false });
      this.rt.texture.minFilter = THREE.NearestFilter; this.rt.texture.magFilter = THREE.NearestFilter;
      this.rt.texture.generateMipmaps = false;
      // Same shader output as the canvas (tone curve + sRGB): three treats an XR-flagged target like the
      // screen, so the materials write display-ready colour into plain RGBA8 and the composite is a copy.
      // The internal format is pinned: with MSAA the colour renderbuffer and the resolve texture must match.
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
      this.rt.texture.internalFormat = 'RGBA8';
      (this.rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    }
    return this.rt;
  }

  /** A slow device loses the outline pass step by step (never while a mode is pinned by `?ol=`). */
  private govern() {
    if (this.pinned || this.mode === 'off') return;
    const now = performance.now(), dt = now - this.last;
    this.last = now;
    if (dt <= 0 || dt > 250) return; // first frame, a hidden tab, a catch-up hitch
    if (this.warm < 120) { this.warm++; return; }
    this.acc += dt; this.n++;
    if (this.n < 90) return;
    const avg = this.acc / this.n;
    this.acc = 0; this.n = 0;
    if (avg > 40) {
      this.setMode(this.mode === 'full' ? 'lite' : 'off');
      this.warm = 0;
      try { sessionStorage.setItem('vysotka.ol', this.mode); } catch { /* blocked storage */ }
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) {
    const r = this.renderer;
    this.govern();
    if (this.mode === 'off') {
      scene.background = this.bg;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    scene.background = null;
    const rt = this.target();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    TOON_U.a[3] = 1; // opaque materials write the outline mask into alpha
    r.render(scene, camera);
    TOON_U.a[3] = 0;
    r.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.tColor.value = rt.texture; u.tDepth.value = rt.depthTexture;
    // line width follows the resolution: about 1.3 px on a 900 px tall canvas, never under one pixel
    const px = Math.max(1, (rt.height / 900) * 1.3);
    u.uPx.value.set(px / rt.width, px / rt.height, (2 * Math.tan((camera.fov * Math.PI) / 360)) / rt.height * px, time);
    u.uCam.value.set(camera.near, camera.far, this.strength, 0);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    r.render(this.scene, this.cam);
  }
}
