# NEUSTADT · Regionen & Stadtleben

[English](README.md) · **Deutsch**

Ein Open-Source-Spiel von [t3ramos](https://github.com/t3ramos). [Quellcode](https://github.com/t3ramos/neustadt) · [Releases](https://github.com/t3ramos/neustadt/releases) · [Releases und Hosting](docs/RELEASING.de.md). Im Browser spielen: [t3ramos.github.io/neustadt](https://t3ramos.github.io/neustadt/).

Eine spielbare 3D-Stadtsimulation mit eigener Grafik, großen Regionen und einem Stadtziel. Erschließe hügeliges Land, verlege Versorgung, entwickle deine Kleinstadt in **drei Ausbaustufen zur Metropole** und erkunde die Straßen selbst am Steuer. NEUSTADT ist eine eigenständige, von klassischen Städtebauspielen wie SimCity 2000 inspirierte Umsetzung.

## Starten

Das Spiel ist vollständig auf **Deutsch und Englisch** verfügbar. Die Sprache lässt sich während des Spiels wechseln und wird im Browser gespeichert. Menüs, Bauwerkzeuge, Hilfe, Meldungen, Aufträge, Challenges und alle **494 NPC-Sprüche** sind in beiden Sprachen enthalten. Ein Sprachwechsel setzt die Stadt nicht zurück; selbst gewählte Stadtnamen bleiben erhalten.

Unter macOS: **[Neustadt starten.command](<Neustadt starten.command>) doppelklicken**. Der Starter erstellt die aktuelle Produktionsfassung und öffnet **[NEUSTADT auf Port 4173](http://127.0.0.1:4173/)**. Er aktualisiert auch eine bereits laufende Fassung und erhält die benötigten Dateien noch geöffneter Spielfenster. Lade das Spiel neu, um den neuen Stand zu sehen. Das Terminal für den lokalen Server geöffnet lassen.

Benötigt werden **Node.js 20 ab 20.19 oder Node.js ab 22.12**, npm und ein Desktop-Browser mit aktiviertem **WebGL2**. Manuell starten:

```sh
npm ci
npm run build
npm run preview -- --port 4173 --strictPort
```

Für Entwicklung mit automatischer Aktualisierung:

```sh
npm run dev
```

Öffne die im Terminal angezeigte Adresse. Der Build liegt in `dist/` und lässt sich über einen statischen Webserver ausliefern. Die Regeln für Simulation, Bau, Spielstände und weitere Spielsysteme prüfst du mit:

```sh
npm test
```

Ein vorhandener Spielstand öffnet automatisch und pausiert. Beim ersten Besuch erstellt das Spiel bereits **Lindenbucht**, eine kleine spielbare Starterstadt, die du direkt erkunden und erweitern kannst. Unter **Stadtmenü → Neue Stadt** wählst du **Mit Starterstadt beginnen** für eine frische vorbereitete Kleinstadt oder **Auf freiem Land beginnen** für eine leere Region. Dort lassen sich auch Name, Landschafts-Seed und eine Region mit **64 × 64**, **96 × 96** oder **128 × 128 Feldern** wählen. Beide Optionen ersetzen den aktiven Spielstand; exportiere deine bisherige Stadt vorher, wenn du sie behalten möchtest. Standard ist 128 × 128: **16.384 Felder und gut zehnmal die Fläche der bisherigen 40er-Karte**. Starterstadt und freies Land beginnen jeweils mit **85.000 €**.

## Bauen und versorgen

1. **Straßen ziehen.** Grundstücke benötigen eine Straße innerhalb von zwei Feldern Abstand. Straßen folgen den Geländehöhen; über Wasser entstehen Brücken. Die Bauvorschau zeigt Baufläche, Kosten und Hindernisse, bevor du loslässt.
2. **Strom und Wasser verlegen.** Straßen, Stromnetz und Wasserrohre sind eigenständige Netze. Verbinde das Kraftwerk mit Stromleitungen und das Wasserwerk mit Rohren. **Ein Stromanschluss pro zusammenhängendem Block reicht:** Kantenweise verbundene Wohn-, Gewerbe- und Industriegebiete leiten den Strom untereinander weiter, auch bevor dort ein Haus steht. Normale Zonenhäuser benötigen keine einzelnen Freileitungen oder Hausanschlüsse; das gilt auch für ihre Hochhäuser. Straßen und freie Zwischenflächen trennen die Blöcke, solange keine ausdrücklich verlegte Leitung sie verbindet. Nur große Anlagen mit mehrteiliger Baufläche können einen sichtbaren eigenen Anschluss erhalten. Dieser verläuft zur Grundstücksgrenze auf derselben Straßenseite und darf weder die Fahrbahn noch ein fremdes Gebäude kreuzen. Wasserrohre versorgen Grundstücke bis zwei Felder Abstand; das Wasserwerk braucht selbst Strom. Ausdrücklich verlegte Leitungen dürfen unter Straßen und Gebäuden verlaufen, im Freiland sind Strommasten sichtbar. Die Datenansichten **Strom** und **Wasser** helfen beim Prüfen.
3. **Gebiete ausweisen.** Ziehe Wohn-, Gewerbe- oder Industriezonen von einer Ecke zur gegenüberliegenden Ecke als Rechteck auf. Beide Eckfelder zählen mit; du kannst in jede Richtung ziehen. Bewegst du die Maus vor dem Loslassen zum Startpunkt zurück, werden Fläche und Kosten wieder kleiner. Wohnen schafft Einwohner, Gewerbe und Industrie schaffen Arbeitsplätze. Bei Nachfrage, Versorgung und ausreichender Zufriedenheit wachsen Gebäude selbstständig. Fehlende Versorgung kann zum Rückbau führen. Wohnhäuser, Mehrfamilienhäuser, Geschäfte, Hochhäuser und Fabriken machen den Ausbau sichtbar.
4. **Lebensqualität sichern.** Parks, Polizei, Feuerwehr, Kliniken und Bildungseinrichtungen wirken in ihrer Umgebung. Industrie und fossile Kraftwerke belasten Nachbargrundstücke. Stadtdienste benötigen Straße, Strom und Wasser; ihre Budgets bestimmen die Wirkung.
5. **Den Haushalt ausgleichen.** Steuern beeinflussen Einnahmen und Zufriedenheit. Polizeiwesen, Feuerwehr, Gesundheit und Bildung haben eigene Budgets. Kredite und Rückzahlungen erfolgen in Schritten von 10.000 €, bis maximal 50.000 € Kredit; der Monatszins beträgt 0,5 %.

Die Startversorgung liefert **6.000 Stromeinheiten je Kraftwerk** und **6.000 Wassereinheiten je versorgtem Wasserwerk**. Später liefern Windparks 1.200 und Solarparks 3.200 Stromeinheiten. Achte sowohl auf die Kapazität als auch auf durchgehende Verbindungen: Ein getrenntes Netz wird nicht durch ein Kraftwerk am anderen Ende der Karte versorgt.

**Vor dem Bauen prüfen:** Die schwebende Vorschau zeigt Fläche, Abmessungen, Kosten und Bauhindernisse und bleibt im sichtbaren Fenster. Lass über der Spielwelt los, um zu bauen. **Rechtsklick oder Esc** verwirft einen laufenden Entwurf und lässt dasselbe Werkzeug ausgewählt; mit **V** oder **Auswählen** wechselst du gezielt zur Grundstücksauswahl. Loslassen über einem Menü oder Bedienfeld, außerhalb der bebaubaren Welt oder nach einer unterbrochenen Zeigerinteraktion verwirft den Entwurf. Auch das Öffnen eines Dialogs bricht einen laufenden Entwurf ab.

Bei **1×** dauert ein Spielmonat etwa fünf Sekunden. **2×**, **3×** und Pause stehen in der unteren Leiste bereit. Dialoge und ein ausgeblendeter Browser-Tab pausieren die Simulation.

### Gelände und große Gebäude

Unter **Gelände** kannst du freie Flächen in **5-Meter-Schritten anheben oder absenken**. **Einebnen** übernimmt die Höhe des zuerst angeklickten Felds für die bearbeitete Fläche. Die Kosten betragen **35 € je Feld und 5 Meter Höhenänderung**. Unter dem Meeresspiegel entsteht Wasser; Aufschütten schafft Land. Bebaute Flächen müssen vor einer Höhenänderung geräumt werden.

Öffentliche Anlagen sind **einzelne Gebäude mit zusammenhängender Baufläche**. Sie benötigen eine freie, trockene und ebene Grundfläche. Mit **R** drehst du Gebäude und Baufläche. Ein Abriss entfernt die gesamte Anlage.

**Zufahrten und Höfe:** Alle 13 großen Anlagentypen unterstützen befestigte Zufahrten von einer angrenzenden Straße, auch bei gedrehten Gebäuden. Bei geeigneter Lage führt eine durchgehende Fahrspur mit Rampe auf den Vorplatz oder Parkplatz; sichtbarer Belag und Fahrzeugräder nutzen dieselbe Oberfläche. Straßen können vorne, seitlich oder hinten anschließen. Die Route bleibt auf dem vorhandenen Grundstück und verschiebt weder gespeicherte Gebäude noch Nachbarfelder. Lege die Straße direkt an die Grundstücksgrenze und achte auf einen überwindbaren Höhenunterschied. Industriegebäude erhalten einen kleineren Ladevorplatz; ist die Straße für eine nutzbare Rampe zu steil, gilt die Einfahrt nicht als befahrbar.

| Anlage | Baufläche | Baukosten | Betrieb / Monat |
| --- | ---: | ---: | ---: |
| Kraftwerk | 4 × 4 | 6.500 € | 320 € |
| Wasserwerk | 2 × 2 | 2.200 € | 180 € |
| Polizeiwache | 2 × 2 | 1.900 € | 125 € |
| Feuerwache | 3 × 2 | 1.600 € | 95 € |
| Klinik | 3 × 3 | 3.200 € | 150 € |
| Schule | 3 × 2 | 1.800 € | 100 € |
| Stadion | 6 × 5 | 9.000 € | 180 € |
| Hafen | 5 × 3 | 9.500 € | 160 € |
| Universität | 5 × 4 | 12.000 € | 280 € |
| Flughafen | 10 × 6 | 16.000 € | 290 € |

Die Preise gelten **pro Anlage**, die Betriebskosten der Stadtdienste bei 100 % Budget. Beim Hafen müssen mindestens **zwei Felder entlang seiner Kaimauer direkt ans Wasser grenzen**; mit R richtet sich die Wasserseite aus. Stadion, Flughafen und Hafen besitzen eigene Details und Animationen.

Eine Straße kostet 18 € pro Feld, ein Wasserrohr 8 € und eine Stromleitung 12 €. Straßen und Schienen über Wasser kosten zusätzlich 90 € je Feld, Unterwasserleitungen zusätzlich 12 €. Das Räumen eines Baums beim Bauen kostet 2 €. Alle Preise, Bauflächen und Freischaltbedingungen stehen auch in der Werkzeugleiste.

## Drei Ausbaustufen, Aufträge und Stadtziel

Öffne **Stadtentwicklung** über die Flagge oder das Stadtmenü. Der Stadtaufstieg richtet sich nach der Einwohnerzahl. Ein erreichter Rang und seine Freischaltungen bleiben erhalten, auch wenn die Bevölkerung später fällt.

| Ausbaustufe | Einwohner | Neue Möglichkeiten | Gebäudeentwicklung in Zonen |
| --- | ---: | --- | --- |
| **Kleinstadt** | ab 0 | Grundversorgung, Stadtdienste, Parks, Gelände und Leitungen | bis Gebäudestufe 2 |
| **Großstadt** | ab 5.000 | Bahn, Wind- und Solarenergie, Stadion, Hafen, Recycling | bis Gebäudestufe 3 |
| **Metropole** | ab 15.000 | Universität, Flughafen, höchste Wohn- und Geschäftshäuser | bis Gebäudestufe 4 |

**14 Aufträge** belohnen unter anderem neue Straßen, Wohnraum, eigene Versorgungsnetze, ausgeglichene Finanzen und eine saubere Energieversorgung mit Geld und Erfahrungspunkten. Hole abgeschlossene Aufträge im Fenster **Stadtentwicklung** ab. Bestehende Starterbebauung zählt nicht als eigener Neubau. Erfahrungspunkte dokumentieren Erfolge; die Ausbaustufen hängen an den Einwohnergrenzen.

Zusätzlich kannst du jeweils eine von **drei zeitlich begrenzten Challenges** starten:

- **Aufbruch in die Metropole:** 5.000 zusätzliche Einwohner innerhalb von 60 Monaten.
- **Grüne Hauptstadt:** innerhalb von 120 Monaten 10.000 Einwohner bei einer Umweltbelastung unter 10 erreichen.
- **Goldene Stadtkasse:** innerhalb von 60 Monaten die Stadtkasse um 150.000 € steigern. Ein neuer Kredit beendet den Versuch.

Erfolgreiche Challenges bringen Geld, Erfahrung und ein bleibendes Abzeichen. Fehlgeschlagene Versuche können neu gestartet werden.

Das **Stadtziel** ist erreicht, wenn du **sechs Monate in Folge gleichzeitig** mindestens **25.000 Einwohner**, **80 Zufriedenheit**, **70 Bildung**, **70 Gesundheit** und einen **positiven monatlichen Haushalt** hältst. Anschließend kannst du im freien Spiel weiterbauen. Aufträge und Challenges unterstützen den Weg; das Ziel verlangt nicht, dass vorher jeder Auftrag abgeschlossen wurde.

## Kamera, Autos und Bewohner

| Eingabe | Funktion |
| --- | --- |
| Linksklick / links ziehen | Ausgewähltes Werkzeug anwenden |
| **M**, dann links ziehen | Kamera verschieben |
| **W A S D / Pfeiltasten** | Kamera bewegen |
| Mittlere Maustaste oder **Alt + links ziehen** | Kamera verschieben |
| Rechts ziehen ohne laufenden Entwurf / **Q und E** | Kamera drehen |
| Rechtsklick während des Bauziehens | Entwurf abbrechen; Werkzeug behalten |
| Mausrad | Zoomen |
| **1 / 2 / 3 / 4 / 5** | Straße / Wohnen / Gewerbe / Industrie / Park |
| **B / V / C** | Abreißen / Grundstück auswählen und untersuchen / Bewohner greifen |
| **R** | Großes Gebäude drehen |
| **Leertaste** bei fokussierter Spielwelt | Pause / mit 1× fortsetzen |
| **G / N / H** | Raster / auf Tag oder Nacht schalten / Spielhilfe |
| **L** | Stadtbeleuchtung ein- oder ausschalten |
| **Cmd/Ctrl + S** | Speichern |
| **Cmd/Ctrl + Z** | Letzte verfügbare Bau- oder Katastrophenaktion rückgängig machen |
| **Esc** | Fahrt beenden, Dialog schließen oder Entwurf abbrechen; Bauwerkzeug behalten |

Die **Weltkugel** zeigt die ganze Region, das **Fadenkreuz** bringt dich zur Innenstadt. Ein Klick auf die Minikarte verschiebt den Blick direkt an einen Ort. Unter **Stadtmenü → Kamera & Bewohner** findest du die Navigationshilfe. Das **Stadtjournal** erreichst du immer über das Stadtmenü, auch in schmalen Laptop- und Mobilansichten.

**Tastatur in Menüs:** Mit Tab und Umschalt+Tab wechselst du zwischen Dialogfeldern. Fokussierte Schaltflächen behalten ihre normale Enter-/Leertastenfunktion; Spielkürzel greifen nicht ein, während du Menüelemente bedienst oder Text eingibst. Nach dem Schließen erhält das öffnende Bedienelement nach Möglichkeit den Fokus zurück. Beim Aktualisieren desselben Dialogs bleiben Scrollposition und Fokus soweit möglich erhalten. Seitenleisten und Dialoginhalte lassen sich in kleineren Fenstern scrollen; NPC-Sprechblasen liegen hinter den Bedienfeldern.

**Selbst fahren:** Wechsle mit **V** zur Auswahl, bewege die Maus über ein Fahrzeug und klicke auf das eingeblendete **Lenkrad**. Die Kamera folgt dem Wagen. **W/S** oder **↑/↓** beschleunigen, bremsen und fahren rückwärts; **A/D** oder **←/→** lenken. **Leertaste** ist die Handbremse: Bei Tempo und gleichzeitigem Lenken kann der Wagen seitlich driften. **Esc** beendet die Fahrt.

Das Fahrprofil erlaubt **50 km/h auf Straßen in Bebauungsnähe**, **70 km/h auf freien Straßen außerhalb der Bebauung** und **25 km/h abseits der Straße**. Das aktuelle Tempo und die jeweilige Grenze erscheinen in der Fahranzeige. Limousinen, Taxis, Transporter und Lastwagen besitzen unterschiedliche Karosserien und Größen sowie runde Räder, Felgen, Spiegel und Leuchten.

**Verkehr und Ampeln:** Fahrzeuge fahren auf der rechten Fahrbahnseite. An T-Einmündungen und Kreuzungen entstehen automatisch Ampeln; eng benachbarte Kreuzungen werden gemeinsam geregelt. Die sichtbaren roten, gelben und grünen Lichter folgen derselben Steuerung wie der KI-Verkehr, mit einer kurzen Rundum-Rotphase zwischen den Zufahrten. KI-Fahrzeuge halten bei Rot oder Gelb, warten vor belegten Kreuzungen und fahren erst hinein, wenn dahinter genügend Platz für das gesamte Fahrzeug frei ist. Bei unbeschilderten Konflikten gilt rechts vor links; enge Kurven und Einmündungen von Betriebshöfen lassen Fahrzeuge ebenfalls nur bei freier gemeinsamer Fahrfläche passieren. Autos stellen sich hinter wartendem Verkehr an und berücksichtigen Fahrzeuggrößen einschließlich LKWs. Auf stark belegten oder blockierten Straßen können weiterhin Staus entstehen.

**Dienstfahrzeuge:** Polizeiautos, Feuerwehrfahrzeuge und Krankenwagen starten im Hof ihrer Wache beziehungsweise Klinik. Bei nutzbarer Verbindung fahren sie über die Zufahrt und Rampe, warten auf eine sichere Lücke und ordnen sich in den KI-Straßenverkehr ein. Über ihren Lenkradknopf kannst du sie wie andere Fahrzeuge auswählen und selbst fahren.

Fahrzeuge kollidieren mit anderen Fahrzeugen und den sichtbaren Baukörpern. Freie Vorplätze und Zwischenräume sind befahrbar, soweit der Wagen hindurchpasst; Wasser und Kartengrenzen bleiben Hindernisse. Angefahrene Bewohner können stürzen oder bei schweren Treffern sterben. Die vorhandenen Regeln für Einwohnerverlust und Zeugen gelten auch dabei.

**Bewohner und Stadtleben:** Fußgänger nutzen die Gehwege und wechseln die Straßenseite über markierte Querungen. Ihre Sprechblasen schöpfen aus **494 verschiedenen Texten in jeweils Deutsch und Englisch** zu Umgebung, Wetter und beobachteten Ereignissen. Jede Figur durchläuft den Textvorrat eines Themas, bevor sie daraus erneut zitiert; kürzlich gesagte Sätze anderer Figuren werden möglichst vermieden. Nach ausgeschöpftem Vorrat können Texte wiederkehren.

Katzen und Hunde tauchen vereinzelt in bewohnten Vierteln und Parks auf. In geeigneten Waldgebieten abseits der Bebauung leben kleine Gruppen von Rehen und Kaninchen. Ihre Verteilung richtet sich nach der Landschaft und den vorhandenen Wohnvierteln.

**Bewohner greifen:** Mit **C** lassen sich die maßstäblich kleinen erwachsenen Figuren mit der Maus greifen und bewegen. Ein kleines Handsymbol markiert die Figur unter dem Mauszeiger. Ziehe die Maus nach oben, um sie anzuheben, und setze sie nahe am Boden langsam ab, damit sie weiterläuft. Die Figuren haben gerundete Formen, modellierte Gesichtsdetails sowie unterschiedliche Frisuren, Kleidung und Accessoires. Sie reagieren mit Sprechblasen auf Greifen oder beobachtete Vorfälle. Nach einem überstandenen Sturz richten sie sich mit einer Aufstehanimation wieder auf.

Ein kräftiger Wurf aktiviert die Ragdoll-Physik; tödliche Aufpralle hinterlassen einen Blutfleck an Boden oder Gebäude. Ein tödlicher Aufprall oder eine Entführung über den Kartenrand reduziert die Bevölkerung um **genau einen Einwohner**. Befinden sich andere Bewohner oder eine Polizeiwache in Beobachtungsreichweite, sinkt zusätzlich die Zufriedenheit um **2 Punkte**; ohne Zeugen entfällt dieser Abzug. Die Sichtprüfung ist eine vereinfachte Reichweitenregel. Sichtbare Bewohner und Fahrzeuge bilden eine begrenzte Auswahl des Stadtlebens ab, keine vollständige Simulation jedes Einwohners und Arbeitswegs.

**Bauten rückgängig machen:** Bis zu **zehn erfolgreiche Bauaktionen** bleiben in der laufenden Stadtsitzung verfügbar, auch über Spielmonate und Änderungen an Einstellungen, Steuern, Budgets oder Krediten hinweg. Rückgängig entfernt die jeweilige Bauänderung und erstattet deren tatsächliche Kosten. Kalender, monatliche Einnahmen und Ausgaben, aktuelle Einstellungen und das übrige Stadtwachstum werden dabei nicht zurückgesetzt. Eine rückgängig gemachte Zone wird auch dann entfernt, wenn sie inzwischen bebaut wurde; beim Zurücknehmen einer Leitung bleibt die sonstige Bebauung erhalten. Wurden betroffene Felder inzwischen unvereinbar verändert, wird Rückgängig abgewiesen, statt den neueren Zustand zu überschreiben. Das Abholen einer Auftragsbelohnung oder das Auslösen einer Katastrophe leert den Bauverlauf.

**Katastrophen rückgängig machen:** Dafür gibt es einen getrennten Verlauf. Die zuletzt ausgelöste Katastrophe lässt sich nur vor dem nächsten Spielmonat oder einer anderen unvereinbaren Stadtänderung zurücknehmen. Pausiere vor dem Auslösen, wenn du Zeit zum Rückgängigmachen haben möchtest. Beide Verläufe gelten nur für die Sitzung und werden nicht im Spielstand gespeichert; Neuladen, Import oder eine neue Stadt beginnen mit leerem Verlauf.

## Wetter, Grafik und Katastrophen

Unter **Grafik & Beleuchtung** stehen **Flüssig**, **Ausgewogen** und **Sehr hoch** bereit. Die Profile regeln Auflösung, Schattendetails und Kantenglättung. Solide stilisierte Wohnhäuser, blaue Hochhäuser mit Manhattan-Silhouette und Fabriken mit Sägezahndächern prägen die Stadt. Eigene Gras- und Geländematerialien, Wasser, atmosphärischer Himmel und der Nebel am Regionsrand ergänzen die Landschaft. Die Grafik verwendet Three.js mit WebGL2, weichen stabilisierten Echtzeitschatten und Materialreflexionen des Himmels.

Der automatische **Tag-Nacht-Wechsel dauert etwa vier Minuten** bei laufender Stadt. Sonne, Mond und Schatten folgen der Tageszeit. Du kannst den Zyklus abschalten und eine feste Uhrzeit wählen. Die **Stadtbeleuchtung** schaltest du unabhängig davon über die **Glühbirne oben**, mit **L** oder im Grafikfenster ein und aus. Der Schalter steuert gemeinsam Gebäudefenster und Straßenlaternen. Versorgte Laternen besitzen warme Leuchtkörper und nachts sichtbare Lichtflächen auf der Straße; ohne Strom bleiben sie dunkel. **Regen** erzeugt nasse Oberflächen, Pfützen und Regentropfen.

Über **Stadtmenü → Stadt fotografieren** exportierst du die aktuelle Spielansicht als PNG. Große, dicht bebaute Regionen beanspruchen mehr Speicher und Rechenleistung; wähle bei Bedarf ein niedrigeres Grafikprofil. Eine bestimmte Bildrate wird nicht für alle Geräte zugesichert.

Unter **Stadtmenü → Katastrophen** aktivierst du den **Experimentiermodus**. Erst dann lassen sich **Großbrand, Erdbeben, Hochwasser und schwerer Sturm** absichtlich auslösen. Die Ereignisse beschädigen Gebäude, Straßen oder Versorgungsnetze. An brennenden Stellen sind animierte Flammen, warmer Lichtschein, aufsteigender Rauch und treibende Glutpartikel sichtbar. Tiefe Küstenflächen sind bei Hochwasser gefährdet; Feuer kann sich ausbreiten und wird durch versorgte Feuerwachen begrenzt. Räume Trümmer und repariere unterbrochene Leitungen, um die Stadt wieder zu versorgen.

## Spielstände und Assets

Die Stadt wird **alle 30 Sekunden**, nach Änderungen mit kurzer Verzögerung sowie beim Ausblenden der Seite automatisch gespeichert. Das Diskettensymbol oder **Cmd/Ctrl + S** speichert manuell. Warte vor dem Schließen auf die Speicherbestätigung; die letzte Speicherung beim Schließen allein ist nicht garantiert.

Große Spielstände liegen vorrangig in **IndexedDB**, mit lokalem Ersatzspeicher bei Bedarf. Es gibt einen aktiven Spielstand pro Browser und Serveradresse. **Die lokale Adresse auf Port 4173, eine Entwicklungsadresse und GitHub Pages haben getrennte Speicherorte. Spielstände werden nicht zu GitHub hochgeladen.** Nutze **Stadtmenü → Spielstand exportieren / importieren**, um Städte als JSON zu sichern oder zwischen Browsern, Geräten und Adressen zu übertragen. Für den Umzug ins Online-Spiel zuerst in der lokalen Stadt exportieren, dann unter der GitHub-Pages-Adresse importieren. Die Veröffentlichung allein überträgt keinen Spielstand. Ein Import oder eine neue Stadt ersetzt den aktiven Spielstand. Importdateien dürfen höchstens **12 MB** groß sein; ungültige Daten werden abgewiesen.

Alte **40 × 40-Spielstände** werden beim Laden auf **128 × 128 Felder** erweitert, wobei die bisherige Stadtbebauung erhalten bleibt. Der ursprüngliche v1-Browserstand wird nicht überschrieben. Lässt sich ein vorhandener Spielstand nicht lesen oder validieren, blockiert das Spiel automatisches Überschreiben und zeigt einen Hinweis. Das Löschen der Browserdaten entfernt auch lokale Städte und Sicherungen; JSON-Exporte bleiben deshalb für dauerhafte Backups sinnvoll.

Das Titelmotiv wurde mit ImageGen eigens für NEUSTADT erzeugt. Gebäude, Landschaft, Straßen, Fahrzeuge und Figuren verwenden eigene prozedurale Modelle und Materialien. Herkunft und Generierung sind in [ASSETS.md](ASSETS.md) dokumentiert. Schriftarten und Assets werden lokal ausgeliefert; externe Assetserver sind zur Laufzeit nicht erforderlich. Die MIT-Lizenz des Spiels sowie die Lizenztexte verwendeter Bibliotheken und Schriftarten liegen in [public/licenses/](public/licenses/).

NEUSTADT verwendet keine Originalgrafiken, Musik oder Spielstände von SimCity 2000. Es bildet zentrale Städtebaumechaniken mit eigener Simulation ab; vollständige Funktionsgleichheit mit dem historischen Original ist nicht Teil dieser Fassung.

## Open Source und Lizenz

NEUSTADT wird unter der [MIT-Lizenz](LICENSE) veröffentlicht: Copyright 2026 t3ramos. Die Lizenz gilt für den eigenen Spielcode, die prozeduralen Modelle und Materialien, die Dialogtexte und das eigene Titelmotiv, soweit daran Rechte bestehen. Externe Bibliotheken, Symbole und Schriftarten behalten ihre jeweiligen Lizenzen; die Hinweise unter [public/licenses/](public/licenses/) gehören auch zum ausgelieferten Spiel. Herkunft und Abgrenzung sind in [ASSETS.md](ASSETS.md) dokumentiert.

Fehlerberichte und Beiträge sind im [persönlichen GitHub-Repository](https://github.com/t3ramos/neustadt) willkommen. Beschreibe bei Fehlern die Schritte zum Nachstellen, Browser und Betriebssystem. Prüfe Änderungen mit `npm test` und `npm run build`; ergänze bei neuen sichtbaren Texten immer beide Sprachen. Veröffentliche persönliche Spielstände nur dann mit einem Bericht, wenn du sie ausdrücklich teilen möchtest.
