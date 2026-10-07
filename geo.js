// Geodätische Hilfsfunktionen: GPS <-> lokale Meter <-> Bildpixel
'use strict';

const EARTH_RADIUS_M = 6378137;

// Projiziert lat/lon in lokale ebene Koordinaten (Meter) um einen Referenzpunkt
// (Äquirektangular-Näherung, für kleine Flächen wie Gebäude/Gelände ausreichend genau)
function latLonToLocalXY(lat, lon, refLat, refLon) {
  const degToRad = Math.PI / 180;
  const x = (lon - refLon) * degToRad * Math.cos(refLat * degToRad) * EARTH_RADIUS_M;
  const y = (lat - refLat) * degToRad * EARTH_RADIUS_M;
  return { x, y };
}

function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const M = matrix.map((row) => row.slice());
  const b = rhs.slice();

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxVal) {
        maxVal = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (maxVal < 1e-12) throw new Error('Singuläres Gleichungssystem (Punkte zu kollinear?)');
    if (pivotRow !== col) {
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
      [b[col], b[pivotRow]] = [b[pivotRow], b[col]];
    }
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      for (let c = col; c < n; c++) M[r][c] -= factor * M[col][c];
      b[r] -= factor * b[col];
    }
  }

  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

// points: [{x, y, px, py}, ...] lokale Meter -> Bildpixel
// Liefert Transform { a, b, c, d, e, f, refLat, refLon } mit
//   px = a*x + b*y + c
//   py = d*x + e*y + f
function solveTransform(points, refLat, refLon) {
  if (points.length < 2) throw new Error('Mindestens 2 Referenzpunkte nötig');

  if (points.length === 2) {
    // Ähnlichkeitstransformation (Skalierung + Rotation), exakt lösbar aus 2 Punkten
    const [p1, p2] = points;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dpx = p2.px - p1.px;
    const dpy = p2.py - p1.py;
    const denom = dx * dx + dy * dy;
    if (denom < 1e-9) throw new Error('Referenzpunkte liegen zu nah beieinander');
    const a = (dx * dpx + dy * dpy) / denom;
    const b = (dx * dpy - dy * dpx) / denom;
    const c = p1.px - a * p1.x + b * p1.y;
    const f = p1.py - b * p1.x - a * p1.y;
    return { a, b: -b, c, d: b, e: a, f, refLat, refLon };
  }

  // Affine Transformation (6 Parameter), Ausgleichsrechnung bei >3 Punkten
  const n = points.length;
  let s_xx = 0, s_xy = 0, s_x = 0, s_yy = 0, s_y = 0, s_1 = n;
  let s_xpx = 0, s_ypx = 0, s_px = 0;
  let s_xpy = 0, s_ypy = 0, s_py = 0;

  for (const p of points) {
    s_xx += p.x * p.x;
    s_xy += p.x * p.y;
    s_x += p.x;
    s_yy += p.y * p.y;
    s_y += p.y;
    s_xpx += p.x * p.px;
    s_ypx += p.y * p.px;
    s_px += p.px;
    s_xpy += p.x * p.py;
    s_ypy += p.y * p.py;
    s_py += p.py;
  }

  const M = [
    [s_xx, s_xy, s_x],
    [s_xy, s_yy, s_y],
    [s_x, s_y, s_1],
  ];

  const [a, b, c] = solveLinearSystem(M, [s_xpx, s_ypx, s_px]);
  const [d, e, f] = solveLinearSystem(M, [s_xpy, s_ypy, s_py]);

  return { a, b, c, d, e, f, refLat, refLon };
}

function applyTransform(transform, lat, lon) {
  const { x, y } = latLonToLocalXY(lat, lon, transform.refLat, transform.refLon);
  const px = transform.a * x + transform.b * y + transform.c;
  const py = transform.d * x + transform.e * y + transform.f;
  return { px, py };
}

// Pixel pro Meter (grobe Schätzung, für Genauigkeitskreis)
function pixelsPerMeter(transform) {
  const scaleX = Math.hypot(transform.a, transform.d);
  const scaleY = Math.hypot(transform.b, transform.e);
  return (scaleX + scaleY) / 2;
}

function buildTransformFromPoints(points) {
  // Referenzpunkt = Mittelwert aller Punkte (numerisch stabiler als erster Punkt)
  const refLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const refLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const localized = points.map((p) => {
    const { x, y } = latLonToLocalXY(p.lat, p.lon, refLat, refLon);
    return { x, y, px: p.px, py: p.py };
  });
  return solveTransform(localized, refLat, refLon);
}
