// Live browser demo of the fabric colour variation detection method.
// Everything runs locally: the camera image never leaves the device.
(function () {
  'use strict';
  var C = window.Colour;
  var $ = function (id) { return document.getElementById(id); };

  var CFG = {
    roi: 0.8,              // inspection box = central 80 % × 80 %
    size: 60,              // region resampled to 60 × 60 (3 × 3 grid of 20 × 20)
    skip: 10, refFrames: 15,
    darkLevel: 4, brightLevel: 250, maxClipPct: 1.0,
    stableMax: 1.0, evenMax: 2.0, window: 30,
    fps: 15
  };

  var video = $('video'), view = $('view'), vctx = view.getContext('2d');
  var small = document.createElement('canvas'); small.width = small.height = CFG.size;
  var sctx = small.getContext('2d', { willReadFrequently: true });
  var clip = document.createElement('canvas'); clip.width = 160; clip.height = 120;
  var cctx = clip.getContext('2d', { willReadFrequently: true });
  var graph = $('graph'), gctx = graph.getContext('2d');

  var stream = null, timer = null, win = [], last = null, test = null, result = null, uiTick = 0;

  // ── helpers ──
  function median(arr) {
    var s = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function medianLab(list) {
    return [0, 1, 2].map(function (k) { return median(list.map(function (l) { return l[k]; })); });
  }
  function meanLab(list) {
    var s = [0, 0, 0];
    list.forEach(function (l) { s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; });
    return s.map(function (v) { return v / list.length; });
  }
  function p95(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1) + 0.5))];
  }
  function roiRect(w, h) {
    var rw = Math.round(w * CFG.roi), rh = Math.round(h * CFG.roi);
    return [Math.round((w - rw) / 2), Math.round((h - rh) / 2), rw, rh];
  }
  function setMsg(text, kind) { var m = $('msg'); m.textContent = text || ''; m.className = 'demo-msg ' + (kind || ''); }

  // ── camera ──
  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMsg('This browser cannot open a camera here. Use a recent Chrome, Edge, Firefox or Safari over https.', 'err');
      return;
    }
    setMsg('Waiting for camera permission…');
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' }, audio: false })
      .then(function (s) {
        stream = s; video.srcObject = s;
        return video.play();
      })
      .then(function () {
        $('stage').classList.add('live');
        $('btnCam').textContent = 'Stop camera';
        $('btnTest').disabled = false;
        setMsg('Camera on. Fill the box with one plain-coloured fabric.');
        win = [];
        timer = setInterval(tick, 1000 / CFG.fps);
      })
      .catch(function (e) {
        setMsg(e && e.name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow the camera in the address bar and try again.'
          : 'Could not open a camera (' + (e && e.name ? e.name : 'error') + ').', 'err');
      });
  }
  function stopCamera() {
    if (timer) clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; video.srcObject = null; test = null; last = null;
    $('stage').classList.remove('live');
    $('btnCam').textContent = 'Start camera';
    $('btnTest').disabled = true; $('btnTest').textContent = 'Start test';
    renderChecks(null); setMsg('Camera off.');
  }

  // ── per-frame analysis (same method as the desktop system) ──
  function analyse() {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    var r = roiRect(w, h);
    sctx.drawImage(video, r[0], r[1], r[2], r[3], 0, 0, CFG.size, CFG.size);
    cctx.drawImage(video, r[0], r[1], r[2], r[3], 0, 0, clip.width, clip.height);
    var px = sctx.getImageData(0, 0, CFG.size, CFG.size).data;
    var cp = cctx.getImageData(0, 0, clip.width, clip.height).data;

    var dark = 0, bright = 0, n = cp.length / 4;
    for (var i = 0; i < cp.length; i += 4) {
      var mx = Math.max(cp[i], cp[i + 1], cp[i + 2]);
      if (mx <= CFG.darkLevel) dark++;
      if (mx >= CFG.brightLevel) bright++;
    }
    var N = CFG.size * CFG.size, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
    var cells = [];
    for (var c = 0; c < 9; c++) cells.push([0, 0, 0, 0]);
    for (var y = 0; y < CFG.size; y++) {
      for (var x = 0; x < CFG.size; x++) {
        var k = (y * CFG.size + x), o = k * 4;
        var lab = C.rgbToLab(px[o], px[o + 1], px[o + 2]);
        L[k] = lab[0]; A[k] = lab[1]; B[k] = lab[2];
        var cell = cells[Math.floor(y / 20) * 3 + Math.floor(x / 20)];
        cell[0] += lab[0]; cell[1] += lab[1]; cell[2] += lab[2]; cell[3]++;
      }
    }
    var colour = [median(L), median(A), median(B)];
    var grid = cells.map(function (s) { return [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    var gridDe = grid.map(function (g) { return C.de2000(grid[4], g); });
    return {
      lab: colour, gridDe: gridDe, uniformity: Math.max.apply(null, gridDe),
      darkPct: dark / n * 100, brightPct: bright / n * 100, rect: r
    };
  }

  function checksFor(a, stability) {
    return [
      { key: 'camera', label: 'Camera', ok: !!a, value: a ? 'on' : 'off' },
      { key: 'dark', label: 'Not too dark', ok: a && a.darkPct <= CFG.maxClipPct, value: a ? a.darkPct.toFixed(1) + '% black' : '—' },
      { key: 'bright', label: 'Not over-exposed', ok: a && a.brightPct <= CFG.maxClipPct, value: a ? a.brightPct.toFixed(1) + '% clipped' : '—' },
      { key: 'stable', label: 'Stable', ok: stability !== null && stability <= CFG.stableMax, value: stability === null ? 'measuring…' : 'ΔE00 ' + stability.toFixed(2) },
      { key: 'even', label: 'Even light', ok: a && a.uniformity <= CFG.evenMax, value: a ? 'ΔE00 ' + a.uniformity.toFixed(2) : '—' }
    ];
  }

  function tick() {
    var a = analyse();
    if (!a) return;
    win.push(a.lab); if (win.length > CFG.window) win.shift();
    var stability = null;
    if (win.length >= 10) {
      var m = meanLab(win);
      stability = p95(win.map(function (l) { return C.de2000(m, l); }));
    }
    var checks = checksFor(a, stability);
    last = { a: a, checks: checks };
    stepTest(a, checks);
    draw(a);
    if (++uiTick % 3 === 0) renderUI();
  }

  // ── test ──
  function startTest() {
    if (test) { finishTest('Stopped'); return; }
    if (!last) return;
    var needed = last.checks.slice(0, 3);
    var bad = needed.filter(function (c) { return !c.ok; })[0];
    if (bad) { setMsg('Not started — ' + bad.label + ': ' + bad.value, 'err'); return; }
    var limit = Math.max(1, parseFloat($('limit').value) || 2);
    test = { state: 'reference', seen: 0, refs: [], ref: null, t0: 0, readings: [],
             duration: parseInt($('duration').value, 10) || 20, limit: limit, badSince: null };
    result = null; $('result').hidden = true;
    $('btnTest').textContent = 'Stop test';
    setMsg('Capturing the reference colour — keep the fabric still…');
  }

  function stepTest(a, checks) {
    if (!test) return;
    var now = performance.now();
    var exposureOk = checks[1].ok && checks[2].ok;
    if (!exposureOk) {
      test.badSince = test.badSince || now;
      if (now - test.badSince > 1500) { finishTest('Stopped: light out of range'); return; }
    } else test.badSince = null;

    test.seen++;
    if (test.state === 'reference') {
      if (test.seen <= CFG.skip) return;
      test.refs.push(a.lab);
      if (test.refs.length >= CFG.refFrames) {
        test.ref = medianLab(test.refs); test.state = 'measuring'; test.t0 = now;
        setMsg('Measuring. Now slide a slightly different fabric into the box to see it detected.');
      }
      return;
    }
    var de = C.de2000(test.ref, a.lab);
    test.readings.push({ t: (now - test.t0) / 1000, L: a.lab[0], a: a.lab[1], b: a.lab[2], de: de, same: de <= test.limit });
    if ((now - test.t0) / 1000 >= test.duration) finishTest('Completed');
  }

  function finishTest(reason) {
    var t = test; test = null;
    $('btnTest').textContent = 'Start test';
    if (!t || !t.readings.length) { setMsg('Test cancelled before the reference was captured.', 'err'); return; }
    var n = t.readings.length, same = t.readings.filter(function (r) { return r.same; }).length;
    var des = t.readings.map(function (r) { return r.de; });
    var mean = des.reduce(function (s, v) { return s + v; }, 0) / n;
    result = { t: t, reason: reason, n: n, same: same, pct: same / n * 100, mean: mean, max: Math.max.apply(null, des) };
    renderResult(); setMsg(reason + '.');
  }

  // ── drawing ──
  function draw(a) {
    var w = video.videoWidth, h = video.videoHeight;
    if (view.width !== w) { view.width = w; view.height = h; }
    vctx.drawImage(video, 0, 0, w, h);
    var r = a.rect, col = '#2BD4A0';
    if (test && test.state === 'reference') col = '#FFC53D';
    else if (test && test.readings.length && !test.readings[test.readings.length - 1].same) col = '#FF5A47';
    if ($('showGrid').checked) {
      var fs = Math.max(10, Math.round(w / 48)); vctx.lineWidth = 1; vctx.font = '600 ' + fs + 'px system-ui, sans-serif';
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
        var de = a.gridDe[i * 3 + j], x = r[0] + j * r[2] / 3, y = r[1] + i * r[3] / 3;
        vctx.strokeStyle = de <= CFG.evenMax ? 'rgba(43,212,160,0.8)' : 'rgba(255,90,71,0.9)';
        vctx.strokeRect(x, y, r[2] / 3, r[3] / 3);
        vctx.fillStyle = 'rgba(0,0,0,0.55)'; vctx.fillRect(x + 4, y + 4, fs * 3.2, fs * 1.5);
        vctx.fillStyle = '#fff'; vctx.fillText((i === 1 && j === 1) ? 'REF' : de.toFixed(1), x + 4 + fs * 0.3, y + 4 + fs * 1.15);
      }
    }
    vctx.lineWidth = 3; vctx.strokeStyle = col; vctx.strokeRect(r[0], r[1], r[2], r[3]);
  }

  function renderChecks(checks) {
    var list = $('checks');
    if (!checks) { list.innerHTML = ''; $('badge').textContent = 'Camera off'; $('badge').className = 'badge'; return; }
    list.innerHTML = checks.map(function (c) {
      return '<li class="' + (c.ok ? 'ok' : 'bad') + '"><span class="dot"></span><span>' + c.label + '</span><span class="val">' + c.value + '</span></li>';
    }).join('');
    var demoOk = checks.slice(0, 3).every(function (c) { return c.ok; });
    var allOk = checks.every(function (c) { return c.ok; });
    var b = $('badge');
    b.textContent = allOk ? 'All checks passed' : demoOk ? 'Ready to test' : 'Adjust light or position';
    b.className = 'badge ' + (allOk ? 'ok' : demoOk ? 'warn' : 'bad');
  }

  function renderUI() {
    if (!last) return;
    renderChecks(last.checks);
    var lab = last.a.lab;
    $('liveChip').style.background = C.labToHex(lab);
    $('liveLab').textContent = lab.map(function (v) { return v.toFixed(1); }).join(' / ');
    var ref = test && test.ref ? test.ref : (result ? result.t.ref : null);
    $('refChip').style.background = ref ? C.labToHex(ref) : 'transparent';
    $('refLab').textContent = ref ? ref.map(function (v) { return v.toFixed(1); }).join(' / ') : '—';
    var rs = test ? test.readings : (result ? result.t.readings : []);
    $('curDe').textContent = test && rs.length ? rs[rs.length - 1].de.toFixed(2) : '—';
    if (test && test.state === 'measuring') {
      var left = Math.max(0, test.duration - (performance.now() - test.t0) / 1000);
      $('timer').textContent = Math.ceil(left) + ' s';
    } else $('timer').textContent = '';
    drawGraph(rs, test ? test.limit : (result ? result.t.limit : parseFloat($('limit').value) || 2));
  }

  function drawGraph(rs, limit) {
    var w = graph.clientWidth, h = graph.clientHeight;
    if (graph.width !== w) { graph.width = w; graph.height = h; }
    gctx.clearRect(0, 0, w, h);
    var vals = rs.map(function (r) { return r.de; });
    var max = Math.max(limit * 2.5, Math.max.apply(null, vals.concat([0]))) * 1.1;
    var y = function (v) { return h - 8 - (v / max) * (h - 16); };
    gctx.strokeStyle = '#B23A2A'; gctx.setLineDash([5, 4]); gctx.lineWidth = 1;
    gctx.beginPath(); gctx.moveTo(0, y(limit)); gctx.lineTo(w, y(limit)); gctx.stroke(); gctx.setLineDash([]);
    gctx.fillStyle = '#B23A2A'; gctx.font = '12px system-ui, sans-serif'; gctx.fillText('limit ' + limit.toFixed(1), w - 62, y(limit) - 5);
    if (vals.length < 2) { gctx.fillStyle = '#6E7489'; gctx.fillText('ΔE00 over time appears here during a test', 12, 20); return; }
    var step = w / (vals.length - 1);
    gctx.strokeStyle = '#26316F'; gctx.lineWidth = 1.5; gctx.beginPath();
    vals.forEach(function (v, i) { i ? gctx.lineTo(i * step, y(v)) : gctx.moveTo(0, y(v)); }); gctx.stroke();
    rs.forEach(function (r, i) {
      gctx.fillStyle = r.same ? '#0B7F6E' : '#B23A2A';
      gctx.beginPath(); gctx.arc(i * step, y(r.de), vals.length > 200 ? 1.5 : 2.5, 0, 6.3); gctx.fill();
    });
  }

  function renderResult() {
    var r = result, pass = r.pct >= 80;
    $('result').hidden = false;
    $('resVerdict').textContent = pass ? (r.pct >= 90 ? 'Excellent consistency' : 'Consistent') : 'Colour variation detected';
    $('resVerdict').className = 'res-verdict ' + (pass ? 'pass' : 'fail');
    $('resSame').textContent = r.pct.toFixed(1) + '%';
    $('resN').textContent = r.n;
    $('resMean').textContent = r.mean.toFixed(2);
    $('resMax').textContent = r.max.toFixed(2);
    $('resReason').textContent = r.reason + ' · limit ΔE00 ' + r.t.limit.toFixed(1) + ' · demo reading, not a measurement';
    renderUI();
  }

  function downloadCsv() {
    if (!result) return;
    var rows = [['t_s', 'L', 'a', 'b', 'dE00', 'status']];
    result.t.readings.forEach(function (r) {
      rows.push([r.t.toFixed(3), r.L.toFixed(3), r.a.toFixed(3), r.b.toFixed(3), r.de.toFixed(3), r.same ? 'same' : 'different']);
    });
    var blob = new Blob([rows.map(function (r) { return r.join(','); }).join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'colour-demo-readings.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  $('btnCam').addEventListener('click', function () { stream ? stopCamera() : startCamera(); });
  $('btnTest').addEventListener('click', startTest);
  $('btnCsv').addEventListener('click', downloadCsv);
  window.addEventListener('pagehide', stopCamera);
  drawGraph([], 2);
})();