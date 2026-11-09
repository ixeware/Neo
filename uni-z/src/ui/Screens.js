import * as THREE from 'three';

// In-car displays rendered to canvases: 10.25" cluster and 14.6" centre screen.
export class Screens {
  constructor() {
    this.cluster = this.makeCanvas(1024, 384);
    this.centre = this.makeCanvas(1024, 576);
    this.clusterTex = new THREE.CanvasTexture(this.cluster); this.clusterTex.colorSpace = THREE.SRGBColorSpace;
    this.centreTex = new THREE.CanvasTexture(this.centre); this.centreTex.colorSpace = THREE.SRGBColorSpace;
    const mat = (tex) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.15, roughness: 0.25, metalness: 0 });
    this.clusterMaterial = mat(this.clusterTex);
    this.centreMaterial = mat(this.centreTex);
    this.acc = 1;
    this.data = { mode: 'showroom', speedKmh: 0, gear: 'P', rpm: 0, powerKw: 0, soc: 0.82, fuel: 0.7, driveMode: 'Normal', powertrain: 'ICE', track: null, car: null, rangeKm: 610, tempC: 21, abs: false, tcs: false, esp: false, lights: 'drl', version: '' };
  }

  makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  update(dt, patch) {
    Object.assign(this.data, patch);
    this.acc += dt;
    if (this.acc < 1 / 20) return;
    this.acc = 0;
    this.drawCluster();
    this.drawCentre();
    this.clusterTex.needsUpdate = true;
    this.centreTex.needsUpdate = true;
  }

  drawCluster() {
    const c = this.cluster.getContext('2d'), W = 1024, H = 384, d = this.data;
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#05080d'); g.addColorStop(1, '#0b1119');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // speed
    c.fillStyle = '#eaf2ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 150px Arial, sans-serif'; c.fillText(String(Math.round(d.speedKmh)), W / 2, H / 2 - 10);
    c.font = '500 30px Arial, sans-serif'; c.fillStyle = '#7f93ad'; c.fillText('км/ч', W / 2, H / 2 + 80);
    // gear
    c.font = '700 54px Arial, sans-serif'; c.fillStyle = '#5ec8ff'; c.fillText(d.gear, W / 2, 50);
    // left arc: rpm (ICE) or power (PHEV)
    const arc = (cx, frac, color, label, value) => {
      c.lineWidth = 16; c.lineCap = 'round';
      c.strokeStyle = '#1b2533'; c.beginPath(); c.arc(cx, H / 2 + 30, 130, Math.PI * 0.8, Math.PI * 2.2); c.stroke();
      c.strokeStyle = color; c.beginPath(); c.arc(cx, H / 2 + 30, 130, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * Math.max(0, Math.min(1, frac)))); c.stroke();
      c.fillStyle = '#c9d6e6'; c.font = '600 40px Arial, sans-serif'; c.fillText(value, cx, H / 2 + 30);
      c.fillStyle = '#7f93ad'; c.font = '500 22px Arial, sans-serif'; c.fillText(label, cx, H / 2 + 72);
    };
    if (d.powertrain === 'PHEV') arc(200, (d.powerKw + 40) / 200, d.powerKw < 0 ? '#3ddc97' : '#5ec8ff', 'кВт', String(Math.round(d.powerKw)));
    else arc(200, d.rpm / 7000, d.rpm > 6000 ? '#ff5a5a' : '#5ec8ff', 'об/мин ×1000', (d.rpm / 1000).toFixed(1));
    const energy = d.powertrain === 'PHEV' ? d.soc : d.fuel;
    arc(824, energy, energy < 0.15 ? '#ffb020' : '#3ddc97', d.powertrain === 'PHEV' ? 'заряд, %' : 'топливо, %', String(Math.round(energy * 100)));
    // status line
    c.font = '500 24px Arial, sans-serif'; c.fillStyle = '#8fa3bd'; c.textAlign = 'left';
    c.fillText(`${d.driveMode}`, 24, 30);
    c.textAlign = 'right'; c.fillText(`${Math.round(d.rangeKm)} км`, W - 24, 30);
    c.textAlign = 'center';
    const flags = [['ABS', d.abs], ['TCS', d.tcs], ['ESP', d.esp]];
    flags.forEach(([t, on], i) => { c.fillStyle = on ? '#ffb020' : '#243041'; c.fillText(t, W / 2 - 90 + i * 90, H - 26); });
  }

  drawCentre() {
    const c = this.centre.getContext('2d'), W = 1024, H = 576, d = this.data;
    c.fillStyle = '#0a0f16'; c.fillRect(0, 0, W, H);
    // top bar
    c.fillStyle = '#121a25'; c.fillRect(0, 0, W, 52);
    c.fillStyle = '#c9d6e6'; c.font = '500 26px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    const now = new Date();
    c.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 20, 27);
    c.textAlign = 'right'; c.fillText(`${d.tempC}°C  ·  ${d.version}`, W - 20, 27);
    // map panel
    const mx = 20, my = 70, mw = 620, mh = 486;
    c.fillStyle = '#0f1722'; c.fillRect(mx, my, mw, mh);
    if (d.track && d.track.length > 2) {
      const xs = d.track.map((p) => p[0]), zs = d.track.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const sc = Math.min((mw - 60) / (maxX - minX), (mh - 60) / (maxZ - minZ));
      const tx = (x) => mx + 30 + (maxX - x) * sc, tz = (z) => my + mh - 30 - (z - minZ) * sc;
      c.strokeStyle = '#3a4a60'; c.lineWidth = 12; c.lineJoin = 'round'; c.beginPath();
      d.track.forEach((p, i) => (i ? c.lineTo(tx(p[0]), tz(p[1])) : c.moveTo(tx(p[0]), tz(p[1])))); c.closePath(); c.stroke();
      c.strokeStyle = '#8fb8e8'; c.lineWidth = 2; c.stroke();
      if (d.car) {
        c.save(); c.translate(tx(d.car.x), tz(d.car.z)); c.rotate(-d.car.heading);
        c.fillStyle = '#5ec8ff'; c.beginPath(); c.moveTo(0, -14); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath(); c.fill(); c.restore();
      }
    } else {
      c.fillStyle = '#5ec8ff'; c.font = '700 64px Arial, sans-serif'; c.textAlign = 'center';
      c.fillText('UNI-Z', mx + mw / 2, my + mh / 2 - 20);
      c.fillStyle = '#7f93ad'; c.font = '500 26px Arial, sans-serif';
      c.fillText('Добро пожаловать', mx + mw / 2, my + mh / 2 + 40);
    }
    // right column: drive info + energy flow
    const rx = 660;
    c.textAlign = 'left'; c.fillStyle = '#7f93ad'; c.font = '500 22px Arial, sans-serif';
    c.fillText('Режим', rx, 100); c.fillText('Силовая установка', rx, 190); c.fillText('Свет', rx, 280);
    c.fillStyle = '#eaf2ff'; c.font = '600 32px Arial, sans-serif';
    c.fillText(d.driveMode, rx, 135); c.fillText(d.powertrain === 'PHEV' ? 'PHEV iDD' : '1.5T 7DCT', rx, 225);
    c.fillText({ off: 'выкл.', drl: 'ДХО', park: 'габариты', low: 'ближний', auto: 'авто' }[d.lights] || d.lights, rx, 315);
    if (d.powertrain === 'PHEV') {
      c.fillStyle = '#7f93ad'; c.font = '500 22px Arial, sans-serif'; c.fillText('Поток энергии', rx, 375);
      const flow = d.powerKw;
      c.fillStyle = flow < 0 ? '#3ddc97' : '#5ec8ff'; c.font = '600 28px Arial, sans-serif';
      c.fillText(flow < -1 ? 'колёса → батарея' : flow > 1 ? (d.engineOn ? 'ДВС → генератор → мотор' : 'батарея → мотор') : 'ожидание', rx, 410);
      c.fillStyle = '#1b2533'; c.fillRect(rx, 440, 330, 18); c.fillStyle = '#3ddc97'; c.fillRect(rx, 440, 330 * d.soc, 18);
    } else {
      c.fillStyle = '#7f93ad'; c.font = '500 22px Arial, sans-serif'; c.fillText('Топливо', rx, 375);
      c.fillStyle = '#1b2533'; c.fillRect(rx, 395, 330, 18); c.fillStyle = '#ffb020'; c.fillRect(rx, 395, 330 * d.fuel, 18);
    }
  }
}
