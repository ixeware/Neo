// Procedural WebAudio: engine (inline-4 firing harmonics), turbo, e-motor whine, tyres, wind, clicks, horn.
export class VehicleAudio {
  constructor() { this.ctx = null; this.on = false; this.inside = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.55;
    this.cabin = ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 18000;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(this.cabin).connect(comp).connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // engine
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 2.5;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain).connect(this.master);
    this.oscs = [['sawtooth', 1, 0.5], ['square', 2, 0.18], ['sawtooth', 0.5, 0.35], ['triangle', 4, 0.08]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(); o.type = type; const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg).connect(this.engFilter); o.start(); return { o, mul };
    });
    this.intake = ctx.createBiquadFilter(); this.intake.type = 'bandpass'; this.intake.frequency.value = 900; this.intake.Q.value = 0.8;
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    noise().connect(this.intake).connect(this.intakeGain).connect(this.master);
    // turbo whistle
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine'; this.turbo.frequency.value = 3000;
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master); this.turbo.start();
    // e-motor whine
    this.motor = ctx.createOscillator(); this.motor.type = 'sine';
    this.motor2 = ctx.createOscillator(); this.motor2.type = 'triangle';
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    this.motor.connect(this.motorGain); this.motor2.connect(this.motorGain); this.motorGain.connect(this.master);
    this.motor.start(); this.motor2.start();
    // tyres, road, wind
    this.squeal = ctx.createBiquadFilter(); this.squeal.type = 'bandpass'; this.squeal.frequency.value = 1150; this.squeal.Q.value = 9;
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    noise().connect(this.squeal).connect(this.squealGain).connect(this.master);
    this.road = ctx.createBiquadFilter(); this.road.type = 'lowpass'; this.road.frequency.value = 420;
    this.roadGain = ctx.createGain(); this.roadGain.gain.value = 0;
    noise().connect(this.road).connect(this.roadGain).connect(this.master);
    this.wind = ctx.createBiquadFilter(); this.wind.type = 'bandpass'; this.wind.frequency.value = 700; this.wind.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    noise().connect(this.wind).connect(this.windGain).connect(this.master);
    // horn
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    for (const f of [415, 498]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(this.hornGain); o.start(); }
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800;
    this.hornGain.connect(hf).connect(this.master);
    this.noiseBuf = noiseBuf;
    this.on = true;
  }

  stop() { if (this.ctx) this.ctx.suspend(); this.on = false; }

  set(param, value, tc = 0.05) { if (param) param.setTargetAtTime(value, this.ctx.currentTime, tc); }

  update(s) {
    if (!this.on || !this.ctx) return;
    const ice = s.kind === 'ICE' || s.engineOn;
    const rpm = s.kind === 'ICE' ? s.rpm : s.engineRpm || 0;
    const f = Math.max(20, (rpm / 60) * 2);
    for (const { o, mul } of this.oscs) this.set(o.frequency, f * mul, 0.03);
    this.set(this.engFilter.frequency, 250 + s.throttle * 2200 + rpm * 0.25);
    this.set(this.engGain.gain, ice ? 0.16 + s.throttle * 0.22 : 0, 0.12);
    this.set(this.intakeGain.gain, ice ? s.throttle * 0.06 * (rpm / 6000) : 0);
    this.set(this.turbo.frequency, 2600 + (s.boost || 0) * 5200);
    this.set(this.turboGain.gain, s.kind === 'ICE' ? (s.boost || 0) * s.throttle * 0.018 : 0);
    const motorHz = (s.motorRpm || 0) / 60 * 8;
    this.set(this.motor.frequency, Math.max(40, motorHz)); this.set(this.motor2.frequency, Math.max(40, motorHz * 1.5));
    this.set(this.motorGain.gain, s.kind === 'PHEV' ? Math.min(0.05, Math.abs(s.powerKw || 0) / 2000 + (s.speed > 1 ? 0.012 : 0)) : 0);
    const slip = Math.max(0, (s.slip || 0) - 0.08);
    this.set(this.squealGain.gain, Math.min(0.22, slip * 0.9) * (s.surface === 'asphalt' || s.surface === 'wet' ? 1 : 0.3), 0.04);
    this.set(this.road.frequency, s.surface === 'gravel' ? 1400 : s.surface === 'snow' ? 260 : 420);
    this.set(this.roadGain.gain, Math.min(0.25, s.speed / 120) * (s.surface === 'gravel' ? 2.2 : 1));
    this.set(this.windGain.gain, Math.min(0.25, (s.speed * s.speed) / 9000));
    this.set(this.hornGain.gain, s.horn ? 0.12 : 0, 0.01);
    this.set(this.cabin.frequency, this.inside ? 1400 : 18000, 0.2);
  }

  click() {
    if (!this.on) return;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const g = ctx.createGain(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3;
    g.gain.setValueAtTime(0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    src.connect(bp).connect(g).connect(this.master); src.start(); src.stop(ctx.currentTime + 0.05);
  }

  thump() {
    if (!this.on) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(90, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.5, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    o.connect(g).connect(this.master); o.start(); o.stop(ctx.currentTime + 0.25);
  }
}
