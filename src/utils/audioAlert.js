// Web Audio API Tactical Alarm & Emergency Siren Synthesizer
class SoundController {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
    this.isSirenActive = false;
    this.sirenNodes = null;
    this.sirenTimer = null;
    this.listeners = new Set();
    this.setupUserGestureUnlock();
  }

  setupUserGestureUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.initContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
    window.addEventListener('click', unlock, { once: true, passive: true });

    // Also attempt eager init — works on HTTPS Chromium without gesture
    setTimeout(() => this.initContext(), 500);
  }

  initContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          this.audioCtx = new AudioContextClass();
        } catch (e) {
          console.debug('AudioContext init error:', e);
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Force-unlock AudioContext. Called before every siren trigger so the
   * context is ready even if the user hasn't interacted with the page yet.
   */
  forceInit() {
    this.initContext();
    // If still suspended (autoplay policy), queue a resume on next gesture
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      const resume = () => {
        this.audioCtx?.resume().catch(() => {});
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('click', resume);
      };
      window.addEventListener('pointerdown', resume, { once: true, passive: true });
      window.addEventListener('click', resume, { once: true, passive: true });
    }
  }


  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.isSirenActive, this.isMuted);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach((cb) => {
      try {
        cb(this.isSirenActive, this.isMuted);
      } catch (err) {
        console.debug('Listener callback error:', err);
      }
    });
  }

  /**
   * Triggers the continuous tactical weapon siren.
   * If already playing, refreshes the hold-off timer (latch) so the siren
   * continues smoothly without clicking, popping, or overlapping.
   * When no weapon is detected for holdDurationMs, the siren winds down.
   */
  triggerWeaponSiren(holdDurationMs = 2800) {
    if (this.isMuted) return;
    this.forceInit(); // ensures AudioContext exists and is resumed

    // If context still not available or suspended, bail — will fire on next gesture
    if (!this.audioCtx || this.audioCtx.state === 'suspended') return;

    // Reset auto-stop countdown timer
    if (this.sirenTimer) {
      clearTimeout(this.sirenTimer);
    }

    if (!this.isSirenActive) {
      this.startSirenAudio();
    }

    this.sirenTimer = setTimeout(() => {
      this.stopSirenAudio();
    }, holdDurationMs);
  }

  /**
   * Plays a one-shot siren burst of specified duration in seconds.
   */
  playSirenBurst(durationSeconds = 3.2) {
    this.triggerWeaponSiren(durationSeconds * 1000);
  }

  startSirenAudio() {
    if (this.isMuted || this.sirenNodes || !this.audioCtx) return;

    try {
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;

      // 1. Modulation LFO (Pitch sweeping up and down at ~0.82 Hz)
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(0.82, now);

      // Depth of pitch sweep: +/- 360 Hz
      const lfoCarrierGain = ctx.createGain();
      lfoCarrierGain.gain.setValueAtTime(360, now);

      // Sub-harmonic depth: +/- 180 Hz
      const lfoSubGain = ctx.createGain();
      lfoSubGain.gain.setValueAtTime(180, now);

      lfo.connect(lfoCarrierGain);
      lfo.connect(lfoSubGain);

      // 2. Primary Carrier Oscillator (Sharp, piercing sawtooth defense siren)
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(880, now); // Sweeps 520Hz -> 1240Hz
      lfoCarrierGain.connect(carrier.frequency);

      // 3. Sub-Octave Oscillator (Rumbling low-frequency tone for defense horn punch)
      const sub = ctx.createOscillator();
      sub.type = 'sawtooth';
      sub.frequency.setValueAtTime(440, now); // Sweeps 260Hz -> 620Hz
      lfoSubGain.connect(sub.frequency);

      // 4. Detune Chorus Oscillator (+6 cents detuned for authentic mechanical horn chorus)
      const detuneOsc = ctx.createOscillator();
      detuneOsc.type = 'sawtooth';
      detuneOsc.frequency.setValueAtTime(883, now);
      lfoCarrierGain.connect(detuneOsc.frequency);

      // 5. Low-Pass Resonant Filter (Acoustic horn resonance, cuts harsh high digital fizz)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600, now);
      filter.Q.setValueAtTime(2.4, now);

      // 6. Mixer Gains
      const carrierGain = ctx.createGain();
      carrierGain.gain.setValueAtTime(0.20, now);

      const subGainNode = ctx.createGain();
      subGainNode.gain.setValueAtTime(0.14, now);

      const detuneGain = ctx.createGain();
      detuneGain.gain.setValueAtTime(0.12, now);

      carrier.connect(carrierGain);
      sub.connect(subGainNode);
      detuneOsc.connect(detuneGain);

      carrierGain.connect(filter);
      subGainNode.connect(filter);
      detuneGain.connect(filter);

      // 7. Master Output Gain with smooth attack envelope
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(0.26, now + 0.18);

      filter.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Start sound sources
      lfo.start(now);
      carrier.start(now);
      sub.start(now);
      detuneOsc.start(now);

      this.sirenNodes = {
        lfo,
        carrier,
        sub,
        detuneOsc,
        masterGain,
      };

      this.isSirenActive = true;
      this.notifyListeners();
    } catch (e) {
      console.warn("Siren synthesis error:", e);
    }
  }

  stopSirenAudio(immediate = false) {
    if (!this.sirenNodes || !this.audioCtx) {
      this.isSirenActive = false;
      this.notifyListeners();
      return;
    }

    try {
      const nodes = this.sirenNodes;
      this.sirenNodes = null;
      if (this.sirenTimer) {
        clearTimeout(this.sirenTimer);
        this.sirenTimer = null;
      }

      const now = this.audioCtx.currentTime;
      const releaseTime = immediate ? 0.05 : 0.45;

      // Smooth volume ramp down
      nodes.masterGain.gain.cancelScheduledValues(now);
      nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
      nodes.masterGain.gain.linearRampToValueAtTime(0.0001, now + releaseTime);

      setTimeout(() => {
        try {
          nodes.carrier.stop();
          nodes.sub.stop();
          nodes.detuneOsc.stop();
          nodes.lfo.stop();
          nodes.carrier.disconnect();
          nodes.sub.disconnect();
          nodes.detuneOsc.disconnect();
          nodes.lfo.disconnect();
          nodes.masterGain.disconnect();
        } catch (_) {}
      }, (releaseTime + 0.1) * 1000);
    } catch (e) {
      console.warn("Error stopping siren:", e);
    } finally {
      this.isSirenActive = false;
      this.notifyListeners();
    }
  }

  /**
   * Silence all active sirens immediately.
   */
  silence() {
    this.stopSirenAudio(true);
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.silence();
    }
    this.notifyListeners();
    return this.isMuted;
  }

  setMute(mute) {
    this.isMuted = !!mute;
    if (this.isMuted) {
      this.silence();
    }
    this.notifyListeners();
  }

  playBreachAlarm() {
    this.playSirenBurst(2.0);
  }

  playWarningChime() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      const now = this.audioCtx.currentTime;

      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.15); // A5

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn("Audio Context error:", e);
    }
  }

  playClick() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.audioCtx) return;

    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'triangle';
      const now = this.audioCtx.currentTime;
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      // ignore
    }
  }
}

export const soundController = new SoundController();

/**
 * Validates whether a detection is a genuine unauthorized weapon threat.
 * Returns false if:
 * 1. The detection itself is authorized (is_authorized === true or threat_level === 'AUTHORIZED')
 * 2. The item is held by an authorized person
 * 3. An authorized sentry in the scene is wielding the weapon
 * 4. The item is a casual object (phone, watch, baggage)
 */
export function isUnauthorizedWeaponThreat(det, allDets = []) {
  if (!det) return false;

  // 1. Direct authorization clearance
  if (det.is_authorized || det.is_weapon_authorized || det.threat_level === 'AUTHORIZED') {
    return false;
  }

  // 2. Reject casual / non-weapon items
  if (det.is_casual_object || det.held_item_type === 'CASUAL_OBJECT') {
    return false;
  }
  const name = (det.class_name || '').toLowerCase();
  const held = (det.held_item || '').toLowerCase();
  const unusual = (det.unusual_item || '').toLowerCase();
  if (
    name.includes('watch') || held.includes('watch') || unusual.includes('watch') ||
    name.includes('unknown') || held.includes('unknown') || unusual.includes('unknown')
  ) {
    return false;
  }

  // 3. Check if held by an authorized person
  if (det.held_by_target_id) {
    const holder = allDets.find((d) => d.target_id === det.held_by_target_id);
    if (holder && (holder.is_authorized || holder.is_weapon_authorized || holder.threat_level === 'AUTHORIZED')) {
      return false;
    }
  }

  // 4. If any person in the frame is authorized and holding, and this is a held weapon
  const hasAuthorizedHolder = allDets.some(
    (d) => (d.is_authorized || d.is_weapon_authorized || d.threat_level === 'AUTHORIZED') &&
           (d.is_holding || d.held_item_type === 'WEAPON')
  );
  if (hasAuthorizedHolder && (det.is_held || det.is_holding)) {
    return false;
  }

  // 5. Genuine weapon threat: either an armed person or an unheld weapon object
  const isArmed = det.is_holding && det.held_item_type === 'WEAPON';
  const isWeapon = Boolean(det.is_weapon);
  return isArmed || isWeapon;
}

