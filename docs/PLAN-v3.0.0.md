# Neustadt 3.0 – Umsetzung und Abnahme

Auftrag vom 6. September 2026. Aktives Goal: vollständige Implementierung, Optimierung, Browser-Abnahme und Veröffentlichung. Alle delegierten Aufgaben verwenden ausschließlich **GPT-6 Astra / Low**. Die spätere Ergänzung des Monats-/Jahreskalenders ist Teil dieses Plans.

## Produktentscheidungen

- Erstbesuch: belebte, gestaltete **New-York-Metropole** als sichtbarer Einstieg; Wahl zwischen **New York übernehmen** und **Eigene Stadt gründen**. Vorhandene gespeicherte Städte werden weiterhin geladen.
- Aktuelle Größenentscheidung: Eigene Städte starten auf **128 × 128** mit großzügiger ebener Baufläche im Zentrum, Bergen im Außenbereich und numerischem oder textuellem Seed. New York bleibt **96 × 96**. Diese Entscheidung ersetzt den früheren 40er-Start und die 96er-Obergrenze. Bestehende 40er- bis 128er-Spielstände bleiben unterstützt. Die Erweiterung jeder kleineren Karte führt direkt auf 128 × 128.
- Landschaft: deterministische Berge, Täler, Küsten, dichte Waldgebiete und Felsgruppen. Bauplatz und Baugrenzen müssen sichtbar und nutzbar sein; äußerer Kontext darf die spielbare Karte nicht wie einen winzigen Ausschnitt wirken lassen.
- Kalender: ein Monat entspricht **60 Simulationssekunden bei 1×**; zwölf Monate ergeben ein Jahr, Startjahr 2000. Wirtschaft und Wachstum behalten ihren Fünf-Sekunden-Schritt. Monatsraten entsprechen zwölf solchen Schritten. Pause und 2×/3× wirken konsistent; Tag/Nacht bleibt eine unabhängige Darstellung.
- Grafik: stilistisch zusammenhängende, detailliertere Gebäude und Menschen; Reflexionen sollen Material und Tageszeit überzeugend zeigen, mit begrenzten Kosten für große Städte.
- Easter Egg: optimierte Ableitung aus der ausdrücklich bereitgestellten Blender-Quelle; Originaldatei bleibt erhalten, keine fremden Assets ohne passende Lizenz.

## Implementierte Arbeitspakete

Die Markierungen beschreiben vorhandene Implementierung, nicht die abschließende Abnahme oder Veröffentlichung. Die ausstehenden Nachweise stehen getrennt darunter.

- [x] **Einstieg und Stadtvorlage:** kompakter New-York-Generator, beide Einstiegswege, Seed-Eingabe, markierter Startpunkt, bestehende Saves, Neustart- und Importablauf. Verantwortlich: Hauptagent.
- [x] **UI und Kalender:** Statuslabel oben links entfernen und Stadtkachel höher rücken; gestaltete, tastaturbedienbare Auswahlmenüs in Sprache, Datenansicht und Einstellungen; Monats-/Jahresanzeige mit Fortschritt und konsistenten Berichten. Verantwortlich: Hauptagent.
- [x] **Landschaft:** Seed-Höhen, Ebenen, Berg-/Talformen, Waldflächen, instanzierte Vegetation/Felsen, Kartenrand. Verantwortlich: `v3_landscape`; Szenenintegration Hauptagent.
- [x] **Gebäude:** mindestens fünf architektonische Varianten je Gebäudeart; echte 2-, 4- und 6-Feld-Zonenbauten, korrekte Anker, Versorgung, Wachstum, Auswahl, Abriss, Katastrophen und Save-Kompatibilität. Verantwortlich: `v3_buildings`.
- [x] **NPCs:** ungefähr halbierte Häufigkeit der Sprechblasen, längere Lesbarkeit, überarbeitete und deutlich erweiterte deutsche/englische Texte; detailliertere instanzierte Figuren. Verantwortlich: `v3_npcs`.
- [x] **Licht und Reflexionen:** überzeugendere Himmels-/Sonnenbeleuchtung, Glasmaterialien und nasse Oberflächen, weich auslaufende Pfützen, kontrollierte Drawcalls und sauberes Trocknen. Verantwortlich: `v3_reflections`, Materialabstimmung `v3_buildings`.
- [x] **Easter Egg-Asset:** Blender-Quelle inspizieren, spielgeeignet vereinfachen, exportieren, Vorschau und technische Budgets prüfen, selten und auffindbar in New York integrieren. Verantwortlich: `v3_easterEgg_asset`; Integration Hauptagent.
## Noch offene Gesamt-Abnahme und Veröffentlichung

- [ ] **Optimierung und Abnahme:** Tests, Import/Export und Reload, Langlauf, reale Browserinteraktion, Screenshots am Tag/Nacht/Regen und in Stadt/Natur, große Stadt sowie neuer 128er-Seed-Start, Tastatur und schmaler Bildschirm. Verantwortlich: Hauptagent.
- [ ] **Release:** Dokumentation DE/EN, Version 3.0.0, Produktionsbuild, Lizenzen/Assetherkunft, GitHub CI, Pages, Release-ZIP und Prüfsumme, öffentliche Prüfung mit Erhalt des Benutzer-Spielstands. Verantwortlich: Hauptagent.

## Verbindliche Prüfungen

1. Ohne Save erscheint der Einstieg über der echten New-York-Szene; Übernehmen speichert genau diese Stadt. Eigene Stadt erzeugt eine unbebaute 128er-Karte und startet am markierten Bauplatz. Gleicher Seed liefert gleiche Welt, andere Seeds erzeugen erkennbare Varianten.
2. Karten-/Kameragrenzen passen für 40/64/96/128 einschließlich neu erzeugter 128er-Städte; Rand und Gelände sind bei maximaler Herauszoomstufe visuell geprüft.
3. Monat/Jahr wechseln korrekt, einschließlich Dezember/Januar; Pause stoppt, Tempo beschleunigt, Reload bewahrt den Zwischenstand. Alte Spielstände behalten Wirtschaft, Fortschritt und Bebauung.
4. Jede Gebäudeart hat fünf belegbar verschiedene Formen. Mehrfeldhäuser belegen genau ihr Grundstück, überbauen nichts Fremdes und werden als Ganzes ausgewählt/gelöscht. Bilanz und Versorgung zählen sie korrekt; Save-Roundtrip und Undo erhalten alle Felder.
5. Gebäudematerialien, Tages-/Nachtbeleuchtung und Regenpfützen werden im echten Browser beurteilt. Pfützen verschwinden beim Trocknen; Lampen bleiben beim Schwenken stabil.
6. NPC-Sprechblasen überdecken sich nicht unlesbar, erscheinen seltener und reagieren weiterhin auf tatsächliche Ereignisse; Sprachwechsel verändert keine Spielmechanik.
7. Easter Egg-Modell ist in der laufenden Szene tatsächlich zu sehen und entspricht der bereitgestellten Quelle. Das Webpaket enthält nur benötigte, optimierte Dateien.
8. Bestehende Tests plus gezielte neue Tests und TypeScript-/Produktionsbuild bestehen. Funktions-/Performance-Grenzen werden dokumentiert; keine pauschale FPS-Garantie.
9. Öffentliche Version, Release-Tag und Artefakte stimmen mit dem geprüften Commit überein. Das Goal endet erst nach erfolgreicher Veröffentlichung und Schlussprüfung.

## Implementierungsstand der Ergänzungen

- [x] Verantwortungsgetrennte Modulstruktur, kleiner Bootstrap, Simulationsfassade, Domänenregeln, UI-Ansichten und Bindings, Speicherung sowie fokussierte Renderbausteine.
- [x] Echte Worker-Schritte mit höchstens einer laufenden Anfrage, Revisions-/Epochenschutz und Verwerfen veralteter Antworten; inkrementelle Szenenblöcke mit kooperativem Vier-Millisekunden-Zielbudget. Erster Szenenaufbau bleibt synchron.
- [x] CPU-Diagnostik und optionale asynchrone GPU-Messung; keine allgemeine FPS-Zusage.
- [x] Eigene Web-Audio-Musik, Wetter-, Umgebungs- und Fahrgeräusche; Freischaltung durch echte Nutzerinteraktion, getrennte Lautstärken und Browserpräferenzen außerhalb des Stadtexports.
- [x] Persistente ländliche Gewerbeidentität, Bauernhofarchitektur, Wiesen/Blumen/Felsen, drei Windsurfer und ein Ruderboot auf geprüfter Wasserroute; platzierbarer Uferstrand.
- [x] Zusammenhängender New-York-Kern, mittelhoher Gürtel und Vororte; drei Dichten für Wohnen/Gewerbe/Industrie mit Stufengrenzen 1/2/4 und drei schwebenden Auswahlknöpfen.
- [x] Fünf mitteldichte Bürofamilien, Fenster auf allen vier Wandseiten ohne zusätzliche Fenstermeshes, endliche geschlossene Erdplatte und Rendering ohne Screen-Space-Ambient-Occlusion.
- [x] Instanzierte Verkehrsdarstellung mit bis zu 70 gewöhnlichen Autos bei ausreichendem Straßennetz; Fußgängerverteilung nach bebauter Straßenfront und Auslassen der Darstellung außerhalb der Kamera.
- [x] Isolierte Easter-Egg-Modellvorschau aus Start-/Stadtmenü mit Rückkehr zur Stadt, ohne Übernahme eines neuen Szenarios.
- [x] Englische und deutsche README, Architekturübersicht, neutrale Assetnamen und vorläufige Release-Notizen; Formatierung, Architekturprüfung und rekursiver Testlauf als Projektbefehle.
- [x] 720 Fußgänger in der laufenden Stadt bestätigt; daraus folgt keine allgemeine Leistungszusage.
- [ ] Neueste 128er-Startlandschaft mit breitem ebenem Zentrum und Bergen außen abschließend prüfen.
- [ ] Neueste 3D-Gang-/Kollisionsänderungen prüfen: normale Stürze erholen sich; starke fiktive Treffer erzeugen sechs Körperteilfragmente, maximal 48 gleichzeitig für zwölf Sekunden.
- [ ] Abgerundete Zweiarm-Straßenkurven und geglättete Steigungen nach Abschluss der laufenden Implementierung abnehmen.
- [ ] Büro-Easter-Egg beim vierten geeigneten mitteldichten Gewerbegrundstück samt freier, sich verbreiternder Sichtfläche bis fünf Felder vor der Fassade samt Straße und Grünfläche prüfen; neue Vorlage und ausdrückliche Versetzungsfunktion ohne automatische Load-Migration abnehmen.
- [ ] Neueste Dach-/Fassadendetails des Easter Eggs, alle Flughafentypen samt kompletter Fluganimation sowie endgültige Stadt-/Naturansichten visuell abnehmen.
- [ ] Abschließenden Testlauf, Build, Import/Export/Reload, Worker-Änderungskonflikte, echte Audiofreischaltung und Hörprobe dokumentieren.
- [ ] Öffentliche Version, Commit, CI, Pages, Release-ZIP und Prüfsumme abschließend prüfen und den Benutzer-Spielstand erhalten.

Zwischenmessungen einzelner Browserläufe bleiben vorläufige QA-Belege. Sie sind keine Zusage für andere Städte, Grafikprofile, Auflösungen oder Geräte und ersetzen die Schlussprüfung nicht.

## Ergänzungen aus der laufenden Abnahme

- Vollständige Modulstruktur statt flachem Source-Verzeichnis; große App-, Modell-, Szenen- und Simulationsmodule nach Verantwortung zerlegen.
- Simulation im echten Web Worker; versionierte Antworten, Schutz vor veralteten Ergebnissen, begrenzte Warteschlange. Gebäude-Neuaufbau inkrementell mit Frame-Budget; CPU/GPU und Nacht-Regen-Performance messen.
- Einheitliche englische README ohne deutschen Begriffs-/Preiskatalog, gleichwertige deutsche README, Projektname bleibt Neustadt.
- Ausschließlich neutrale Bezeichnung Easter Egg in Code, Dateinamen, Metadaten und Dokumentation. Einzigartiges kommerzielles 3×2-Gebäude mit Straßenorientierung und vollständiger Rückseite. Hoher Fassadenschriftzug, geteiltes Dach mit Technik/Solar, überdachtem Zwischenbereich, möblierter Terrasse und Glasgeländern.
- Isolierte Easter-Egg-Modellvorschau mit Rückkehr zur Stadt im Start-/Stadtmenü, ohne beim bloßen Erkunden stillschweigend die neue Stadt zu übernehmen.
- Ländliche Gewerbegrundstücke als dauerhaft gespeicherte Bauernhöfe; Wiesen, Gras, Wildblumen und Felsen in der New-York-Umgebung.
- Originale leise Hintergrundmusik, Wetter-/Stadtatmosphäre, Fahrmotor und ortsabhängige Anlagen-/Fahrzeuggeräusche; getrennte Lautstärkeregler.
- Grundverschiedene Hochhausfassaden und Materialien. Flughafenvarianten und komplette Fluganimation auf freie Roll-/Flugwege prüfen.
- Drei Windsurfer und ein Ruderboot auf geeignetem See; allgemein platzierbarer Strand, nicht automatisch in New York. Regen deckt die gesamte Welt stabil ab, UI liegt darüber.

## Release-Abnahme vom 6. September 2026

Feature-Umfang eingefroren. 643 Tests, TypeScript, Produktionsbuild, Formatierung und Modulgrenzen erfolgreich geprüft. Die automatisierten Prüfungen decken insbesondere die neue Startfläche, verlustfreie Kartenerweiterung, Fußgängerwege, sichere normale Stürze, starke Aufpralle, Dichtewachstum und tatsächliche Straßen-/Kollisionsgeometrie ab. Repräsentative Browseransichten von Tag, Nacht, Regen, Kurven, Hochhäusern, Flughafen und Büro-Easter-Egg wurden beurteilt. Die bestehenden Nutzerstädte blieben erhalten; Bergtal wurde mit allen 21 Straßenfeldern auf 128 erweitert, das Büro in New York ausdrücklich an die Parkfront versetzt. Veröffentlichung erfolgt über CI, GitHub Pages und Release v3.0.0.

Die früheren Checklisten dokumentieren Zwischenstände; diese Abnahme beschreibt den finalen Umfang. Nicht beansprucht werden hardwarebeschleunigtes Raytracing, vollständige Umgebungsreflexionen oder eine hardwareunabhängig garantierte Bildrate.
