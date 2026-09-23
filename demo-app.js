// Web demo of the Fabric Color Variation Detection system.
// Mirrors engine.py (analysis, checks, test, baseline) and the desktop UI,
// but runs entirely in the browser with the visitor's own camera.
(function () {
  'use strict';
  var C = window.Colour;
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var CFG = {
    roi: 0.8, size: 60, skip: 10, refFrames: 15,
    darkLevel: 4, brightLevel: 250, maxClip: 1.0,
    stableMax: 1.0, evenMax: 2.0, window: 30,
    lightGraceMs: 1500, fps: 15, passPct: 80, excellentPct: 90, minLimit: 1.0
  };
  var MSG = { camera: 'NO CAMERA', dark: 'TOO DARK', bright: 'OVEREXPOSED', stable: 'UNSTABLE', even: 'UNEVEN LIGHT' };
  var HISTORY_KEY = 'fcv-web-demo-history';

  var video = document.createElement('video'); video.muted = true; video.playsInline = true;
  var small = document.createElement('canvas'); small.width = small.height = CFG.size;
  var sctx = small.getContext('2d', { willReadFrequently: true });
  var clip = document.createElement('canvas'); clip.width = 160; clip.height = 120;
  var cctx = clip.getContext('2d', { willReadFrequently: true });

  var stream = null, timer = null, win = [], last = null, test = null, baseline = null, view = 'viewCheck';
  var graphData = [], graphLimit = 2.0, tickN = 0;

  // ── small helpers ──
  function median(a) { var s = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function medianLab(list) { return [0, 1, 2].map(function (k) { return median(list.map(function (l) { return l[k]; })); }); }
  function meanLab(list) { var s = [0, 0, 0]; list.forEach(function (l) { s[0] += l[0]; s[1] += l[1]; s[2] += l[2]; }); return s.map(function (v) { return v / list.length; }); }
  function pct(values, p) { var s = values.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]; }
  function mean(v) { return v.reduce(function (s, x) { return s + x; }, 0) / v.length; }
  function sd(v) { var m = mean(v); return Math.sqrt(mean(v.map(function (x) { return (x - m) * (x - m); }))); }
  function f2(v) { return v.toFixed(2); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(msg, err) { var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast.h); toast.h = setTimeout(function () { t.className = 'toast'; }, 4000); }
  function setMsg(t, kind) { var m = $('ctrlMsg'); m.textContent = t || ''; m.className = 'ctrl-msg ' + (kind || ''); }
  function roiRect(w, h) { var rw = Math.round(w * CFG.roi), rh = Math.round(h * CFG.roi); return [Math.round((w - rw) / 2), Math.round((h - rh) / 2), rw, rh]; }

  // ── camera ──
  function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devs) {
      var cams = devs.filter(function (d) { return d.kind === 'videoinput'; });
      var sel = $('cameraSelect'), cur = sel.value;
      sel.innerHTML = cams.map(function (d, i) { return '<option value="' + esc(d.deviceId) + '">' + esc(d.label || ('Camera ' + (i + 1))) + '</option>'; }).join('') || '<option value="">Default camera</option>';
      if (cur) sel.value = cur;
      else if (stream) { var id = stream.getVideoTracks()[0].getSettings().deviceId; if (id) sel.value = id; }
      if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    });
  }

  function startCamera(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot open a camera here. Use Chrome, Edge, Firefox or Safari over https.', true); return; }
    stopCamera(true);
    var v = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (deviceId) v.deviceId = { exact: deviceId };
    navigator.mediaDevices.getUserMedia({ video: v, audio: false }).then(function (s) {
      stream = s; video.srcObject = s; return video.play();
    }).then(function () {
      $$('.cam-start').forEach(function (e) { e.style.display = 'none'; });
      win = []; timer = setInterval(tick, 1000 / CFG.fps);
      listCameras();
      toast('Camera on — fill the green box with one plain-coloured fabric.');
    }).catch(function (e) {
      toast(e && e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow it in the address bar and try again.' : 'Could not open the camera (' + (e && e.name || 'error') + ').', true);
    });
  }
  function stopCamera(silent) {
    if (timer) clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; last = null;
    if (!silent) { $$('.cam-start').forEach(function (e) { e.style.display = ''; }); renderReadiness(null); }
  }

  // ── analysis (engine.py: analyze) ──
  function analyse() {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    var r = roiRect(w, h);
    sctx.drawImage(video, r[0], r[1], r[2], r[3], 0, 0, CFG.size, CFG.size);
    cctx.drawImage(video, r[0], r[1], r[2], r[3], 0, 0, clip.width, clip.height);
    var px = sctx.getImageData(0, 0, CFG.size, CFG.size).data, cp = cctx.getImageData(0, 0, clip.width, clip.height).data;
    var dark = 0, bright = 0, n = cp.length / 4;
    for (var i = 0; i < cp.length; i += 4) { var mx = Math.max(cp[i], cp[i + 1], cp[i + 2]); if (mx <= CFG.darkLevel) dark++; if (mx >= CFG.brightLevel) bright++; }
    var N = CFG.size * CFG.size, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N), cells = [];
    for (var c = 0; c < 9; c++) cells.push([0, 0, 0, 0]);
    for (var y = 0; y < CFG.size; y++) for (var x = 0; x < CFG.size; x++) {
      var k = y * CFG.size + x, o = k * 4, lab = C.rgbToLab(px[o], px[o + 1], px[o + 2]);
      L[k] = lab[0]; A[k] = lab[1]; B[k] = lab[2];
      var cell = cells[Math.floor(y / 20) * 3 + Math.floor(x / 20)]; cell[0] += lab[0]; cell[1] += lab[1]; cell[2] += lab[2]; cell[3]++;
    }
    var grid = cells.map(function (s) { return [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    var gridDe = grid.map(function (g) { return C.de2000(grid[4], g); });
    return { lab: [median(L), median(A), median(B)], grid: grid, gridDe: gridDe, uniformity: Math.max.apply(null, gridDe),
             darkPct: dark / n * 100, brightPct: bright / n * 100, rect: r, w: w, h: h };
  }

  function computeChecks(a, stab) {
    return [
      { key: 'camera', label: 'Camera', ok: !!a, value: a ? 'browser camera' : 'not connected' },
      { key: 'dark', label: 'Not too dark', ok: a.darkPct <= CFG.maxClip, value: a.darkPct.toFixed(1) + '% black px' },
      { key: 'bright', label: 'Not overexposed', ok: a.brightPct <= CFG.maxClip, value: a.brightPct.toFixed(1) + '% clipped px' },
      { key: 'stable', label: 'Stable', ok: stab !== null && stab <= CFG.stableMax, value: stab === null ? 'measuring…' : 'ΔE00 ' + f2(stab) },
      { key: 'even', label: 'Even light', ok: a.uniformity <= CFG.evenMax, value: 'ΔE00 ' + f2(a.uniformity) }
    ];
  }

  function tick() {
    var a = analyse(); if (!a) return;
    win.push(a.lab); if (win.length > CFG.window) win.shift();
    var stab = null;
    if (win.length >= 10) { var m = meanLab(win); stab = pct(win.map(function (l) { return C.de2000(m, l); }), 0.95); }
    last = { a: a, checks: computeChecks(a, stab), stab: stab };
    stepTest(a); stepBaseline(a);
    draw(a);
    if (++tickN % 3 === 0) renderAll();
  }

  // ── colour test (engine.py: _step_test / _finalize) ──
  function startTest() {
    if (test) return;
    var name = $('fabricNameInput').value.trim();
    if (!name) { $('fabricNameInput').style.borderColor = '#ef4444'; $('fabricNameInput').focus(); setMsg('Enter a fabric name first.', 'err'); setTimeout(function () { $('fabricNameInput').style.borderColor = ''; }, 1500); return; }
    if (!stream || !last) { setMsg('Start the camera first.', 'err'); return; }
    if (baseline) { setMsg('Baseline is running — wait for it to finish.', 'err'); return; }
    var bad = last.checks.slice(0, 3).filter(function (c) { return !c.ok; })[0];
    if (bad) { setMsg('Not started — ' + bad.label + ': ' + bad.value, 'err'); return; }
    test = { fabric: name, light: $('lightSourceInput').value.trim(), duration: Math.max(5, Math.min(120, parseInt($('durationInput').value, 10) || 20)),
             limit: Math.max(CFG.minLimit, parseFloat($('thresholdInput').value) || 2), state: 'reference', seen: 0, refs: [], ref: null,
             t0: 0, readings: [], badSince: null, startTime: new Date() };
    graphData = []; graphLimit = test.limit; resetStats();
    setMsg('Demo camera — this result is marked DEMO.', 'warn');
    renderAll();
  }

  function stepTest(a) {
    var t = test; if (!t) return;
    var now = performance.now();
    var expOk = a.darkPct <= CFG.maxClip && a.brightPct <= CFG.maxClip;
    if (!expOk) { t.badSince = t.badSince || now; if (now - t.badSince > CFG.lightGraceMs) { if (t.state === 'measuring' && t.readings.length) finalize('light_lost'); else { test = null; setMsg('Test cancelled: light went out of range before the reference was set.', 'err'); } return; } }
    else t.badSince = null;
    t.seen++;
    if (t.state === 'reference') {
      if (t.seen <= CFG.skip) return;
      t.refs.push(a.lab);
      if (t.refs.length >= CFG.refFrames) { t.ref = medianLab(t.refs); t.state = 'measuring'; t.t0 = now; }
      return;
    }
    var de = C.de2000(t.ref, a.lab);
    t.readings.push({ t: (now - t.t0) / 1000, L: a.lab[0], a: a.lab[1], b: a.lab[2], de: de, status: de <= t.limit ? 'same' : 'not_same' });
    if ((now - t.t0) / 1000 >= t.duration) finalize('completed');
  }

  function finalize(reason) {
    var t = test; test = null;
    if (!t || !t.readings.length) { setMsg('Test cancelled before the reference colour was captured.', 'err'); renderAll(); return null; }
    var n = t.readings.length, same = t.readings.filter(function (r) { return r.status === 'same'; }).length, des = t.readings.map(function (r) { return r.de; });
    var rep = { id: Date.now(), fabric: t.fabric, light: t.light, date: t.startTime.toISOString().slice(0, 16).replace('T', ' '),
                reason: reason, n: n, same: same, pctGood: +(same / n * 100).toFixed(1), pctBad: +((n - same) / n * 100).toFixed(1),
                mean: mean(des), sd: sd(des), max: Math.max.apply(null, des), p95: pct(des, 0.95), limit: t.limit,
                refLab: t.ref, refHex: C.labToHex(t.ref), duration: +t.readings[n - 1].t.toFixed(1), readings: t.readings };
    saveHistory(rep); renderHistory(); showModal(rep); setMsg(''); renderAll();
    return rep;
  }

  function resetStats() {
    $('scGoodPct').textContent = '0%'; $('scBadPct').textContent = '0%'; $('scTotal').textContent = '0'; $('scGoodLbl').textContent = 'GOOD';
    $('qbarFill').style.width = '0%'; $('qbarVal').textContent = '— %'; $('qbarVal').className = 'qbar-val';
    drawGraph();
  }

  // ── baseline (engine.py: _step_baseline / _baseline_result) ──
  function startBaseline() {
    if (!stream || !last) { toast('Start the camera first.', true); return; }
    if (test) { toast('Stop the running test first.', true); return; }
    var d = Math.max(3, Math.min(60, parseFloat($('baselineDur').value) || 10));
    baseline = { t0: performance.now(), dur: d * 1000, labs: [], grids: [], dark: [], bright: [] };
  }
  function stepBaseline(a) {
    var b = baseline; if (!b) return;
    b.labs.push(a.lab); b.grids.push(a.grid); b.dark.push(a.darkPct); b.bright.push(a.brightPct);
    if (performance.now() - b.t0 >= b.dur) { baseline = null; renderBaseline(baselineResult(b)); }
  }
  function baselineResult(b) {
    var ref = medianLab(b.labs), noise = b.labs.map(function (l) { return C.de2000(ref, l); });
    var g = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return meanLab(b.grids.map(function (gr) { return gr[i]; })); });
    var gde = g.map(function (x) { return C.de2000(g[4], x); });
    var nm = mean(noise), ns = sd(noise), dark = mean(b.dark), bright = mean(b.bright);
    var r = { frames: b.labs.length, refHex: C.labToHex(ref), noiseMean: nm, noiseSd: ns, noiseP95: pct(noise, 0.95),
              uniMax: Math.max.apply(null, gde), dark: dark, bright: bright,
              suggested: Math.max(CFG.minLimit, Math.ceil((nm + 3 * ns) * 10) / 10) };
    r.checks = { exposure: dark <= CFG.maxClip && bright <= CFG.maxClip, stable: r.noiseP95 <= CFG.stableMax, even: r.uniMax <= CFG.evenMax };
    r.ok = r.checks.exposure && r.checks.stable && r.checks.even;
    return r;
  }
  function renderBaseline(r) {
    var row = function (ok, l, v) { return '<div class="ck ' + (ok ? 'ok' : 'bad') + '"><span class="ck-dot"></span><span class="ck-lbl">' + l + '</span><span class="ck-val">' + v + '</span></div>'; };
    $('baselineResult').innerHTML =
      '<div class="br-head ' + (r.ok ? 'ok' : 'bad') + '"><span class="ref-chip" style="background:' + r.refHex + '"></span>' + (r.ok ? 'SETUP OK' : 'SETUP NOT OK') +
      ' <span class="muted">' + r.frames + ' frames · browser camera</span></div>' +
      row(false, 'Exposure/WB locked', 'not possible in a browser') +
      row(r.checks.exposure, 'Exposure', f2(r.dark) + '% black · ' + f2(r.bright) + '% clipped') +
      row(r.checks.stable, 'Noise (P95)', 'ΔE00 ' + r.noiseP95.toFixed(3) + ' (mean ' + r.noiseMean.toFixed(3) + ' ± ' + r.noiseSd.toFixed(3) + ')') +
      row(r.checks.even, 'Uniformity (max)', 'ΔE00 ' + r.uniMax.toFixed(3)) +
      '<div class="br-foot">Suggested ΔE00 limit: <strong>' + r.suggested.toFixed(1) + '</strong> ' +
      '<button class="btn-soft" id="useLimit">Use this limit</button><br><span class="muted">(noise mean + 3 SD — smaller differences cannot be told apart from camera noise)</span></div>';
    $('useLimit').onclick = function () { $('thresholdInput').value = Math.max(2, r.suggested).toFixed(1); toast('ΔE00 limit set to ' + $('thresholdInput').value + ' on Check Color.'); };
  }

  // ── drawing ──
  function draw(a) {
    var cv = $(view === 'viewSetup' ? 'setupCanvas' : 'liveCanvas'), ctx = cv.getContext('2d');
    if (cv.width !== a.w) { cv.width = a.w; cv.height = a.h; }
    ctx.drawImage(video, 0, 0, a.w, a.h);
    var r = a.rect;
    if (view === 'viewSetup') {
      var fs = Math.max(11, Math.round(a.w / 45)); ctx.font = '600 ' + fs + 'px system-ui, sans-serif'; ctx.lineWidth = 1;
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
        var de = a.gridDe[i * 3 + j], x = r[0] + j * r[2] / 3, y = r[1] + i * r[3] / 3, ok = de <= CFG.evenMax;
        ctx.strokeStyle = ok ? 'rgb(80,200,80)' : 'rgb(230,60,60)'; ctx.strokeRect(x, y, r[2] / 3, r[3] / 3);
        var txt = (i === 1 && j === 1) ? 'REF' : de.toFixed(1);
        ctx.fillStyle = '#000'; ctx.fillText(txt, x + 6, y + fs + 4); ctx.fillStyle = ok ? 'rgb(120,230,120)' : 'rgb(255,110,110)'; ctx.fillText(txt, x + 5, y + fs + 3);
      }
    } else {
      var col = 'rgb(100,255,0)';
      if (test && test.state === 'reference') col = 'rgb(255,215,0)';
      else if (test && test.readings.length && test.readings[test.readings.length - 1].status === 'not_same') col = 'rgb(240,60,60)';
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.strokeRect(r[0], r[1], r[2], r[3]);
    }
  }

  function drawGraph() {
    var canvas = $('colorGraph'); if (!canvas || !canvas.parentElement) return;
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(50, rect.width - 26); canvas.height = Math.max(40, rect.height - 30);
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (graphData.length < 2) return;
    ctx.fillStyle = '#f8f7f5'; ctx.fillRect(0, 0, w, h);
    var maxD = Math.max(graphLimit * 2.5, Math.max.apply(null, graphData.map(function (p) { return p.diff; }))) * 1.1;
    var ty = h - (graphLimit / maxD) * h;
    ctx.strokeStyle = 'rgba(239,68,68,0.35)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(239,68,68,0.55)'; ctx.font = '9px monospace'; ctx.fillText('LIMIT ' + graphLimit, w - 70, ty - 3);
    var step = w / (graphData.length - 1);
    ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = '#2d5a3d'; ctx.lineJoin = 'round';
    graphData.forEach(function (p, i) { var x = i * step, y = h - (p.diff / maxD) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    graphData.forEach(function (p, i) { var x = i * step, y = h - (p.diff / maxD) * h; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.3); ctx.fillStyle = p.status === 'same' ? '#22c55e' : '#ef4444'; ctx.fill(); });
  }

  // ── UI rendering ──
  function renderReadiness(checks) {
    var byKey = {}; (checks || []).forEach(function (c) { byKey[c.key] = c; });
    $$('.ld').forEach(function (el) { var c = byKey[el.dataset.k]; el.className = 'ld ' + (!c ? 'dim' : c.ok ? 'grn' : 'red'); if (c) el.title = c.label + ': ' + c.value; });
    var failing = (checks || []).filter(function (c) { return !c.ok; });
    var demoOk = checks && checks.slice(0, 3).every(function (c) { return c.ok; });
    $$('.lightBadge').forEach(function (b) {
      var txt = b.querySelector('.lightTxt');
      if (!checks) { b.className = 'light-badge checking lightBadge'; txt.textContent = 'NO CAMERA'; }
      else if (!failing.length) { b.className = 'light-badge ok lightBadge'; txt.textContent = 'LIGHT OK'; }
      else if (demoOk) { b.className = 'light-badge warn lightBadge'; txt.textContent = 'DEMO OK · ' + MSG[failing[0].key]; }
      else { b.className = 'light-badge low lightBadge'; txt.textContent = MSG[failing[0].key]; }
    });
    var tip = (checks || []).map(function (c) { return (c.ok ? '✓ ' : '✗ ') + c.label + ' — ' + c.value; }).join('\n');
    $$('.readiness').forEach(function (g) { g.title = tip; });
    $('checkList').innerHTML = checks ? checks.map(function (c) {
      return '<div class="ck ' + (c.ok ? 'ok' : 'bad') + '"><span class="ck-dot"></span><span class="ck-lbl">' + c.label + '</span><span class="ck-val">' + c.value + '</span></div>';
    }).join('') : '<div class="muted">Start the camera.</div>';
  }

  function renderAll() {
    renderReadiness(last ? last.checks : null);
    if (last) { $('swLive').style.background = C.labToHex(last.a.lab); $('swLiveLbl').textContent = 'Live L* ' + last.a.lab[0].toFixed(1); }
    var t = test, running = !!t;
    $('startBindi').className = 'bindi' + (running ? ' green' : '');
    $('stopBindi').className = 'bindi' + (running ? '' : ' red');
    $('camScan').style.display = running ? 'block' : 'none';
    $('camTimer').style.display = running ? 'block' : 'none';
    $('camFabricName').textContent = t ? 'Fabric: ' + t.fabric : '';
    $('btnStart').disabled = running; $('fabricNameInput').disabled = running; $('cameraSelect').disabled = running;
    $('lightWarn').style.display = t && t.badSince ? 'block' : 'none';
    var sb = $('stateBanner');
    if (t && t.state === 'reference') { sb.textContent = 'Capturing reference colour… ' + Math.round(Math.min(1, Math.max(0, t.seen - CFG.skip) / CFG.refFrames) * 100) + '%'; sb.style.display = 'block'; }
    else sb.style.display = 'none';
    var bb = $('setupBanner');
    if (baseline) { bb.textContent = 'Measuring baseline — keep everything still… ' + Math.round(Math.min(1, (performance.now() - baseline.t0) / baseline.dur) * 100) + '%'; bb.style.display = 'block'; }
    else bb.style.display = 'none';
    $('baselineProgress').style.display = baseline ? 'block' : 'none';
    if (baseline) $('baselineFill').style.width = Math.round(Math.min(1, (performance.now() - baseline.t0) / baseline.dur) * 100) + '%';
    $('btnBaseline').disabled = !!baseline || running;

    if (t) {
      $('swRefWrap').style.display = t.ref ? 'flex' : 'none'; if (t.ref) $('swRef').style.background = C.labToHex(t.ref);
      $('camTimer').textContent = (t.state === 'measuring' ? Math.max(0, Math.ceil(t.duration - (performance.now() - t.t0) / 1000)) : t.duration) + 's';
      var n = t.readings.length, same = t.readings.filter(function (r) { return r.status === 'same'; }).length;
      if (n) {
        var g = +(same / n * 100).toFixed(1), lbl = g >= CFG.excellentPct ? 'EXCELLENT' : g >= CFG.passPct ? 'GOOD' : 'BELOW MIN';
        $('scGoodPct').textContent = g + '%'; $('scBadPct').textContent = (100 - g).toFixed(1) + '%'; $('scTotal').textContent = n; $('scGoodLbl').textContent = lbl;
        var fill = $('qbarFill'); fill.style.width = Math.min(g, 100) + '%';
        fill.className = 'qbar-fill' + (g >= CFG.excellentPct ? ' excellent' : g < CFG.passPct ? ' fail' : '');
        var val = $('qbarVal'); val.textContent = g + '% — ' + lbl;
        val.className = 'qbar-val' + (g >= CFG.excellentPct ? ' excellent' : g < CFG.passPct ? ' fail' : ' good');
      }
      graphData = t.readings.slice(-90).map(function (r) { return { diff: r.de, status: r.status }; });
    }
    drawGraph();
  }

  // ── report modal + history (localStorage, this browser only) ──
  var REASON = { completed: 'Completed', stopped_by_user: 'Stopped manually', light_lost: 'Stopped: light went out of range' };
  var modalRep = null;
  function showModal(r) {
    modalRep = r;
    $('modalFabric').textContent = r.fabric;
    $('modalGoodPct').textContent = r.pctGood + '%'; $('modalBadPct').textContent = r.pctBad + '%';
    $('modalMode').textContent = 'DEMO — not a measurement · ' + (REASON[r.reason] || r.reason) + ' · mean ΔE00 ' + f2(r.mean);
    var pass = r.pctGood >= CFG.passPct, v = $('modalVerdict');
    v.textContent = pass ? (r.pctGood >= CFG.excellentPct ? '★ EXCELLENT — Outstanding color consistency' : '✓ FABRIC PASSED — Color consistency acceptable')
                         : '✗ FABRIC FAILED — ' + (r.n - r.same) + ' of ' + r.n + ' readings above the limit';
    v.className = 'modal-verdict ' + (pass ? 'pass' : 'fail');
    $('modalReport').innerHTML = 'Method: <strong>CIEDE2000</strong> · Limit: <strong>ΔE00 ≤ ' + r.limit.toFixed(1) + '</strong><br>' +
      'Readings: <strong>' + r.n + '</strong> in <strong>' + r.duration + ' s</strong> · Max ΔE00: <strong>' + f2(r.max) + '</strong> · P95: <strong>' + f2(r.p95) + '</strong><br>' +
      'Reference L*a*b*: <strong>' + r.refLab.map(function (x) { return x.toFixed(1); }).join(' / ') + '</strong> <span class="ref-chip" style="background:' + r.refHex + ';width:14px;height:14px;vertical-align:middle"></span>';
    $('reportModal').style.display = 'flex';
  }
  function closeModal() { $('reportModal').style.display = 'none'; }
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory(rep) {
    var h = loadHistory(); h.unshift(rep); h = h.slice(0, 15);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) { /* storage full or blocked */ }
  }
  function renderHistory() {
    var h = loadHistory(), list = $('historyList');
    if (!h.length) { list.innerHTML = '<div class="hist-loading">No tests yet</div>'; return; }
    list.innerHTML = h.map(function (r) {
      var cls = r.pctGood >= 90 ? 'e' : r.pctGood >= 80 ? 'p' : 'f', lbl = r.pctGood >= 90 ? 'Excellent' : r.pctGood >= 80 ? 'Good' : 'Fail';
      return '<div class="hi" data-id="' + r.id + '"><button class="hi-del" data-del="' + r.id + '" title="Delete">✕</button>' +
        '<div class="hi-name">' + esc(r.fabric) + '</div><div class="hi-date">' + esc(r.date) + '</div>' +
        '<span class="hi-badge ' + cls + '">' + r.pctGood + '% ' + lbl + '</span><span class="hi-tag demo">DEMO</span></div>';
    }).join('');
  }
  function exportCsv(r) {
    var rows = [['Fabric Color Variation Detection - Web demo report'], ['Mode', 'DEMO (browser camera)'], ['Fabric name', r.fabric], ['Light source', r.light],
      ['Date', r.date], ['Delta E method', 'CIEDE2000'], ['Delta E threshold', r.limit], ['Total readings', r.n], ['Same (%)', r.pctGood],
      ['Mean dE00', f2(r.mean)], ['SD dE00', f2(r.sd)], ['Max dE00', f2(r.max)], ['Reference L*a*b*', r.refLab.map(function (x) { return x.toFixed(3); }).join(' ')], [],
      ['#', 't (s)', 'L*', 'a*', 'b*', 'dE00', 'Status']];
    r.readings.forEach(function (x, i) { rows.push([i + 1, x.t.toFixed(3), x.L.toFixed(3), x.a.toFixed(3), x.b.toFixed(3), x.de.toFixed(3), x.status]); });
    var csv = rows.map(function (row) { return row.map(function (c) { c = String(c); return /[",]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = ('report_' + r.fabric + '_' + r.id + '.csv').replace(/\s+/g, '_'); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ── views ──
  function showView(id) {
    view = id;
    $$('.view').forEach(function (v) { v.hidden = v.id !== id; });
    $$('.sb-item[data-view]').forEach(function (a) { var on = a.dataset.view === id; a.classList.toggle('active', on); a.querySelector('.sb-dot').classList.toggle('active', on); });
    setTimeout(drawGraph, 0);
  }

  // ── wiring ──
  $$('.btnCamera').forEach(function (b) { b.addEventListener('click', function () { startCamera($('cameraSelect').value || null); }); });
  $('cameraSelect').addEventListener('change', function () { if (stream) startCamera(this.value || null); });
  $('btnStart').addEventListener('click', startTest);
  $('btnStop').addEventListener('click', function () { if (test && test.state === 'measuring' && test.readings.length) finalize('stopped_by_user'); else if (test) { test = null; setMsg('Test cancelled.'); renderAll(); } });
  $('btnRefresh').addEventListener('click', function () { if (test) test = null; graphData = []; resetStats(); setMsg(''); $('swRefWrap').style.display = 'none'; renderAll(); });
  $('btnBaseline').addEventListener('click', startBaseline);
  $$('.sb-item[data-view]').forEach(function (a) { a.addEventListener('click', function () { showView(a.dataset.view); }); });
  $('modalCloseBtn').addEventListener('click', closeModal);
  $('modalAgainBtn').addEventListener('click', function () { closeModal(); $('btnRefresh').click(); });
  $('modalCsvBtn').addEventListener('click', function () { if (modalRep) exportCsv(modalRep); });
  $('historyList').addEventListener('click', function (e) {
    var del = e.target.getAttribute('data-del');
    if (del) { e.stopPropagation(); var h = loadHistory().filter(function (r) { return String(r.id) !== del; }); localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); renderHistory(); return; }
    var item = e.target.closest('.hi'); if (!item) return;
    var r = loadHistory().filter(function (x) { return String(x.id) === item.dataset.id; })[0]; if (r) showModal(r);
  });
  window.addEventListener('resize', drawGraph);
  window.addEventListener('pagehide', function () { stopCamera(true); });
  renderHistory(); renderReadiness(null); drawGraph();
})();