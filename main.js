import { BEAT, NOTES, SONG, SONG_LENGTH } from "./chart.js";
import { playClick, scheduleSong } from "./audio.js";

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
// Browsers tend to over-report outputLatency; measured ~120 ms too much on macOS.
const DEFAULT_OFFSET = 0.12;
const SYNC_SAMPLES = 8;

const $ = (id) => document.getElementById(id);
const canvas = $("highway");
const g = canvas.getContext("2d");

let audio = null;
let startAt = 0;
let playing = false;
let notes = [];
let stats = null;
let flashes = [];
let sync = null;
let calibration = loadCalibration();

function loadCalibration() {
  try {
    const stored = localStorage.getItem("cube-beats-calibration");
    return stored === null ? DEFAULT_OFFSET : Number(stored) || 0;
  } catch {
    return DEFAULT_OFFSET;
  }
}

function setCalibration(seconds) {
  calibration = seconds;
  try {
    localStorage.setItem("cube-beats-calibration", String(seconds));
  } catch {}
  renderCalibration();
}

function renderCalibration() {
  const ms = Math.round(calibration * 1000);
  const text = `${ms > 0 ? "+" : ""}${ms} ms`;
  $("calibration-value").textContent = text;
  $("sync-offset").textContent = text;
}

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

/** Seconds into the song as the player hears it. Calibrated with the sync tool. */
function songTime() {
  if (!audio) return -Infinity;
  return audio.ctx.currentTime - startAt - (audio.ctx.outputLatency || 0) + calibration;
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

function ensureAudio() {
  if (!audio) {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.ratio.value = 4;
    master.gain.value = 0.8;
    master.connect(glue).connect(ctx.destination);
    audio = { ctx, master };
  }
  audio.ctx.resume();
}

function start() {
  ensureAudio();
  if (audio.song) audio.song.disconnect();
  audio.song = audio.ctx.createGain();
  audio.song.connect(audio.master);
  audio.lead = audio.ctx.createGain();
  audio.lead.connect(audio.song);
  startAt = audio.ctx.currentTime + 0.3;
  scheduleSong(audio.ctx, { song: audio.song, lead: audio.lead }, startAt);
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

function judge(note, result) {
  note.result = result;
  if (result === "miss") {
    stats.miss++;
    stats.combo = 0;
    audio.lead.gain.setTargetAtTime(0.12, audio.ctx.currentTime, 0.03);
  } else {
    stats[result]++;
    stats.combo++;
    stats.bestCombo = Math.max(stats.bestCombo, stats.combo);
    stats.score += SCORES[result] * multiplier();
    audio.lead.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.015);
  }
  flashes.push({ lane: LANES.indexOf(note.face), text: result === "miss" ? "Miss" : result === "perfect" ? "Perfect" : "Good", result, at: performance.now() });
  renderHud();
}

const lastPress = {};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

function openSync() {
  ensureAudio();
  const out = audio.ctx.createGain();
  out.connect(audio.master);
  startAt = audio.ctx.currentTime + 0.3;
  sync = { out, nextBeat: 0, offsets: [] };
  $("sync-status").textContent = "Turn any face on each click.";
  $("menu").hidden = true;
  $("sync").hidden = false;
}

function closeSync() {
  sync.out.disconnect();
  sync = null;
  $("sync").hidden = true;
  $("menu").hidden = false;
}

function syncTurn(latency) {
  const t = songTime() - latency;
  if (t < -BEAT / 2) return;
  sync.offsets.push(t - Math.round(t / BEAT) * BEAT);
  if (sync.offsets.length < SYNC_SAMPLES) {
    $("sync-status").textContent = `Measuring… ${sync.offsets.length}/${SYNC_SAMPLES}`;
    return;
  }
  const shift = -median(sync.offsets);
  sync.offsets = [];
  setCalibration(calibration + shift);
  const ms = Math.round(shift * 1000);
  $("sync-status").textContent = Math.abs(ms) <= 10 ? "In sync. Keep turning to double-check." : `Adjusted by ${ms > 0 ? "+" : ""}${ms} ms. Keep turning to refine.`;
}

function scheduleClicks() {
  while (startAt + sync.nextBeat * BEAT < audio.ctx.currentTime + 0.2) {
    playClick(audio.ctx, sync.out, startAt + sync.nextBeat * BEAT, sync.nextBeat % SONG.beatsPerBar === 0);
    sync.nextBeat++;
  }
  const phase = ((songTime() % BEAT) + BEAT) % BEAT;
  const pulse = Math.exp(-phase * 12);
  $("sync-pulse").style.transform = `scale(${1 + pulse * 0.35})`;
  $("sync-pulse").style.opacity = String(0.35 + pulse * 0.65);
}

function onTurn(face, prime, latency) {
  lastPress[face] = performance.now();
  if (sync) return syncTurn(latency);
  if (!playing) return;
  const t = songTime() - latency;
  const candidate = notes.find((n) => !n.result && n.face === face && Math.abs(n.time - t) <= GOOD_WINDOW);
  if (!candidate) return;
  if (candidate.prime !== prime) {
    judge(candidate, "miss");
    return;
  }
  judge(candidate, Math.abs(candidate.time - t) <= PERFECT_WINDOW ? "perfect" : "good");
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
$("sync-open").addEventListener("click", openSync);
$("sync-done").addEventListener("click", closeSync);
$("sync-earlier").addEventListener("click", () => setCalibration(calibration - 0.01));
$("sync-later").addEventListener("click", () => setCalibration(calibration + 0.01));
$("sync-reset").addEventListener("click", () => setCalibration(DEFAULT_OFFSET));
renderCalibration();
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
    const glow = Math.max(0, 1 - (performance.now() - (lastPress[face] ?? -Infinity)) / 250);
    if (glow > 0) {
      g.globalAlpha = glow * 0.6;
      g.strokeStyle = FACE_COLORS[face];
      g.lineWidth = 3;
      roundRect(x + laneW / 2 - 22, hitY + 22, 44, 44, 13);
      g.stroke();
      g.fillStyle = "#fff";
      g.globalAlpha = glow * 0.35;
      roundRect(x + laneW / 2 - 18, hitY + 26, 36, 36, 10);
      g.fill();
    }
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
      if (!note.result && t - note.time > GOOD_WINDOW) judge(note, "miss");
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
  if (sync) scheduleClicks();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
