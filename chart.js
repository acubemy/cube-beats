// "Neon Turns" – original demo song. Every section is a move sequence that
// returns the cube to where it started (sexy move ×6, sledgehammer ×6, U U').
export const SONG = { title: "Neon Turns", bpm: 100, beatsPerBar: 4, bars: 22 };
export const BEAT = 60 / SONG.bpm;
export const SONG_LENGTH = SONG.bars * SONG.beatsPerBar * BEAT;

/** Chord per bar, as MIDI note numbers: Am, F, C, G. */
export const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];

/** Song layout in bars; the audio arrangement and the chart both follow it. */
export const SECTIONS = [
  { name: "intro", from: 0, to: 4 },
  { name: "verse", from: 4, to: 10 },
  { name: "chorus", from: 10, to: 16 },
  { name: "bridge", from: 16, to: 18 },
  { name: "finale", from: 18, to: 21 },
  { name: "outro", from: 21, to: 22 },
];

const repeat = (moves, times) => Array.from({ length: times }, () => moves).flat();

function sequence(moves, startBar, beatsPerMove) {
  return moves.map((move, i) => ({
    move,
    face: move[0],
    prime: move.includes("'"),
    beat: startBar * SONG.beatsPerBar + i * beatsPerMove,
  }));
}

export const NOTES = [
  ...sequence(repeat(["R", "U", "R'", "U'"], 6), 4, 1),
  ...sequence(repeat(["R'", "F", "R", "F'"], 6), 10, 1),
  ...sequence(repeat(["U", "U'"], 4), 16, 0.5),
  ...sequence(repeat(["D", "D'"], 4), 17, 0.5),
  ...sequence(repeat(["R", "U", "R'", "U'"], 6), 18, 0.5),
].map((note) => ({ ...note, time: note.beat * BEAT }));
