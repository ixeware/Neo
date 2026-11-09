// Drive-mode HUD: speed, gear, rpm/power, energy, assists, g-meter, mini-map, lap timer.
const $ = (id) => document.getElementById(id);
const fmt = (t) => (t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`);

export class HUD {
  constructor(track) {
    this.track = track;
    this.el = { root: $('hud'), speed: $('hud-speed'), gear: $('hud-gear'), abs: $('f-abs'), tcs: $('f-tcs'), esp: $('f-esp'), lap: $('lap-time'), best: $('lap-best'), surf: $('lap-surface') };
    this.gauge = $('hud-gauge').getContext('2d');
    this.energy = $('hud-energy').getContext('2d');
    this.g = $('hud-g').getContext('2d');
    this.map = $('hud-map').getContext('2d');
    this.trail = [];
    this.acc = 0;
    this.lap = { t: 0, best: null, armed: false, dist: 0, lastZ: 0, running: false };
    this.prepMap();
  }

  show(on) { this.el.root.hidden = !on; }

  prepMap() {
    const pts = this.track.track2D;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    this.bounds = { minX: Math.min(...xs) - 30, maxX: Math.max(...xs) + 200, minZ: Math.min(...zs) - 30, maxZ: Math.max(...zs) + 30 };
  }

  updateLap(dt, pos, vel) {
    const L = this.lap;
    L.dist += vel.length() * dt;
    if (L.running) L.t += dt;
    const crossed = L.lastZ < 0 && pos.z >= 0 && Math.abs(pos.x) < 7 && vel.z > 0;
    L.lastZ = pos.z;
    if (crossed) {
      if (L.running && L.dist > 1500) { L.best = L.best == null ? L.t : Math.min(L.best, L.t); }
      L.running = true; L.t = 0; L.dist = 0;
    }
  }

  update(dt, s) {
    this.updateLap(dt, s.pos, s.vel);
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const e = this.el;
    e.speed.textContent = Math.round(Math.abs(s.speedKmh));
    e.gear.textContent = s.gear;
    e.abs.classList.toggle('on', s.flags.abs); e.tcs.classList.toggle('on', s.flags.tcs); e.esp.classList.toggle('on', s.flags.esp);
    e.lap.textContent = fmt(this.lap.running ? this.lap.t : null);
    e.best.textContent = `лучший ${fmt(this.lap.best)}`;
    e.surf.textContent = `${s.surface} · ${s.driveMode}`;
    this.drawGauge(s); this.drawEnergy(s); this.drawG(s); this.drawMap(s);
  }

  arc(ctx, cx, cy, r, f, color, width = 8) {
    ctx.lineCap = 'round'; ctx.lineWidth = width;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke();
    ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.85, Math.PI * (0.85 + 1.3 * Math.max(0, Math.min(1, f)))); ctx.stroke();
  }

  drawGauge(s) {
    const c = this.gauge, W = 150, H = 86;
    c.clearRect(0, 0, W, H);
    c.textAlign = 'center'; c.fillStyle = '#e7ebf1';
    if (s.kind === 'PHEV') {
      const f = (s.powerKw + 40) / 200;
      this.arc(c, W / 2, 56, 40, f, s.powerKw < 0 ? '#3ddc97' : '#4fb6ff');
      c.font = '600 16px "JetBrains Mono", monospace'; c.fillText(`${Math.round(s.powerKw)}`, W / 2, 58);
      c.font = '500 10px "Golos Text", sans-serif'; c.fillStyle = '#8e98a8'; c.fillText(s.engineOn ? 'кВт · ДВС' : 'кВт · EV', W / 2, 74);
    } else {
      this.arc(c, W / 2, 56, 40, s.rpm / 7000, s.rpm > 6000 ? '#ff5a5a' : '#4fb6ff');
      c.font = '600 16px "JetBrains Mono", monospace'; c.fillText((s.rpm / 1000).toFixed(1), W / 2, 58);
      c.font = '500 10px "Golos Text", sans-serif'; c.fillStyle = '#8e98a8'; c.fillText('×1000 об/мин', W / 2, 74);
    }
  }

  drawEnergy(s) {
    const c = this.energy, W = 120, H = 86;
    c.clearRect(0, 0, W, H);
    const f = s.kind === 'PHEV' ? s.soc : s.fuel;
    this.arc(c, W / 2, 56, 34, f, f < 0.15 ? '#ffb020' : '#3ddc97', 7);
    c.textAlign = 'center'; c.fillStyle = '#e7ebf1'; c.font = '600 15px "JetBrains Mono", monospace'; c.fillText(`${Math.round(f * 100)}%`, W / 2, 58);
    c.font = '500 10px "Golos Text", sans-serif'; c.fillStyle = '#8e98a8'; c.fillText(s.kind === 'PHEV' ? 'батарея' : 'топливо', W / 2, 74);
  }

  drawG(s) {
    const c = this.g, W = 150, cx = 75, cy = 75, R = 60;
    c.clearRect(0, 0, W, W);
    c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
    for (const r of [R / 2, R]) { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
    const px = cx - (s.accelG.x / 1.2) * R, py = cy - (s.accelG.z / 1.2) * R;
    this.trail.push([px, py]); if (this.trail.length > 60) this.trail.shift();
    c.strokeStyle = 'rgba(79,182,255,0.35)'; c.beginPath(); this.trail.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
    c.fillStyle = '#4fb6ff'; c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8e98a8'; c.font = '500 10px "JetBrains Mono", monospace'; c.textAlign = 'center';
    c.fillText(`${Math.hypot(s.accelG.x, s.accelG.z).toFixed(2)} g`, cx, W - 4);
    c.fillText('1.2 g', cx + R - 10, cy - 4);
  }

  drawMap(s) {
    const c = this.map, W = 200, b = this.bounds;
    c.clearRect(0, 0, W, W);
    const sc = Math.min((W - 20) / (b.maxX - b.minX), (W - 20) / (b.maxZ - b.minZ));
    const tx = (x) => 10 + (b.maxX - x) * sc, tz = (z) => W - 10 - (z - b.minZ) * sc;
    c.lineJoin = 'round'; c.strokeStyle = 'rgba(160,176,198,0.35)'; c.lineWidth = 5; c.beginPath();
    this.track.track2D.forEach(([x, z], i) => (i ? c.lineTo(tx(x), tz(z)) : c.moveTo(tx(x), tz(z)))); c.closePath(); c.stroke();
    c.fillStyle = 'rgba(160,176,198,0.25)';
    for (const z of this.zones || []) c.fillRect(tx(z.x1), tz(z.z1), (z.x1 - z.x0) * sc, (z.z1 - z.z0) * sc);
    c.save(); c.translate(tx(s.pos.x), tz(s.pos.z)); c.rotate(-s.heading);
    c.fillStyle = '#4fb6ff'; c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill(); c.restore();
  }
}
