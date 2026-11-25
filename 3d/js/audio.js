// 音：WebAudio でその場で合成する（音のファイルは使わない）。銃声は武器ごとの作り方、立体的な位置（HRTF）、残響、BGM のシーケンサー
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

const GUN = {
  pistol:   { f: 190, fd: 0.07, nf: 2600, nq: 0.8, d: 0.11, tail: 0.28, v: 0.62, crack: 0.5 },
  sniper:   { f: 85,  fd: 0.28, nf: 1700, nq: 0.6, d: 0.24, tail: 1.1,  v: 1.0,  crack: 1.0 },
  smg:      { f: 230, fd: 0.045, nf: 3300, nq: 0.9, d: 0.055, tail: 0.14, v: 0.42, crack: 0.3 },
  shotgun:  { f: 68,  fd: 0.22, nf: 1100, nq: 0.5, d: 0.2,  tail: 0.75, v: 1.0,  crack: 0.6 },
  ar:       { f: 150, fd: 0.07, nf: 2500, nq: 0.8, d: 0.08, tail: 0.24, v: 0.52, crack: 0.45 },
  burst:    { f: 170, fd: 0.06, nf: 2900, nq: 0.9, d: 0.07, tail: 0.22, v: 0.5,  crack: 0.45 },
  revolver: { f: 105, fd: 0.15, nf: 1900, nq: 0.7, d: 0.16, tail: 0.6,  v: 0.85, crack: 0.8 },
  lmg:      { f: 125, fd: 0.08, nf: 2100, nq: 0.7, d: 0.09, tail: 0.26, v: 0.52, crack: 0.4 },
  focus:    { f: 260, fd: 0.06, nf: 4200, nq: 1.2, d: 0.08, tail: 0.5,  v: 0.6,  crack: 0.7 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 0.9, music: 0.45 };
    this.voices = 0;
    this.musicOn = false;
    this.intensity = 0;
    this.hrtf = !(/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 10; this.comp.ratio.value = 5; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    // 残響（その場で作ったインパルス応答）
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(2.4, 2.6);
    this.verbGain = c.createGain(); this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.verbSend = c.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.verb);
    // ノイズ
    const n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // 音楽用のディレイ
    this.delay = c.createDelay(1); this.delay.delayTime.value = 60 / 112 * 0.75;
    this.fb = c.createGain(); this.fb.gain.value = 0.38;
    this.delayOut = c.createGain(); this.delayOut.gain.value = 0.5;
    this.delay.connect(this.fb); this.fb.connect(this.delay); this.delay.connect(this.delayOut); this.delayOut.connect(this.music);
    this.applyVolume();
  }

  impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return b;
  }

  applyVolume() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
  }

  // 聞いている人＝カメラ
  listen(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position, t = this.ctx.currentTime;
    const f = this._f || (this._f = { x: 0, y: 0, z: -1 });
    const e = cam.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(e[4], t, 0.02); L.upY.setTargetAtTime(e[5], t, 0.02); L.upZ.setTargetAtTime(e[6], t, 0.02);
    } else if (L.setPosition) { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, e[4], e[5], e[6]); }
  }

  // 出口：位置があれば立体音響、無ければ真ん中
  out(pos, gain, verb) {
    const c = this.ctx, g = c.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = c.createPanner();
      p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = 3.5; p.rolloffFactor = 1.1; p.maxDistance = 150;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(this.sfx);
      if (verb) { const s = c.createGain(); s.gain.value = verb; p.connect(s); s.connect(this.verbSend); }
    } else {
      g.connect(this.sfx);
      if (verb) { const s = c.createGain(); s.gain.value = verb; g.connect(s); s.connect(this.verbSend); }
    }
    return g;
  }

  osc(type, f0, f1, t0, dur, dest, gain, attack) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + (attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  noiseHit(t0, dur, dest, gain, ftype, f0, f1, q, attack) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = ftype || 'bandpass'; f.frequency.setValueAtTime(f0, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur); f.Q.value = q || 0.8;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + (attack || 0.002)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  }

  ok() { return this.ctx && this.ctx.state === 'running'; }
  voice(dur) { if (this.voices > 40) return false; this.voices++; setTimeout(() => { this.voices--; }, dur * 1000 + 60); return true; }

  // 銃声
  gun(key, pos, mine) {
    if (!this.ok()) return;
    const P = GUN[key] || GUN.ar;
    if (!this.voice(P.tail)) return;
    const t = this.ctx.currentTime, o = this.out(mine ? null : pos, mine ? P.v * 0.8 : P.v * 1.3, 0.35 + P.tail * 0.3);
    const pv = 0.94 + Math.random() * 0.12;
    this.osc('sine', P.f * 1.8 * pv, P.f * 0.6, t, P.fd * 2.2, o, 0.9);
    this.osc('triangle', P.f * 3 * pv, P.f, t, P.fd, o, 0.35);
    this.noiseHit(t, P.d, o, 1.0, 'bandpass', P.nf * pv, P.nf * 0.35, P.nq);
    this.noiseHit(t, P.tail, o, 0.22, 'lowpass', P.nf * 0.6, 200, 0.5, 0.01);
    if (P.crack) this.noiseHit(t, 0.03, o, 0.5 * P.crack, 'highpass', 5000, 3000, 0.7);
  }

  play(name, pos, opt) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime, o = opt || {};
    const out = (g, v) => this.out(pos || null, g, v);
    switch (name) {
      case 'grenadeFire': { const d = out(0.8, 0.3); this.osc('sine', 140, 45, t, 0.25, d, 0.9); this.noiseHit(t, 0.18, d, 0.5, 'lowpass', 900, 200, 0.6); break; }
      case 'explosion': {
        if (!this.voice(1.8)) return;
        const d = out(1.5, 0.6);
        this.osc('sine', 95, 28, t, 1.1, d, 1.0, 0.005);
        this.noiseHit(t, 1.6, d, 1.0, 'lowpass', 2400, 90, 0.4, 0.004);
        this.noiseHit(t, 0.25, d, 0.6, 'bandpass', 1400, 400, 0.6);
        break;
      }
      case 'railCharge': { const d = out(0.35, 0.1); this.osc('sawtooth', 180, 1400, t, o.dur || 0.42, d, 0.25, 0.05); this.osc('sine', 360, 2800, t, o.dur || 0.42, d, 0.2, 0.05); break; }
      case 'rail': {
        const d = out(1.1, 0.5);
        this.osc('sawtooth', 2400, 80, t, 0.45, d, 0.5);
        this.osc('square', 900, 60, t, 0.3, d, 0.25);
        this.noiseHit(t, 0.6, d, 0.6, 'bandpass', 5000, 300, 1.4);
        break;
      }
      case 'focusFull': { const d = out(0.35, 0.3); this.osc('sine', 1760, 1760, t, 0.25, d, 0.4); this.osc('sine', 2637, 2637, t + 0.03, 0.3, d, 0.25); break; }
      case 'focusPerfect': { const d = out(0.6, 0.5); this.osc('sine', 1318, 2637, t, 0.35, d, 0.5); this.osc('triangle', 659, 1318, t, 0.4, d, 0.4); break; }
      case 'swing': { const d = out(0.5, 0.1); this.noiseHit(t, o.dur || 0.2, d, 0.7, 'bandpass', 500, 2500, 1.6, 0.03); break; }
      case 'meleeHit': { const d = out(0.9, 0.2); this.osc('sine', 160, 50, t, 0.18, d, 0.9); this.noiseHit(t, 0.12, d, 0.7, 'lowpass', 1800, 300, 0.6); if (o.heavy) this.osc('square', 90, 30, t, 0.3, d, 0.4); break; }
      case 'hitmark': { const d = out(0.32); this.osc('square', 2300, 1900, t, 0.035, d, 0.35); break; }
      case 'headshot': { const d = out(0.45); this.osc('sine', 1850, 1850, t, 0.22, d, 0.5); this.osc('sine', 2770, 2770, t, 0.3, d, 0.28); break; }
      case 'kill': { const d = out(0.5); this.osc('triangle', 880, 880, t, 0.12, d, 0.5); this.osc('triangle', 1318, 1318, t + 0.08, 0.25, d, 0.5); this.osc('sine', 1760, 1760, t + 0.08, 0.35, d, 0.25); break; }
      case 'hurt': { const d = out(0.55); this.osc('sine', 120, 60, t, 0.16, d, 0.8); this.noiseHit(t, 0.08, d, 0.3, 'lowpass', 600, 200, 0.5); break; }
      case 'reload': {
        const d = out(0.4, 0.05), k = o.dur || 1.5;
        this.noiseHit(t + 0.05, 0.04, d, 0.6, 'bandpass', 3200, 2600, 3);
        this.osc('square', 600, 400, t + 0.06, 0.03, d, 0.15);
        this.noiseHit(t + k * 0.55, 0.05, d, 0.6, 'bandpass', 2200, 1600, 3);
        this.noiseHit(t + k * 0.9, 0.04, d, 0.8, 'bandpass', 3800, 3000, 4);
        this.osc('square', 900, 700, t + k * 0.9, 0.03, d, 0.2);
        break;
      }
      case 'swap': { const d = out(0.35); this.noiseHit(t, 0.05, d, 0.5, 'bandpass', 2800, 2000, 2.5); this.osc('square', 520, 520, t + 0.03, 0.03, d, 0.12); break; }
      case 'empty': { const d = out(0.3); this.osc('square', 1400, 1200, t, 0.03, d, 0.2); break; }
      case 'jump': { const d = out(0.3, 0.05); this.noiseHit(t, 0.16, d, 0.4, 'bandpass', 700, 1500, 1); break; }
      case 'land': { const d = out(0.4, 0.05); this.osc('sine', 110, 60, t, 0.1, d, 0.5 * (o.k || 1)); this.noiseHit(t, 0.08, d, 0.3, 'lowpass', 700, 200, 0.5); break; }
      case 'step': { const d = out(0.14 * (o.k || 1)); this.noiseHit(t, 0.05, d, 0.6, 'bandpass', 900 + Math.random() * 500, 300, 1.2); break; }
      case 'pad': { const d = out(0.7, 0.3); this.osc('sine', 160, 900, t, 0.5, d, 0.6, 0.02); this.osc('triangle', 320, 1800, t, 0.4, d, 0.25, 0.02); this.noiseHit(t, 0.4, d, 0.3, 'bandpass', 500, 3000, 1.2, 0.05); break; }
      case 'roll': { const d = out(0.5, 0.05); this.noiseHit(t, 0.28, d, 0.6, 'bandpass', 400, 2200, 1.3, 0.02); break; }
      case 'parry': { const d = out(0.6, 0.4); [1567, 2093, 2637].forEach((f, i) => this.osc('sine', f, f * 0.98, t + i * 0.01, 0.5, d, 0.22)); break; }
      case 'parryHit': { const d = out(1.0, 0.6); this.osc('square', 2200, 1100, t, 0.25, d, 0.3); [1318, 1975, 2637, 3520].forEach((f) => this.osc('sine', f, f, t, 0.8, d, 0.2)); this.noiseHit(t, 0.1, d, 0.6, 'highpass', 4000, 6000, 1); break; }
      case 'rewind': { const d = out(0.7, 0.5); this.osc('sawtooth', 1600, 200, t, 0.45, d, 0.18, 0.02); this.osc('sine', 800, 100, t, 0.5, d, 0.3, 0.02); this.noiseHit(t, 0.45, d, 0.25, 'bandpass', 4000, 300, 2, 0.05); break; }
      case 'decoy': { const d = out(0.6, 0.5); [880, 1108, 1318, 1760].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.04, 0.35, d, 0.18)); break; }
      case 'pierce': { const d = out(0.7, 0.3); this.osc('sawtooth', 220, 880, t, 0.3, d, 0.25, 0.02); this.osc('square', 110, 440, t, 0.3, d, 0.15, 0.02); break; }
      case 'pierceShot': { const d = out(0.5, 0.2); this.osc('sawtooth', 1400, 300, t, 0.18, d, 0.25); break; }
      case 'heal': { const d = out(0.6, 0.5); [523, 659, 784, 1046, 1318].forEach((f, i) => this.osc('sine', f, f, t + i * 0.06, 0.45, d, 0.25)); break; }
      case 'beep': { const d = out(0.5); this.osc('square', o.f || 880, o.f || 880, t, 0.14, d, 0.22); this.osc('sine', (o.f || 880) * 2, (o.f || 880) * 2, t, 0.14, d, 0.1); break; }
      case 'go': { const d = out(0.6, 0.3); [523, 659, 784, 1046].forEach((f) => this.osc('sawtooth', f, f, t, 0.5, d, 0.09)); this.osc('sine', 1046, 1046, t, 0.6, d, 0.25); break; }
      case 'win': { const d = out(0.6, 0.5); [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36], [1318, 0.5]].forEach(([f, k]) => { this.osc('triangle', f, f, t + k, 0.6, d, 0.3); this.osc('sine', f * 2, f * 2, t + k, 0.4, d, 0.08); }); break; }
      case 'lose': { const d = out(0.5, 0.5); [[392, 0], [349, 0.18], [311, 0.36], [261, 0.56]].forEach(([f, k]) => this.osc('triangle', f, f * 0.98, t + k, 0.55, d, 0.3)); break; }
      case 'ui': { const d = out(0.25); this.osc('sine', o.f || 1200, (o.f || 1200) * 1.2, t, 0.06, d, 0.25); break; }
      case 'uiBig': { const d = out(0.35, 0.2); this.osc('triangle', 660, 990, t, 0.12, d, 0.3); this.osc('sine', 1320, 1980, t + 0.04, 0.16, d, 0.18); break; }
      case 'thunder': {
        if (!this.voice(4)) return;
        const d = out(0.9, 0.8);
        this.noiseHit(t, 0.3, d, 0.6, 'lowpass', 3000, 400, 0.4, 0.005);
        this.noiseHit(t + 0.1, 3.4, d, 0.8, 'lowpass', 500, 40, 0.3, 0.3);
        break;
      }
      case 'death': { const d = out(0.7, 0.4); this.osc('sawtooth', 600, 60, t, 0.6, d, 0.2); this.osc('sine', 300, 40, t, 0.7, d, 0.4); break; }
      case 'fall': { const d = out(0.5, 0.3); this.noiseHit(t, 1.2, d, 0.5, 'bandpass', 2000, 200, 1, 0.2); break; }
      case 'spawn': { const d = out(0.5, 0.4); this.osc('sine', 300, 1200, t, 0.35, d, 0.3, 0.02); this.noiseHit(t, 0.35, d, 0.2, 'highpass', 3000, 8000, 1, 0.05); break; }
      case 'heart': { const d = out(0.5); this.osc('sine', 70, 45, t, 0.12, d, 0.9, 0.006); this.osc('sine', 62, 40, t + 0.16, 0.12, d, 0.6, 0.006); break; }
      case 'whiz': { const d = out(0.4); this.noiseHit(t, 0.09, d, 0.5, 'bandpass', 3500, 1200, 3, 0.01); break; }
    }
  }

  // ---- BGM：4つの和音の進行（Am-F-C-G）に、ベース・パッド・アルペジオ・ドラム。intensity で戦いの盛り上がり ----
  startMusic(kind) {
    if (!this.ctx) return;
    this.kind = kind || 'menu';
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0; this.nextT = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  stopMusic() { this.musicOn = false; clearInterval(this.timer); }
  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const spb = 60 / (this.kind === 'battle' ? 124 : 96) / 4;
    while (this.nextT < this.ctx.currentTime + 0.14) { this.note(this.step, this.nextT, spb); this.step++; this.nextT += spb; }
  }
  note(s, t, spb) {
    const prog = this.kind === 'battle' ? [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] : [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
    const bar = Math.floor(s / 16) % 4, k = s % 16, ch = prog[bar], M = this.music, battle = this.kind === 'battle';
    // パッド（小節の頭）
    if (k === 0) {
      for (const n of ch) for (const det of [-6, 5]) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = NOTE(n); o.detune.value = det;
        f.type = 'lowpass'; f.frequency.value = battle ? 1500 : 900; f.Q.value = 0.4;
        const len = spb * 16;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.022, t + len * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.02);
        o.connect(f); f.connect(g); g.connect(M); o.start(t); o.stop(t + len * 1.05);
      }
    }
    // ベース
    const bassPat = battle ? [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1] : [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    if (bassPat[k]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = NOTE(ch[0] - 24 + (k === 14 && battle ? 12 : 0));
      f.type = 'lowpass'; f.frequency.setValueAtTime(battle ? 900 : 500, t); f.frequency.exponentialRampToValueAtTime(120, t + spb * 1.8); f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(battle ? 0.12 : 0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 1.9);
      o.connect(f); f.connect(g); g.connect(M); o.start(t); o.stop(t + spb * 2);
    }
    // アルペジオ
    const arpOn = battle ? k % 2 === 0 || this.intensity > 0.5 : k % 2 === 0;
    if (arpOn) {
      const seq = [0, 1, 2, 1, 2, 0, 1, 2], n = ch[seq[(k >> 1) % 8]] + 12 + (k >= 8 && bar % 2 ? 12 : 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = battle ? 'square' : 'triangle'; o.frequency.value = NOTE(n);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(battle ? 0.022 : 0.03, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 1.5);
      o.connect(g); g.connect(M); g.connect(this.delay); o.start(t); o.stop(t + spb * 1.6);
    }
    if (!battle) return;
    // ドラム
    const kick = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1][k], snare = k === 4 || k === 12, hat = k % 2 === 1 || this.intensity > 0.6;
    if (kick) this.osc('sine', 140, 42, t, 0.28, M, 0.55, 0.002);
    if (snare) { this.noiseHit(t, 0.16, M, 0.22, 'bandpass', 1800, 900, 0.8); this.osc('triangle', 200, 160, t, 0.1, M, 0.15); }
    if (hat) this.noiseHit(t, 0.035, M, k % 4 === 2 ? 0.08 : 0.045, 'highpass', 7500, 9000, 0.7);
  }
}
