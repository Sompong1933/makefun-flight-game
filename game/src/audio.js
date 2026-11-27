// Sound, all synthesized in the browser: an engine hum that follows the throttle, a chime for
// a ring, a warning beep and a touchdown thud. Nothing is loaded from the network, and every
// call is guarded so a browser without audio still plays.

export function createAudio() {
  let context = null;
  let engine = null;
  let engineGain = null;
  let muted = false;

  function ensure() {
    if (context !== null) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      engine = context.createOscillator();
      engine.type = 'sawtooth';
      engine.frequency.value = 60;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engine.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(context.destination);
      engine.start();
      return true;
    } catch {
      return false;
    }
  }

  function tone(frequency, duration, type, volume, when = 0) {
    if (!ensure() || muted || context.state === 'suspended') return;
    try {
      const start = context.currentTime + when;
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.05);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  return {
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    /** Call every frame with the throttle 0..1 and whether the engine runs. */
    engine(throttle, running) {
      if (!ensure() || muted) return;
      try {
        if (context.state === 'suspended') return;
        engine.frequency.value = 55 + throttle * 75;
        engineGain.gain.value = running ? 0.02 + throttle * 0.05 : 0;
      } catch {
        // Ignore audio faults.
      }
    },
    ring() {
      tone(880, 0.25, 'sine', 0.16);
      tone(1318, 0.4, 'sine', 0.12, 0.09);
    },
    land() {
      tone(180, 0.3, 'sine', 0.2);
      tone(523, 0.2, 'sine', 0.1, 0.05);
    },
    warn() {
      tone(660, 0.12, 'square', 0.06);
    },
    crash() {
      tone(90, 0.6, 'sawtooth', 0.2);
      tone(55, 0.8, 'sine', 0.2, 0.1);
    },
    toggleMute() {
      muted = !muted;
      if (engineGain) engineGain.gain.value = 0;
      return muted;
    },
  };
}
