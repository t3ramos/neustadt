# Neustadt v3.0.2 · Park landscaping and camera clipping fix

## English

- Replaced the repeated raised garden boxes around the office with a continuous lawn, connected footpaths and small irregular flower patches. The open view of the office remains clear; soft planting does not create collision obstacles.
- Fixed foreground clipping after returning from a building close-up and zooming out. The orthographic city camera now retains sufficient distance from the entire region while preserving its viewing angle and target.

Existing city saves keep their buildings and progress. The new garden appearance applies to existing park tiles after reloading. Camera regressions reproduce the former near-plane clipping at wide zoom across landscape, tall and narrow viewports; park tests verify flat connected surfaces and collision behavior.

## Deutsch

- Die wiederholten hohen Pflanzkästen am Büro sind durch zusammenhängenden Rasen, verbundene Wege und kleine unregelmäßige Blütenflächen ersetzt. Die Sicht auf das Büro bleibt frei; weicher Bewuchs erzeugt keine künstlichen Hindernisse.
- Der gerade abgeschnittene Vordergrund nach der Gebäude-Nahansicht und anschließendem Herauszoomen ist behoben. Die Stadtkamera hält jetzt ausreichend Abstand zur gesamten Region, ohne den Blickwinkel oder Zielpunkt zu verändern.

Bestehende Städte behalten ihre Gebäude und ihren Fortschritt. Bereits vorhandene Parkfelder erscheinen nach dem Neuladen in der neuen Gestaltung. Kameratests reproduzieren das frühere Abschneiden bei starkem Zoom und verschiedenen Bildschirmformaten; Parktests prüfen ebene Übergänge und Kollisionen.

Validation / Prüfung: **670 tests passed / Tests bestanden**, TypeScript, production build, formatting and module boundaries passed. Both changes were also checked in the browser on the existing local server.
