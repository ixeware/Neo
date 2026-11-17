// Everything you hear is synthesized: no sound files.
// Music: a lezginka-style 6/8 drum (доул) with a reedy zurna line over it.
export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode; sfx!: GainNode; mus!: GainNode;
  muted = false; musicOn = true;
  private noise!: AudioBuffer;
  private nextBeat = 0; private beat = 0; private timer = 0;
  private last = new Map<string, number>();

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = this.musicOn ? 0.32 : 0; this.mus.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.nextBeat = c.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop() { clearInterval(this.timer); this.ctx?.close(); this.ctx = null; }
  setMuted(m: boolean) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }
  setMusic(on: boolean) { this.musicOn = on; if (this.ctx) this.mus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.2); }

  private ok(key: string, gapMs: number) {
    const now = performance.now();
    if ((this.last.get(key) ?? 0) + gapMs > now) return false;
    this.last.set(key, now);
    return !!this.ctx && !this.muted;
  }

  private tone(f: number, dur: number, type: OscillatorType, vol: number, at = 0, slide = 0, dest?: AudioNode) {
    const c = this.ctx!; const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest ?? this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, vol: number, freq: number, q = 1, at = 0, dest?: AudioNode) {
    const c = this.ctx!; const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest ?? this.sfx);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  click() { if (this.ok('click', 40)) { this.tone(900, 0.05, 'square', 0.06); } }
  deploy() { if (this.ok('deploy', 60)) { this.tone(140, 0.18, 'sine', 0.5, 0, 0.5); this.hiss(0.12, 0.25, 900, 0.8); } }
  deny() { if (this.ok('deny', 150)) { this.tone(180, 0.12, 'square', 0.12); this.tone(140, 0.16, 'square', 0.12, 0.09); } }
  hit(big: number) { if (this.ok('hit' + big, big ? 70 : 45)) { this.hiss(big ? 0.22 : 0.08, big ? 0.35 : 0.16, big ? 500 : 1800, 1.2); if (big) this.tone(90, 0.2, 'sine', 0.4, 0, 0.6); } }
  shot(k: number) {
    if (!this.ok('shot' + k, 80)) return;
    if (k === 0) { this.hiss(0.09, 0.3, 2500, 0.7); this.tone(600, 0.05, 'square', 0.05, 0, 0.3); }
    else if (k === 3) { this.tone(420, 0.12, 'triangle', 0.12, 0, 0.6); }
    else if (k === 2) { this.hiss(0.3, 0.15, 5000, 0.5); }
    else this.tone(300, 0.1, 'triangle', 0.08, 0, 1.6);
  }
  coin() { if (this.ok('coin', 120)) { this.tone(1320, 0.08, 'square', 0.06); this.tone(1760, 0.14, 'square', 0.06, 0.07); } }
  capture(good: boolean) {
    if (!this.ok('cap', 300)) return;
    const n = good ? [523, 659, 784] : [392, 330, 262];
    n.forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.18, i * 0.1));
  }
  collapse() { if (this.ok('col', 400)) { this.hiss(1.4, 0.6, 180, 0.6); this.tone(55, 1.2, 'sine', 0.6, 0, 0.5); this.hiss(0.6, 0.3, 900, 1, 0.15); } }
  gavel() { if (this.ok('gavel', 300)) { this.tone(220, 0.08, 'square', 0.2); this.hiss(0.08, 0.3, 1200, 2); this.tone(220, 0.08, 'square', 0.2, 0.16); this.hiss(0.08, 0.3, 1200, 2, 0.16); } }
  boss(s: number) {
    if (!this.ok('boss', 800)) return;
    if (s === 1) { this.tone(70, 1.1, 'sawtooth', 0.3, 0, 0.7); this.tone(105, 1.0, 'sawtooth', 0.18, 0.05, 0.7); this.hiss(0.9, 0.3, 300, 0.5); }
    else { this.tone(330, 0.7, 'sawtooth', 0.12, 0, 1.5); this.hiss(1.2, 0.2, 7000, 0.4); }
  }
  ult() { if (this.ok('ult', 300)) { this.tone(60, 0.6, 'sine', 0.7, 0, 0.4); this.hiss(0.5, 0.5, 400, 0.7); } }
  victory(win: boolean) {
    if (!this.ctx || this.muted) return;
    const n = win ? [523, 659, 784, 1047, 784, 1047] : [523, 494, 440, 392, 349, 330];
    n.forEach((f, i) => this.tone(f, 0.3, 'square', 0.1, i * 0.14));
  }
  floorUp() { if (this.ok('fu', 300)) [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, i * 0.08)); }

  // ---- heroes, rides, world events -----------------------------------------------------
  /** Noise through a band-pass whose centre slides from f0 to f1 (whoosh, rumble sweeps). */
  private sweep(dur: number, vol: number, f0: number, f1: number, q = 1, at = 0) {
    const c = this.ctx!; const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.05);
  }
  /** «Землетряс»: a long low rumble with a few thumps inside. */
  quake() {
    if (!this.ok('quake', 600)) return;
    this.hiss(1.3, 0.55, 80, 0.45); this.tone(38, 1.2, 'sine', 0.65, 0, 0.7);
    for (let i = 0; i < 4; i++) this.tone(60 + Math.random() * 25, 0.18, 'sine', 0.35, 0.12 + i * 0.22, 0.5);
  }
  /** One pulse of the quake (lighter than the cast). */
  rumble() { if (this.ok('rumble', 350)) { this.hiss(0.6, 0.35, 90, 0.5); this.tone(45, 0.5, 'sine', 0.4, 0, 0.6); } }
  /** «Взломать Пентагон»: modem-ish bit glitch. */
  hack() {
    if (!this.ok('hack', 500)) return;
    for (let i = 0; i < 9; i++) this.tone(300 + Math.random() * 1900, 0.035, 'square', 0.06, i * 0.042);
    this.hiss(0.08, 0.25, 6000, 3, 0.05); this.hiss(0.08, 0.25, 6000, 3, 0.25);
    this.tone(1200, 0.3, 'sawtooth', 0.04, 0.38, 0.25);
  }
  /** Админ ставит «Н»: a rubber stamp on paper. */
  stamp() { if (this.ok('stamp', 180)) { this.tone(120, 0.1, 'sine', 0.55, 0, 0.45); this.hiss(0.06, 0.45, 2200, 1.3); this.hiss(0.12, 0.12, 600, 0.8, 0.02); } }
  /** WOU «Рейджбайт»: a short jeer. */
  jeer() {
    if (!this.ok('jeer', 2500)) return;
    this.tone(540, 0.22, 'sawtooth', 0.05, 0, 0.72); this.tone(400, 0.32, 'sawtooth', 0.05, 0.16, 0.7);
    this.hiss(0.3, 0.06, 1100, 2, 0.05);
  }
  /** Голем: stone crack and a heavy settle. */
  golem() {
    if (!this.ok('golem', 400)) return;
    this.hiss(0.05, 0.6, 3200, 2); this.hiss(0.45, 0.45, 260, 0.7, 0.03);
    this.tone(70, 0.45, 'triangle', 0.45, 0.02, 0.5); this.hiss(0.05, 0.4, 2400, 2, 0.14);
  }
  /** Курица: clucks. */
  cluck(n = 3) {
    if (!this.ok('cluck', 300)) return;
    for (let i = 0; i < n; i++) this.tone(820 + Math.random() * 260, 0.07, 'square', 0.05, i * 0.1 + Math.random() * 0.03, 0.5);
  }
  /** Курица or Голем burst on death. */
  pop() { if (this.ok('pop', 120)) { this.hiss(0.14, 0.35, 1300, 1); this.tone(210, 0.1, 'square', 0.08, 0, 0.4); } }
  /** Такси (side 0): bright two-tone horn. Маршрутка (side 1): lower, longer. */
  horn(s: number) {
    if (!this.ok('horn' + s, 900)) return;
    if (s === 0) { this.tone(440, 0.16, 'square', 0.06); this.tone(554, 0.16, 'square', 0.05); this.tone(440, 0.22, 'square', 0.06, 0.22); this.tone(554, 0.22, 'square', 0.05, 0.22); }
    else { this.tone(294, 0.42, 'sawtooth', 0.06); this.tone(349, 0.42, 'sawtooth', 0.05); }
  }
  /** Ride unloads: sliding door / car door clunk. */
  door() { if (this.ok('door', 250)) { this.sweep(0.22, 0.18, 1800, 500, 1.4); this.tone(95, 0.12, 'square', 0.12, 0.2, 0.5); this.hiss(0.07, 0.3, 700, 1.2, 0.2); } }
  /** World event starts: a short jingle. */
  jingle() {
    if (!this.ok('jingle', 1500)) return;
    [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.13, i * 0.09));
    this.tone(1319, 0.5, 'sine', 0.06, 0.36);
  }
  /** A hero walks in. Атаги rise, Курчалой growl. */
  heroIn(s: number) {
    if (!this.ok('hero', 700)) return;
    const ch = s === 0 ? [392, 494, 587] : [220, 277, 330];
    ch.forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.045, i * 0.05, 1.02));
    this.tone(ch[0] / 2, 0.45, 'square', 0.06, 0, 1);
  }
  /** Адам убегает. */
  whoosh() { if (this.ok('whoosh', 600)) this.sweep(0.35, 0.22, 600, 4200, 1.1); }
  /** Бекхан ест лагман. */
  slurp() { if (this.ok('slurp', 800)) { this.tone(260, 0.3, 'sine', 0.12, 0, 2.1); this.tone(330, 0.2, 'sine', 0.08, 0.28, 1.6); } }
  /** «Я отравился». */
  sick() { if (this.ok('sick', 1500)) { this.tone(190, 0.45, 'sawtooth', 0.05, 0, 0.55); this.tone(150, 0.5, 'sawtooth', 0.04, 0.3, 0.6); } }
  /** «Шампунь +40 к удаче»: a dodge. */
  swish() { if (this.ok('swish', 250)) this.sweep(0.14, 0.12, 2500, 6000, 0.8); }
  // ---- v3: ersno, the admin's pack, buffs, Гелики, спортики, places ---------------------
  /** ersno's hit lifts a couple of rubles: a small coin clink. */
  steal() {
    if (!this.ok('steal', 220)) return;
    const f = 2300 + Math.random() * 500;
    this.tone(f, 0.07, 'triangle', 0.07); this.tone(f * 1.34, 0.12, 'sine', 0.05, 0.05);
    this.hiss(0.03, 0.08, 6500, 2.5);
  }
  /** «Списание с карты»: a cash register — the bell, the drawer, coins pouring. */
  cardSteal() {
    if (!this.ok('cardSteal', 600)) return;
    this.tone(95, 0.08, 'square', 0.12); this.hiss(0.06, 0.25, 1600, 1.2); // key press
    this.sweep(0.22, 0.16, 900, 300, 1.2, 0.06); // drawer slides out
    this.tone(1568, 0.5, 'sine', 0.14, 0.18); this.tone(2093, 0.6, 'sine', 0.12, 0.2); this.tone(3136, 0.3, 'sine', 0.05, 0.2); // ка-чинг
    for (let i = 0; i < 7; i++) this.tone(2200 + Math.random() * 1400, 0.06, 'triangle', 0.045, 0.3 + i * 0.05 + Math.random() * 0.02);
  }
  /** The pack falls (a whoosh), lands with a cardboard thud, and a warning beeps twice. */
  packDrop() {
    if (!this.ok('pack', 500)) return;
    this.sweep(0.5, 0.18, 2600, 380, 1.1);
    this.tone(85, 0.22, 'sine', 0.6, 0.5, 0.55); this.hiss(0.16, 0.5, 420, 0.8, 0.5); this.hiss(0.05, 0.25, 2400, 1.6, 0.5);
    this.tone(988, 0.09, 'square', 0.07, 0.72); this.tone(988, 0.09, 'square', 0.07, 0.9);
  }
  /** A scared crowd: a burst of short panicky voices (formant-ish blips), more for a bigger crowd. */
  panic(n: number) {
    if (!this.ok('panic', 900) || !this.ctx) return;
    const c = this.ctx, k = Math.min(10, 3 + Math.round(n / 2));
    for (let i = 0; i < k; i++) {
      const t = c.currentTime + 0.6 + Math.random() * 0.55;
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth';
      const f0 = 260 + Math.random() * 380;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), t + 0.12);
      f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 1400; f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.2);
    }
    this.hiss(0.5, 0.06, 1400, 0.6, 0.62);
  }
  /** «Отходняк» / «сдулись»: a long sigh, like a balloon going down. */
  comedown() {
    if (!this.ok('comedown', 2000)) return;
    this.sweep(0.9, 0.16, 1100, 260, 0.9);
    this.tone(320, 0.85, 'triangle', 0.07, 0.05, 0.4);
  }
  /** A Гелик rolls out: a V8 rumble that revs once, then a short horn blip. */
  gelik() {
    if (!this.ok('gelik', 900) || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    const lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(42, t); o.frequency.exponentialRampToValueAtTime(78, t + 0.35); o.frequency.exponentialRampToValueAtTime(48, t + 0.9);
    o2.frequency.setValueAtTime(84, t); o2.frequency.exponentialRampToValueAtTime(156, t + 0.35); o2.frequency.exponentialRampToValueAtTime(96, t + 0.9);
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2;
    lfo.frequency.value = 26; lg.gain.value = 0.06; // the burble of eight cylinders
    lfo.connect(lg); lg.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.08); g.gain.setValueAtTime(0.14, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.sfx);
    o.start(t); o2.start(t); lfo.start(t); o.stop(t + 1.05); o2.stop(t + 1.05); lfo.stop(t + 1.05);
    this.tone(415, 0.12, 'square', 0.05, 1.0); this.tone(523, 0.12, 'square', 0.04, 1.0);
  }
  /** Спортики run in: a coach's whistle, two short pips with a trill. */
  whistle() {
    if (!this.ok('whistle', 1200) || !this.ctx) return;
    const c = this.ctx;
    for (const [at, dur] of [[0, 0.12], [0.18, 0.32]]) {
      const t = c.currentTime + at;
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(2850, t);
      lfo.frequency.value = 32; lg.gain.value = 140; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.015); g.gain.setValueAtTime(0.06, t + dur - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.sfx); o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    }
    this.hiss(0.4, 0.03, 5000, 1.5);
  }
  /** A place with a perk changed hands: the admin's stamp, then a jingle that says what it gives. */
  placeTaken(good: boolean, perk: string) {
    if (!this.ok('place', 400)) return;
    this.tone(120, 0.1, 'sine', 0.5, 0, 0.45); this.hiss(0.06, 0.4, 2200, 1.3);
    if (!good) { [392, 330, 262].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.14, 0.12 + i * 0.1)); return; }
    switch (perk) {
      case 'sportiki': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, 'square', 0.06, 0.12 + i * 0.07)); break;
      case 'gelik': this.tone(415, 0.16, 'square', 0.06, 0.14); this.tone(523, 0.16, 'square', 0.05, 0.14); this.tone(415, 0.24, 'square', 0.06, 0.34); this.tone(523, 0.24, 'square', 0.05, 0.34); break;
      case 'gym': for (let i = 0; i < 2; i++) { this.tone(180, 0.18, 'triangle', 0.18, 0.14 + i * 0.22, 0.7); this.hiss(0.08, 0.2, 3000, 4, 0.14 + i * 0.22); } break;
      case 'market': this.tone(1568, 0.35, 'sine', 0.1, 0.14); this.tone(2093, 0.45, 'sine', 0.09, 0.16); break;
      default: [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.16, 0.12 + i * 0.1));
    }
  }
  /** Our place went neutral: a stamp and a falling minor third. */
  placeLost() {
    if (!this.ok('placeLost', 600)) return;
    this.tone(110, 0.1, 'sine', 0.45, 0, 0.45); this.hiss(0.06, 0.35, 1800, 1.3);
    this.tone(330, 0.25, 'triangle', 0.13, 0.12); this.tone(277, 0.4, 'triangle', 0.13, 0.3);
  }
  /** Achievement unlocked: stamp plus two bright notes. */
  achievement() {
    if (!this.ok('ach', 400)) return;
    this.tone(120, 0.1, 'sine', 0.45, 0, 0.45); this.hiss(0.06, 0.35, 2200, 1.3);
    this.tone(1047, 0.16, 'triangle', 0.1, 0.1); this.tone(1568, 0.3, 'triangle', 0.1, 0.2);
  }

  // ---- music ------------------------------------------------------------------------
  intensity = 0.4; // 0..1, follows the battle
  private schedule() {
    const c = this.ctx;
    if (!c) return;
    const bpm = 128 + this.intensity * 26; // 6/8, eighth-note pulse
    const step = 60 / bpm / 2;
    while (this.nextBeat < c.currentTime + 0.25) {
      if (this.musicOn && !this.muted) this.playBeat(this.beat, this.nextBeat);
      this.nextBeat += step;
      this.beat = (this.beat + 1) % 48;
    }
  }

  private playBeat(b: number, t: number) {
    const c = this.ctx!, i = b % 6;
    // доул: ДУМ . тэ ДУМ тэ тэ
    const pat = [2, 0, 1, 2, 1, 1];
    const v = pat[i];
    if (v) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(v === 2 ? 95 : 180, t);
      o.frequency.exponentialRampToValueAtTime(v === 2 ? 48 : 120, t + 0.12);
      g.gain.setValueAtTime(v === 2 ? 0.8 : 0.28, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (v === 2 ? 0.25 : 0.08));
      o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.3);
      if (v === 1) {
        const s = c.createBufferSource(); s.buffer = this.noise;
        const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
        const g2 = c.createGain(); g2.gain.setValueAtTime(0.12 + this.intensity * 0.1, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        s.connect(f); f.connect(g2); g2.connect(this.mus); s.start(t, Math.random() * 0.5); s.stop(t + 0.08);
      }
    }
    // zurna phrase: Phrygian dominant on D, 8 bars of 6 eighths
    const MEL = [62, -1, 63, 66, -1, 67, 69, -1, 67, 66, 63, 62, 62, -1, 63, 66, 67, 69, 70, 69, 67, 66, -1, -1,
      69, -1, 70, 69, 67, 66, 67, -1, 66, 63, 62, -1, 63, 66, 67, 66, 63, 62, 61, 62, -1, -1, -1, -1];
    const n = MEL[b];
    if (n > 0 && this.intensity > 0.15) {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square';
      o.frequency.setValueAtTime(f, t); o2.frequency.setValueAtTime(f * 1.003, t);
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.4;
      const dur = 60 / (128 + this.intensity * 26) / 2 * 0.95;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.08, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(this.mus);
      o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
    }
  }
}
