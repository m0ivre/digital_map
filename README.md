# GeoRef Standort

Progressive Web App: Foto/PDF einer Karte oder eines Lageplans importieren,
auf dem Bild Referenzpunkte mit bekannten GPS-Koordinaten setzen, und danach
den eigenen Standort live als Punkt auf diesem Bild angezeigt bekommen –
sobald man sich im kartierten Bereich bewegt.

Alles läuft rein lokal im Browser (kein Backend). Bilder/PDFs und
Kalibrierdaten werden in IndexedDB gespeichert. Funktioniert offline nach
dem ersten Laden (Service Worker) und lässt sich als App installieren.

## Nutzung

1. **+ Neue Karte** → Foto mit Kamera aufnehmen oder Bild/PDF aus Dateien wählen.
   Bei PDFs wird die erste Seite gerastert.
2. Georeferenzieren – zwei Methoden als Reiter:

   **A) Auf Grundkarte ausrichten (Standard, schnell)**
   Das importierte Bild wird halbtransparent über eine echte Grundkarte
   (OpenStreetMap, OpenTopoMap, Humanitarian/HOT oder Satellit) gelegt.
   - "🗺 Karte bewegen": die Grundkarte verschieben/zoomen, bis der richtige
     Ausschnitt sichtbar ist (📍-Button springt direkt zum eigenen GPS-Standort).
   - "🖼 Bild ausrichten": das importierte Bild per Ziehen verschieben, mit
     zwei Fingern skalieren/drehen (oder über die Regler), bis Straßen/
     Gebäude im Bild zu denen der Grundkarte passen.
   - Durchsichtigkeits-Regler erleichtert den Vergleich.
   - "✓ Ausrichtung übernehmen & speichern" errechnet aus der aktuellen
     Bildposition automatisch 4 Referenzpunkte (die Bildecken) und speichert.
   - Benötigt eine Internetverbindung für die Kartenkacheln.

   **B) Punkte manuell setzen (präziser, auch offline)**
   Auf mindestens 2 markante Punkte im Bild tippen (z. B. Gebäudeecken,
   Wegkreuzungen) und jeweils die realen GPS-Koordinaten zuweisen – manuell
   eingeben oder, während man physisch an diesem Punkt steht, über
   "Aktuellen GPS-Standort verwenden" erfassen.
   - 2 Punkte → Ähnlichkeitstransformation (Skalierung + Rotation).
   - 3+ Punkte → affine Transformation (korrigiert zusätzlich Scherung/Verzug,
     z. B. bei schräg fotografierten oder nicht nordausgerichteten Plänen).

3. Karte öffnen → Standort wird live als blauer Punkt (inkl. GPS-Genauigkeitskreis)
   auf dem Bild angezeigt, mit Pinch-Zoom/Pan. "Folgen" zentriert die Ansicht
   automatisch auf den aktuellen Standort.

## Lokal starten

Für Kamera, Geolocation und den Service Worker benötigen Browser einen
sicheren Kontext (HTTPS oder `localhost`). `file://` reicht nicht.

```bash
# Python
python3 -m http.server 8080

# oder Node
npx serve .
```

Dann `http://localhost:8080` öffnen.

## Auf dem Smartphone nutzen / installieren

Für Kamera- und GPS-Zugriff unterwegs muss die App über HTTPS erreichbar
sein (z. B. per Deploy auf GitHub Pages, Netlify, Vercel, oder einem eigenen
Server mit TLS-Zertifikat). Danach im mobilen Browser öffnen und über
"Zum Startbildschirm hinzufügen" / den Install-Button installieren.

## Technische Hinweise

- **Georeferenzierung**: `geo.js` rechnet GPS-Koordinaten über eine
  äquirektangulare Näherung in lokale Meter um und löst daraus eine
  Ähnlichkeits- (2 Punkte) bzw. affine Transformation (3+ Punkte, kleinste
  Quadrate) zu Bildpixel-Koordinaten. Für die Flächengröße einzelner Gebäude/
  Gelände ist die Näherung ausreichend genau.
- **PDF-Rendering**: `pdf.js` (Mozilla) wird lokal aus `vendor/` geladen,
  damit der Import auch offline funktioniert.
- **Grundkarte**: Leaflet (`vendor/leaflet.js`), lokal vendort. Die
  Kartenkacheln selbst (OpenStreetMap/OpenTopoMap/HOT/Esri) kommen live aus
  dem Internet und werden bewusst **nicht** vom Service Worker zwischengespeichert
  (das wäre unbegrenzt viele Kacheln) – der Reiter "Auf Grundkarte ausrichten"
  braucht daher eine Internetverbindung. Die manuelle Punktmethode funktioniert
  weiterhin komplett offline.
- **Speicherung**: IndexedDB (`db.js`), Bilder als Blob.
- **Pan/Zoom**: eigene Pointer-Events-Implementierung (`panzoom.js` für die
  Ansichten, `overlay-align.js` für das frei verschieb-/skalier-/drehbare
  Bild-Overlay inkl. kombinierter Zwei-Finger-Rotation+Skalierung), kein
  externes Abhängigkeits-Framework außer Leaflet.
- Kein Build-Schritt nötig – reines HTML/CSS/JS.

## Grenzen

- Die Positionsgenauigkeit hängt vollständig vom GPS-Empfang des Geräts ab
  (im Gebäudeinneren oft ungenau/nicht verfügbar).
- Die äquirektangulare Näherung ist für große Flächen (mehrere Kilometer)
  weniger exakt als eine echte Kartenprojektion – für Gebäude- und
  Geländepläne spielt das keine Rolle.
- Die visuelle Ausrichtung ist nur so genau wie das Augenmaß beim Vergleich
  mit der Grundkarte; für höchste Präzision die manuelle Punktmethode nutzen
  (ggf. ergänzend zur groben visuellen Ausrichtung).
- Kartenkacheln-Nutzung unterliegt den Richtlinien der jeweiligen Anbieter
  (z. B. [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/));
  für sehr intensive Nutzung ggf. eigenen Tile-Server erwägen.
