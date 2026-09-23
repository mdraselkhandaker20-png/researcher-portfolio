// Colour maths for the browser demo — same method as the Python system.
// sRGB (D65) -> CIE XYZ -> CIELAB, and the CIEDE2000 colour difference
// (verified against Sharma, Wu & Dalal 2005 test data).
(function (root) {
  var XN = 0.95047, YN = 1.0, ZN = 1.08883;

  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function f(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }

  function rgbToLab(r, g, b) {
    var R = lin(r), G = lin(g), B = lin(b);
    var X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
    var Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
    var Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
    var fx = f(X / XN), fy = f(Y / YN), fz = f(Z / ZN);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deg(x) { return x * 180 / Math.PI; }
  function rad(x) { return x * Math.PI / 180; }

  function de2000(l1, l2) {
    var L1 = l1[0], a1 = l1[1], b1 = l1[2], L2 = l2[0], a2 = l2[1], b2 = l2[2];
    var C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    var Cb = (C1 + C2) / 2, Cb7 = Math.pow(Cb, 7);
    var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    var h1p = (deg(Math.atan2(b1, a1p)) + 360) % 360;
    var h2p = (deg(Math.atan2(b2, a2p)) + 360) % 360;
    var dLp = L2 - L1, dCp = C2p - C1p, zero = C1p * C2p === 0;
    var dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    if (zero) dhp = 0;
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
    var Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hsum = h1p + h2p, hbp;
    if (zero) hbp = hsum;
    else if (Math.abs(h1p - h2p) <= 180) hbp = hsum / 2;
    else hbp = hsum < 360 ? (hsum + 360) / 2 : (hsum - 360) / 2;
    var T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) +
            0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
    var dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var Cbp7 = Math.pow(Cbp, 7);
    var RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
    var SL = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    var SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
    var RT = -Math.sin(rad(2 * dTh)) * RC;
    var tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  }

  function labToHex(lab) {
    var fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    function finv(t) { return t > 6 / 29 ? t * t * t : 3 * Math.pow(6 / 29, 2) * (t - 4 / 29); }
    var X = XN * finv(fx), Y = YN * finv(fy), Z = ZN * finv(fz);
    var r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    var g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
    var b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    function gam(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255); }
    return '#' + [gam(r), gam(g), gam(b)].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  var api = { rgbToLab: rgbToLab, de2000: de2000, labToHex: labToHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Colour = api;
})(this);