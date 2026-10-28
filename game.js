const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = canvas.width;
const H = canvas.height;
const LANES = 4;
const LANE_W = W / LANES;
const JUDGE_Y = H - 100;
const BASE_NOTE_SPEED = 240;
const NOTE_H = 22;
const SONG_TITLE = 'Test Track';
const BPM = typeof CHART_BPM !== 'undefined' ? CHART_BPM : 150;
const BEAT_SEC = 60 / BPM;
const STEP_SEC = BEAT_SEC / 4;
const MUSIC_BARS = typeof TOTAL_BARS !== 'undefined' ? TOTAL_BARS : 40;
const TOTAL_STEPS = MUSIC_BARS * 16;
const LAST_NOTE_TIME = (typeof CHART !== 'undefined' && Array.isArray(CHART) && CHART.length > 0)
  ? Math.max(...CHART.map((n) => n.time + (n.duration || 0)))
  : MUSIC_BARS * BEAT_SEC * 4;
const SONG_LENGTH_SEC = MUSIC_BARS * BEAT_SEC * 4;
const SONG_DURATION = LAST_NOTE_TIME + 2; // 마지막 노트 time + 2초 기준

// Am - F - C - G 코드 진행 (루트음: A1, F1, C2, G1 및 3화음 아르페지오)
const CHORD_PROG = [
  { root: 55.00, arp: [440.00, 523.25, 659.25] },
  { root: 43.65, arp: [349.23, 440.00, 523.25] },
  { root: 65.41, arp: [523.25, 659.25, 783.99] },
  { root: 49.00, arp: [392.00, 493.88, 587.33] }
];

const KEY_MAP = { KeyZ: 0, KeyX: 1, Period: 2, Slash: 3 };
const KEY_LABELS = ['Z', 'X', '.', '/'];
const LANE_COLORS = ['#ff5c8a', '#38b6ff', '#06d6a0', '#ffbe0b'];
const HIT_FREQS = [523.25, 659.25, 783.99, 987.77];
const JUDGE_COLORS = {
  PERFECT: '#ffe066',
  GREAT: '#4df0ff',
  GOOD: '#7ae582',
  MISS: '#ff5c77'
};
const BASE_SCORE = { PERFECT: 300, GREAT: 200, GOOD: 100 };

const pressed = [false, false, false, false];
const laneHolding = [false, false, false, false];

let audioCtx = null;
let musicVolume = 0.35; // 타이틀 화면용 음악 볼륨 변수 (마스터 0.35)
let musicGain = null;   // 배경음악 마스터 GainNode
let sfxGain = null;     // 노트 히트 효과음 전용 별도 GainNode
let noiseBuffer = null;
let state = 'READY'; // READY, PLAYING, RESULT
let speedMult = 2.0;
let startTime = 0;
let nextStep = 0;
let endTime = null;
let notes = [];
let effects = [];
let lastJudge = null;
let comboPulseTime = null;
let score = 0;
let combo = 0;
let maxCombo = 0;
let counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.75;
    sfxGain.connect(audioCtx.destination);

    const sampleRate = audioCtx.sampleRate;
    noiseBuffer = audioCtx.createBuffer(1, Math.floor(sampleRate * 0.2), sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function stopMusic() {
  if (musicGain && audioCtx) {
    try {
      musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
      musicGain.gain.setValueAtTime(0, audioCtx.currentTime);
      musicGain.disconnect();
    } catch (e) {}
    musicGain = null;
  }
}

let SYNC_OFFSET_MS = 0;
try {
  const savedSync = localStorage.getItem('sync_offset_ms');
  if (savedSync !== null) {
    const parsed = parseInt(savedSync, 10);
    if (!isNaN(parsed)) SYNC_OFFSET_MS = Math.min(150, Math.max(-150, parsed));
  }
} catch (e) {}

function setSyncOffset(val) {
  SYNC_OFFSET_MS = Math.min(150, Math.max(-150, val));
  try {
    localStorage.setItem('sync_offset_ms', String(SYNC_OFFSET_MS));
  } catch (e) {}
}

function getGameTime() {
  return audioCtx ? audioCtx.currentTime - startTime : 0;
}

function getJudgeTime() {
  return getGameTime() - SYNC_OFFSET_MS / 1000;
}

function playHitSound(lane) {
  if (!audioCtx || !sfxGain) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(HIT_FREQS[lane], t);
  gain.gain.setValueAtTime(0.6, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(t);
  osc.stop(t + 0.07);
}

function playMissSound() {
  if (!audioCtx || !sfxGain) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.11);
  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(t);
  osc.stop(t + 0.11);
}

function playKick(t, fade) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
  gain.gain.setValueAtTime(0.95 * fade, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(gain);
  gain.connect(musicGain);
  osc.start(t);
  osc.stop(t + 0.1);
}

function playNoise(t, hpFreq, dur, vol) {
  if (!noiseBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(hpFreq, t);
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(musicGain);
  src.start(t);
  src.stop(t + dur);
}

function playBass(t, freq, fade) {
  const dur = STEP_SEC * 1.8;
  const osc = audioCtx.createOscillator();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(320, t);
  gain.gain.setValueAtTime(0.5 * fade, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(musicGain);
  osc.start(t);
  osc.stop(t + dur);
}

function playLead(t, freq, vol) {
  const dur = STEP_SEC * 0.9;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain);
  gain.connect(musicGain);
  osc.start(t);
  osc.stop(t + dur);
}

function scheduleMusicStep(step, time) {
  if (!audioCtx || !musicGain) return;
  const t = Math.max(time, audioCtx.currentTime);
  const bar = Math.floor(step / 16) + 1; // 1 ~ 40마디
  const s = step % 16;                   // 마디 내 16분음표 위치 (0 ~ 15)
  const chord = CHORD_PROG[(bar - 1) % 4];
  const fade = bar === 40 ? Math.max(0.05, 1 - s / 16) : 1;

  // 1. 킥: 매 박(0, 4, 8, 12)마다
  if (s % 4 === 0) {
    playKick(t, fade);
  }

  // 2. 하이햇: 1~28마디 8분음표, 29~36마디 16분음표마다 (37~40마디 제외)
  if (bar <= 28 && s % 2 === 0) {
    playNoise(t, 7500, 0.04, 0.25);
  } else if (bar >= 29 && bar <= 36) {
    playNoise(t, 7500, 0.035, s % 2 === 0 ? 0.25 : 0.15);
  }

  // 3. 스네어: 5~36마디의 각 마디 2박(s === 4)과 4박(s === 12)
  if (bar >= 5 && bar <= 36 && (s === 4 || s === 12)) {
    playNoise(t, 1500, 0.12, 0.45);
  }

  // 4. 베이스: 5~40마디에서 8분음표마다
  if (bar >= 5 && s % 2 === 0) {
    playBass(t, chord.root, fade);
  }

  // 5. 리드 멜로디: 5~36마디(17~36마디 본격 리드) 16분음표 아르페지오
  if (bar >= 5 && bar <= 36) {
    const leadVol = bar >= 17 ? 0.14 : 0.05;
    playLead(t, chord.arp[s % 3], leadVol);
  }
}

function startGame() {
  initAudio();
  stopMusic();
  musicGain = audioCtx.createGain();
  musicGain.gain.setValueAtTime(musicVolume, audioCtx.currentTime);
  musicGain.connect(audioCtx.destination);
  try {
    notes = (typeof CHART !== 'undefined' && Array.isArray(CHART) ? CHART : []).map((n) => ({
      ...n,
      duration: n.duration || 0,
      done: false,
      holding: false
    }));
  } catch (err) {
    console.error('[game.js] 노트 로드 중 오류 발생:', err);
    notes = [];
  }
  for (let i = 0; i < LANES; i++) {
    pressed[i] = false;
    laneHolding[i] = false;
  }
  effects = [];
  lastJudge = null;
  comboPulseTime = null;
  score = 0;
  combo = 0;
  maxCombo = 0;
  counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  nextStep = 0;
  endTime = null;
  startTime = audioCtx.currentTime;
  state = 'PLAYING';
}

function applyJudge(type, currentTime, lane) {
  counts[type]++;
  if (type === 'MISS') {
    combo = 0;
    playMissSound();
  } else {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    if (combo % 10 === 0) comboPulseTime = currentTime;
    score += BASE_SCORE[type] + (combo - 1) * 2;
    effects.push({ lane, time: currentTime, color: LANE_COLORS[lane] });
    playHitSound(lane);
  }
  lastJudge = { text: type, color: JUDGE_COLORS[type], time: currentTime };
}

function judgeLane(lane) {
  const currentTime = getGameTime();
  const judgeTime = getJudgeTime();
  let target = null;
  let minDiff = Infinity;

  for (const note of notes) {
    if (note.done || note.holding || note.lane !== lane) continue;
    const diff = Math.abs(note.time - judgeTime) * 1000;
    if (diff < minDiff) {
      minDiff = diff;
      target = note;
    }
  }

  if (!target || minDiff > 120) return;

  let grade = 'GOOD';
  if (minDiff <= 40) grade = 'PERFECT';
  else if (minDiff <= 80) grade = 'GREAT';

  if (target.duration > 0) {
    target.holding = true;
    lastJudge = { text: grade, color: JUDGE_COLORS[grade], time: currentTime };
    playHitSound(lane);
    effects.push({ lane, time: currentTime, color: LANE_COLORS[lane] });
  } else {
    target.done = true;
    applyJudge(grade, currentTime, lane);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;

  if (state === 'READY') {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const delta = e.code === 'ArrowUp' ? 0.5 : -0.5;
      speedMult = Math.min(6.0, Math.max(1.0, speedMult + delta));
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const delta = e.code === 'ArrowRight' ? 5 : -5;
      setSyncOffset(SYNC_OFFSET_MS + delta);
      return;
    }
  }

  const lane = KEY_MAP[e.code];
  if (lane === undefined) return;
  e.preventDefault();
  pressed[lane] = true;
  laneHolding[lane] = true;

  if (state === 'READY' || state === 'RESULT') {
    if (e.code === 'KeyZ') startGame();
    return;
  }

  judgeLane(lane);
});

window.addEventListener('keyup', (e) => {
  const lane = KEY_MAP[e.code];
  if (lane === undefined) return;
  pressed[lane] = false;
  laneHolding[lane] = false;

  if (state !== 'PLAYING') return;
  const currentTime = getGameTime();
  const judgeTime = getJudgeTime();
  for (const note of notes) {
    if (note.holding && !note.done && note.lane === lane) {
      note.holding = false;
      note.done = true;
      if (judgeTime < note.time + note.duration - 0.15) {
        applyJudge('MISS', currentTime, lane);
      } else {
        applyJudge('PERFECT', currentTime, lane);
      }
    }
  }
});

window.addEventListener('blur', () => {
  for (let i = 0; i < LANES; i++) {
    pressed[i] = false;
    laneHolding[i] = false;
  }
  if (state === 'PLAYING') {
    const currentTime = getGameTime();
    for (const note of notes) {
      if (note.holding && !note.done) {
        note.holding = false;
        note.done = true;
        applyJudge('MISS', currentTime, note.lane);
      }
    }
  }
});

function update() {
  if (state !== 'PLAYING') return;
  const currentTime = getGameTime();
  const judgeTime = getJudgeTime();
  let allDone = true;

  for (const note of notes) {
    if (note.done) continue;

    if (note.holding) {
      allDone = false;
      if (!laneHolding[note.lane]) {
        note.holding = false;
        note.done = true;
        if (judgeTime < note.time + note.duration - 0.15) {
          applyJudge('MISS', currentTime, note.lane);
        } else {
          applyJudge('PERFECT', currentTime, note.lane);
        }
        continue;
      }
      if (judgeTime >= note.time + note.duration) {
        note.holding = false;
        note.done = true;
        applyJudge('PERFECT', currentTime, note.lane);
      }
    } else {
      if ((judgeTime - note.time) * 1000 > 130) {
        note.done = true;
        applyJudge('MISS', currentTime, note.lane);
      } else {
        allDone = false;
      }
    }
  }

  while (nextStep < TOTAL_STEPS && nextStep * STEP_SEC < currentTime + 0.1) {
    scheduleMusicStep(nextStep, startTime + nextStep * STEP_SEC);
    nextStep++;
  }

  effects = effects.filter((fx) => currentTime - fx.time < 0.25);

  if (allDone) {
    if (endTime === null) endTime = currentTime;
    else if (currentTime - endTime >= 0.6) {
      stopMusic();
      state = 'RESULT';
    }
  }
}

function drawNotes(currentTime) {
  const noteSpeed = BASE_NOTE_SPEED * speedMult;
  for (const note of notes) {
    if (note.done) continue;

    if (note.duration > 0) {
      const isHeld = note.holding && laneHolding[note.lane];
      const yTail = JUDGE_Y - ((note.time + note.duration) - currentTime) * noteSpeed;
      const yHead = isHeld ? JUDGE_Y : JUDGE_Y - (note.time - currentTime) * noteSpeed;
      if (yHead < 0 || yTail > H) continue;

      const barX = note.lane * LANE_W + 14;
      const barW = LANE_W - 28;
      const barH = yHead - yTail;

      ctx.save();
      ctx.fillStyle = LANE_COLORS[note.lane];
      ctx.globalAlpha = isHeld ? 0.85 : 0.5;
      ctx.fillRect(barX, yTail, barW, barH);
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = isHeld ? '#ffffff' : LANE_COLORS[note.lane];
      ctx.lineWidth = isHeld ? 3 : 2;
      ctx.strokeRect(barX, yTail, barW, barH);
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(note.lane * LANE_W + 10, yTail - 4, LANE_W - 20, 8, 4);
      ctx.fill();

      if (!isHeld) {
        ctx.fillStyle = LANE_COLORS[note.lane];
        ctx.beginPath();
        ctx.roundRect(note.lane * LANE_W + 5, yHead - NOTE_H / 2, LANE_W - 10, NOTE_H, 6);
        ctx.fill();
      } else {
        const cx = note.lane * LANE_W + LANE_W / 2;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(note.lane * LANE_W + 6, JUDGE_Y - 5, LANE_W - 12, 10);
        ctx.beginPath();
        ctx.arc(cx, JUDGE_Y, 16 + Math.sin(currentTime * 20) * 3, 0, Math.PI * 2);
        ctx.fillStyle = LANE_COLORS[note.lane];
        ctx.globalAlpha = 0.6;
        ctx.fill();
        ctx.restore();
      }
    } else {
      const y = JUDGE_Y - (note.time - currentTime) * noteSpeed;
      if (y + NOTE_H / 2 < 0 || y - NOTE_H / 2 > H) continue;

      ctx.fillStyle = LANE_COLORS[note.lane];
      ctx.beginPath();
      ctx.roundRect(note.lane * LANE_W + 5, y - NOTE_H / 2, LANE_W - 10, NOTE_H, 6);
      ctx.fill();
    }
  }
}

function drawEffects(currentTime) {
  for (const fx of effects) {
    const p = Math.max(0, (currentTime - fx.time) / 0.25);
    const cx = fx.lane * LANE_W + LANE_W / 2;
    const r = 12 + p * 36;

    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, JUDGE_Y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = (1 - p) * 0.5;
    ctx.beginPath();
    ctx.arc(cx, JUDGE_Y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHUD(currentTime) {
  const progress = Math.min(1, Math.max(0, currentTime / SONG_DURATION));
  ctx.fillStyle = '#182446';
  ctx.fillRect(0, 0, W, 6);
  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(0, 0, W * progress, 6);

  ctx.fillStyle = '#e2ecff';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`SCORE ${score}`, 14, 18);

  if (combo > 0) {
    let scale = 1;
    if (comboPulseTime !== null) {
      const elapsed = currentTime - comboPulseTime;
      if (elapsed >= 0 && elapsed < 0.22) {
        scale = 1 + 0.35 * Math.sin((elapsed / 0.22) * Math.PI);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8fa8d8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('COMBO', W / 2, 82);

    ctx.save();
    ctx.translate(W / 2, 118);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText(String(combo), 0, 0);
    ctx.restore();
  }

  if (lastJudge && currentTime - lastJudge.time <= 0.5) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = lastJudge.color;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(lastJudge.text, W / 2, JUDGE_Y - 65);
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function drawTitle() {
  ctx.fillStyle = 'rgba(10, 17, 36, 0.88)';
  ctx.strokeStyle = '#38b6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(40, 140, W - 80, 280, 12);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(SONG_TITLE, W / 2, 182);

  ctx.fillStyle = '#8fa8d8';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`BPM ${BPM}  •  ${formatTime(SONG_LENGTH_SEC)}`, W / 2, 218);

  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`SPEED ${speedMult.toFixed(1)}`, W / 2, 258);

  ctx.fillStyle = '#768ebc';
  ctx.font = '12px sans-serif';
  ctx.fillText('▲ / ▼ 속도 조절 (1.0 ~ 6.0)', W / 2, 280);

  const syncSign = SYNC_OFFSET_MS > 0 ? '+' : '';
  ctx.fillStyle = '#ffbe0b';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`SYNC: ${syncSign}${SYNC_OFFSET_MS}ms`, W / 2, 314);

  ctx.fillStyle = '#768ebc';
  ctx.font = '12px sans-serif';
  ctx.fillText('◀ / ▶ 싱크 조절 (5ms)', W / 2, 336);

  ctx.fillStyle = '#ffe066';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Z 키를 눌러 시작', W / 2, 385);
}

function getRank(acc) {
  if (acc >= 95) return { grade: 'S', color: '#ffe066' };
  if (acc >= 85) return { grade: 'A', color: '#00e5ff' };
  if (acc >= 70) return { grade: 'B', color: '#7ae582' };
  return { grade: 'C', color: '#ff8fa3' };
}

function drawResult() {
  ctx.fillStyle = 'rgba(6, 9, 20, 0.82)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#111c38';
  ctx.strokeStyle = '#38b6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(35, 65, W - 70, 520, 12);
  ctx.fill();
  ctx.stroke();

  const total = notes.length || 1;
  const acc = ((counts.PERFECT * 300 + counts.GREAT * 200 + counts.GOOD * 100) / (total * 300)) * 100;
  const rank = getRank(acc);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('RESULT', W / 2, 102);

  ctx.fillStyle = rank.color;
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText(rank.grade, W / 2, 162);

  const summary = [
    ['점수', String(score)],
    ['최대 콤보', String(maxCombo)],
    ['정확도', `${acc.toFixed(1)}%`]
  ];
  ctx.font = 'bold 18px sans-serif';
  summary.forEach(([label, val], idx) => {
    const y = 225 + idx * 34;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fb3e0';
    ctx.fillText(label, 65, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(val, W - 65, y);
  });

  ctx.strokeStyle = '#283a68';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 320);
  ctx.lineTo(W - 60, 320);
  ctx.stroke();

  const detail = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];
  ctx.font = 'bold 18px sans-serif';
  detail.forEach((type, idx) => {
    const y = 350 + idx * 32;
    ctx.textAlign = 'left';
    ctx.fillStyle = JUDGE_COLORS[type];
    ctx.fillText(type, 65, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e2ecff';
    ctx.fillText(String(counts[type]), W - 65, y);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Z 키를 눌러 재시작', W / 2, 535);
}

function draw() {
  const laneBg = ctx.createLinearGradient(0, 0, 0, JUDGE_Y);
  laneBg.addColorStop(0, '#0b1224');
  laneBg.addColorStop(0.7, '#111d3a');
  laneBg.addColorStop(1, '#1e3363');
  ctx.fillStyle = laneBg;
  ctx.fillRect(0, 0, W, JUDGE_Y);

  ctx.fillStyle = '#0a1020';
  ctx.fillRect(0, JUDGE_Y, W, H - JUDGE_Y);

  for (let i = 0; i < LANES; i++) {
    const x = i * LANE_W;

    if (pressed[i]) {
      const grad = ctx.createLinearGradient(0, 0, 0, JUDGE_Y);
      grad.addColorStop(0, 'rgba(70, 175, 255, 0.05)');
      grad.addColorStop(1, 'rgba(70, 175, 255, 0.45)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, LANE_W, JUDGE_Y);
    }

    if (i > 0) {
      ctx.strokeStyle = '#25335a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, JUDGE_Y);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(0, JUDGE_Y - 2, W, 4);

  const currentTime = getGameTime();

  if (state === 'PLAYING') {
    drawNotes(currentTime);
  } else if (state === 'READY') {
    drawTitle();
  }

  for (let i = 0; i < LANES; i++) {
    const x = i * LANE_W;
    const bx = x + 10;
    const by = JUDGE_Y + 15;
    const bw = LANE_W - 20;
    const bh = 70;

    ctx.fillStyle = pressed[i] ? '#38b6ff' : '#182446';
    ctx.strokeStyle = pressed[i] ? '#b8ebff' : '#334678';
    ctx.lineWidth = 2;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = pressed[i] ? '#081226' : '#c8d6f5';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(KEY_LABELS[i], x + LANE_W / 2, by + bh / 2);
  }

  if (state === 'PLAYING') {
    drawEffects(currentTime);
    drawHUD(currentTime);
  } else if (state === 'RESULT') {
    drawResult();
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
