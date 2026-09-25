import { BEAT, NOTES, PROGRESSION, SECTIONS, SONG } from "./chart.js";

const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const sectionAt = (bar) => SECTIONS.find((s) => bar >= s.from && bar < s.to)?.name;
const BAR = BEAT * SONG.beatsPerBar;
const S16 = BEAT / 4;

function synth(ctx, dest, { time, freq, duration, type = "sawtooth", gain = 0.1, attack = 0.005, cutoff = 2000, cutoffEnd = cutoff, q = 1, detune = 0 }) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  osc.detune.value = detune;
  filter.type = "lowpass";
  filter.Q.value = q;
  filter.frequency.setValueAtTime(cutoff, time);
  filter.frequency.exponentialRampToValueAtTime(cutoffEnd, time + duration);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(filter).connect(env).connect(dest);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noise(ctx, dest, buffer, { time, duration, gain, type = "highpass", freq, freqEnd = freq, attack = 0 }) {
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = buffer;
  filter.type = type;
  filter.frequency.setValueAtTime(freq, time);
  filter.frequency.exponentialRampToValueAtTime(freqEnd, time + duration);
  if (attack) {
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + attack);
  } else {
    env.gain.setValueAtTime(gain, time);
  }
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  src.connect(filter).connect(env).connect(dest);
  src.start(time);
  src.stop(time + duration + 0.05);
}

function kick(ctx, dest, time, gain = 0.9) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.1);
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
  osc.connect(env).connect(dest);
  osc.start(time);
  osc.stop(time + 0.35);
}

function snare(ctx, dest, buf, time, gain = 0.3) {
  noise(ctx, dest, buf, { time, duration: 0.18, gain, type: "bandpass", freq: 1800 });
  synth(ctx, dest, { time, freq: 190, duration: 0.1, type: "triangle", gain: gain * 0.8, cutoff: 3000 });
}

const hat = (ctx, dest, buf, time, gain, open = false) =>
  noise(ctx, dest, buf, { time, duration: open ? 0.22 : 0.035, gain, freq: 8000 });
const crash = (ctx, dest, buf, time) => noise(ctx, dest, buf, { time, duration: 1.6, gain: 0.12, freq: 5000 });
const riser = (ctx, dest, buf, time, duration) =>
  noise(ctx, dest, buf, { time, duration, gain: 0.12, type: "bandpass", freq: 400, freqEnd: 7000, attack: duration * 0.95 });

/** Chart moves as melody: each face starts on a chord tone, a prime turn jumps two tones up. */
const FACE_DEGREE = { R: 0, U: 1, F: 2, D: 0, L: 1, B: 2 };
function leadPitch(note) {
  const chord = PROGRESSION[Math.floor(note.time / BAR) % PROGRESSION.length];
  const degree = FACE_DEGREE[note.face] + (note.prime ? 2 : 0);
  return chord[degree % 3] + 12 * Math.floor(degree / 3) + 12;
}

/**
 * Schedules the whole song on the audio clock. The chart melody goes to `lead`
 * so the game can duck it after a miss, like a Guitar Hero stem.
 */
export function scheduleSong(ctx, { song, lead }, start) {
  const buf = noiseBuffer(ctx);
  const pad = ctx.createGain();
  pad.connect(song);
  const pump = (time) => {
    pad.gain.setValueAtTime(0.3, time);
    pad.gain.linearRampToValueAtTime(1, time + BEAT * 0.6);
  };

  for (let b = 0; b < SONG.bars; b++) {
    const section = sectionAt(b);
    const t0 = start + b * BAR;
    const chord = PROGRESSION[b % PROGRESSION.length];
    const root = chord[0] - 24;
    const full = section === "chorus" || section === "finale";
    const beatAt = (q) => t0 + q * BEAT;

    if (section === "outro") {
      crash(ctx, song, buf, t0);
      kick(ctx, song, t0);
      synth(ctx, song, { time: t0, freq: midiToFreq(root), duration: BAR, cutoff: 800, cutoffEnd: 100, gain: 0.14 });
      for (const note of chord) {
        for (const detune of [-10, 10]) synth(ctx, pad, { time: t0, freq: midiToFreq(note), duration: BAR * 2, attack: 0.02, gain: 0.03, cutoff: 3000, cutoffEnd: 300, detune });
      }
      break;
    }

    // Pad: two detuned saws, filter opens up over the intro, pumps with the kick.
    const padCutoff = section === "intro" ? 500 + b * 350 : full ? 2600 : section === "bridge" ? 900 : 1600;
    for (const note of chord) {
      for (const detune of [-10, 10]) synth(ctx, pad, { time: t0, freq: midiToFreq(note), duration: BAR, attack: 0.08, gain: 0.025, cutoff: padCutoff, detune });
    }

    if ([0, 4, 10, 18].includes(b)) crash(ctx, song, buf, t0);
    if (b === 3 || b === 9 || b === 17) riser(ctx, song, buf, t0, BAR);

    // Drums
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * S16;
      const onBeat = s % 4 === 0;
      if (section === "intro") {
        if (b >= 2 && s % 2 === 0) hat(ctx, song, buf, t, onBeat ? 0.05 : 0.03);
      } else if (section === "bridge") {
        hat(ctx, song, buf, t, onBeat ? 0.04 : 0.02);
      } else {
        const sixteenths = full || s % 2 === 0;
        if (sixteenths) hat(ctx, song, buf, t, onBeat ? 0.06 : s % 2 === 0 ? 0.045 : 0.025);
        if (full && s % 4 === 2) hat(ctx, song, buf, t, 0.05, true);
      }
    }
    if (section === "intro" && b === 3) {
      for (let q = 0; q < 4; q++) kick(ctx, song, beatAt(q), 0.7);
      for (let s = 8; s < 16; s++) snare(ctx, song, buf, t0 + s * S16, 0.06 + (s - 8) * 0.02);
    }
    if (section === "verse" || full) {
      const kicks = full ? [0, 1, 2, 3] : [0, 1.5, 2, 2.75];
      for (const q of kicks) {
        kick(ctx, song, beatAt(q));
        pump(beatAt(q));
      }
      snare(ctx, song, buf, beatAt(1));
      snare(ctx, song, buf, beatAt(3));
      if (full) snare(ctx, song, buf, beatAt(3.75), 0.12);
    }
    if (b === 9) for (let s = 12; s < 16; s++) snare(ctx, song, buf, t0 + s * S16, 0.1 + (s - 12) * 0.05);
    if (b === 17) {
      for (let q = 0; q < 4; q++) kick(ctx, song, beatAt(q), 0.8);
      for (let s = 0; s < 16; s += s < 8 ? 2 : 1) snare(ctx, song, buf, t0 + s * S16, 0.05 + s * 0.015);
    }

    // Bass: driving eighths with an octave bounce; sixteenths in the finale.
    if (section !== "intro") {
      const step = section === "finale" ? S16 : BEAT / 2;
      const steps = Math.round(BAR / step);
      for (let i = 0; i < steps; i++) {
        const t = t0 + i * step;
        const octave = full && i % 4 === 3 ? 12 : 0;
        const cutoff = section === "bridge" ? 350 : full ? 1400 : 900;
        synth(ctx, song, { time: t, freq: midiToFreq(root + octave), duration: step * 0.9, gain: 0.13, cutoff, cutoffEnd: 120, q: 4 });
        synth(ctx, song, { time: t, freq: midiToFreq(root - 12), duration: step * 0.9, type: "sine", gain: 0.12, cutoff: 400 });
      }
    }

    // Offbeat chord stabs in the chorus and finale.
    if (full) {
      for (let q = 0; q < 4; q++) {
        for (const note of chord) synth(ctx, song, { time: beatAt(q + 0.5), freq: midiToFreq(note + 12), duration: BEAT * 0.3, gain: 0.03, cutoff: 3500, cutoffEnd: 600, type: "square" });
      }
    }
  }

  NOTES.forEach((note, i) => {
    const gap = (NOTES[i + 1]?.time ?? note.time + BEAT) - note.time;
    const time = start + note.time;
    const freq = midiToFreq(leadPitch(note));
    synth(ctx, lead, { time, freq, duration: Math.min(gap, BEAT) * 0.95, type: "square", gain: 0.07, cutoff: 5000, cutoffEnd: 700, q: 3 });
    synth(ctx, lead, { time, freq: freq * 2, duration: Math.min(gap, BEAT) * 0.5, type: "triangle", gain: 0.04 });
  });
}

export function playClick(ctx, dest, time, accent) {
  synth(ctx, dest, { time, freq: accent ? 1760 : 880, duration: 0.06, type: "sine", gain: 0.3, attack: 0.001, cutoff: 8000 });
}
