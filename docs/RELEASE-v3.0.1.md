# Neustadt v3.0.1 · Kassel and smarter road drawing

## English

- **A redesigned starting metropolis named Kassel.** The 128 × 128 scenario starts with 77,848 residents, 85% happiness, complete utility connections and a positive budget. A central lake park, northern skyline, midrise neighborhoods, garden suburbs and a compact peripheral utility district replace the previous repetitive layout. The office Easter Egg is always present near the map center, facing an open park boulevard.
- **Roads route around zoning.** While dragging, the proposed road avoids residential, commercial and industrial zones—including undeveloped zoning—and occupied facility footprints. Existing roads can connect the route. Moving back shortens the proposed route; the committed road matches the final preview. A blocked endpoint selects a nearby free edge; an unreachable connection remains blocked without overwriting zoning.
- **Better first view.** The opening city camera includes the lake, skyline and central office area; the welcome screen shows the actual city name and map dimensions.

Existing saves remain compatible and are not automatically replaced. The new scenario is available through **City menu → New city → Take over Kassel**. The office discovery sequence remains unchanged.

Validation: **665 automated tests passed**, TypeScript and production build passed. Browser review covered the redesigned city and a real road drag: 19 road tiles built, 36 protected zoning tiles retained, preview shortened and restored before commit.

## Deutsch

- **Neue Startmetropole Kassel.** Die gestaltete 128 × 128-Stadt startet mit 77.848 Einwohnern, 85% Zufriedenheit, vollständiger Versorgung und positivem Haushalt. Ein zentraler Seepark, eine nördliche Skyline, mittelhohe Quartiere, Gartenviertel und ein kompakter Versorgungsbereich am Rand ersetzen das bisherige wiederholte Raster. Das Büro-Easter-Egg ist immer nahe der Kartenmitte vorhanden und zeigt zur freien Parkpromenade.
- **Straßen umgehen Zonen.** Beim Ziehen führt die Vorschau um Wohn-, Gewerbe- und Industriezonen sowie belegte Gebäudegrundstücke herum. Das gilt auch für noch unbebaute Zonen. Bestehende Straßen bleiben nutzbar. Zurückziehen verkürzt den Entwurf; gebaut wird die abschließende Vorschau. Ein blockierter Endpunkt weicht auf einen nahen freien Rand aus. Ohne sicheren Weg wird keine Zone überschrieben.
- **Bessere Startperspektive.** See, Skyline und zentraler Bürobereich liegen gemeinsam im Bild; der Einstieg zeigt den tatsächlichen Stadtnamen und die Kartengröße.

Bestehende Spielstände bleiben kompatibel und werden nicht automatisch ersetzt. Die neue Vorlage liegt unter **Stadtmenü → Neue Stadt → Kassel übernehmen**. Die verborgene Entdeckung des Büro-Easter-Eggs bleibt erhalten.

Prüfung: **665 automatisierte Tests bestanden**, TypeScript und Produktionsbuild erfolgreich. Im Browser wurden Stadtbild und Straßenziehen geprüft: 19 Straßenfelder gebaut, alle 36 Zonenfelder erhalten, Vorschau vor dem Bauen verkürzt und wieder verlängert.
