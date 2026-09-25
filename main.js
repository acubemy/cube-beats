import { NOTES, SONG, SONG_LENGTH } from "./chart.js";
import { playHitSound, playMissSound, scheduleSong } from "./audio.js";

const acubemy = window.acubemy;

const LANES = ["L", "U", "F", "R", "B", "D"];
const FACE_COLORS = { U: "#ece8e2", D: "#ffe62a", F: "#1abe57", B: "#3d7ce0", R: "#eb4242", L: "#ff801f" };
const COLORS = { surface: "#131619", lane: "#1c1f22", border: "rgba(255,255,255,0.07)", text3: "#9b9ea1", accent: "rgb(241,142,33)" };

const LOOKAHEAD = 1.8;
const PERFECT_WINDOW = 0.08;
const GOOD_WINDOW = 0.18;
// Bluetooth adds some delay between the physical turn and the event.
const CUBE_LATENCY = 0.05;
const SCORES = { perfect: 300, good: 100 };

const $ = (id) => document.getElementById(id);
const canvas = $("highway");
const g = canvas.getContext("2d");

let audio = null;
let startAt = 0;
let playing = false;
let notes = [];
let stats = null;
let flashes = [];

$("song-title").textContent = SONG.title;
$("song-bpm").textContent = String(SONG.bpm);
$("song-length").textContent = `${Math.floor(SONG_LENGTH / 60)}:${String(Math.round(SONG_LENGTH % 60)).padStart(2, "0")}`;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

/** Seconds into the song as the player hears it. */
function songTime() {
  if (!audio) return -Infinity;
  return audio.ctx.currentTime - startAt - (audio.ctx.outputLatency || 0);
}

function renderDevice() {
  const device = acubemy.getDevice();
  const embedded = window.parent !== window;
  $("device").textContent = device.connected
    ? `${device.deviceName ?? "Smart cube"} connected`
    : embedded
      ? "No cube connected · connect one above, or use the keys U R F D L B (Shift = counter-clockwise)"
      : "Keys U R F D L B (Shift = counter-clockwise)";
}
acubemy.onDeviceChange(renderDevice);
renderDevice();

function start() {
  if (!audio) {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    audio = { ctx, master };
  }
  if (audio.song) audio.song.disconnect();
  audio.song = audio.ctx.createGain();
  audio.song.connect(audio.master);
  audio.ctx.resume();
  startAt = audio.ctx.currentTime + 0.3;
  scheduleSong(audio.ctx, audio.song, startAt);

  notes = NOTES.map((n) => ({ ...n, result: null }));
  stats = { score: 0, combo: 0, bestCombo: 0, perfect: 0, good: 0, miss: 0 };
  flashes = [];
  playing = true;
  $("menu").hidden = true;
  $("results").hidden = true;
  $("hud").hidden = false;
  $("quit").hidden = false;
  renderHud();
}

function stop({ keepMusic = false } = {}) {
  playing = false;
  if (audio?.song && !keepMusic) {
    audio.song.disconnect();
    audio.song = null;
  }
  $("hud").hidden = true;
  $("quit").hidden = true;
}

function finish() {
  stop({ keepMusic: true });
  const total = notes.length;
  const accuracy = total ? (stats.perfect + stats.good * 0.5) / total : 0;
  $("results-title").textContent = stats.miss === 0 ? "Full combo!" : "Song complete";
  $("r-score").textContent = stats.score.toLocaleString("en-US");
  $("r-accuracy").textContent = `${Math.round(accuracy * 100)}%`;
  $("r-combo").textContent = String(stats.bestCombo);
  $("r-breakdown").textContent = `${stats.perfect} perfect · ${stats.good} good · ${stats.miss} missed`;
  $("results").hidden = false;
}

const multiplier = () => Math.min(4, 1 + Math.floor(stats.combo / 8));

function renderHud() {
  $("score").textContent = stats.score.toLocaleString("en-US");
  $("combo").textContent = String(stats.combo);
  $("multiplier").textContent = multiplier() > 1 ? `combo · ×${multiplier()}` : "combo";
}

function judge(note, result, at) {
  note.result = result;
  if (result === "miss") {
    stats.miss++;
    stats.combo = 0;
    playMissSound(audio.ctx, audio.master);
  } else {
    stats[result]++;
    stats.combo++;
    stats.bestCombo = Math.max(stats.bestCombo, stats.combo);
    stats.score += SCORES[result] * multiplier();
    playHitSound(audio.ctx, audio.master, at, result === "perfect");
  }
  flashes.push({ lane: LANES.indexOf(note.face), text: result === "miss" ? "Miss" : result === "perfect" ? "Perfect" : "Good", result, at: performance.now() });
  renderHud();
}

function onTurn(face, prime, latency) {
  if (!playing) return;
  const t = songTime() - latency;
  const candidate = notes.find((n) => !n.result && n.face === face && Math.abs(n.time - t) <= GOOD_WINDOW);
  if (!candidate) return;
  if (candidate.prime !== prime) {
    judge(candidate, "miss", t);
    return;
  }
  judge(candidate, Math.abs(candidate.time - t) <= PERFECT_WINDOW ? "perfect" : "good", t);
}

acubemy.onMove(({ face, prime }) => onTurn(face, prime, acubemy.getDevice().connected ? CUBE_LATENCY : 0));

// Standalone, the SDK already turns keys into moves; embedded, the game listens itself.
if (window.parent !== window) {
  window.addEventListener("keydown", (e) => {
    const face = e.key.toUpperCase();
    if (LANES.includes(face) && !e.repeat) onTurn(face, e.shiftKey, 0);
  });
}

$("start").addEventListener("click", start);
$("again").addEventListener("click", start);
$("quit").addEventListener("click", () => {
  stop();
  $("menu").hidden = false;
});

function roundRect(x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function draw() {
  const w = window.innerWidth, h = window.innerHeight;
  g.fillStyle = COLORS.surface;
  g.fillRect(0, 0, w, h);

  const laneW = Math.min(84, (w - 32) / LANES.length);
  const left = (w - laneW * LANES.length) / 2;
  const top = 72;
  const hitY = h - 96;
  const speed = (hitY - top) / LOOKAHEAD;
  const t = songTime();

  LANES.forEach((face, i) => {
    const x = left + i * laneW;
    g.fillStyle = COLORS.lane;
    g.fillRect(x + 2, top, laneW - 4, h - top);
    g.fillStyle = FACE_COLORS[face];
    g.globalAlpha = 0.9;
    roundRect(x + laneW / 2 - 18, hitY + 26, 36, 36, 10);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = COLORS.surface;
    g.font = "700 16px 'Geist Variable', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(face, x + laneW / 2, hitY + 44);
  });

  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(left, hitY - 1, laneW * LANES.length, 2);

  if (playing) {
    g.save();
    g.beginPath();
    g.rect(0, top, w, hitY + 16 - top);
    g.clip();
    for (const note of notes) {
      if (!note.result && t - note.time > GOOD_WINDOW) judge(note, "miss", t);
      if (note.result && note.result !== "miss") continue;
      const dt = note.time - t;
      if (dt > LOOKAHEAD || dt < -0.4) continue;
      const lane = LANES.indexOf(note.face);
      const x = left + lane * laneW + 6;
      const y = hitY - dt * speed;
      const nw = laneW - 12, nh = 26;
      const color = FACE_COLORS[note.face];
      g.globalAlpha = note.result === "miss" ? 0.25 : 1;
      roundRect(x, y - nh / 2, nw, nh, 7);
      if (note.prime) {
        g.lineWidth = 2.5;
        g.strokeStyle = color;
        g.stroke();
        g.fillStyle = color;
      } else {
        g.fillStyle = color;
        g.fill();
        g.fillStyle = COLORS.surface;
      }
      g.font = "700 14px 'Geist Variable', system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(note.move, x + nw / 2, y + 1);
      g.globalAlpha = 1;
    }
    g.restore();

    const now = performance.now();
    flashes = flashes.filter((f) => now - f.at < 600);
    for (const f of flashes) {
      const age = (now - f.at) / 600;
      const x = left + f.lane * laneW + laneW / 2;
      g.globalAlpha = 1 - age;
      if (f.result !== "miss") {
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(x - laneW / 2 + 2, top, laneW - 4, hitY - top);
      }
      g.fillStyle = f.result === "perfect" ? COLORS.accent : f.result === "good" ? "#e6e8ea" : COLORS.text3;
      g.font = "600 13px 'Geist Variable', system-ui, sans-serif";
      g.fillText(f.text, x, hitY - 28 - age * 24);
      g.globalAlpha = 1;
    }

    const progress = Math.max(0, Math.min(1, t / SONG_LENGTH));
    g.fillStyle = COLORS.border;
    g.fillRect(left, top - 10, laneW * LANES.length, 3);
    g.fillStyle = COLORS.accent;
    g.fillRect(left, top - 10, laneW * LANES.length * progress, 3);

    if (t > SONG_LENGTH + 0.3) finish();
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
