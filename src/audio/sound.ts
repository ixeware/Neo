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
