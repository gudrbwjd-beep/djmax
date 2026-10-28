// 전역 곡 설정 변수
var CHART_BPM = 150;
var TOTAL_BARS = 40;

function buildChart() {
  var beatSec = 60 / CHART_BPM; // 1박 = 0.4초
  var barSec = beatSec * 4;     // 1마디 = 1.6초
  var startOffset = 0;          // 곡 시작 시점(time=0)과 동기화

  // 시드 고정 의사난수 생성기
  var seed = 20261028;
  function rng() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  var notes = [];

  function addNote(time, lane, duration) {
    var item = { time: Math.round(time * 1000) / 1000, lane: lane };
    if (duration > 0) item.duration = Math.round(duration * 1000) / 1000;
    notes.push(item);
  }

  function addChord(time, lane1, lane2) {
    addNote(time, lane1, 0);
    addNote(time, lane2, 0);
  }

  // 1~4마디: 인트로 (4분음표 위주, 1마디 첫 2박은 리드인 여유)
  var introPatterns = [
    [0, 1, 2, 3],
    [3, 2, 1, 0],
    [0, 2, 1, 3],
    [1, 2, 3, 0]
  ];
  for (var b = 1; b <= 4; b++) {
    var bt = startOffset + (b - 1) * barSec;
    var pat = introPatterns[b - 1];
    for (var beat = (b === 1 ? 2 : 0); beat < 4; beat++) {
      addNote(bt + beat * beatSec, pat[beat], 0);
    }
  }

  // 5~16마디: 전개 (8분음표 계단 및 웨이브)
  var lastDevPat = -1;
  var devPatterns = [
    [0, 1, 2, 3, 0, 1, 2, 3],
    [3, 2, 1, 0, 3, 2, 1, 0],
    [0, 1, 2, 3, 2, 1, 0, 1],
    [3, 2, 1, 0, 1, 2, 3, 2],
    [0, 2, 1, 3, 0, 2, 1, 3]
  ];
  for (var b5 = 5; b5 <= 16; b5++) {
    var bt5 = startOffset + (b5 - 1) * barSec;
    var patIdx = Math.floor(rng() * devPatterns.length);
    if (patIdx === lastDevPat) patIdx = (patIdx + 1) % devPatterns.length;
    lastDevPat = patIdx;
    var pat5 = devPatterns[patIdx];
    for (var step = 0; step < 8; step++) {
      addNote(bt5 + step * (beatSec / 2), pat5[step], 0);
    }
  }

  // 17~28마디: 클라이맥스 (8분음표 + 2개 동시치기 + 연타(잭) + 롱노트)
  var chordPairs = [
    [0, 2], [1, 3], [0, 3], [1, 2], [0, 1], [2, 3]
  ];
  var longNoteBars = {
    18: { lane: 0, beat: 0, dur: beatSec * 2 },
    21: { lane: 3, beat: 0, dur: beatSec * 2 },
    24: { lane: 1, beat: 2, dur: beatSec * 1.5 },
    27: { lane: 2, beat: 2, dur: beatSec * 1.5 }
  };

  for (var b17 = 17; b17 <= 28; b17++) {
    var bt17 = startOffset + (b17 - 1) * barSec;
    if (longNoteBars[b17]) {
      var ln = longNoteBars[b17];
      addNote(bt17 + ln.beat * beatSec, ln.lane, ln.dur);
      var freeLanes = [0, 1, 2, 3].filter(function (l) { return l !== ln.lane; });
      for (var s = 0; s < 8; s++) {
        var t = bt17 + s * (beatSec / 2);
        if (s * 0.5 < ln.beat || s * 0.5 >= ln.beat + ln.dur / beatSec) {
          var pair = chordPairs[Math.floor(rng() * chordPairs.length)];
          addChord(t, pair[0], pair[1]);
        } else {
          addNote(t, freeLanes[s % freeLanes.length], 0);
        }
      }
      continue;
    }

    var chord1 = chordPairs[b17 % chordPairs.length];
    var chord2 = chordPairs[(b17 + 3) % chordPairs.length];
    addChord(bt17, chord1[0], chord1[1]);
    addChord(bt17 + 2 * beatSec, chord2[0], chord2[1]);

    var jackLane = b17 % 4;
    var otherLane = (jackLane + 2) % 4;
    addNote(bt17 + 0.5 * beatSec, jackLane, 0);
    addNote(bt17 + 1.0 * beatSec, jackLane, 0);
    addNote(bt17 + 1.5 * beatSec, otherLane, 0);
    addNote(bt17 + 2.5 * beatSec, otherLane, 0);
    addNote(bt17 + 3.0 * beatSec, jackLane, 0);
    addNote(bt17 + 3.5 * beatSec, otherLane, 0);
  }

  // 29~36마디: 최고조 (16분음표 트릴 + 동시치기)
  var trills = [
    [0, 1, 0, 1],
    [2, 3, 2, 3],
    [1, 2, 1, 2]
  ];
  for (var b29 = 29; b29 <= 36; b29++) {
    var bt29 = startOffset + (b29 - 1) * barSec;
    var c1 = chordPairs[Math.floor(rng() * chordPairs.length)];
    var c2 = chordPairs[Math.floor(rng() * chordPairs.length)];

    addChord(bt29, c1[0], c1[1]);
    addNote(bt29 + 0.5 * beatSec, (c1[0] + 1) % 4, 0);

    var trillPat = trills[b29 % trills.length];
    for (var i = 0; i < 4; i++) {
      addNote(bt29 + 1.0 * beatSec + i * (beatSec / 4), trillPat[i], 0);
    }

    addChord(bt29 + 2.0 * beatSec, c2[0], c2[1]);

    var trillPat2 = trills[(b29 + 1) % trills.length];
    for (var j = 0; j < 4; j++) {
      addNote(bt29 + 3.0 * beatSec + j * (beatSec / 4), trillPat2[3 - j], 0);
    }
  }

  // 37~40마디: 아웃트로
  var b37 = startOffset + 36 * barSec;
  var stepNotes = [3, 2, 1, 0, 2, 1, 0, 1];
  for (var k = 0; k < stepNotes.length; k++) {
    addNote(b37 + k * (beatSec / 2), stepNotes[k], 0);
  }

  var b38 = startOffset + 37 * barSec;
  addChord(b38, 0, 3);
  addNote(b38 + 1 * beatSec, 1, 0);
  addChord(b38 + 2 * beatSec, 1, 2);
  addNote(b38 + 3 * beatSec, 2, 0);

  var b39 = startOffset + 38 * barSec;
  var downNotes = [3, 2, 1, 0];
  for (var d = 0; d < downNotes.length; d++) {
    addNote(b39 + d * beatSec, downNotes[d], 0);
  }

  var b40 = startOffset + 39 * barSec;
  addChord(b40, 0, 2);
  addChord(b40 + 1 * beatSec, 1, 3);
  var finalTime = b40 + 3 * beatSec;
  addNote(finalTime, 0, 0);
  addNote(finalTime, 1, 0);
  addNote(finalTime, 2, 0);
  addNote(finalTime, 3, 0);

  notes.sort(function (a, b) {
    return a.time - b.time || a.lane - b.lane;
  });

  return notes;
}

// 전역 채보 생성 및 에러 방어
var CHART = [];
try {
  CHART = buildChart();
} catch (err) {
  console.error('[chart.js] 채보 생성 중 오류 발생:', err);
  CHART = [];
}
