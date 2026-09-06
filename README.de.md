# Neustadt

**Ein 3D-Städtebauspiel mit lebendigen Straßen, wachsenden Vierteln und Landschaften zum Erkunden.**

[English](README.md) · **Deutsch**

[Im Browser spielen](https://t3ramos.github.io/neustadt/) · [Quellcode](https://github.com/t3ramos/neustadt) · [Releases](https://github.com/t3ramos/neustadt/releases) · [Veröffentlichung](docs/RELEASING.de.md)

Neustadt ist eine eigenständige Open-Source-Städtebausimulation von [t3ramos](https://github.com/t3ramos). Baue Straßen und Versorgungsnetze, gestalte das Gelände, finanziere öffentliche Dienste und entwickle eine Kleinstadt zur Metropole. Anschließend kannst du deine Stadt am Steuer eines ihrer Fahrzeuge aus Straßenhöhe erkunden. Das gesamte Spiel ist auf Deutsch und Englisch verfügbar.

Diese README beschreibt den Entwicklungsstand von v3.0.0. Veröffentlichung und abschließende Release-Prüfung stehen noch aus; die [Release-Notizen](docs/RELEASE-v3.0.0.md) halten den Status fest.

## Wähle deinen Einstieg

- **Kassel übernehmen:** Starte mit einer bewohnten, gestalteten Metropole auf 128 × 128 Feldern, mit Alleen, zentralem Park, Ufer, Versorgung, dichtem Stadtkern, mittelhohem Stadtgürtel und lockeren Vororten. Das Szenario ist eine stilisierte Stadt, keine geografisch genaue Nachbildung.
- **Eigene Stadt gründen:** Beginne auf einer unbebauten Region mit 128 × 128 Feldern, einer großzügigen ebenen Baufläche im Zentrum und Bergen an den äußeren Rändern. Ein numerischer oder textueller Seed erzeugt eine wiederholbare Landschaft.
- **Bestehende Stadt fortsetzen:** Kompatible Browser-Spielstände laden automatisch und pausiert. Bestehende Kartengrößen, einschließlich 40 × 40 und 128 × 128, bleiben unterstützt. Kleinere Regionen lassen sich direkt auf 128 × 128 erweitern.

Exportiere deine aktuelle Stadt, bevor du sie durch ein neues Szenario oder einen importierten Spielstand ersetzt.

## Baue eine funktionierende Stadt

Zeichne Straßen und weise Wohn-, Gewerbe- und Industriegebiete aus. Für alle drei Zonentypen wählst du über drei schwebende Schaltflächen niedrige, mittlere oder hohe Dichte. Die Gebäudestufen sind damit auf 1, 2 beziehungsweise 4 begrenzt; Nachfrage und Stadtaufstieg bestimmen weiterhin das Wachstum. Gebäude wachsen, wenn Nachfrage, Versorgung und Zufriedenheit es erlauben. Fünf Architekturvarianten je Gebäudetyp sorgen für abwechslungsreichere Viertel. Neben Einfeldhäusern entstehen größere Zonenbauten auf zwei, vier oder sechs Feldern. Zusammenhängende Grundstücke werden als ganzes Gebäude ausgewählt, versorgt und abgerissen. Gewerbe mittlerer Dichte besitzt fünf unterschiedliche Bürofamilien; Fenster auf allen vier Fassadenseiten entstehen im Wandmaterial ohne zusätzliche Fenstermeshes.

Straßen, Stromleitungen und Wasserrohre bilden getrennte Netze. Verbundene Zonenblöcke reichen Strom über gemeinsame Feldkanten weiter, auch durch noch unbebaute Zonen. Straßen und Lücken unterbrechen die Verbindung, sofern keine Stromleitung sie überbrückt. Wasserrohre versorgen nahe Grundstücke; Wasserwerke benötigen Strom. Prüfe mit den Strom- und Wasseransichten sowohl Verbindungen als auch Kapazität.

Sorge für Parks, Schulen, Kliniken, Polizei und Feuerwehr. Passe Steuern und Dienstbudgets an, verwalte Kredite und schalte mit dem Stadtwachstum Bahn, erneuerbare Energie, Recycling, Stadion, Hafen, Universität und Flughafen frei. Bauvorschau und Werkzeugleiste zeigen aktuelle Preise, Bauflächen, Voraussetzungen und Hindernisse direkt im Spiel.

Beim Straßenziehen sucht die Vorschau automatisch einen zusammenhängenden Weg um Zonen und belegte Gebäudegrundstücke. Gebaut wird die zuletzt angezeigte Route.

Hebe, senke oder ebne unbebautes Gelände für neue Bauplätze. Große Anlagen benötigen trockene, ebene Flächen und lassen sich mit **R** drehen. Geeignete angrenzende Straßen verbinden sich mit ihren Zufahrten und Höfen. Häfen brauchen zusätzlich ein passendes Ufer. Prüfe vor dem Bauen die gesamte Vorschau; Rechtsklick oder **Esc** bricht einen Entwurf ab.

Der Stadtaufstieg hat drei dauerhafte Stufen: Kleinstadt, Großstadt ab 5.000 und Metropole ab 15.000 Einwohnern. Vierzehn Aufträge und drei zeitlich begrenzte Challenges bieten zusätzliche Ziele. Das Stadtziel verlangt eine große, zufriedene, gesunde und gebildete Bevölkerung bei positiver Bilanz über einen zusammenhängenden Zeitraum. Danach geht es im freien Spiel weiter.

## Zeit, Wetter und Stadtleben

Die untere Leiste zeigt **Monat und Jahr**, beginnend mit **Januar 2000**, sowie den Fortschritt im Monat. Bei 1× dauert ein Monat 60 Simulationssekunden; zwölf Monate ergeben ein Jahr. Pause stoppt den Kalender, 2× und 3× beschleunigen ihn. Wirtschaft und Wachstum werden weiterhin alle fünf Simulationssekunden berechnet und behalten ihr bisheriges Tempo.

Haushaltsberichte zeigen **Monatsprognosen** aus den aktuellen Simulationsraten. Das sind Spielwerte in der bestehenden Spielwährung, keine realen Finanzprognosen. Der Tag-Nacht-Wechsel bleibt eine unabhängige Grafikeinstellung.

Seed-basierte Landschaften verbinden Berge, Täler, Küsten, Wälder und Felsgruppen auf einer endlichen Geländeplatte mit geschlossenen Seiten und Unterseite. Dynamisches Wetter wechselt zwischen klaren Phasen und GPU-berechnetem Regen über der gesamten Karte; Schauer blenden aus und Pfützen trocknen anschließend. Glas und nasse Oberflächen spiegeln die Himmelsumgebung. Sie bilden keine exakten Spiegelungen benachbarter Gebäude ab. Pfützen verwenden acht instanzierte Geometriegruppen, um den Renderaufwand zu begrenzen.

Bewohner laufen entlang der Straßen, nutzen markierte Querungen und kommentieren Umgebung, Wetter und Ereignisse. Es gibt **680 eigenständig formulierte Dialogzeilen je Sprache**, mit selteneren Sprechblasen und mehr Zeit zum Lesen. Detaillierte Figuren, Haustiere in Wohnvierteln und Wildtiere im Wald beleben die Stadt, ohne jeden einzelnen Einwohner zu simulieren. Bis zu 720 Fußgänger verteilen sich entlang bebauter Straßenfronten; außerhalb des Kamerabereichs wird ihre Darstellung ausgespart. Instanzierte Fahrzeugmodelle unterstützen bis zu 70 gewöhnliche Verkehrsautos, abhängig vom verfügbaren Straßennetz.

Autos folgen Fahrspuren, Ampeln, Kreuzungsfreigaben und Warteschlangen. Dienstfahrzeuge fahren über ihre Stationszufahrten ins Straßennetz. Wähle ein Fahrzeug und klicke auf sein Lenkradsymbol, um selbst zu fahren: **W/S** beschleunigt und fährt rückwärts, **A/D** lenkt, **Leertaste** betätigt die Handbremse und **Esc** beendet die Fahrt. Überlastete oder blockierte Straßen können weiterhin Staus verursachen.

Mit dem Greifwerkzeug lassen sich Bewohner anheben und mit Ragdoll-Physik werfen. Schwere Kollisionen und Stürze können zu Todesfällen und sichtbarem Blut führen; beobachtete Vorfälle beeinflussen die Zufriedenheit. Brand, Erdbeben und Sturm sind im optionalen Katastrophen-Experimentiermodus verfügbar. Nach einer Katastrophe pausiert die Stadt zum Ansehen. Vor dem Fortsetzen oder unvereinbaren Änderungen kann die Aktion rückgängig gemacht werden.

Ländliche Gewerbegrundstücke können Bauernhofarchitektur entwickeln; ihre ländliche Identität bleibt im Spielstand erhalten. Wiesen ergänzen Gras, Blumen und Steine. Geeignete Seen bieten drei Windsurfern und einem Ruderboot eine geprüfte Route auf dem Wasser. Ein platzierbarer Uferstrand schafft weitere Freizeitmöglichkeiten; Kassel erhält ihn nicht automatisch. Flughäfen besitzen fünf Layoutvarianten mit Flugrouten, die auf Freiraum gegenüber ihren Terminalbauten geprüft werden.

## Klang und Musik

Eine eigene, prozedural mit Web Audio erzeugte Musik begleitet Wind, Regen, Ufer, Verkehr, Flugzeuge und Stadtgeräusche. Motoren reagieren auf deine Fahrweise; räumliche Sirenen folgen fahrenden Einsatzfahrzeugen. Ein echter Klick oder Tastendruck schaltet die Wiedergabe frei. Die Audioeinstellungen bieten getrennte Regler für Gesamtlautstärke, Musik, Effekte und Umgebung sowie einen eigenen Musikschalter.

Audioeinstellungen werden im Browser getrennt von Stadtexporten gespeichert. Pause blendet Verkehrsgeräusche aus, während Musik und ortsfeste Umgebung weiterlaufen können; ein ausgeblendeter Tab wird stumm. Musik und Effekte verwenden keine externen Aufnahmen oder Streamingdienste.

## Ein architektonisches Easter Egg

Das Bürogebäude als Easter Egg entsteht beim vierten geeigneten Gewerbeneubau mittlerer Dichte, sofern sein Sechsfeldgrundstück und eine freie Vorderseite Platz finden. Es richtet sich zu einem begrünten Vorplatz und zur Straße aus. Pro Karte gibt es höchstens eines; das Kassel-Szenario enthält es bereits. Es basiert auf dem **linken Bürogebäude** der bereitgestellten Blender-Quelle, ergänzt dessen unfertige Fassaden und trägt den originalen Schriftzug hoch an der Vorderseite. Der Menüeintrag bleibt bis zur Entdeckung im Stadtmenü verborgen. Die isolierte Modellvorschau führt zurück in die bestehende Stadt.

Die [Easter-Egg-Assetdokumentation](public/assets/models/easter-egg-office-README.md) beschreibt Herkunft, Änderungen, technische Budgets und Reproduktion. Die ursprüngliche Quelldatei bleibt unverändert. Die Nutzung des Namens und Schriftzugs überträgt keine Markenrechte.

## Steuerung

| Eingabe | Funktion |
| --- | --- |
| Linksklick / links ziehen | Ausgewähltes Werkzeug anwenden |
| W A S D / Pfeiltasten | Kamera bewegen |
| M, dann links ziehen / mittlere Maustaste / Alt + links ziehen | Kamera verschieben |
| Rechts ziehen ohne Entwurf / Q und E | Kamera drehen |
| Mausrad | Zoomen |
| 1 / 2 / 3 / 4 / 5 | Straße / Wohnen / Gewerbe / Industrie / Park |
| B / V / C | Abreißen / auswählen / Bewohner greifen |
| R | Großes Gebäude drehen |
| Leertaste bei fokussierter Spielwelt | Pause / fortsetzen |
| G / N / H / L | Raster / Tag oder Nacht / Hilfe / Stadtbeleuchtung |
| Cmd/Strg + S | Speichern |
| Cmd/Strg + Z | Verfügbare Bau- oder Katastrophenaktion rückgängig machen |
| Esc | Entwurf abbrechen, Dialog schließen oder Fahrzeug verlassen |

Die Minikarte bewegt den Blick an eine Position; die Weltkugel zeigt die ganze Region und das Fadenkreuz die Innenstadt. In der Stadtverwaltung findest du Haushalt, Berichte, Wetter und Licht, Ziele, Katastrophen, Journal und Hilfe. Menüs unterstützen Tastaturbedienung, Scrollen in kleinen Fenstern und die Rückkehr zum vorherigen Fokus. Spielkürzel greifen nicht in Textfelder oder fokussierte Bedienelemente ein.

Bau-Undo behält bis zu zehn geeignete Aktionen der laufenden Sitzung und erstattet deren tatsächliche Kosten, ohne zwischenzeitliche Einnahmen oder unabhängiges Wachstum zurückzusetzen. Neue Städte, Importe und Neuladen leeren den Verlauf. Die Stadtfotofunktion exportiert die aktuelle Ansicht als PNG.

## Lokal starten

Benötigt werden Node.js **ab 20.19 innerhalb der 20er-Version oder ab 22.12**, npm und ein Desktop-Browser mit aktiviertem **WebGL2**.

```sh
npm ci
npm run build
npm run preview
```

Öffne [localhost:4399](http://127.0.0.1:4399/) und lasse das Terminal während des Spiels offen. Für Entwicklung mit automatischen Aktualisierungen:

```sh
npm run dev
```

Mit `npm run format` formatierst du Quellcode, Tests und Werkzeuge. Prüfe Änderungen vor dem Einreichen mit den folgenden Befehlen:

```sh
npm run format:check
npm run check:architecture
npm test
npm run build
```

Der Produktionsbuild liegt in `dist/` und kann über einen statischen HTTP- oder HTTPS-Server ausgeliefert werden. Schriftarten und Assets werden lokal mitgeliefert; im Spiel sind keine externen Assetserver nötig. Wähle ein niedrigeres Grafikprofil, wenn eine große Stadt zu anspruchsvoll wird. Die Leistung hängt von Gerät, Browser, Auflösung und Stadt ab; eine allgemeine Bildratenzusage gibt es nicht.

## Stadt speichern und übertragen

Die Stadt speichert regelmäßig automatisch, nach Änderungen und beim Ausblenden der Seite. Nutze zusätzlich den Speicherknopf oder **Cmd/Strg + S** und warte vor dem Schließen auf die Bestätigung. Spielstände liegen vorrangig in IndexedDB, bei Bedarf mit verfügbarem lokalem Ersatzspeicher.

Jeder Browser und jede Serveradresse besitzt eine eigene aktive Stadt. Lokale Vorschau, Entwicklungsserver und GitHub Pages haben deshalb getrennte Speicherorte. **Städte werden nicht auf GitHub hochgeladen.** Exportiere im Stadtmenü eine JSON-Datei und importiere sie am Ziel, um zwischen Adressen, Browsern oder Geräten zu wechseln. Ein Import ersetzt die aktive Stadt; die Dateigrenze beträgt 12 MB.

Spielstände im aktuellen Format behalten ihre Kartengröße, einschließlich 128 × 128 Feldern. Ursprüngliche v1-Spielstände werden auf 64 × 64 Felder migriert, damit größere Anlagen Platz finden. Unlesbare oder ungültige Daten blockieren automatisches Überschreiben. Das Löschen von Browserdaten entfernt lokale Städte; exportierte Dateien sind deshalb sinnvolle Backups.

## Mitwirken und Lizenzen

Neustadt verwendet TypeScript, Three.js, Vite und Cannon ES. Die [Architekturübersicht](docs/ARCHITECTURE.md) beschreibt Anwendung, Simulation, Speicherung, Rendering und Audio. Wirtschaftsschritte laufen in einem Web Worker; vorgemerkte Szenenänderungen teilen sich ein kooperatives Zeitbudget pro Frame. Die erste Szenenerzeugung bleibt synchron. Daraus folgt keine garantierte Bildrate. Fehlerberichte und Beiträge sind im [Repository](https://github.com/t3ramos/neustadt) willkommen. Nenne Schritte zum Nachstellen, Browser und Betriebssystem. Halte sichtbare Texte in beiden Sprachen verfügbar und füge Spielstände nur bei, wenn du sie teilen möchtest.

Das Spiel steht unter der [MIT-Lizenz](LICENSE), Copyright 2026 t3ramos. Externe Bibliotheken, Schriftarten und Symbole behalten ihre eigenen Lizenzen; mitgelieferte Hinweise liegen in [public/licenses](public/licenses/). Herkunft und Assetdetails stehen in [ASSETS.md](ASSETS.md) und der [Easter-Egg-Assetdokumentation](public/assets/models/easter-egg-office-README.md).

Neustadt ist von klassischen Städtebauspielen wie SimCity 2000 inspiriert. Es verwendet eine eigene Simulation und eigene Grafikassets, keine originalen SimCity-Grafiken, Musik oder Spielstände. Vollständige Funktionsgleichheit mit diesem Spiel wird nicht beansprucht.
