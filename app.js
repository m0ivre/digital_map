'use strict';

// ---------- Globaler Zustand ----------
const state = {
  screen: 'home',
  currentMap: null, // vollständiger DB-Record der aktuell offenen Karte
  pendingImport: null, // { blob, url, width, height }
  calibrationPoints: [], // [{px, py, lat, lon, accuracy}]
  pendingPin: null, // { px, py } wartet auf Koordinateneingabe
  panzoom: null,
  watchId: null,
  follow: true,
  objectUrls: [],
  alignMap: null,
  overlayAlign: null,
  currentTileLayer: null,
  manualPanzoomReady: false,
};

const BASEMAPS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '© OpenStreetMap-Mitwirkende' },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 17,
      attribution: 'Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Darstellung: © OpenTopoMap (CC-BY-SA)',
    },
  },
  hot: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      attribution: '© OpenStreetMap-Mitwirkende, Stil: Humanitarian OpenStreetMap Team',
    },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics' },
  },
};

const screens = {
  home: document.getElementById('screen-home'),
  import: document.getElementById('screen-import'),
  calibrate: document.getElementById('screen-calibrate'),
  view: document.getElementById('screen-view'),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('active', key === name);
  }
  state.screen = name;
  if (name !== 'view') stopWatching();
}

function trackObjectUrl(url) {
  state.objectUrls.push(url);
  return url;
}

function revokeTrackedUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

// ---------- Home-Screen: Kartenliste ----------
async function renderHome() {
  const list = document.getElementById('map-list');
  list.innerHTML = '';
  const maps = await getAllMaps();
  maps.sort((a, b) => b.createdAt - a.createdAt);

  if (maps.length === 0) {
    document.getElementById('map-list-empty').style.display = 'block';
  } else {
    document.getElementById('map-list-empty').style.display = 'none';
  }

  for (const map of maps) {
    const li = document.createElement('li');
    li.className = 'map-item';

    const thumbUrl = trackObjectUrl(URL.createObjectURL(map.imageBlob));
    li.innerHTML = `
      <img class="map-thumb" src="${thumbUrl}" alt="">
      <div class="map-item-info">
        <div class="map-item-name">${escapeHtml(map.name)}</div>
        <div class="map-item-meta">${map.calibrationPoints.length} Referenzpunkte · ${new Date(map.createdAt).toLocaleDateString('de-DE')}</div>
      </div>
      <button class="icon-btn danger" data-action="delete" title="Löschen">🗑</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete"]')) return;
      openMap(map.id);
    });
    li.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`"${map.name}" wirklich löschen?`)) {
        await deleteMap(map.id);
        renderHome();
      }
    });
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Import-Screen ----------
function resetImportScreen() {
  state.pendingImport = null;
  state.calibrationPoints = [];
  state.pendingPin = null;
  document.getElementById('import-status').textContent = '';
  document.getElementById('file-input').value = '';
  document.getElementById('camera-input').value = '';
}

document.getElementById('btn-new-map').addEventListener('click', () => {
  resetImportScreen();
  showScreen('import');
});

document.getElementById('btn-import-cancel').addEventListener('click', () => {
  showScreen('home');
});

async function handleFileSelected(file) {
  if (!file) return;
  const statusEl = document.getElementById('import-status');
  statusEl.textContent = 'Wird verarbeitet…';
  try {
    const { blob, width, height } = await fileToImageBlob(file);
    const url = trackObjectUrl(URL.createObjectURL(blob));
    state.pendingImport = { blob, url, width, height };
    statusEl.textContent = '';
    beginCalibration();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Fehler beim Importieren: ' + err.message;
  }
}

document.getElementById('file-input').addEventListener('change', (e) => {
  handleFileSelected(e.target.files[0]);
});
document.getElementById('camera-input').addEventListener('change', (e) => {
  handleFileSelected(e.target.files[0]);
});

// ---------- Kalibrierungs-Screen ----------
function beginCalibration() {
  state.calibrationPoints = [];
  state.pendingPin = null;
  state.manualPanzoomReady = false;
  renderCalibrationPointList();
  showScreen('calibrate');
  switchCalibTab('align');
  initAlignTab();
}

// --- Tab-Umschaltung ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchCalibTab(btn.dataset.tab));
});

function switchCalibTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tab-align').classList.toggle('active', tab === 'align');
  document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');

  if (tab === 'align' && state.alignMap) {
    setTimeout(() => state.alignMap.invalidateSize(), 0);
  }
  if (tab === 'manual' && !state.manualPanzoomReady) {
    initManualCalibration();
  }
}

// --- Tab 1: visuelle Ausrichtung auf Grundkarte ---
function setBasemapLayer(map, key) {
  if (state.currentTileLayer) map.removeLayer(state.currentTileLayer);
  const cfg = BASEMAPS[key] || BASEMAPS.osm;
  state.currentTileLayer = L.tileLayer(cfg.url, cfg.options).addTo(map);
}

function syncSlidersFromOverlay() {
  const overlay = state.overlayAlign;
  if (!overlay) return;
  const scalePercent = Math.min(1000, Math.max(1, Math.round(overlay.getScale() * 100)));
  document.getElementById('scale-slider').value = scalePercent;
  let deg = overlay.getRotationDeg() % 360;
  if (deg > 180) deg -= 360;
  if (deg < -180) deg += 360;
  document.getElementById('rotation-slider').value = deg.toFixed(1);
}

function setAlignMode(mode) {
  document.getElementById('mode-btn-map').classList.toggle('active', mode === 'map');
  document.getElementById('mode-btn-image').classList.toggle('active', mode === 'image');
  state.overlayAlign?.setMode(mode);
}

function initAlignTab() {
  if (state.alignMap) {
    state.alignMap.remove();
    state.alignMap = null;
    state.currentTileLayer = null;
  }

  document.getElementById('align-image').src = state.pendingImport.url;

  const map = L.map('align-map', { attributionControl: true }).setView([51.1657, 10.4515], 6);
  setBasemapLayer(map, document.getElementById('basemap-select').value);
  state.alignMap = map;

  const overlayEl = document.getElementById('align-overlay');
  const overlay = new OverlayAlign(map, overlayEl, state.pendingImport.width, state.pendingImport.height);
  overlay.setOpacity(document.getElementById('opacity-slider').value / 100);
  overlay.onChange = syncSlidersFromOverlay;
  state.overlayAlign = overlay;

  requestAnimationFrame(() => {
    map.invalidateSize();
    overlay.reset();
    syncSlidersFromOverlay();
  });

  setAlignMode('map');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        overlay.reset();
        syncSlidersFromOverlay();
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
}

document.getElementById('basemap-select').addEventListener('change', (e) => {
  if (state.alignMap) setBasemapLayer(state.alignMap, e.target.value);
});

document.getElementById('mode-btn-map').addEventListener('click', () => setAlignMode('map'));
document.getElementById('mode-btn-image').addEventListener('click', () => setAlignMode('image'));

document.getElementById('opacity-slider').addEventListener('input', (e) => {
  state.overlayAlign?.setOpacity(e.target.value / 100);
});
document.getElementById('scale-slider').addEventListener('input', (e) => {
  state.overlayAlign?.setScale(e.target.value / 100);
});
document.getElementById('rotation-slider').addEventListener('input', (e) => {
  state.overlayAlign?.setRotationDeg(parseFloat(e.target.value));
});

document.getElementById('btn-locate-me').addEventListener('click', () => {
  if (!navigator.geolocation || !state.alignMap) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => state.alignMap.setView([pos.coords.latitude, pos.coords.longitude], 17),
    (err) => alert('Standort nicht verfügbar: ' + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

document.getElementById('btn-align-reset').addEventListener('click', () => {
  state.overlayAlign?.reset();
  syncSlidersFromOverlay();
});

document.getElementById('btn-confirm-align').addEventListener('click', () => {
  finalizeSaveMap(state.overlayAlign?.getCornerCalibrationPoints());
});

function teardownCalibration() {
  if (state.alignMap) {
    state.alignMap.remove();
    state.alignMap = null;
    state.currentTileLayer = null;
  }
  state.overlayAlign = null;
}

// --- Tab 2: manuelle Referenzpunkte (bestehender Ablauf) ---
function initManualCalibration() {
  state.manualPanzoomReady = true;
  const viewport = document.getElementById('calibrate-viewport');
  const pannable = document.getElementById('calibrate-pannable');
  const img = document.getElementById('calibrate-image');

  img.src = state.pendingImport.url;
  pannable.style.width = state.pendingImport.width + 'px';
  pannable.style.height = state.pendingImport.height + 'px';
  pannable.dataset.naturalWidth = state.pendingImport.width;
  pannable.dataset.naturalHeight = state.pendingImport.height;
  clearPinElements(pannable);

  const pz = new PanZoom(viewport, pannable, { minScale: 0.05, maxScale: 12 });
  pz.fit(state.pendingImport.width, state.pendingImport.height);
  pz.onTap = (clientX, clientY) => {
    const { x, y } = pz.clientToNatural(clientX, clientY);
    openPinDialog(x, y);
  };
  state.panzoom = pz;
}

function clearPinElements(pannable) {
  pannable.querySelectorAll('.pin').forEach((el) => el.remove());
}

function addPinMarker(pannable, x, y, label) {
  const pin = document.createElement('div');
  pin.className = 'pin';
  pin.style.left = x + 'px';
  pin.style.top = y + 'px';
  pin.innerHTML = `<span>${label}</span>`;
  pannable.appendChild(pin);
  return pin;
}

function renderCalibrationPointList() {
  const pannable = document.getElementById('calibrate-pannable');
  clearPinElements(pannable);
  state.calibrationPoints.forEach((p, i) => addPinMarker(pannable, p.px, p.py, i + 1));

  const listEl = document.getElementById('calibration-points');
  listEl.innerHTML = '';
  state.calibrationPoints.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>#${i + 1}: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</span>
      <button class="icon-btn" data-idx="${i}" title="Entfernen">✕</button>`;
    li.querySelector('button').addEventListener('click', () => {
      state.calibrationPoints.splice(i, 1);
      renderCalibrationPointList();
      updateSaveButtonState();
    });
    listEl.appendChild(li);
  });
  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btn = document.getElementById('btn-save-map');
  btn.disabled = state.calibrationPoints.length < 2;
  const hint = document.getElementById('calibration-hint');
  if (state.calibrationPoints.length < 2) {
    hint.textContent = `Noch ${2 - state.calibrationPoints.length} Referenzpunkt(e) nötig (mind. 2, besser 3+ für höhere Genauigkeit).`;
  } else {
    hint.textContent = `${state.calibrationPoints.length} Referenzpunkte erfasst. Weitere Punkte verbessern die Genauigkeit.`;
  }
}

function openPinDialog(px, py) {
  state.pendingPin = { px, py };
  const dialog = document.getElementById('pin-dialog');
  document.getElementById('pin-lat').value = '';
  document.getElementById('pin-lon').value = '';
  document.getElementById('pin-gps-status').textContent = '';
  dialog.showModal();
}

document.getElementById('pin-dialog-cancel').addEventListener('click', () => {
  document.getElementById('pin-dialog').close();
  state.pendingPin = null;
});

document.getElementById('btn-use-gps').addEventListener('click', async () => {
  const statusEl = document.getElementById('pin-gps-status');
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation wird nicht unterstützt.';
    return;
  }
  statusEl.textContent = 'Ermittle Standort…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('pin-lat').value = pos.coords.latitude.toFixed(7);
      document.getElementById('pin-lon').value = pos.coords.longitude.toFixed(7);
      statusEl.textContent = `Standort erfasst (Genauigkeit ±${Math.round(pos.coords.accuracy)} m)`;
    },
    (err) => {
      statusEl.textContent = 'Standort nicht verfügbar: ' + err.message;
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

document.getElementById('pin-dialog-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const lat = parseFloat(document.getElementById('pin-lat').value);
  const lon = parseFloat(document.getElementById('pin-lon').value);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return;
  state.calibrationPoints.push({ px: state.pendingPin.px, py: state.pendingPin.py, lat, lon });
  state.pendingPin = null;
  document.getElementById('pin-dialog').close();
  renderCalibrationPointList();
});

document.getElementById('btn-calibrate-cancel').addEventListener('click', () => {
  if (confirm('Kalibrierung verwerfen?')) {
    teardownCalibration();
    revokeCurrentImport();
    showScreen('home');
  }
});

document.getElementById('btn-calibrate-fit').addEventListener('click', () => {
  state.panzoom?.fit(state.pendingImport.width, state.pendingImport.height);
});

function revokeCurrentImport() {
  state.pendingImport = null;
}

async function finalizeSaveMap(points) {
  if (!points || points.length < 2) {
    alert('Mindestens 2 Referenzpunkte nötig.');
    return;
  }
  const name = prompt('Name für diese Karte:', 'Karte ' + new Date().toLocaleDateString('de-DE'));
  if (!name) return;

  const transform = buildTransformFromPoints(points);
  const record = {
    id: makeId(),
    name,
    imageBlob: state.pendingImport.blob,
    width: state.pendingImport.width,
    height: state.pendingImport.height,
    calibrationPoints: points,
    transform,
    createdAt: Date.now(),
  };
  await saveMap(record);
  teardownCalibration();
  revokeCurrentImport();
  showScreen('home');
  renderHome();
}

document.getElementById('btn-save-map').addEventListener('click', () => {
  finalizeSaveMap(state.calibrationPoints);
});

// ---------- Ansichts-Screen (Live-Standort) ----------
async function openMap(id) {
  const record = await getMap(id);
  if (!record) return;
  state.currentMap = record;
  showScreen('view');

  document.getElementById('view-title').textContent = record.name;

  const viewport = document.getElementById('view-viewport');
  const pannable = document.getElementById('view-pannable');
  const img = document.getElementById('view-image');

  const url = trackObjectUrl(URL.createObjectURL(record.imageBlob));
  img.src = url;
  pannable.style.width = record.width + 'px';
  pannable.style.height = record.height + 'px';
  pannable.dataset.naturalWidth = record.width;
  pannable.dataset.naturalHeight = record.height;

  const marker = document.getElementById('you-are-here');
  const accuracyCircle = document.getElementById('accuracy-circle');
  marker.style.display = 'none';
  accuracyCircle.style.display = 'none';

  const pz = new PanZoom(viewport, pannable, { minScale: 0.05, maxScale: 12 });
  pz.fit(record.width, record.height);
  state.panzoom = pz;

  state.follow = true;
  updateFollowButton();
  document.getElementById('view-status').textContent = 'Suche GPS-Signal…';
  startWatching(record);
}

function updateFollowButton() {
  const btn = document.getElementById('btn-follow');
  btn.textContent = state.follow ? '📍 Folgen: An' : '📍 Folgen: Aus';
  btn.classList.toggle('active', state.follow);
}

document.getElementById('btn-follow').addEventListener('click', () => {
  state.follow = !state.follow;
  updateFollowButton();
});

document.getElementById('btn-view-fit').addEventListener('click', () => {
  state.panzoom?.fit(state.currentMap.width, state.currentMap.height);
});

document.getElementById('btn-view-back').addEventListener('click', () => {
  showScreen('home');
  renderHome();
});

document.getElementById('btn-view-delete').addEventListener('click', async () => {
  if (confirm(`"${state.currentMap.name}" wirklich löschen?`)) {
    await deleteMap(state.currentMap.id);
    showScreen('home');
    renderHome();
  }
});

function startWatching(record) {
  stopWatching();
  if (!navigator.geolocation) {
    document.getElementById('view-status').textContent = 'Geolocation wird von diesem Browser nicht unterstützt.';
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition(record, pos),
    (err) => {
      document.getElementById('view-status').textContent = 'Standortfehler: ' + describeGeoError(err);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
  );
}

function stopWatching() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

function describeGeoError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Standortzugriff wurde verweigert. Bitte in den Browser-/System-Einstellungen erlauben.';
    case err.POSITION_UNAVAILABLE:
      return 'Standort momentan nicht bestimmbar.';
    case err.TIMEOUT:
      return 'Zeitüberschreitung bei der Standortermittlung.';
    default:
      return err.message;
  }
}

function onPosition(record, pos) {
  const { px, py } = applyTransform(record.transform, pos.coords.latitude, pos.coords.longitude);
  const ppm = pixelsPerMeter(record.transform);
  const radiusPx = (pos.coords.accuracy || 0) * ppm;

  const marker = document.getElementById('you-are-here');
  const accuracyCircle = document.getElementById('accuracy-circle');

  marker.style.left = px + 'px';
  marker.style.top = py + 'px';
  marker.style.display = 'block';

  accuracyCircle.style.left = px + 'px';
  accuracyCircle.style.top = py + 'px';
  accuracyCircle.style.width = radiusPx * 2 + 'px';
  accuracyCircle.style.height = radiusPx * 2 + 'px';
  accuracyCircle.style.display = radiusPx > 2 ? 'block' : 'none';

  const inside = px >= 0 && py >= 0 && px <= record.width && py <= record.height;
  document.getElementById('view-status').textContent = inside
    ? `Standort aktiv · Genauigkeit ±${Math.round(pos.coords.accuracy)} m`
    : `Außerhalb des kartierten Bereichs · Genauigkeit ±${Math.round(pos.coords.accuracy)} m`;

  if (state.follow && state.panzoom) {
    state.panzoom.centerOn(px, py);
  }
}

// ---------- PWA: Service Worker & Installation ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW-Registrierung fehlgeschlagen:', err));
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('btn-install').style.display = 'inline-flex';
});

document.getElementById('btn-install').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('btn-install').style.display = 'none';
});

// ---------- Start ----------
renderHome();
