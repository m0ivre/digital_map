// Frei positionierbares Bild-Overlay auf einer Leaflet-Grundkarte:
// verschieben (1 Finger/Maus), skalieren+drehen (2 Finger), plus Slider für Maus-Bedienung.
'use strict';

class OverlayAlign {
  constructor(map, overlayEl, naturalWidth, naturalHeight) {
    this.map = map;
    this.el = overlayEl;
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;

    this.cx = 0; // Mittelpunkt des Overlays, in Container-Pixel-Koordinaten der Karte
    this.cy = 0;
    this.scaleX = 1; // Overlay-Breite = naturalWidth * scaleX
    this.scaleY = 1; // Overlay-Höhe = naturalHeight * scaleY
    this.angle = 0; // Radiant

    this.mode = 'map'; // 'map' | 'image'
    this.pointers = new Map();
    this.gestureStart = null;

    this.el.style.width = naturalWidth + 'px';
    this.el.style.height = naturalHeight + 'px';

    this._bind();
  }

  _bind() {
    this.el.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
    this.el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  setMode(mode) {
    this.mode = mode;
    const interactive = mode === 'image';
    this.el.style.pointerEvents = interactive ? 'auto' : 'none';
    if (interactive) {
      this.map.dragging.disable();
      this.map.scrollWheelZoom.disable();
      this.map.touchZoom.disable();
      this.map.doubleClickZoom.disable();
    } else {
      this.map.dragging.enable();
      this.map.scrollWheelZoom.enable();
      this.map.touchZoom.enable();
      this.map.doubleClickZoom.enable();
    }
  }

  // Platziert das Overlay zentriert im aktuellen Kartenausschnitt
  reset() {
    const size = this.map.getSize();
    this.cx = size.x / 2;
    this.cy = size.y / 2;
    const targetWidth = Math.min(size.x, size.y) * 0.7;
    const s = targetWidth / Math.max(this.naturalWidth, this.naturalHeight);
    this.scaleX = s;
    this.scaleY = s;
    this.angle = 0;
    this._render();
  }

  setOpacity(v) {
    this.el.style.opacity = String(v);
  }

  setScaleX(v) {
    this.scaleX = Math.max(0.02, v);
    this._render();
  }

  setScaleY(v) {
    this.scaleY = Math.max(0.02, v);
    this._render();
  }

  getScaleX() {
    return this.scaleX;
  }

  getScaleY() {
    return this.scaleY;
  }

  setRotationDeg(deg) {
    this.angle = (deg * Math.PI) / 180;
    this._render();
  }

  getRotationDeg() {
    return (this.angle * 180) / Math.PI;
  }

  _mapContainerPos(clientX, clientY) {
    const rect = this.map.getContainer().getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  _onDown(e) {
    if (this.mode !== 'image') return;
    this.el.setPointerCapture?.(e.pointerId);
    const pos = this._mapContainerPos(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, pos);
    this._resetGestureStart();
  }

  _resetGestureStart() {
    const pts = [...this.pointers.values()];
    if (pts.length === 1) {
      this.gestureStart = { type: 'pan', p: pts[0], cx: this.cx, cy: this.cy };
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this.gestureStart = {
        type: 'pinch',
        dist,
        angle,
        mid,
        scaleX: this.scaleX,
        scaleY: this.scaleY,
        angle0: this.angle,
        cx: this.cx,
        cy: this.cy,
      };
    } else {
      this.gestureStart = null;
    }
  }

  _onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const pos = this._mapContainerPos(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, pos);

    if (!this.gestureStart) return;

    if (this.gestureStart.type === 'pan' && this.pointers.size === 1) {
      const dx = pos.x - this.gestureStart.p.x;
      const dy = pos.y - this.gestureStart.p.y;
      this.cx = this.gestureStart.cx + dx;
      this.cy = this.gestureStart.cy + dy;
      this._render();
    } else if (this.gestureStart.type === 'pinch' && this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

      // Zwei Finger skalieren Breite+Höhe gemeinsam (gleicher Faktor, Seitenverhältnis
      // bleibt erhalten) – für unabhängige Breite/Höhe gibt es die beiden Regler.
      const scaleFactor = dist / this.gestureStart.dist;
      const deltaAngle = angle - this.gestureStart.angle;
      this.scaleX = Math.max(0.02, this.gestureStart.scaleX * scaleFactor);
      this.scaleY = Math.max(0.02, this.gestureStart.scaleY * scaleFactor);
      this.angle = this.gestureStart.angle0 + deltaAngle;

      // Mittelpunkt so verschieben, dass der ursprüngliche Zwei-Finger-Mittelpunkt
      // unter den Fingern bleibt (Rotation+Skalierung um diesen Ankerpunkt).
      const vx = this.gestureStart.mid.x - this.gestureStart.cx;
      const vy = this.gestureStart.mid.y - this.gestureStart.cy;
      const cosA = Math.cos(deltaAngle), sinA = Math.sin(deltaAngle);
      const rvx = (vx * cosA - vy * sinA) * scaleFactor;
      const rvy = (vx * sinA + vy * cosA) * scaleFactor;
      this.cx = mid.x - rvx;
      this.cy = mid.y - rvy;

      this._render();
      this._notifyChange();
    }
  }

  _onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.el.releasePointerCapture?.(e.pointerId);
    this._resetGestureStart();
    this._notifyChange();
  }

  _onWheel(e) {
    if (this.mode !== 'image') return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.setScaleX(this.scaleX * factor);
    this.setScaleY(this.scaleY * factor);
    this._notifyChange();
  }

  _render() {
    this.el.style.left = this.cx + 'px';
    this.el.style.top = this.cy + 'px';
    this.el.style.transform = `translate(-50%, -50%) rotate(${this.angle}rad) scale(${this.scaleX}, ${this.scaleY})`;
  }

  _notifyChange() {
    if (this.onChange) this.onChange();
  }

  // Liefert die 4 Bildeckpunkte (natürliche Pixel) mit ihren aktuellen Geokoordinaten
  getCornerCalibrationPoints() {
    const w = this.naturalWidth, h = this.naturalHeight;
    const corners = [
      { px: 0, py: 0 },
      { px: w, py: 0 },
      { px: 0, py: h },
      { px: w, py: h },
    ];
    const cosA = Math.cos(this.angle), sinA = Math.sin(this.angle);

    return corners.map((pt) => {
      const dx = (pt.px - w / 2) * this.scaleX;
      const dy = (pt.py - h / 2) * this.scaleY;
      const rx = dx * cosA - dy * sinA;
      const ry = dx * sinA + dy * cosA;
      const containerX = this.cx + rx;
      const containerY = this.cy + ry;
      const latlng = this.map.containerPointToLatLng(L.point(containerX, containerY));
      return { px: pt.px, py: pt.py, lat: latlng.lat, lon: latlng.lng };
    });
  }
}
