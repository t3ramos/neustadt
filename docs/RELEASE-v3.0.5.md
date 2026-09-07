# Neustadt v3.0.5 · 60 FPS limit, reset and rotated Kassel

Rendering is capped at 60 FPS across city and driving views, independently of display refresh rate. Simulation timing remains unchanged. Skipped display callbacks do not run scene animation or GPU rendering, and resuming a suspended tab does not trigger a catch-up burst.

The city menu now offers “Reset to starter city”. A confirmation explains that the current save will be replaced and points players to Export save first. Confirming creates the original Kassel, resets the scene and saves it locally. A save requested while another write is pending is queued so the latest city is persisted.

Kassel's starter map is rotated by 180 degrees: terrain, streets, infrastructure, building footprints and facade orientations. The camera retains its original orientation. Existing saves are not migrated; the rotated layout appears when starting or resetting Kassel.

Die Darstellung ist auf 60 FPS begrenzt, auch auf schnellen Displays. Das Simulationstempo bleibt unverändert.

Das Stadtmenü bietet jetzt „Auf Startstadt zurücksetzen“. Nach einer Bestätigung wird Kassel im ursprünglichen Zustand geladen und lokal gespeichert. Abbrechen erhält die bisherige Stadt. Die gesamte Startkarte von Kassel einschließlich Gelände, Straßen und Gebäudeausrichtungen ist um 180 Grad gedreht. Die Kamera bleibt unverändert.

Validation: 684 tests, formatting and architecture checks passed. Type-check and production build passed after the map rotation. Browser verification confirmed the original camera orientation and the rotated landmark at (62, 61), facing south. Reset verification confirmed cancellation preserves the city and reset survives reloading with 77,848 residents, €20,000,000 and month 0.
