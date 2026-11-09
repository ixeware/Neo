import * as THREE from 'three';
import { flakeNormal, grainNormal, treadNormal, carpetNormal, leatherNormal, seatInsertNormal } from '../util/textures.js';

// Material library keyed by slot name. Body parts carry slot keys, so swapping a paint or a trim colour
// is a property change on one shared material.
export function createMaterials() {
  const flake = flakeNormal();
  const grain = grainNormal(256, 30, 5, 1.4);
  const M = {};
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const std = (o) => new THREE.MeshStandardMaterial(o);

  M.paint = phys({ color: 0x5e636a, metalness: 0.65, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, normalMap: flake, normalScale: new THREE.Vector2(0.1, 0.1), envMapIntensity: 1.8 });
  M.paint_roof = M.paint; // two-tone option swaps this slot (see VehicleModel.setTwoTone)
  M.trim_black = std({ color: 0x141517, roughness: 0.78, metalness: 0.0, normalMap: grain, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.black_gloss = phys({ color: 0x040405, roughness: 0.1, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2, side: THREE.DoubleSide });
  M.liner = std({ color: 0x09090a, roughness: 0.95, side: THREE.DoubleSide });
  M.interior = std({ color: 0x232428, roughness: 0.85, normalMap: carpetNormal(), normalScale: new THREE.Vector2(0.8, 0.8) });
  M.engine = std({ color: 0x17181b, roughness: 0.7, metalness: 0.2 });
  M.jamb = std({ color: 0x1b1c20, roughness: 0.55, metalness: 0.2 });
  M.headliner = std({ color: 0x45474c, roughness: 0.96 });

  const glass = (color, opacity) => phys({ color, metalness: 0, roughness: 0.03, transparent: true, opacity, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
  M.glass_windshield = glass(0x1a2228, 0.28);
  M.glass_side = glass(0x0a0e12, 0.52);
  M.glass_rear = glass(0x06080a, 0.72);
  M.glass_sunroof = glass(0x050608, 0.78);
  M.mirror_glass = std({ color: 0xc8d0d8, metalness: 1, roughness: 0.02 });

  M.chrome = std({ color: 0xf2f4f7, metalness: 1, roughness: 0.06, envMapIntensity: 1.4 });
  M.satin = std({ color: 0xb6bbc2, metalness: 1, roughness: 0.34 });
  M.grille_dot = phys({ color: 0x060607, metalness: 0.4, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
  M.grille_dot_edge = std({ color: 0xc9ced6, metalness: 1, roughness: 0.22 });
  M.mesh_dark = std({ color: 0x0b0b0c, roughness: 0.6, metalness: 0.3 });

  // Lights (emissive intensity driven by Lights.js)
  M.lens = phys({ color: 0xffffff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.18, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false });
  M.lens_red = phys({ color: 0x8a0710, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.82, clearcoat: 1, envMapIntensity: 1.2 });
  M.housing = phys({ color: 0x0a0b0d, metalness: 0.6, roughness: 0.25, clearcoat: 0.6 });
  M.reflector = std({ color: 0xe8ebf0, metalness: 1, roughness: 0.12 });
  M.led_drl = std({ color: 0x111111, emissive: 0xf4f7ff, emissiveIntensity: 0 });
  M.led_beam = std({ color: 0x15171a, emissive: 0xfff6e6, emissiveIntensity: 0 });
  M.led_amber = std({ color: 0x1a1206, emissive: 0xff8a12, emissiveIntensity: 0 });
  M.led_tail = std({ color: 0x2a0306, emissive: 0xff1424, emissiveIntensity: 0 });
  M.led_brake = std({ color: 0x2a0306, emissive: 0xff1020, emissiveIntensity: 0 });
  M.led_reverse = std({ color: 0x1a1a1a, emissive: 0xffffff, emissiveIntensity: 0 });
  M.led_fog = std({ color: 0x2a0306, emissive: 0xff1020, emissiveIntensity: 0 });
  M.reflector_red = phys({ color: 0x5a0208, roughness: 0.2, clearcoat: 1 });

  // Wheels
  M.rubber = std({ color: 0x141416, roughness: 0.92, normalMap: treadNormal(), normalScale: new THREE.Vector2(1.2, 1.2) });
  M.sidewall = std({ color: 0x18181a, roughness: 0.88, side: THREE.DoubleSide });
  M.rim_face = phys({ color: 0xd9dde2, metalness: 1, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, anisotropy: 0.6 });
  M.rim_dark = phys({ color: 0x2b2e33, metalness: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
  M.brake_disc = std({ color: 0x7c7f84, metalness: 1, roughness: 0.48, side: THREE.DoubleSide });
  M.brake_hat = std({ color: 0x3d3f43, metalness: 0.9, roughness: 0.55, side: THREE.DoubleSide });
  M.caliper = phys({ color: 0x2c2f35, metalness: 0.5, roughness: 0.35, clearcoat: 0.6 });

  // Interior
  M.plastic_soft = std({ color: 0x26272b, roughness: 0.72, normalMap: grain, normalScale: new THREE.Vector2(0.4, 0.4) });
  M.plastic_light = std({ color: 0x5b5e64, roughness: 0.7, normalMap: grain, normalScale: new THREE.Vector2(0.4, 0.4) });
  M.piano = phys({ color: 0x050506, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
  M.leather = phys({ color: 0x1e1f22, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0x404040), normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
  M.leather_light = phys({ color: 0x6d6a66, roughness: 0.58, sheen: 0.4, sheenColor: new THREE.Color(0x707070), normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.5, 0.5) });
  M.fabric = phys({ color: 0x2c2e33, roughness: 0.92, sheen: 0.8, sheenColor: new THREE.Color(0x5a5e66), normalMap: seatInsertNormal(), normalScale: new THREE.Vector2(0.6, 0.6) });
  M.stitch = std({ color: 0x8a8f99, roughness: 0.8 });
  M.ambient = std({ color: 0x111111, emissive: 0x4fb6ff, emissiveIntensity: 1.6 });
  M.screen_black = phys({ color: 0x020203, roughness: 0.05, clearcoat: 1 });
  M.metal_dark = std({ color: 0x2a2c30, metalness: 0.8, roughness: 0.5 });
  M.spring = std({ color: 0x3a6fb0, metalness: 0.6, roughness: 0.4 });

  // Pillars and trims are single surfaces: seen from the cabin (back faces) they should read as matte trim, not mirror
  M.black_gloss.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n if (!gl_FrontFacing) { reflectedLight.indirectSpecular *= 0.08; reflectedLight.directSpecular *= 0.1; }');
  };
  M.black_gloss.customProgramCacheKey = () => 'black_gloss_backface_matte';
  for (const [k, m] of Object.entries(M)) if (!m.name) m.name = k;
  return M;
}

export function applyPaint(M, paint) {
  M.paint.color.set(paint.color);
  M.paint.metalness = paint.metalness;
  M.paint.roughness = paint.roughness;
  M.paint.normalScale.set(paint.flake, paint.flake);
  M.paint.iridescence = paint.iridescence || 0;
  M.paint.iridescenceIOR = 1.6;
  M.paint.iridescenceThicknessRange = [200, 600];
  M.paint.needsUpdate = true;
}
