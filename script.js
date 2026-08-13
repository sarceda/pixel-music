'use strict';

/* ============================================================
   pixel-music — draw colored walls, bounce a ball, make music.
   Vanilla JS + Canvas 2D + Web Audio. No dependencies.

   Cada celda de color es una nota. La pelota rebota contra las
   celdas (suena la nota y la celda desaparece) y contra las
   paredes externas (suena la nota del color seleccionado).
   ============================================================ */

// ---------- Grid config ----------
const COLS = 48;
const ROWS = 30;
const CELL = 20;
const W = COLS * CELL;   // 960
const H = ROWS * CELL;   // 600

// ---------- Palette: color -> note (C major pentatonic) ----------
const PALETTE = [
  { hex: '#ff5252', name: 'C4',  freq: 261.63, solfege: 'do'   },
  { hex: '#ff8a3d', name: 'D4',  freq: 293.66, solfege: 're'   },
  { hex: '#ffd740', name: 'E4',  freq: 329.63, solfege: 'mi'   },
  { hex: '#69f0ae', name: 'G4',  freq: 392.00, solfege: 'sol'  },
  { hex: '#40e0d0', name: 'A4',  freq: 440.00, solfege: 'la'   },
  { hex: '#40a9ff', name: 'C5',  freq: 523.25, solfege: 'do²'  },
  { hex: '#b388ff', name: 'D5',  freq: 587.33, solfege: 're²'  },
  { hex: '#ff6fb5', name: 'E5',  freq: 659.25, solfege: 'mi²'  },
];

// grid cells: 0 = empty, 1..PALETTE.length = color index
const grid = new Uint8Array(COLS * ROWS);

// ---------- Ball ----------
const BALL_RADIUS = 7;
const BASE_SPEED = 240; // px/s
const TRAIL_LEN = 14;

const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
const trail = [];

let speedFactor = 1;
let gravity = 0;          // px/s^2
let running = false;
let lastTime = null;

// ---------- Tools ----------
let currentColor = 1;      // 1..PALETTE.length
let eraser = false;

// collision burst feedback (expanding rings)
const bursts = [];

// ---------- DOM ----------
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const paletteEl = document.getElementById('palette');
const btnPlay = document.getElementById('btnPlay');
const btnReset = document.getElementById('btnReset');
const btnClear = document.getElementById('btnClear');
const speedRange = document.getElementById('speedRange');
const volRange = document.getElementById('volRange');
const gravityToggle = document.getElementById('gravityToggle');
const muteToggle = document.getElementById('muteToggle');
const audioStatus = document.getElementById('audioStatus');

// crisp rendering on hi-DPI screens
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

// ---------- Audio ----------
let audioCtx = null;
let masterGain = null;
let reverb = null;
let muted = false;

function makeImpulse(duration = 1.5, decay = 2.8) {
  const rate = audioCtx.sampleRate;
  const len = Math.floor(rate * duration);
  const buf = audioCtx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) {
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volRange.value);
    masterGain.connect(audioCtx.destination);

    // light reverb for warmth
    reverb = audioCtx.createConvolver();
    reverb.buffer = makeImpulse();
    const wet = audioCtx.createGain();
    wet.gain.value = 0.35;
    reverb.connect(wet);
    wet.connect(masterGain);

    audioCtx.onstatechange = updateAudioStatus;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // iOS unlock trick: start a silent sample through the destination inside the
  // user gesture. Some iOS/WebKit builds only flip the context to "running"
  // after an actual source node is started.
  try {
    const buf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (err) { /* ignore */ }

  updateAudioStatus();
}

let lastNoteAt = -1;

function playNote(freq) {
  if (!audioCtx || muted) return;
  if (audioCtx.state !== 'running') audioCtx.resume();
  const now = audioCtx.currentTime;
  if (now - lastNoteAt < 0.028) return; // avoid machine-gun retriggering
  lastNoteAt = now;

  const t = now;
  const osc = audioCtx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;

  const osc2 = audioCtx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  const g2 = audioCtx.createGain();
  g2.gain.value = 0.22;

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);

  osc.connect(g);
  osc2.connect(g2);
  g2.connect(g);
  g.connect(masterGain); // dry
  g.connect(reverb);     // wet

  osc.start(t);
  osc.stop(t + 0.6);
  osc2.start(t);
  osc2.stop(t + 0.6);
}

function updateAudioStatus() {
  if (!audioStatus) return;
  if (!audioCtx) {
    audioStatus.textContent = '';
    audioStatus.style.display = 'none';
    return;
  }
  audioStatus.style.display = '';
  if (audioCtx.state === 'running') {
    audioStatus.textContent = '🔊 sonido listo';
    audioStatus.className = 'audio-status ok';
  } else {
    audioStatus.textContent = '🔇 audio bloqueado';
    audioStatus.className = 'audio-status warn';
  }
}

function wallNote() {
  // note of the currently selected color (used by the outer walls)
  const i = Math.min(Math.max(currentColor, 1), PALETTE.length);
  return PALETTE[i - 1];
}

// ---------- Palette UI ----------
function buildPalette() {
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.index = String(i + 1);
    b.style.background = c.hex;
    b.style.color = c.hex; // used by .selected box-shadow currentColor
    b.title = `${c.name} (${c.solfege}) · ${c.freq.toFixed(2)} Hz`;
    const n = document.createElement('span');
    n.className = 'note';
    n.textContent = c.name;
    b.appendChild(n);
    b.addEventListener('click', () => selectColor(i + 1));
    paletteEl.appendChild(b);
  });

  const e = document.createElement('button');
  e.className = 'swatch eraser';
  e.id = 'swatchEraser';
  e.title = 'Borrador (también: click derecho)';
  e.textContent = '🧽';
  e.addEventListener('click', () => selectEraser());
  paletteEl.appendChild(e);
}

function refreshSelection() {
  paletteEl.querySelectorAll('.swatch').forEach((s) => {
    const idx = Number(s.dataset.index || 0);
    s.classList.toggle('selected', !eraser && idx === currentColor);
  });
  const e = document.getElementById('swatchEraser');
  if (e) e.classList.toggle('selected', eraser);
}

function selectColor(i) {
  currentColor = i;
  eraser = false;
  refreshSelection();
}

function selectEraser() {
  eraser = true;
  refreshSelection();
}

// ---------- Drawing ----------
let painting = false;
let lastCell = null;

function cellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (W / rect.width);
  const sy = (e.clientY - rect.top) * (H / rect.height);
  return {
    cx: Math.floor(sx / CELL),
    cy: Math.floor(sy / CELL),
  };
}

function setCell(cx, cy, value) {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
  grid[cy * COLS + cx] = value;
}

function lineCells(x0, y0, x1, y1, value) {
  // Bresenham line so fast drags don't leave gaps
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setCell(x, y, value);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function paint(e, eraseOverride) {
  const { cx, cy } = cellFromEvent(e);
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
  const value = eraseOverride ? 0 : (eraser ? 0 : currentColor);
  if (lastCell) {
    lineCells(lastCell.cx, lastCell.cy, cx, cy, value);
  } else {
    setCell(cx, cy, value);
  }
  lastCell = { cx, cy };
}

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  painting = true;
  canvas.setPointerCapture(e.pointerId);
  lastCell = null;
  paint(e, e.button === 2);
});

canvas.addEventListener('pointermove', (e) => {
  if (!painting) return;
  paint(e, e.buttons === 2);
});

window.addEventListener('pointerup', () => {
  painting = false;
  lastCell = null;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Physics ----------
function randomVelocity() {
  const a = Math.random() * Math.PI * 2;
  const s = BASE_SPEED * speedFactor;
  ball.vx = Math.cos(a) * s;
  ball.vy = Math.sin(a) * s;
}

function collideCells() {
  const r = BALL_RADIUS;
  const x0 = Math.floor((ball.x - r) / CELL);
  const x1 = Math.floor((ball.x + r) / CELL);
  const y0 = Math.floor((ball.y - r) / CELL);
  const y1 = Math.floor((ball.y + r) / CELL);

  let best = null;

  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
      const ci = grid[cy * COLS + cx];
      if (ci === 0) continue;

      const rx = cx * CELL;
      const ry = cy * CELL;
      const px = Math.max(rx, Math.min(ball.x, rx + CELL));
      const py = Math.max(ry, Math.min(ball.y, ry + CELL));
      const dx = ball.x - px;
      const dy = ball.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;

      let d = Math.sqrt(d2);
      let nx;
      let ny;
      if (d < 1e-6) {
        // ball center sits inside the cell rect — resolve along smallest penetration axis
        const left = ball.x - rx;
        const right = rx + CELL - ball.x;
        const top = ball.y - ry;
        const bottom = ry + CELL - ball.y;
        const minX = Math.min(left, right);
        const minY = Math.min(top, bottom);
        if (minX < minY) { nx = left < right ? -1 : 1; ny = 0; }
        else { nx = 0; ny = top < bottom ? -1 : 1; }
        d = 0;
      } else {
        nx = dx / d;
        ny = dy / d;
      }

      if (!best || d < best.d) {
        best = { d, nx, ny, ci, idx: cy * COLS + cx };
      }
    }
  }

  if (!best) return;

  // push the ball out of the collided cell
  const pen = BALL_RADIUS - best.d;
  ball.x += best.nx * pen;
  ball.y += best.ny * pen;

  // reflect the velocity component along the normal
  const vn = ball.vx * best.nx + ball.vy * best.ny;
  if (vn < 0) {
    ball.vx -= 2 * vn * best.nx;
    ball.vy -= 2 * vn * best.ny;
    ball.vx *= 0.995;
    ball.vy *= 0.995;
  }

  // sound + the cell disappears after the bounce
  playNote(PALETTE[best.ci - 1].freq);
  const bxc = best.idx % COLS;
  const byc = Math.floor(best.idx / COLS);
  bursts.push({
    x: bxc * CELL + CELL / 2,
    y: byc * CELL + CELL / 2,
    t: performance.now(),
    color: PALETTE[best.ci - 1].hex,
  });
  grid[best.idx] = 0;
}

function step(dt) {
  if (gravity) ball.vy += gravity * dt;

  // keep speed within sane bounds (prevents tunneling + runaway)
  const maxSpeed = BASE_SPEED * speedFactor * 2.5;
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > maxSpeed) {
    ball.vx *= maxSpeed / sp;
    ball.vy *= maxSpeed / sp;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // outer walls — bounce and play the selected note
  let ex = null;
  let ey = null;
  if (ball.x - BALL_RADIUS < 0) { ball.x = BALL_RADIUS; ball.vx = Math.abs(ball.vx); ex = BALL_RADIUS; ey = ball.y; }
  else if (ball.x + BALL_RADIUS > W) { ball.x = W - BALL_RADIUS; ball.vx = -Math.abs(ball.vx); ex = W - BALL_RADIUS; ey = ball.y; }
  if (ball.y - BALL_RADIUS < 0) { ball.y = BALL_RADIUS; ball.vy = Math.abs(ball.vy); ey = BALL_RADIUS; ex = ball.x; }
  else if (ball.y + BALL_RADIUS > H) { ball.y = H - BALL_RADIUS; ball.vy = -Math.abs(ball.vy); ey = H - BALL_RADIUS; ex = ball.x; }
  if (ex !== null) {
    const wn = wallNote();
    playNote(wn.freq);
    bursts.push({ x: ex, y: ey, t: performance.now(), color: wn.hex });
  }

  // collide with painted cells (iterate a few times for corners)
  for (let i = 0; i < 3; i++) collideCells();

  // trail
  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > TRAIL_LEN) trail.shift();
}

// ---------- Rendering ----------
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0f17';
  ctx.fillRect(0, 0, W, H);

  // grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= COLS; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); }
  for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); }
  ctx.stroke();

  // painted cells
  for (let i = 0; i < grid.length; i++) {
    const ci = grid[i];
    if (ci === 0) continue;
    const cx = i % COLS;
    const cy = Math.floor(i / COLS);
    ctx.fillStyle = PALETTE[ci - 1].hex;
    ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);
  }

  // trail
  for (let i = 0; i < trail.length; i++) {
    const t = (i + 1) / trail.length;
    ctx.fillStyle = `rgba(255,255,255,${(t * 0.32).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, BALL_RADIUS * (0.4 + 0.6 * t), 0, Math.PI * 2);
    ctx.fill();
  }

  // ball
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // collision bursts
  const now = performance.now();
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    const age = now - b.t;
    if (age > 260) { bursts.splice(i, 1); continue; }
    const p = age / 260;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 0.5 + 3 * (1 - p);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2 + p * CELL * 1.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Main loop ----------
function loop(t) {
  requestAnimationFrame(loop);
  const dt = lastTime ? Math.min((t - lastTime) / 1000, 1 / 30) : 0;
  lastTime = t;
  if (running) step(dt);
  draw();
}

// ---------- Controls ----------
function setRunning(v) {
  running = v;
  btnPlay.textContent = v ? '⏸ Pausar' : '▶ Reproducir';
  btnPlay.classList.toggle('paused', !v);
}

function togglePlay() {
  if (!running) {
    ensureAudio();
    if (Math.hypot(ball.vx, ball.vy) < 1) randomVelocity();
    lastTime = null;
    setRunning(true);
  } else {
    setRunning(false);
  }
}

btnPlay.addEventListener('click', togglePlay);
btnReset.addEventListener('click', () => {
  ball.x = W / 2;
  ball.y = H / 2;
  trail.length = 0;
  randomVelocity();
});
btnClear.addEventListener('click', () => {
  grid.fill(0);
  bursts.length = 0;
});

speedRange.addEventListener('input', () => {
  const nf = parseFloat(speedRange.value);
  const ratio = nf / speedFactor;
  ball.vx *= ratio;
  ball.vy *= ratio;
  speedFactor = nf;
});

volRange.addEventListener('input', () => {
  if (masterGain) masterGain.gain.value = parseFloat(volRange.value);
});

gravityToggle.addEventListener('change', () => {
  gravity = gravityToggle.checked ? 340 : 0;
});

muteToggle.addEventListener('click', () => {
  muted = !muted;
  muteToggle.textContent = muted ? '🔇' : '🔊';
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'c' || e.key === 'C') { grid.fill(0); bursts.length = 0; }
  else if (e.key === 'r' || e.key === 'R') { ball.x = W / 2; ball.y = H / 2; trail.length = 0; randomVelocity(); }
  else if (e.key === 'g' || e.key === 'G') { gravityToggle.checked = !gravityToggle.checked; gravity = gravityToggle.checked ? 340 : 0; }
  else if (e.key === 'm' || e.key === 'M') { muteToggle.click(); }
  else if (e.key >= '1' && e.key <= '8') { selectColor(Number(e.key)); }
});

// ---------- Init ----------
buildPalette();
refreshSelection();
randomVelocity();

// unlock audio on the very first user gesture (iOS requires a real touch/click)
function firstGesture() { ensureAudio(); }
window.addEventListener('pointerdown', firstGesture, { once: true, passive: true });
window.addEventListener('touchend', firstGesture, { once: true, passive: true });
window.addEventListener('click', firstGesture, { once: true, passive: true });

updateAudioStatus();
requestAnimationFrame(loop);
