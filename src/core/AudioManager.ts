import type { ShotSoundProfile } from '../weapons/WeaponDatabase';

/**
 * AudioManager — fully procedural WebAudio sound engine for ASSEMBLY (no external asset files).
 * Supports first-person weapon acoustics, 3D spatialized stereo gunfire & footsteps,
 * elimination audio chimes, and low-health cardiac heartbeat pulses.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;

  // Listener pose for 3D spatialization
  private listenerX = 0;
  private listenerY = 1.6;
  private listenerZ = 0;
  private listenerYaw = 0;

  // Counters for automated verification & telemetry
  spatialShotsPlayed = 0;
  spatialFootstepsPlayed = 0;
  eliminationChimesPlayed = 0;
  heartbeatsPlayed = 0;

  /** Must be called from a user gesture (click) to satisfy browser autoplay policies. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;
      master.connect(comp).connect(ctx.destination);

      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.noise = buffer;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /**
   * Updates the 3D listener position and camera yaw (radians) for spatialized audio.
   */
  setListenerPose(x: number, y: number, z: number, yawRad: number): void {
    this.listenerX = x;
    this.listenerY = y;
    this.listenerZ = z;
    this.listenerYaw = yawRad;
  }

  /**
   * Computes stereo pan (-1..+1) and distance attenuation (0..1) from a 3D world point.
   */
  computeSpatialParams(
    srcX: number,
    srcY: number,
    srcZ: number,
    maxDistance: number,
  ): { pan: number; gainMult: number; distance: number } {
    const dx = srcX - this.listenerX;
    const dy = srcY - this.listenerY;
    const dz = srcZ - this.listenerZ;
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= maxDistance) {
      return { pan: 0, gainMult: 0, distance };
    }

    const horizLen = Math.hypot(dx, dz);
    let pan = 0;
    if (horizLen > 0.05) {
      // Camera forward is (-sin(yaw), 0, -cos(yaw)); right is (cos(yaw), 0, -sin(yaw))
      const rightX = Math.cos(this.listenerYaw);
      const rightZ = -Math.sin(this.listenerYaw);
      const dotRight = (dx / horizLen) * rightX + (dz / horizLen) * rightZ;
      pan = Math.max(-0.95, Math.min(0.95, dotRight));
    }

    const norm = Math.max(0, 1 - distance / maxDistance);
    const gainMult = norm * norm;
    return { pan, gainMult, distance };
  }

  playShot(p: ShotSoundProfile): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.triggerGunshotNodes(ctx, this.master, p, 1.0, 2600);
  }

  /**
   * Spatialized 3D gunshot for AI bots with stereo panning and distance air-absorption filtering.
   */
  playSpatialShot(p: ShotSoundProfile, srcX: number, srcY: number, srcZ: number, maxDist = 65): void {
    const { pan, gainMult, distance } = this.computeSpatialParams(srcX, srcY, srcZ, maxDist);
    if (gainMult <= 0.01) return;
    this.spatialShotsPlayed++;

    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);

    const airCutoff = Math.max(650, 2800 - distance * 32);
    this.triggerGunshotNodes(ctx, panner, p, gainMult * 0.48, airCutoff);
  }

  private triggerGunshotNodes(
    ctx: AudioContext,
    dest: AudioNode,
    p: ShotSoundProfile,
    gainScale: number,
    bodyCutoffFreq: number,
  ): void {
    const t = ctx.currentTime;
    const sup = p.suppressed === true;

    // Supersonic crack
    this.noiseBurstTo(t, dest, {
      filter: 'bandpass',
      freq: p.crack * (0.92 + Math.random() * 0.16),
      q: sup ? 0.7 : 1.1,
      gain: p.gain * gainScale * (sup ? 0.35 : 0.9),
      attack: 0.001,
      decay: p.decay * 0.6,
    });
    // Body
    this.noiseBurstTo(t, dest, {
      filter: 'lowpass',
      freq: sup ? Math.min(900, bodyCutoffFreq) : bodyCutoffFreq,
      q: 0.6,
      gain: p.gain * gainScale * (sup ? 0.5 : 0.85),
      attack: 0.002,
      decay: p.decay * 1.5,
    });
    // Pressure thump
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.thump * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(p.thump * 0.5, t + 0.12);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.gain * gainScale * (sup ? 0.5 : 1.0)), t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + p.decay * 2.2);
    osc.connect(og).connect(dest);
    osc.start(t);
    osc.stop(t + p.decay * 2.5);
    // Reverberant tail
    this.noiseBurstTo(t + 0.01, dest, {
      filter: 'lowpass',
      freq: sup ? 500 : 900,
      q: 0.4,
      gain: p.gain * gainScale * (sup ? 0.08 : 0.22),
      attack: 0.03,
      decay: p.tail,
    });
  }

  playDryFire(): void {
    this.click(2200, 0.25, 0.03);
  }

  playMechanical(freq = 1400, gain = 0.25): void {
    this.click(freq, gain, 0.05);
    const ctx = this.ctx;
    if (ctx && this.master) {
      this.noiseBurstTo(ctx.currentTime, this.master, {
        filter: 'highpass',
        freq: freq * 1.5,
        q: 0.7,
        gain: gain * 0.5,
        attack: 0.001,
        decay: 0.04,
      });
    }
  }

  playHit(headshot: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = headshot ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(headshot ? 1720 : 920, t);
    g.gain.setValueAtTime(headshot ? 0.24 : 0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (headshot ? 0.22 : 0.065));
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  /**
   * Plays the crisp Elimination Audio Chime paired with the Red X kill hitmarker.
   */
  playEliminationChime(headshot = false): void {
    this.eliminationChimesPlayed++;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const freqs = headshot ? [784, 1174.66, 1567.98] : [659.25, 987.77];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + i * 0.055;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.22, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(g).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  }

  playKill(): void {
    this.playEliminationChime(false);
  }

  playFootstep(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.noiseBurstTo(ctx.currentTime, this.master, {
      filter: 'lowpass',
      freq: 500 + Math.random() * 200,
      q: 1,
      gain: 0.12 * intensity,
      attack: 0.002,
      decay: 0.07,
    });
  }

  /**
   * Spatialized 3D footstep for nearby AI bots.
   */
  playSpatialFootstep(srcX: number, srcY: number, srcZ: number, intensity = 1.0, maxDist = 24): void {
    const { pan, gainMult } = this.computeSpatialParams(srcX, srcY, srcZ, maxDist);
    if (gainMult <= 0.02) return;
    this.spatialFootstepsPlayed++;

    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);

    this.noiseBurstTo(ctx.currentTime, panner, {
      filter: 'lowpass',
      freq: 440 + Math.random() * 180,
      q: 1.1,
      gain: 0.16 * intensity * gainMult,
      attack: 0.002,
      decay: 0.075,
    });
  }

  /**
   * Low-health cardiac lub-dub pulse when operator health drops below 35 HP.
   */
  playHeartbeat(intensity = 1.0): void {
    this.heartbeatsPlayed++;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const pulses: Array<[number, number, number]> = [
      [0, 62, 0.22 * intensity],
      [0.14, 48, 0.16 * intensity],
    ];
    for (const [offset, startFreq, amp] of pulses) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, t + offset);
      osc.frequency.exponentialRampToValueAtTime(28, t + offset + 0.11);
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, amp), t + offset + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.12);
      osc.connect(g).connect(this.master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.14);
    }
  }

  playJump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.noiseBurstTo(ctx.currentTime, this.master, {
      filter: 'lowpass',
      freq: 700,
      q: 0.8,
      gain: 0.1,
      attack: 0.003,
      decay: 0.06,
    });
  }

  playLand(impact: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const g = Math.min(0.35, 0.05 + impact * 0.03);
    this.noiseBurstTo(ctx.currentTime, this.master, {
      filter: 'lowpass',
      freq: 380,
      q: 1,
      gain: g,
      attack: 0.002,
      decay: 0.12,
    });
  }

  playSlide(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.noiseBurstTo(ctx.currentTime, this.master, {
      filter: 'bandpass',
      freq: 1800,
      q: 0.5,
      gain: 0.12,
      attack: 0.03,
      decay: 0.55,
    });
  }

  playAmmoPickup(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.click(1750, 0.22, 0.035);
    [587.33, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      g.gain.setValueAtTime(0.0001, t + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(0.16, t + idx * 0.055 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.055 + 0.14);
      osc.connect(g).connect(this.master!);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.16);
    });
  }

  playWeaponSwap(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.playMechanical(1180, 0.28);
    window.setTimeout(() => this.playMechanical(1620, 0.22), 90);
  }

  private click(freq: number, gain: number, decay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + decay);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  private noiseBurstTo(
    t: number,
    dest: AudioNode,
    o: { filter: BiquadFilterType; freq: number; q: number; gain: number; attack: number; decay: number },
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.frequency.value = o.freq;
    filter.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    src.connect(filter).connect(g).connect(dest);
    src.start(t, Math.random() * 1.2);
    src.stop(t + o.attack + o.decay + 0.05);
  }
}
