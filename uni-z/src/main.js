import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createMaterials } from './model/Materials.js';
import { VehicleModel } from './model/VehicleModel.js';
import { Showroom } from './world/Showroom.js';
import { TestTrack, ZONES } from './world/TestTrack.js';
import { VehicleDynamics } from './sim/VehicleDynamics.js';
import { Input } from './sim/Input.js';
import { runSelfTest } from './sim/SelfTest.js';
import { VehicleAudio } from './audio/VehicleAudio.js';
import { HUD } from './ui/HUD.js';
import { QUALITY, QUALITY_ORDER } from './config/quality.js';
import { PAINTS, VERSIONS, DIMS, CHASSIS, TIRES, ICE_VARIANTS, POWERTRAINS, MASS, STEERING } from './config/vehicle.js';
import { LOWER, GREEN, INTERIOR, sToZ } from './config/geometry.js';
import { damp, easeInOutCubic, clamp } from './util/math.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const store = {
  get(k, d) { try { const v = localStorage.getItem('uniz.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('uniz.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const PHYS_DT = 1 / 240;
const CAM_NAMES = { chase: 'погоня', hood: 'капот', driver: 'водитель', wheel: 'колесо', cinema: 'кино', free: 'свободная' };
const SHOW_VIEWS = {
  'Перед 3/4': [[-5.9, 1.75, 7.1], [0.35, 0.72, 0.1]],
  'Зад 3/4': [[6.1, 2.0, -6.8], [-0.35, 0.75, -0.1]],
  'Бок': [[-9.4, 1.05, 0.0], [0, 0.78, 0]],
  'Перед': [[0, 1.05, 8.6], [0, 0.75, 0]],
  'Зад': [[0, 1.2, -8.6], [0, 0.85, 0]],
  'Сверху': [[0.01, 9.5, 0.0], [0, 0, 0]],
  'Колесо': [[-2.4, 0.55, 2.6], [-0.8, 0.38, 1.4]],
  'Решётка': [[-0.9, 0.9, 3.9], [0, 0.6, 2.25]],
  'Фонарь': [[1.1, 1.25, -4.3], [0, 0.95, -2.3]],
  'Салон': [[0.37, 1.24, sToZ(2800)], [0.25, 1.0, sToZ(1500)]],
  'Мотор': [[0, 2.4, 3.6], [0, 0.85, 1.2]],
};

class App {
  constructor() {
    this.mode = 'showroom';
    this.qualityKey = new URLSearchParams(location.search).get('q') || store.get('quality', 'auto');
    this.q = QUALITY[this.qualityKey === 'auto' ? 'medium' : this.qualityKey] || QUALITY.medium;
    this.camMode = 'chase';
    this.night = false;
    this.timeOfDay = 15;
    this.stats = { frames: 0, acc: 0, fps: 60 };
    this.camAnim = null;
    this.driverLook = { yaw: 0, pitch: 0 };
  }

  async init() {
    this.loadSteps = ['Рендер и материалы', 'Кузов: лофт и CSG', 'Детали, оптика, салон', 'Полигон и физика', 'Готово'];
    this.renderLoading(0);
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.q.smaa, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.q.shadows > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false; // count every pass of the composer, reset once per frame
    $('app').prepend(renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 6000);
    this.camera.fov = this.showroomFov(); this.camera.updateProjectionMatrix();
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, minDistance: 2.2, maxDistance: 16, maxPolarAngle: Math.PI * 0.495, autoRotateSpeed: 0.8 });
    this.controls.addEventListener('start', () => { this.camAnim = null; });
    this.M = createMaterials();
    this.showroom = new Showroom(renderer, this.q);
    this.scene.add(this.showroom.group);
    this.applyShowroomEnv();
    await nextFrame();
    this.renderLoading(1);
    await nextFrame();
    this.buildCar();
    this.renderLoading(3);
    await nextFrame();
    this.track = new TestTrack(this.q);
    this.track.group.visible = false;
    this.scene.add(this.track.group);
    this.physics = new VehicleDynamics(this.track, { powertrain: 'ICE', iceVariant: VERSIONS[this.car.config.version].iceVariant, wheelSize: this.car.config.wheels });
    this.input = new Input();
    this.input.on((code) => this.onKey(code));
    this.audio = new VehicleAudio();
    this.hud = new HUD(this.track);
    this.hud.zones = [ZONES.slalom, ZONES.bumps, ZONES.hill, ZONES.gravel, ZONES.snow, ZONES.parking];
    this.buildComposer();
    this.bindUI();
    this.restoreConfig();
    this.setView('Перед 3/4', true);
    // compile every material up front (showroom + track) so switching modes does not stall on shader builds
    this.track.group.visible = true;
    if (this.renderer.extensions.has('KHR_parallel_shader_compile')) await this.renderer.compileAsync(this.scene, this.camera);
    else this.renderer.compile(this.scene, this.camera);
    this.track.group.visible = false;
    this.renderLoading(4);
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.tick(t));
    $('loading').hidden = true;
    window.__UNIZ_READY = true;
    if (new URLSearchParams(location.search).get('selftest') === '1') this.showSelfTest();
  }

  renderLoading(done) {
    $('load-bar').style.width = `${Math.round(((done + 0.5) / this.loadSteps.length) * 100)}%`;
    $('load-steps').innerHTML = this.loadSteps.map((s, i) => `<li class="${i < done ? 'done' : ''}">${s}</li>`).join('');
  }

  buildCar() {
    const t0 = performance.now();
    const prev = this.car?.config;
    this.car = new VehicleModel(this.M);
    if (prev) Object.assign(this.car.config, prev);
    this.car.build({ quality: this.q });
    this.car.root.position.y = this.car.rideOffset;
    this.scene.add(this.car.root);
    this.buildMs = performance.now() - t0;
    this.car.root.traverse((o) => { if (o.isMesh) o.castShadow = o.castShadow !== false; });
  }

  buildComposer() {
    const q = this.q, r = this.renderer;
    this.composer?.dispose?.();
    if (q.post === 'none') { this.composer = null; return; }
    const comp = new EffectComposer(r);
    comp.setPixelRatio(r.getPixelRatio());
    comp.setSize(innerWidth, innerHeight);
    comp.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) { const ao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight); ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.75; comp.addPass(ao); }
    this.bloomPass = null;
    if (q.bloom) { this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 1.05); comp.addPass(this.bloomPass); }
    this.tuneBloom();
    comp.addPass(new OutputPass());
    if (q.smaa) comp.addPass(new SMAAPass()); else if (q.post === 'fxaa') comp.addPass(new FXAAPass());
    this.composer = comp;
  }

  setQuality(key) {
    this.qualityKey = key;
    store.set('quality', key);
    this.applyQuality(QUALITY[key === 'auto' ? 'medium' : key]);
  }

  applyQuality(q) {
    this.q = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.pixelRatio));
    this.renderer.shadowMap.enabled = this.q.shadows > 0;
    for (const l of [...this.showroom.lightsList, this.track?.sun].filter(Boolean)) {
      if (!l.shadow) continue;
      l.castShadow = this.q.shadows > 0;
      l.shadow.mapSize.set(this.q.shadows || 1024, this.q.shadows || 1024);
      l.shadow.map?.dispose(); l.shadow.map = null;
    }
    for (const m of Object.values(this.M)) if (m.isMaterial) m.needsUpdate = true;
    this.buildComposer();
    this.toast(`Качество: ${this.q.label}`);
  }


  // Bloom works on linear HDR: the daytime sky is far above 1.0, so raise the threshold outdoors
  tuneBloom() {
    const b = this.bloomPass;
    if (!b) return;
    if (this.mode === 'drive' && !this.night) { b.threshold = 3.2; b.strength = 0.22; b.radius = 0.3; }
    else if (this.mode === 'drive') { b.threshold = 1.6; b.strength = 0.45; b.radius = 0.35; }
    else { b.threshold = 1.05; b.strength = 0.55; b.radius = 0.45; }
  }

  applyShowroomEnv() {
    this.renderer.toneMappingExposure = 1.0;
    this.scene.environment = this.showroom.envMap;
    this.scene.environmentIntensity = this.night ? 0.12 : 1;
    this.scene.background = new THREE.Color(0x0b0d10);
  }

  // ---------------------------------------------------------------- UI wiring
  bindUI() {
    const car = this.car;
    // modes
    $('mode-showroom').onclick = () => this.setMode('showroom');
    $('mode-drive').onclick = () => this.setMode('drive');
    // quality
    $('quality').innerHTML = [['auto', 'Авто'], ...QUALITY_ORDER.map((k) => [k, QUALITY[k].label])].map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    $('quality').value = this.qualityKey;
    $('quality').onchange = (e) => this.setQuality(e.target.value);
    $('btn-sound').onclick = () => {
      if (this.audio.on) { this.audio.stop(); } else { this.audio.start(); }
      $('btn-sound').setAttribute('aria-pressed', String(this.audio.on));
    };
    $('btn-help').onclick = () => { $('help').hidden = false; };
    $('help-close').onclick = () => { $('help').hidden = true; };
    // version / powertrain
    $('sel-version').innerHTML = Object.entries(VERSIONS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    $('sel-version').onchange = (e) => this.setVersion(e.target.value);
    $('sel-powertrain').onchange = (e) => this.setPowertrain(e.target.value);
    // paint
    $('swatches').innerHTML = PAINTS.map((p) => `<button class="swatch" data-paint="${p.id}" style="background:${p.color}" title="${p.name}" aria-pressed="false" aria-label="${p.name}"></button>`).join('')
      + '<label class="swatch swatch-custom" title="Свой цвет"><input type="color" id="paint-custom" value="#7a1f2b" aria-label="Свой цвет"></label>';
    $('swatches').addEventListener('click', (e) => { const id = e.target.closest('[data-paint]')?.dataset.paint; if (id) this.setPaint(id); });
    $('paint-custom').addEventListener('input', (e) => this.setPaint(e.target.value));
    // wheels & options
    $('wheels-19').onclick = () => this.setWheels(19);
    $('wheels-20').onclick = () => this.setWheels(20);
    $('opt-rails').onchange = (e) => { car.setRails(e.target.checked); this.saveConfig(); };
    $('opt-twotone').onchange = (e) => { car.setTwoTone(e.target.checked); this.saveConfig(); };
    $('opt-flush').onchange = (e) => { car.setHandles(e.target.checked ? 'flush' : 'mechanical'); this.saveConfig(); };
    $('opt-plate-cn').onchange = (e) => { this.setPlate(e.target.checked ? 'CN' : 'RU'); this.saveConfig(); };
    // opening parts
    const parts = [['door_fl', 'Водит. дверь'], ['door_fr', 'Пасс. дверь'], ['door_rl', 'Задн. лев.'], ['door_rr', 'Задн. прав.'], ['hood', 'Капот'], ['tailgate', 'Багажник'], ['sunroof', 'Люк'], ['mirrors', 'Сложить зеркала']];
    $('open-buttons').innerHTML = parts.map(([k, l]) => `<button class="btn" data-part="${k}" aria-pressed="false">${l}</button>`).join('');
    $('open-buttons').addEventListener('click', (e) => { const b = e.target.closest('[data-part]'); if (b) this.togglePart(b.dataset.part); });
    // lights
    const modes = [['off', 'Выкл'], ['drl', 'ДХО'], ['park', 'Габар.'], ['low', 'Ближн.'], ['auto', 'Авто']];
    $('light-modes').innerHTML = modes.map(([k, l]) => `<button data-lmode="${k}" aria-pressed="${k === 'drl'}">${l}</button>`).join('');
    $('light-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-lmode]'); if (b) this.setLightMode(b.dataset.lmode); });
    const lb = [['high', 'Дальний'], ['turnL', 'Поворот ←'], ['turnR', 'Поворот →'], ['hazard', 'Аварийка'], ['brake', 'Стоп'], ['reverse', 'Задний ход'], ['fog', 'Противотуман.'], ['welcome', 'Приветствие']];
    $('light-buttons').innerHTML = lb.map(([k, l]) => `<button class="btn" data-light="${k}" aria-pressed="false">${l}</button>`).join('');
    $('light-buttons').addEventListener('click', (e) => { const b = e.target.closest('[data-light]'); if (b) this.toggleLight(b.dataset.light); });
    // camera presets & tools
    $('cam-buttons').innerHTML = Object.keys(SHOW_VIEWS).map((k) => `<button class="btn" data-view="${k}">${k}</button>`).join('');
    $('cam-buttons').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) this.setView(b.dataset.view); });
    $('tool-dims').onclick = (e) => this.toggleDims(e.currentTarget);
    $('tool-night').onclick = (e) => { this.setNight(!this.night); e.currentTarget.setAttribute('aria-pressed', String(this.night)); };
    $('tool-spin').onclick = (e) => { this.controls.autoRotate = !this.controls.autoRotate; e.currentTarget.setAttribute('aria-pressed', String(this.controls.autoRotate)); };
    $('tool-photo').onclick = () => this.photo();
    $('tool-glb').onclick = () => this.exportGLB();
    $('tool-geo').onclick = () => this.openGeometry();
    $('geo-close').onclick = () => { $('geo').hidden = true; };
    $('geo-apply').onclick = () => this.applyGeometry();
    $('tool-debug').onclick = (e) => this.toggleDebug(e.currentTarget);
    if (window.__ARTIFACT__) { $('tool-photo').hidden = true; $('tool-glb').hidden = true; }
    // drive bar
    $('drive-modes').innerHTML = ['Eco', 'Normal', 'Sport'].map((m) => `<button data-dmode="${m}" aria-pressed="${m === 'Normal'}">${m}</button>`).join('');
    $('drive-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-dmode]'); if (b) this.setDriveMode(b.dataset.dmode); });
    $('tod').oninput = (e) => { this.timeOfDay = +e.target.value; this.todDirty = true; };
    for (const k of ['abs', 'tcs', 'esp']) $(`as-${k}`).onclick = (e) => { this.physics.assists[k] = !this.physics.assists[k]; e.currentTarget.setAttribute('aria-pressed', String(this.physics.assists[k])); };
    $('btn-cam').onclick = () => this.cycleCamera();
    $('btn-reset').onclick = () => this.resetCar();
    $('btn-selftest').onclick = () => this.showSelfTest();
    $('selftest-close').onclick = () => { $('selftest').hidden = true; };
    // pick parts with the mouse in the showroom
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || this.mode !== 'showroom') return;
      ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObject(this.car.root, true)[0];
      let o = hit?.object;
      while (o && !this.car.pivots[o.name] && !/^Mirror_/.test(o.name)) o = o.parent;
      if (o) this.togglePart(/^Mirror_/.test(o.name) ? 'mirrors' : o.name);
    });
    // driver camera mouse look
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      if (this.mode === 'drive' && this.camMode === 'driver' && e.buttons) { this.driverLook.yaw -= e.movementX * 0.004; this.driverLook.pitch = clamp(this.driverLook.pitch - e.movementY * 0.004, -0.6, 0.5); }
    });
    this.bindTouch();
    // collapse the config sheet on phones
    if (matchMedia('(max-width: 860px)').matches) {
      const p = $('panel-config'); p.classList.add('collapsed');
      p.querySelector('h3').addEventListener('click', () => p.classList.toggle('collapsed'));
    }
    this.updateSpecs();
  }

  bindTouch() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.touchEnabled = coarse;
    const steer = $('touch-steer'), knob = steer.querySelector('i');
    const setSteer = (e) => {
      const r = steer.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.input.touch.steer = (0.5 - x) * 2;
      knob.style.left = `${x * (r.width - 64)}px`;
    };
    steer.addEventListener('pointerdown', (e) => { steer.setPointerCapture(e.pointerId); setSteer(e); });
    steer.addEventListener('pointermove', (e) => { if (e.buttons) setSteer(e); });
    steer.addEventListener('pointerup', () => { this.input.touch.steer = 0; knob.style.left = '58px'; });
    const hold = (id, key) => {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); this.input.touch[key] = key === 'handbrake' ? true : 1; });
      const up = () => { this.input.touch[key] = key === 'handbrake' ? false : 0; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    };
    hold('touch-gas', 'throttle'); hold('touch-brake', 'brake'); hold('touch-hb', 'handbrake');
  }

  // ---------------------------------------------------------------- configuration
  setPaint(id) {
    this.car.setPaint(id);
    for (const b of document.querySelectorAll('[data-paint]')) b.setAttribute('aria-pressed', String(b.dataset.paint === id));
    const p = PAINTS.find((x) => x.id === id);
    $('paint-name').textContent = p ? `${p.name} · ${p.cn}${p.since ? ' · с 2026 г.' : ''}` : `Свой цвет ${id}`;
    this.saveConfig();
  }

  setWheels(size) {
    this.car.setWheels(size);
    if (this.mode === 'showroom') this.car.root.position.y = this.car.rideOffset;
    $('wheels-19').setAttribute('aria-pressed', String(size === 19));
    $('wheels-20').setAttribute('aria-pressed', String(size === 20));
    this.physics?.configure({ powertrain: this.physics.kind, iceVariant: VERSIONS[this.car.config.version].iceVariant, wheelSize: size });
    this.updateSpecs();
    this.saveConfig();
  }

  setVersion(id) {
    const v = VERSIONS[id];
    this.car.setVersion(id);
    $('sel-version').value = id;
    const opts = [['ICE', `${ICE_VARIANTS[v.iceVariant].label} · 7DCT`], ['PHEV', 'PHEV iDD · 158 кВт + 18,4 кВт·ч']];
    $('sel-powertrain').innerHTML = opts.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    this.setPowertrain(v.powertrainDefault);
    this.setPlate(v.plate);
    $('opt-plate-cn').checked = v.plate === 'CN';
    this.updateSpecs();
    this.saveConfig();
  }

  setPowertrain(kind) {
    this.powertrain = kind;
    $('sel-powertrain').value = kind;
    if (this.physics) {
      this.physics.configure({ powertrain: kind, iceVariant: VERSIONS[this.car.config.version].iceVariant, wheelSize: this.car.config.wheels });
      if (this.mode === 'drive') this.resetCar();
    }
    this.updateSpecs();
    this.saveConfig();
  }

  setPlate(format) {
    this.car.config.plate = format;
    for (const p of [this.car.details.plateFront, this.car.details.plateRear]) {
      if (!p) continue;
      const face = p.children[1];
      import('./util/textures.js').then(({ plateTexture }) => {
        face.material.map?.dispose();
        face.material.map = plateTexture(format);
        face.material.needsUpdate = true;
        const [w, h] = format === 'CN' ? [0.44, 0.14] : [0.52, 0.112];
        face.geometry.dispose(); face.geometry = new THREE.PlaneGeometry(w, h);
        p.children[0].geometry.dispose(); p.children[0].geometry = new THREE.PlaneGeometry(w + 0.02, h + 0.02);
      });
    }
  }

  togglePart(part) {
    if (this.mode === 'drive' && Math.abs(this.physics.speed) > 0.5) { this.toast('Сначала остановитесь'); return; }
    let on;
    if (part === 'mirrors') { on = this.car.mirrorFold.target ? 0 : 1; this.car.foldMirrors(on); }
    else on = this.car.toggle(part);
    document.querySelector(`[data-part="${part}"]`)?.setAttribute('aria-pressed', String(!!on));
    if (part.startsWith('door') || part === 'tailgate' || part === 'hood') setTimeout(() => this.audio.thump(), on ? 50 : 700);
  }

  setLightMode(m) {
    this.car.lights.set({ mode: m });
    for (const b of document.querySelectorAll('[data-lmode]')) b.setAttribute('aria-pressed', String(b.dataset.lmode === m));
  }

  toggleLight(k) {
    const L = this.car.lights, st = L.state;
    const patch = {
      high: { high: !st.high }, turnL: { turn: st.turn > 0 ? 0 : 1 }, turnR: { turn: st.turn < 0 ? 0 : -1 }, hazard: { hazard: !st.hazard },
      brake: { brake: st.brake ? 0 : 1 }, reverse: { reverse: !st.reverse }, fog: { fog: !st.fog }, welcome: { welcome: 3 },
    }[k];
    L.set(patch);
    if (k === 'high' && st.high && st.mode !== 'low') this.setLightMode('low');
    this.syncLightButtons();
  }

  syncLightButtons() {
    const st = this.car.lights.state;
    const on = { high: st.high, turnL: st.turn > 0, turnR: st.turn < 0, hazard: st.hazard, brake: st.brake > 0, reverse: st.reverse, fog: st.fog, welcome: st.welcome > 0 };
    for (const b of document.querySelectorAll('[data-light]')) b.setAttribute('aria-pressed', String(!!on[b.dataset.light]));
  }

  setNight(on) {
    this.night = on;
    if (this.mode === 'showroom') {
      this.showroom.setNight(on);
      this.scene.environmentIntensity = on ? 0.12 : 1;
      this.setLightMode(on ? 'low' : 'drl');
    } else { this.timeOfDay = on ? 22.5 : 15; $('tod').value = this.timeOfDay; this.todDirty = true; }
  }

  setDriveMode(m) {
    this.physics.powertrain.setMode(m);
    for (const b of document.querySelectorAll('[data-dmode]')) b.setAttribute('aria-pressed', String(b.dataset.dmode === m));
  }

  updateSpecs() {
    const v = VERSIONS[this.car.config.version], kind = this.powertrain || v.powertrainDefault;
    const d = DIMS.CN, t = TIRES[this.car.config.wheels];
    const ice = ICE_VARIANTS[v.iceVariant];
    const rows = [
      ['Д × Ш × В', `${d.lengthM * 1000} × ${d.widthM * 1000} × ${d.heightM * 1000}`],
      ['База / колея', `${d.wheelbaseM * 1000} / ${CHASSIS.trackFrontM * 1000} мм`],
      ['Клиренс', `≈${CHASSIS.groundClearanceM * 1000} мм`],
      ['Масса', `${MASS[kind].curbKg} кг`],
      kind === 'PHEV' ? ['Привод', '1.5 атм 72 кВт + 158 кВт'] : ['Двигатель', ice.label],
      kind === 'PHEV' ? ['Батарея', 'LFP 18,4 кВт·ч'] : ['КП', '7DCT, мокрые сцепления'],
      ['Шины', t.label],
      ['Cd', String(CHASSIS.cd)],
    ];
    $('specs').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }

  saveConfig() {
    const c = this.car.config;
    store.set('config', { paint: c.paint, wheels: c.wheels, rails: c.rails, twoTone: c.twoTone, handles: c.handles, version: c.version, powertrain: this.powertrain, plate: c.plate });
  }

  restoreConfig() {
    const c = store.get('config', null) || {};
    this.setVersion(c.version && VERSIONS[c.version] ? c.version : 'RU-2026');
    if (c.powertrain) this.setPowertrain(c.powertrain);
    this.setPaint(c.paint || PAINTS[0].id);
    if (c.wheels === 20) this.setWheels(20);
    if (c.rails === false) { $('opt-rails').checked = false; this.car.setRails(false); }
    if (c.twoTone) { $('opt-twotone').checked = true; this.car.setTwoTone(true); }
    if (c.handles === 'flush') { $('opt-flush').checked = true; this.car.setHandles('flush'); }
    if (c.plate) { this.setPlate(c.plate); $('opt-plate-cn').checked = c.plate === 'CN'; }
  }

  // ---------------------------------------------------------------- modes and cameras
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    $('mode-showroom').setAttribute('aria-pressed', String(mode === 'showroom'));
    $('mode-drive').setAttribute('aria-pressed', String(mode === 'drive'));
    const drive = mode === 'drive';
    $('panel-config').hidden = drive; $('panel-info').hidden = drive;
    $('drivebar').hidden = !drive; this.hud.show(drive);
    $('touch').hidden = !(drive && this.touchEnabled);
    this.showroom.group.visible = !drive;
    this.track.group.visible = drive;
    this.controls.enabled = !drive;
    this.controls.autoRotate = false;
    this.dimsGroup && (this.dimsGroup.visible = false);
    if (drive) {
      this.car.closeAll(); this.car.foldMirrors(false);
      for (const k of Object.keys(this.car.open)) { const st = this.car.open[k]; st.t = 0; this.car.pivots[k].userData.apply(this.car.pivots[k], 0); }
      this.resetCar();
      this.todDirty = true;
      this.camera.fov = 58; this.camera.near = 0.05; this.camera.updateProjectionMatrix();
      this.setLightMode('auto');
      this.toast('W — газ, S — тормоз/назад, A/D — руль, C — камера');
    } else {
      this.car.root.position.set(0, this.car.rideOffset, 0);
      this.car.root.quaternion.identity();
      for (let i = 0; i < 4; i++) this.car.setWheelPose(i, {});
      this.applyShowroomEnv();
      this.showroom.setNight(this.night);
      this.tuneBloom();
      this.camera.fov = this.showroomFov(); this.camera.updateProjectionMatrix();
      this.setView('Перед 3/4', true);
      this.setLightMode(this.night ? 'low' : 'drl');
      this.car.lights.set({ brake: 0, reverse: false });
      this.audio.inside = false;
    }
  }

  resetCar() {
    const s = this.track.start;
    this.physics.reset(s.position, s.heading);
    this.track.resetCones();
    this.chase = null;
    this.hud.lap.running = false;
  }

  cycleCamera() {
    const order = Object.keys(CAM_NAMES);
    this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
    $('btn-cam').textContent = `Камера: ${CAM_NAMES[this.camMode]}`;
    this.controls.enabled = this.camMode === 'free';
    this.driverLook.yaw = this.driverLook.pitch = 0;
    this.camera.fov = this.camMode === 'driver' ? 68 : 58;
    this.camera.updateProjectionMatrix();
    this.chase = null; this.cinema = null;
  }

  setView(name, instant = false) {
    const [p, t] = SHOW_VIEWS[name];
    if (name === 'Мотор') this.car.setOpen('hood', true);
    const to = { pos: new THREE.Vector3(...p), target: new THREE.Vector3(...t) };
    if (name === 'Салон') { this.controls.minDistance = 0.05; } else this.controls.minDistance = 2.2;
    if (instant) { this.camera.position.copy(to.pos); this.controls.target.copy(to.target); this.controls.update(); return; }
    this.camAnim = { from: { pos: this.camera.position.clone(), target: this.controls.target.clone() }, to, t: 0 };
  }

  updateShowroomCamera(dt) {
    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / 1.1);
      const k = easeInOutCubic(a.t);
      this.camera.position.lerpVectors(a.from.pos, a.to.pos, k);
      this.controls.target.lerpVectors(a.from.target, a.to.target, k);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();
  }

  updateDriveCamera(dt) {
    const root = this.car.root, cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    const carPos = root.position.clone();
    const speed = this.physics.speed;
    this.audio.inside = this.camMode === 'driver';
    if (this.camMode === 'free') { this.controls.target.copy(carPos).add(new THREE.Vector3(0, 0.8, 0)); this.controls.update(); return; }
    if (this.camMode === 'chase') {
      const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const dist = 6.4 + Math.min(2.5, Math.abs(speed) / 18);
      const desired = carPos.clone().addScaledVector(flat, -dist).add(new THREE.Vector3(0, 2.1, 0));
      const look = carPos.clone().addScaledVector(flat, 3).add(new THREE.Vector3(0, 0.9, 0));
      if (!this.chase) this.chase = { pos: desired.clone(), look: look.clone() };
      this.chase.pos.x = damp(this.chase.pos.x, desired.x, 5, dt); this.chase.pos.z = damp(this.chase.pos.z, desired.z, 5, dt); this.chase.pos.y = damp(this.chase.pos.y, desired.y, 3, dt);
      this.chase.look.lerp(look, 1 - Math.exp(-10 * dt));
      cam.position.copy(this.chase.pos);
      const gy = this.track.heightAt(cam.position.x, cam.position.z) + 0.4;
      if (cam.position.y < gy) cam.position.y = gy;
      cam.lookAt(this.chase.look);
      cam.fov = damp(cam.fov, 56 + Math.min(14, Math.abs(speed) * 0.25), 2, dt); cam.updateProjectionMatrix();
      return;
    }
    if (this.camMode === 'hood' || this.camMode === 'driver') {
      const eye = this.camMode === 'hood' ? new THREE.Vector3(0, 1.36, sToZ(1450)) : new THREE.Vector3(INTERIOR.driverEye[2] / 1000, INTERIOR.driverEye[1] / 1000, sToZ(INTERIOR.driverEye[0]));
      cam.position.copy(eye).applyMatrix4(root.matrixWorld);
      const dir = new THREE.Vector3(0, 0, 1);
      if (this.camMode === 'driver') dir.applyEuler(new THREE.Euler(-0.08 + this.driverLook.pitch, this.driverLook.yaw, 0, 'YXZ'));
      dir.applyQuaternion(root.quaternion);
      cam.up.set(0, 1, 0).applyQuaternion(root.quaternion);
      cam.lookAt(cam.position.clone().add(dir));
      cam.up.set(0, 1, 0);
      return;
    }
    if (this.camMode === 'wheel') {
      const p = new THREE.Vector3(1.55, 0.42, 2.2).applyMatrix4(root.matrixWorld);
      cam.position.copy(p);
      cam.lookAt(new THREE.Vector3(0.75, 0.36, 1.35).applyMatrix4(root.matrixWorld));
      return;
    }
    if (this.camMode === 'cinema') {
      if (!this.cinema || this.cinema.t > 6 || this.cinema.pos.distanceTo(carPos) > 70) {
        const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), side = new THREE.Vector3(flat.z, 0, -flat.x);
        const ahead = Math.max(18, Math.abs(speed) * 2.2);
        const pos = carPos.clone().addScaledVector(flat, ahead).addScaledVector(side, (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 6));
        pos.y = this.track.heightAt(pos.x, pos.z) + 0.8 + Math.random() * 2.5;
        this.cinema = { pos, t: 0 };
      }
      this.cinema.t += dt;
      cam.position.copy(this.cinema.pos);
      cam.lookAt(carPos.clone().add(new THREE.Vector3(0, 0.7, 0)));
      cam.fov = damp(cam.fov, clamp(900 / (cam.position.distanceTo(carPos) + 10), 18, 60), 3, dt); cam.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- keyboard actions
  onKey(code) {
    if (code === 'Escape') { for (const id of ['help', 'geo', 'selftest']) $(id).hidden = true; return; }
    if (code === 'KeyP') { this.photo(); return; }
    if (code === 'KeyL') { this.setLightMode(this.car.lights.cycleMode()); return; }
    if (code === 'KeyK') { this.toggleLight('high'); return; }
    if (code === 'KeyZ') { this.toggleLight('turnL'); return; }
    if (code === 'KeyX') { this.toggleLight('turnR'); return; }
    if (code === 'KeyJ') { this.toggleLight('hazard'); return; }
    if (/^Digit[1-6]$/.test(code)) { this.togglePart(['door_fl', 'door_fr', 'door_rl', 'door_rr', 'hood', 'tailgate'][+code.slice(5) - 1]); return; }
    if (this.mode !== 'drive') return;
    if (code === 'KeyC') this.cycleCamera();
    else if (code === 'KeyR') this.resetCar();
    else if (code === 'KeyM') { const order = ['Eco', 'Normal', 'Sport']; this.setDriveMode(order[(order.indexOf(this.physics.powertrain.mode) + 1) % 3]); this.toast(`Режим ${this.physics.powertrain.mode}`); }
    else if (code === 'KeyG') { const pt = this.physics.powertrain; pt.manual = !pt.manual; this.toast(pt.manual ? 'Ручной режим КП: E / Q' : 'Автоматический режим КП'); }
    else if (code === 'KeyE') this.input.state.shiftUp = true;
    else if (code === 'KeyQ') this.input.state.shiftDown = true;
  }

  // ---------------------------------------------------------------- frame
  tick(now) {
    const real = (now - this.last) / 1000;
    const dt = Math.min(0.05, real);
    this.last = now;
    if (this.pendingPixelRatio) { this.renderer.setPixelRatio(this.pendingPixelRatio); this.composer?.setPixelRatio(this.pendingPixelRatio); this.pendingPixelRatio = null; }
    this.renderer.info.reset();
    if (this.mode === 'drive') this.stepDrive(dt);
    else this.stepShowroom(dt);
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.updateStats(real);
  }

  stepShowroom(dt) {
    this.updateShowroomCamera(dt);
    this.car.update(dt);
    if (this.car.lights.update(dt, { night: this.night })) this.audio.click();
    this.car.screens.update(dt, { mode: 'showroom', version: VERSIONS[this.car.config.version].label, powertrain: this.powertrain, lights: this.car.lights.state.mode, track: null });
    this.syncLightButtonsThrottled(dt);
    this.audio.update({ kind: this.powertrain, rpm: 750, throttle: 0, speed: 0, horn: this.input.keys.has('KeyH'), engineOn: false });
  }

  syncLightButtonsThrottled(dt) {
    this._lbAcc = (this._lbAcc || 0) + dt;
    if (this._lbAcc > 0.25) { this._lbAcc = 0; this.syncLightButtons(); }
  }

  stepDrive(dt) {
    const ph = this.physics, pt = ph.powertrain;
    if (this.todDirty) { this.todDirty = false; this.night = this.track.setTimeOfDay(this.timeOfDay, this.renderer, this.scene); this.renderer.toneMappingExposure = this.night ? 0.7 : 0.42; this.tuneBloom(); }
    const inp = this.input.update(dt, Math.abs(ph.speed));
    if (!$('help').hidden || !$('geo').hidden || !$('selftest').hidden) { inp.throttle = 0; inp.brake = 0; }
    this.physAcc = (this.physAcc || 0) + dt;
    let n = 0;
    while (this.physAcc >= PHYS_DT && n < 14) { ph.step(PHYS_DT, inp); this.physAcc -= PHYS_DT; n++; }
    if (n === 14) this.physAcc = 0;
    // pose the model
    const root = this.car.root;
    ph.rootPose(root.position, root.quaternion);
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    ph.wheels.forEach((w, i) => {
      const wheel = this.car.wheels[i];
      wheel.position.copy(w.centre).applyMatrix4(inv);
      wheel.userData.steer.rotation.y = w.steer;
      wheel.userData.spin.rotation.x = w.spin;
    });
    this.car.update(dt);
    const brakeOn = pt.selector !== 'P' && pt.pedals(inp).brake > 0.05;
    this.car.lights.set({ brake: brakeOn ? 1 : 0, reverse: pt.selector === 'R' });
    if (this.car.lights.update(dt, { night: this.night })) this.audio.click();
    this.track.updateCones(dt, root.position, root.quaternion, ph.vel);
    this.track.follow(root.position);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    const heading = Math.atan2(fwd.x, fwd.z);
    const speedKmh = ph.speed * 3.6;
    const surf = ph.wheels[0].surface;
    const slip = Math.max(...ph.wheels.map((w) => (w.contact ? Math.max(Math.abs(w.slip), Math.abs(w.slipAngle) * 1.5) : 0)));
    const state = {
      kind: ph.kind, speedKmh, gear: pt.gearLabel(), rpm: pt.kind === 'ICE' ? pt.rpm : pt.engineRpm || 0, powerKw: pt.powerKw, soc: pt.soc, fuel: pt.fuelL / POWERTRAINS.ICE.fuelTankL,
      flags: ph.flags, pos: root.position, vel: ph.vel, heading, accelG: ph.accelG, surface: surf, driveMode: pt.mode, engineOn: pt.engineOn,
    };
    this.hud.update(dt, state);
    this.car.screens.update(dt, {
      mode: 'drive', speedKmh: Math.abs(speedKmh), gear: state.gear, rpm: state.rpm, powerKw: pt.powerKw, soc: pt.soc, fuel: state.fuel, driveMode: pt.mode, powertrain: ph.kind,
      track: this.track.track2D, car: { x: root.position.x, z: root.position.z, heading }, rangeKm: ph.kind === 'PHEV' ? pt.soc * 101 + pt.fuelL * 16 : pt.fuelL * 13.5,
      abs: ph.flags.abs, tcs: ph.flags.tcs, esp: ph.flags.esp, lights: this.car.lights.state.mode, version: VERSIONS[this.car.config.version].label, engineOn: pt.engineOn,
    });
    this.car.interior.setControls({ steerWheelRad: -ph.steerAngle * STEERING.ratio, throttle: pt.pedals(inp).throttle, brake: pt.pedals(inp).brake, indicator: this.car.lights.state.turn });
    this.audio.update({ kind: ph.kind, rpm: pt.rpm, engineRpm: pt.engineRpm, motorRpm: pt.kind === 'PHEV' ? pt.rpm : 0, throttle: inp.throttle, boost: pt.boost, powerKw: pt.powerKw, speed: Math.abs(ph.speed), slip, surface: ph.wheels[2].surfaceKey, horn: this.input.keys.has('KeyH'), engineOn: pt.engineOn });
    this.updateDriveCamera(dt);
  }

  updateStats(dt) {
    const s = this.stats;
    s.frames++; s.acc += dt;
    if (s.acc < 1) return;
    s.fps = s.frames / s.acc; s.frames = 0; s.acc = 0;
    const info = this.renderer.info.render;
    $('stats').textContent = `${Math.round(s.fps)} к/с · ${info.calls} вызовов · ${(info.triangles / 1000).toFixed(0)} тыс. треуг. · сборка ${(this.buildMs / 1000).toFixed(1)} с`;
    // dynamic resolution: keep ~55+ fps
    const r = this.renderer, max = Math.min(window.devicePixelRatio, this.q.pixelRatio);
    let pr = r.getPixelRatio();
    if (s.fps < 45 && pr > 0.6) pr = Math.max(0.6, pr - 0.1);
    else if (s.fps > 58 && pr < max) pr = Math.min(max, pr + 0.05);
    if (pr !== r.getPixelRatio()) this.pendingPixelRatio = pr;
    if (this.qualityKey === 'auto') {
      this.lowFpsTime = s.fps < 24 ? (this.lowFpsTime || 0) + 1 : 0;
      if (this.lowFpsTime > 3 && this.q !== QUALITY.low) { this.applyQuality(QUALITY.low); this.toast('Качество снижено до «Низкого»'); }
    }
  }

  showroomFov() {
    const a = innerWidth / innerHeight;
    return a >= 1.2 ? 32 : Math.min(64, 32 * Math.pow(1.2 / Math.max(0.4, a), 0.85));
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    if (this.mode === 'showroom') this.camera.fov = this.showroomFov();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------------------------------------------------------------- tools
  toggleDims(btn) {
    if (!this.dimsGroup) { this.buildDims(); this.dimsGroup.visible = false; }
    this.dimsGroup.visible = !this.dimsGroup.visible;
    btn.setAttribute('aria-pressed', String(this.dimsGroup.visible));
  }

  buildDims() {
    const g = (this.dimsGroup = new THREE.Group());
    const car = this.car;
    const box = new THREE.Box3();
    for (const m of [car.bodyMesh, car.greenMesh, ...Object.values(car.partMeshes)]) box.expandByObject(m);
    const rails = car.details.rails?.visible ? new THREE.Box3().setFromObject(car.details.rails) : null;
    const top = rails ? Math.max(box.max.y, rails.max.y) : box.max.y;
    const L = box.max.z - box.min.z, W = box.max.x - box.min.x;
    const wb = car.wheels[0].position.z - car.wheels[2].position.z, track = car.wheels[0].position.x - car.wheels[1].position.x;
    const clearance = box.min.y;
    const ref = DIMS.CN;
    const ok = (a, b, tol) => Math.abs(a - b) <= tol;
    const items = [
      ['Длина', L, ref.lengthM, 0.03, [new THREE.Vector3(1.25, 0.05, box.max.z), new THREE.Vector3(1.25, 0.05, box.min.z)]],
      ['Ширина', W, ref.widthM, 0.02, [new THREE.Vector3(box.max.x, 0.05, 2.75), new THREE.Vector3(box.min.x, 0.05, 2.75)]],
      ['Высота', top, rails ? ref.heightM : ref.heightNoRailsM, 0.02, [new THREE.Vector3(-1.25, 0, -2.6), new THREE.Vector3(-1.25, top, -2.6)]],
      ['База', wb, ref.wheelbaseM, 0.005, [new THREE.Vector3(-1.2, 0.05, car.wheels[0].position.z), new THREE.Vector3(-1.2, 0.05, car.wheels[2].position.z)]],
      ['Колея', track, CHASSIS.trackFrontM, 0.01, [new THREE.Vector3(car.wheels[0].position.x, 0.03, 2.9), new THREE.Vector3(car.wheels[1].position.x, 0.03, 2.9)]],
    ];
    const lines = [];
    for (const [name, val, refV, tol, [a, b]] of items) {
      const good = ok(val, refV, tol);
      const mat = new THREE.LineBasicMaterial({ color: good ? 0x3ddc97 : 0xff5a5a });
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const x = c.getContext('2d'); x.fillStyle = 'rgba(14,17,22,0.85)'; x.fillRect(0, 0, 512, 96);
      x.fillStyle = good ? '#3ddc97' : '#ff5a5a'; x.font = '600 40px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(`${name} ${(val * 1000).toFixed(0)} мм`, 256, 48);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      spr.scale.set(1.1, 0.2, 1); spr.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(0, 0.18, 0));
      g.add(spr);
      lines.push(`${name}: ${(val * 1000).toFixed(0)} мм (эталон ${(refV * 1000).toFixed(0)}) ${good ? '✓' : '✗'}`);
    }
    lines.push(`Клиренс по кузову: ${(clearance * 1000).toFixed(0)} мм`);
    $('dims-check').innerHTML = lines.join('<br>');
    console.info('[UNI-Z] dimensions', lines.join(' | '));
    this.scene.add(g);
  }

  photo() {
    if (window.__ARTIFACT__) { this.toast('Сохранение файлов недоступно в этом окне'); return; }
    const r = this.renderer, pr = r.getPixelRatio();
    const app = $('app');
    for (const c of app.children) if (c !== r.domElement) c.style.visibility = 'hidden';
    r.setPixelRatio(Math.min(2, window.devicePixelRatio * 1.5)); this.composer?.setPixelRatio(r.getPixelRatio()); this.resize();
    if (this.composer) this.composer.render(); else r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    r.setPixelRatio(pr); this.composer?.setPixelRatio(pr); this.resize();
    for (const c of app.children) c.style.visibility = '';
    const a = document.createElement('a'); a.href = url; a.download = `uni-z-${Date.now()}.png`; a.click();
    this.toast('Снимок сохранён');
  }

  async exportGLB() {
    if (window.__ARTIFACT__) { this.toast('Сохранение файлов недоступно в этом окне'); return; }
    this.toast('Экспорт GLB…');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exp = new GLTFExporter();
    const data = await exp.parseAsync(this.car.root, { binary: true, onlyVisible: true });
    const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
    const a = document.createElement('a'); a.href = url; a.download = 'changan-uni-z.glb'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.toast(`GLB: ${(data.byteLength / 1e6).toFixed(1)} МБ`);
  }

  openGeometry() {
    $('geo-text').value = JSON.stringify({ LOWER, GREEN }, null, 0).replace(/\],\[/g, '],\n[').replace(/:\[\[/g, ':[\n[');
    $('geo-msg').textContent = '';
    $('geo').hidden = false;
  }

  async applyGeometry() {
    try {
      const data = JSON.parse($('geo-text').value);
      const okRows = (rows, n) => Array.isArray(rows) && rows.length > 3 && rows.every((r) => Array.isArray(r) && r.length === n && r.every(Number.isFinite));
      if (!okRows(data.LOWER, 7) || !okRows(data.GREEN, 5)) throw new Error('нужны массивы LOWER (по 7 чисел) и GREEN (по 5 чисел)');
      LOWER.splice(0, LOWER.length, ...data.LOWER); GREEN.splice(0, GREEN.length, ...data.GREEN);
      $('geo-msg').textContent = 'Перестраиваю…';
      await nextFrame();
      this.scene.remove(this.car.root);
      this.car.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      const cfg = { ...this.car.config };
      this.buildCar();
      Object.assign(this.car.config, cfg);
      this.setVersion(cfg.version); this.setPaint(cfg.paint); this.setWheels(cfg.wheels);
      this.car.setRails(cfg.rails); this.car.setTwoTone(cfg.twoTone); this.car.setHandles(cfg.handles);
      if (this.dimsGroup) { this.scene.remove(this.dimsGroup); this.dimsGroup = null; }
      $('geo-msg').textContent = `Готово за ${(this.buildMs / 1000).toFixed(1)} с`;
    } catch (e) {
      $('geo-msg').textContent = `Ошибка: ${e.message}`;
    }
  }

  async toggleDebug(btn) {
    if (this.gui) { this.gui.destroy(); this.gui = null; this.forceViz?.removeFromParent(); this.forceViz = null; btn.setAttribute('aria-pressed', 'false'); return; }
    const { default: GUI } = await import('lil-gui');
    const gui = (this.gui = new GUI({ title: 'Отладка' }));
    const p = this.physics;
    const f1 = gui.addFolder('Подвеска');
    const sp = { front: p.wheels[0].k, rear: p.wheels[2].k };
    f1.add(sp, 'front', 15000, 60000, 500).name('пружина перед, Н/м').onChange((v) => { p.wheels[0].k = p.wheels[1].k = v; });
    f1.add(sp, 'rear', 15000, 60000, 500).name('пружина зад, Н/м').onChange((v) => { p.wheels[2].k = p.wheels[3].k = v; });
    const arb = { front: p.wheels[0].arb, rear: p.wheels[2].arb };
    f1.add(arb, 'front', 0, 40000, 500).name('стабилизатор перед').onChange((v) => { p.wheels[0].arb = p.wheels[1].arb = v; });
    f1.add(arb, 'rear', 0, 40000, 500).name('стабилизатор зад').onChange((v) => { p.wheels[2].arb = p.wheels[3].arb = v; });
    const f2 = gui.addFolder('Вид');
    const view = { wireframe: false, forces: false };
    f2.add(view, 'wireframe').name('каркас').onChange((v) => { this.car.root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.wireframe = v; }); }); });
    f2.add(view, 'forces').name('силы на колёсах').onChange((v) => { this.showForces = v; if (!v && this.forceViz) this.forceViz.visible = false; });
    btn.setAttribute('aria-pressed', 'true');
  }

  async showSelfTest() {
    $('selftest').hidden = false;
    $('selftest-body').textContent = 'Считаю (≈1 с)…';
    await nextFrame();
    const rows = [];
    const out = {};
    for (const kind of ['ICE', 'PHEV']) {
      const r = runSelfTest(kind);
      out[kind] = r;
      const c = (k) => (r.checks[k] ? '<span class="chk-ok">✓</span>' : '<span class="chk-bad">✗</span>');
      rows.push(`<tr><td><b>${kind === 'ICE' ? '1.5T 7DCT' : 'PHEV iDD'}</b></td><td></td></tr>`,
        `<tr><td>0–100 км/ч</td><td>${r.zeroTo100S.toFixed(1)} с ${c('zeroTo100')}</td></tr>`,
        `<tr><td>100–0 км/ч</td><td>${r.brake100To0M.toFixed(1)} м ${c('brake')}</td></tr>`,
        `<tr><td>Скидпад R 40 м</td><td>${r.skidpadG.toFixed(2)} g ${c('skidpad')}</td></tr>`,
        `<tr><td>Максимальная скорость</td><td>${r.vmaxKmh.toFixed(0)} км/ч ${c('vmax')}</td></tr>`,
        `<tr><td>Оседание / посадка</td><td>${r.settleS.toFixed(2)} с · ${r.rideHeightErrMm.toFixed(0)} мм ${c('settle')}</td></tr>`,
        `<tr><td>Горка 15 % на ручнике, 5 с</td><td>${(r.hillCreepM * 100).toFixed(1)} см ${c('hillHold')}</td></tr>`);
    }
    $('selftest-body').innerHTML = `<table class="keys"><tbody>${rows.join('')}</tbody></table><p class="caption">Допуск ±15 % к целевым диапазонам из конфигурации. Те же расчёты, что и в игре (240 Гц).</p>`;
    window.__SELFTEST = out;
    console.info('[UNI-Z] selftest', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...v, checks: v.checks }]))));
  }
}

const app = new App();
window.uniz = app;
app.init().catch((e) => {
  console.error('[UNI-Z] init failed', e);
  const box = document.querySelector('#loading .box');
  if (box) box.insertAdjacentHTML('beforeend', `<p class="caption" style="color:var(--bad)">Не удалось запустить: ${e.message}. Нужен браузер с WebGL2.</p>`);
  window.__UNIZ_FATAL = true;
});
