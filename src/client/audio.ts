import type { WeaponId } from '../sim/weapons';

/** All sound is synthesised at runtime, so the game ships with no audio files. */
interface ShotSound { noise: number; tone: number; toneEnd: number; len: number; filter: number; gain: number }

const SHOTS: Record<WeaponId, ShotSound> = {
  pistol: { noise: 0.14, tone: 300, toneEnd: 90, len: 0.14, filter: 2600, gain: 0.5 },
  smg: { noise: 0.07, tone: 420, toneEnd: 160, len: 0.07, filter: 3400, gain: 0.3 },
  rifle: { noise: 0.1, tone: 260, toneEnd: 90, len: 0.11, filter: 2400, gain: 0.38 },
  burst: { noise: 0.1, tone: 280, toneEnd: 100, len: 0.1, filter: 2600, gain: 0.42 },
  marksman: { noise: 0.2, tone: 220, toneEnd: 70, len: 0.2, filter: 2000, gain: 0.55 },
  shotgun: { noise: 0.3, tone: 150, toneEnd: 50, len: 0.3, filter: 1500, gain: 0.75 },
  sniper: { noise: 0.42, tone: 180, toneEnd: 40, len: 0.5, filter: 1800, gain: 0.85 },
  rocket: { noise: 0.4, tone: 130, toneEnd: 300, len: 0.4, filter: 900, gain: 0.6 },
  flamer: { noise: 0.07, tone: 0, toneEnd: 0, len: 0.08, filter: 700, gain: 0.16 },
  rail: { noise: 0.1, tone: 1500, toneEnd: 120, len: 0.42, filter: 4200, gain: 0.5 },
  saw: { noise: 0.06, tone: 900, toneEnd: 1500, len: 0.2, filter: 3000, gain: 0.3 },
  blade: { noise: 0.1, tone: 0, toneEnd: 0, len: 0.12, filter: 3200, gain: 0.25 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private jetGain: GainNode | null = null;
  private volume = 0.7;
  private muted = false;

  /** Browsers only allow audio after a user gesture, so call this from the first click or key. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor);
    compressor.connect(ctx.destination);
    this.master = master;
    this.applyVolume();

    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    // A looping filtered noise bed, faded in while the local player's jetpack burns.
    const jet = ctx.createBufferSource();
    jet.buffer = buffer;
    jet.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    jet.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    jet.start();
    this.jetGain = gain;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setJet(active: boolean): void {
    if (!this.ctx || !this.jetGain) return;
    this.jetGain.gain.setTargetAtTime(active ? 0.2 : 0, this.ctx.currentTime, 0.04);
  }

  private burst(len: number, freq: number, gain: number, pan: number, type: BiquadFilterType = 'lowpass'): void {
    const { ctx, master, noiseBuffer } = this;
    if (!ctx || !master || !noiseBuffer || gain <= 0.003) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const offset = Math.random() * 0.9;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter);
    filter.connect(g);
    g.connect(panner);
    panner.connect(master);
    src.start(t, offset, len + 0.02);
  }

  private tone(f0: number, f1: number, len: number, gain: number, pan: number, type: OscillatorType = 'square', delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master || gain <= 0.003) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g);
    g.connect(panner);
    panner.connect(master);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  shot(weapon: WeaponId, vol: number, pan: number): void {
    const s = SHOTS[weapon];
    this.burst(s.len, s.filter, s.gain * vol, pan);
    if (s.tone > 0) this.tone(s.tone, s.toneEnd, s.len, s.gain * vol * 0.35, pan, 'sawtooth');
  }

  explosion(vol: number, pan: number): void {
    this.burst(0.8, 650, 1.1 * vol, pan);
    this.burst(0.22, 2400, 0.5 * vol, pan);
    this.tone(120, 30, 0.7, 0.9 * vol, pan, 'sine');
  }

  impact(vol: number, pan: number): void {
    this.burst(0.05, 3800, 0.16 * vol, pan, 'bandpass');
  }

  ricochet(vol: number, pan: number): void {
    this.tone(1900, 700, 0.12, 0.09 * vol, pan, 'triangle');
  }

  hurt(vol: number, pan: number): void {
    this.burst(0.09, 900, 0.3 * vol, pan);
  }

  hitMarker(headshot: boolean): void {
    this.tone(headshot ? 1650 : 1050, headshot ? 1500 : 950, 0.06, 0.16, 0, 'square');
  }

  killConfirm(): void {
    this.tone(660, 660, 0.09, 0.15, 0, 'square');
    this.tone(990, 990, 0.14, 0.15, 0, 'square', 0.08);
  }

  death(): void {
    this.tone(320, 60, 0.6, 0.3, 0, 'sawtooth');
  }

  punch(landed: boolean, vol: number, pan: number): void {
    this.burst(0.08, landed ? 700 : 2000, (landed ? 0.5 : 0.14) * vol, pan);
  }

  reload(vol: number, pan: number): void {
    this.tone(900, 700, 0.04, 0.1 * vol, pan, 'square');
    this.tone(500, 400, 0.05, 0.1 * vol, pan, 'square', 0.12);
  }

  dry(): void {
    this.tone(1500, 1300, 0.03, 0.08, 0, 'square');
  }

  swap(): void {
    this.tone(700, 1000, 0.05, 0.07, 0, 'square');
  }

  bounce(vol: number, pan: number): void {
    this.tone(1200, 800, 0.05, 0.11 * vol, pan, 'triangle');
  }

  gas(vol: number, pan: number): void {
    this.burst(1, 1600, 0.3 * vol, pan, 'highpass');
  }

  pickup(): void {
    this.tone(620, 620, 0.07, 0.11, 0, 'triangle');
    this.tone(930, 930, 0.1, 0.11, 0, 'triangle', 0.06);
  }

  spawn(): void {
    this.tone(320, 880, 0.26, 0.09, 0, 'sine');
  }

  announce(): void {
    this.tone(440, 440, 0.11, 0.14, 0, 'square');
    this.tone(660, 660, 0.11, 0.14, 0, 'square', 0.1);
    this.tone(880, 880, 0.2, 0.14, 0, 'square', 0.2);
  }

  countdown(final: boolean): void {
    this.tone(final ? 1000 : 600, final ? 1000 : 600, final ? 0.32 : 0.1, 0.17, 0, 'square');
  }

  click(): void {
    this.tone(800, 600, 0.04, 0.08, 0, 'square');
  }
}
