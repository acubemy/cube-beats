import { BEAT, PROGRESSION, SECTIONS, SONG } from "./chart.js";

const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const sectionAt = (bar) => SECTIONS.find((s) => bar >= s.from && bar < s.to)?.name;

function tone(ctx, dest, { time, freq, duration, type = "triangle", gain = 0.2, attack = 0.005 }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(env).connect(dest);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noise(ctx, dest, buffer, { time, duration, gain, highpass }) {
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = highpass;
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  src.connect(filter).connect(env).connect(dest);
  src.start(time);
  src.stop(time + duration + 0.05);
}

function kick(ctx, dest, time) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  env.gain.setValueAtTime(0.9, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
  osc.connect(env).connect(dest);
  osc.start(time);
  osc.stop(time + 0.35);
}

/** Schedules the whole song on the audio clock, starting at `start`. */
export function scheduleSong(ctx, dest, start) {
  const noiseBuf = noiseBuffer(ctx);
  const bar = BEAT * SONG.beatsPerBar;

  for (let b = 0; b < SONG.bars; b++) {
    const section = sectionAt(b);
    const t0 = start + b * bar;
    const chord = PROGRESSION[b % PROGRESSION.length];
    const last = b === SONG.bars - 1;

    // Pad: soft sustained chord, the whole song long.
    for (const note of chord) {
      tone(ctx, dest, { time: t0, freq: midiToFreq(note), duration: last ? bar * 2 : bar, type: "sine", gain: 0.05, attack: 0.3 });
    }
    if (last) {
      kick(ctx, dest, t0);
      break;
    }

    for (let e = 0; e < 8; e++) {
      const t = t0 + e * (BEAT / 2);
      const downbeat = e % 2 === 0;
      if (section !== "intro" || b >= 2) noise(ctx, dest, noiseBuf, { time: t, duration: 0.04, gain: downbeat ? 0.06 : 0.035, highpass: 7000 });
      if (section !== "intro" && section !== "bridge") {
        tone(ctx, dest, { time: t, freq: midiToFreq(chord[0] - 24), duration: BEAT / 2.2, type: "square", gain: 0.05 });
      }
    }
    for (let q = 0; q < 4; q++) {
      const t = t0 + q * BEAT;
      const bridgeBuild = section === "bridge" && b === 17;
      if (section !== "intro" && (q % 2 === 0 || bridgeBuild)) kick(ctx, dest, t);
      if ((section === "chorus" || section === "finale") && q % 2 === 1) {
        noise(ctx, dest, noiseBuf, { time: t, duration: 0.14, gain: 0.25, highpass: 1500 });
      }
    }
    if (section === "chorus" || section === "finale") {
      // Arpeggiated lead over the chord, one octave up.
      const pattern = [0, 1, 2, 1, 2, 1, 0, 2];
      pattern.forEach((idx, e) => {
        tone(ctx, dest, { time: t0 + e * (BEAT / 2), freq: midiToFreq(chord[idx] + 12), duration: BEAT / 2.5, gain: 0.06 });
      });
    }
  }
}

/** Short pluck in key: the root of the current chord, higher for perfect hits. */
export function playHitSound(ctx, dest, songTime, perfect) {
  const barIndex = Math.max(0, Math.floor(songTime / (BEAT * SONG.beatsPerBar)));
  const chord = PROGRESSION[barIndex % PROGRESSION.length];
  tone(ctx, dest, { time: ctx.currentTime, freq: midiToFreq(chord[perfect ? 2 : 0] + 24), duration: 0.18, gain: 0.08 });
}

export function playMissSound(ctx, dest) {
  tone(ctx, dest, { time: ctx.currentTime, freq: 110, duration: 0.12, type: "sawtooth", gain: 0.035 });
}
