// Einfacher Pan/Zoom-Viewer per Pointer Events (Maus, Touch, Pinch)
'use strict';

class PanZoom {
  constructor(viewportEl, pannableEl, opts = {}) {
    this.viewport = viewportEl;
    this.pannable = pannableEl;
    this.minScale = opts.minScale ?? 0.05;
    this.maxScale = opts.maxScale ?? 10;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.pointers = new Map();
    this.pinchStartDist = null;
    this.pinchStartScale = 1;
    this.onTap = null; // optional callback(clientX, clientY), vom Aufrufer gesetzt

    this.viewport.style.touchAction = 'none';
    this._bind();
  }

  _bind() {
    this.viewport.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this.viewport.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  _onPointerDown(e) {
    this.viewport.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      moved: false,
    });
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchStartScale = this.scale;
    }
  }

  _onPointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(e.clientX - p.startX) > 4 || Math.abs(e.clientY - p.startY) > 4) p.moved = true;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStartDist) {
        const rect = this.viewport.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
        const newScale = this._clampScale(this.pinchStartScale * (dist / this.pinchStartDist));
        this._zoomAt(midX, midY, newScale);
      }
    } else if (this.pointers.size === 1) {
      this.panX += dx;
      this.panY += dy;
      this._apply();
    }
  }

  _onPointerUp(e) {
    const p = this.pointers.get(e.pointerId);
    const wasSinglePointer = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    this.pinchStartDist = null;
    this.viewport.releasePointerCapture?.(e.pointerId);

    if (wasSinglePointer && p && !p.moved && this.onTap) {
      const duration = performance.now() - p.startTime;
      if (duration < 600) this.onTap(e.clientX, e.clientY);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = this._clampScale(this.scale * factor);
    this._zoomAt(x, y, newScale);
  }

  _zoomAt(x, y, newScale) {
    // Punkt (x,y) im Viewport soll beim Zoom an derselben Bildstelle bleiben
    const imgX = (x - this.panX) / this.scale;
    const imgY = (y - this.panY) / this.scale;
    this.scale = newScale;
    this.panX = x - imgX * this.scale;
    this.panY = y - imgY * this.scale;
    this._apply();
  }

  _clampScale(s) {
    return Math.min(this.maxScale, Math.max(this.minScale, s));
  }

  _apply() {
    this.pannable.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
  }

  // Passt die Ansicht so an, dass das gesamte Bild in den Viewport passt
  fit(naturalWidth, naturalHeight) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const scale = Math.min(vw / naturalWidth, vh / naturalHeight);
    this.scale = this._clampScale(scale);
    this.panX = (vw - naturalWidth * this.scale) / 2;
    this.panY = (vh - naturalHeight * this.scale) / 2;
    this._apply();
  }

  // Zentriert die Ansicht auf einen Punkt in natürlichen Bildpixel-Koordinaten,
  // ohne den aktuellen Zoomfaktor zu verändern.
  centerOn(naturalX, naturalY) {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.panX = vw / 2 - naturalX * this.scale;
    this.panY = vh / 2 - naturalY * this.scale;
    this._apply();
  }

  // Wandelt Client-Koordinaten (z.B. aus einem Click/Tap-Event) in natürliche
  // Bildpixel-Koordinaten um, unabhängig vom aktuellen Zoom/Pan-Zustand.
  clientToNatural(clientX, clientY) {
    const rect = this.pannable.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.pannable.dataset.naturalWidth,
      y: ((clientY - rect.top) / rect.height) * this.pannable.dataset.naturalHeight,
    };
  }
}
