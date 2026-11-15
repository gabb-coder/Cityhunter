// Sound + vibration cues.
//
// iPhones do not support vibration from a web page, so every alert also has
// a short synthesised sound (Web Audio, no audio files). Browsers only allow
// sound after the player has touched the page, so the audio context is
// created on the first tap. On iPhone the ringer switch still mutes it.

import { store, buzz } from './util.js';
import { app } from './state.js';

const KEY = 'ch2.sound';
let enabled = store.get(KEY, true) !== false;
let ctx = null;
const log = [];   // names of cues fired, newest last (used by tests)

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  document.addEventListener(type, () => enabled && audio(), { passive: true, capture: true });
}

// note: [frequency Hz, start s, length s, wave, volume, slide-to Hz]
const CUES = {
  ping:      { notes: [[880, 0, 0.09], [880, 0.14, 0.09]], buzz: 80 },
  near:      { notes: [[440, 0, 0.12], [660, 0.14, 0.12], [440, 0.28, 0.12], [660, 0.42, 0.16]], buzz: [200, 100, 200] },
  tagged:    { notes: [[988, 0, 0.1], [740, 0.12, 0.1], [988, 0.24, 0.1], [740, 0.36, 0.1], [988, 0.48, 0.18]], buzz: [200, 100, 200] },
  zone:      { notes: [[720, 0, 0.24, 'sawtooth', 0.2, 340], [720, 0.32, 0.24, 'sawtooth', 0.2, 340]], buzz: [300, 150, 300] },
  gps:       { notes: [[330, 0, 0.2], [262, 0.24, 0.3]], buzz: 200 },
  release:   { notes: [[523, 0, 0.1], [659, 0.12, 0.1], [784, 0.24, 0.22]], buzz: [120, 80, 120] },
  converted: { notes: [[392, 0, 0.18, 'sawtooth'], [294, 0.2, 0.18, 'sawtooth'], [196, 0.4, 0.36, 'sawtooth']], buzz: [300, 120, 300] },
  caught:    { notes: [[523, 0, 0.09], [659, 0.1, 0.09], [784, 0.2, 0.09], [1047, 0.3, 0.26]], buzz: [80, 60, 200] },
  wrong:     { notes: [[196, 0, 0.26, 'sawtooth']], buzz: 300 },
  radar:     { notes: [[1245, 0, 0.05], [1245, 0.1, 0.05], [1245, 0.2, 0.05]], buzz: [200, 100, 200, 100, 200] },
  help:      { notes: [0, 0.5, 1, 1.5].flatMap((t) => [[880, t, 0.22, 'square', 0.3], [587, t + 0.25, 0.22, 'square', 0.3]]), buzz: [400, 200, 400, 200, 400] },
  msg:       { notes: [[1320, 0, 0.05, 'sine', 0.12]] },
  tap:       { notes: [], buzz: 30 }
};

export function cue(name) {
  const c = CUES[name];
  if (!c) return;
  log.push(name);
  if (log.length > 50) log.shift();
  app.bus.emit('cue', name);
  if (c.buzz) buzz(c.buzz);
  if (!enabled || !c.notes.length) return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  const t0 = a.currentTime + 0.02;
  for (const [freq, at, len, wave = 'square', vol = 0.18, slide] of c.notes) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t0 + at);
    if (slide) osc.frequency.linearRampToValueAtTime(slide, t0 + at + len);
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    osc.connect(gain).connect(a.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.03);
  }
}

app.sound = {
  cue,
  log,
  get on() { return enabled; },
  toggle() {
    enabled = !enabled;
    store.set(KEY, enabled);
    if (enabled) {
      audio();
      cue('ping');
    }
    return enabled;
  }
};
