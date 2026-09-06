# Neustadt v3.0.3 · Reliable throws and detailed flowers

## English

- Fixed a duplicate pointer-up sample cancelling the last sideways flick. Recent movement is retained at release; a genuine pause still allows careful placement. Released figures keep their position and follow a physical trajectory.
- Calibrated strong fall impacts to approximately ten metres using the existing gravity and air damping. Separation happens at ground or building contact. Short one-to-three-metre falls remain below the threshold; no additional blood effects were added.
- Meadow flower groups now contain individual petals, contrasting centres, stems and paired leaves. Shared geometry keeps each cluster to one mesh and at most 320 triangles; lawn, paths and soft-plant collision behavior remain unchanged.

Existing saves remain compatible. The browser check reproduced the actual mouse-move/duplicate-release sequence: a held figure travelled sideways without snapping down. The ten-metre drop was also checked through the actual scene input and physics.

## Deutsch

- Ein doppelter Mauspunkt beim Loslassen löscht nicht mehr den seitlichen Schwung. Die letzte tatsächliche Bewegung bleibt erhalten; eine echte Pause ermöglicht weiterhin vorsichtiges Absetzen. Die Figur behält beim Loslassen ihre Position und folgt einer physikalischen Flugbahn.
- Starke Fallaufpralle sind anhand der vorhandenen Schwerkraft und Luftdämpfung auf ungefähr zehn Meter eingestellt. Das Zerlegen erfolgt beim Boden- oder Gebäudekontakt. Kurze Stürze aus ein bis drei Metern bleiben unter der Schwelle. Zusätzliche Bluteffekte wurden nicht ergänzt.
- Blumengruppen besitzen jetzt einzelne Blütenblätter, eine kontrastierende Mitte, Stängel und paarige Blätter. Geteilte Geometrie begrenzt jede Gruppe auf ein Mesh und höchstens 320 Dreiecke. Rasen, Wege und die Durchquerbarkeit bleiben erhalten.

Bestehende Spielstände bleiben kompatibel. Im Browser wurde die tatsächliche Folge aus Mausbewegung und doppeltem Loslasspunkt geprüft: Die angehobene Figur flog seitlich weiter, ohne auf den Boden zu springen. Auch der Zehn-Meter-Fall wurde über die echte Szeneneingabe und Physik geprüft.

Validation / Prüfung: **681 tests passed / Tests bestanden**, TypeScript, production build and module boundaries passed. Actual browser input recorded six separate parts after a ten-metre drop and a retained sideways trajectory after duplicate release coordinates.
