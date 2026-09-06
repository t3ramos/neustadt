# Original assets

## Neustadt cover

- Project path: `public/assets/neustadt-cover.png`
- Dimensions: 1536 × 1024 pixels, PNG.
- Intended use: welcome screen and game menu cover art.
- Created: 2026-09-05 using the built-in `image_gen.imagegen` tool (not the API/CLI fallback). The built-in tool does not expose a selectable or returned model name.
- Source: generated specifically for Neustadt and copied into `public/assets/neustadt-cover.png`.
- Original generated artwork. No external game assets or reference images were supplied.
- Visual QA: verified wide city composition, architecture, coast, water, lighting, no logos or text.

### Final generation prompt

```text
Use case: stylized-concept
Asset type: original game cover and welcome-panel key art, wide landscape 3:2 composition.
Primary request: a beautiful, premium three-dimensional miniature city on a lush green coastal island for an original city-building simulation called Neustadt. Do not render the game name.
Scene/backdrop: a turquoise-blue sheltered bay wrapping around a densely built but welcoming island, gentle ocean horizon and pale clear sky.
Subject: a thoughtfully planned small city with white and cream mid-rise apartment blocks, warm terracotta-roof villas, a few elegant deep navy glass high-rises at the civic center, clean branching roads, a coastal promenade, leafy rounded trees, small parks, tiny sailboats, a marina, and a bridge.
Style/medium: high-end real-time 3D architectural model aesthetic, tactile carefully crafted geometry, understated realistic materials, joyful sophisticated strategy-game art, crisp building detail with charming miniature scale.
Composition/framing: wide 1536x1024 landscape, elevated three-quarter isometric camera seeing the full island and its city, skyline rising near the center-right, water foreground with natural breathing room, coherent streets and believable zoning.
Lighting/mood: sunny late-summer morning, soft directional shadows, subtle ambient occlusion, inviting optimistic mood.
Color palette: sage green, warm cream, terracotta, slate navy, turquoise water, pale powder blue sky.
Constraints: completely original architecture and composition; no text, letters, logos, UI, brand references, watermark, photorealistic people closeups, existing game characters or copied copyrighted game assets.
```

## Prozedurale Spielassets · Aktueller Grafikstand

Die 3D-Spielassets sind eigener Projektcode. Sie werden beim Start aus Geometrie, Farben, Materialien und deterministischen Varianten aufgebaut; es werden keine Modelle oder Texturen aus SimCity 2000 übernommen.

- **Gebäude und Anlagen:** die ursprünglichen eigenen Wohnhäuser, Doppelhäuser, kompakten Mehrfamilienhäuser, blauen Gewerbehochhäuser mit Manhattan-Silhouette und Fabriken mit Sägezahndächern. Die großen zusammenhängenden Modelle für Kraftwerk, Wasserwerk, Polizei, Feuerwehr, Klinik, Schule, Universität, Recyclinghof, Stadion, Flughafen und Hafen bleiben erhalten. Stadionbetrieb, Flugbewegungen und weitere Anlagendetails besitzen eigene Animationen.
- **Gebäudestil und Fenster:** solide stilisierte Baukörper mit eigenen Fassaden, Dachdetails und opaken Fenstermaterialien. Fenster- und Gebäudelichter lassen sich unabhängig von der Tageszeit ein- und ausschalten. Die Modelle bilden auch die Grundlage der Kollisionsflächen für Bewohner und Fahrzeuge.
- **Landschaft und Straßen:** persistierte Geländehöhen, Küsten und Hügel, ein eigenes wiederholbares Grasmaterial mit Farb-, Normalen- und Rauheitskarten sowie höhenangepasste Straßen und Brücken. Die Materialkarten werden lokal erzeugt.
- **Licht und Wetter:** prozeduraler Himmel mit Sonne und Mond, Tag-Nacht-Beleuchtung, weiche stabilisierte Echtzeitschatten, Materialreflexionen der Himmelsumgebung, eigene Wasser- und Regenoberflächen, Pfützengeometrie und Regentropfen. Straßenlaternen besitzen eigene Leuchtkörper, weiche Lichtflächen auf dem Straßenbelag und eine begrenzte Zahl echter Lichtquellen in Kameranähe.
- **Fahrzeuge:** eigene Limousinen, Taxis mit Dachzeichen und Karoband, geschlossene Lieferwagen und sechsrädrige Pritschenlastwagen mit separater Kabine und Ladegut. Modellierte Details umfassen geformte Motorhauben, Dächer und Kotflügel, echte Radausschnitte, schräge Frontscheiben, profilierte Reifen, Felgen und Speichen, Spiegel, Scheibenwischer, Kühlergrill, Stoßfänger und Leuchten. Lack und opake Fenster verwenden eigene Materialeinstellungen. Auch die Boote sind eigene Modelle.
- **Bewohner:** maßstäblich kleine erwachsene Figuren mit gerundeten Köpfen, Gliedmaßen, Händen, Schuhen, Haaren und Rucksäcken, modellierten Gesichtsdetails und Varianten für Haut, Kleidung und Accessoires. Geh- und Aufstehanimationen, Gehweg- und Querungsrouting, Greifinteraktion und das kleine Handsymbol sind eigener Code. Die Gelenk- und Kollisionsphysik der Ragdolls verwendet `cannon-es`. Aufprallpartikel und Flecken werden prozedural erzeugt.
- **Dialoge:** über 450 eigene deutsche Textzeilen für Situationen und beobachtete Ereignisse. Themenauswahl, Sprechblasen und die Auswahl ohne erneute Verwendung einer Zeile vor dem Durchlaufen des jeweiligen Themenvorrats einer Figur werden lokal berechnet. Es werden dafür keine Sprachmodelle oder externen Dienste aufgerufen.
- **Tiere:** eigene kleine Katzen-, Hunde-, Reh- und Kaninchenmodelle aus gemeinsam genutzter Geometrie, mit passenden Proportionen, Laufbewegungen und Lebensräumen.
- **Bauinteraktion:** eigene Bauflächenvorschau, Konturen und Werkzeugmarkierungen. Interface-Symbole stammen aus Lucide; deren Lizenz ist separat enthalten.

Das Titelmotiv oben ist das vorhandene ImageGen-Asset. Für die Erweiterungen wurden die spielbaren Geometrien und Materialien im Code erstellt. Es wurden keine zusätzlichen Rasterbilder generiert.

## Bibliotheken und Schriftarten

Die aktuelle Echtzeitdarstellung verwendet **Three.js**. **cannon-es** liefert die Ragdoll-Physik. Die Oberfläche verwendet **Lucide**, **DM Sans** und **Manrope**. Diese Komponenten sind externe Bibliotheken bzw. Schriftarten; sie sind nicht als eigene Assets ausgewiesen.

Der frühere Raytracing-Modus gehört nicht mehr zum laufenden Spiel. **three-mesh-bvh**, **three-gpu-pathtracer** und der dort verwendete **glslSmartDeNoise**-Shader bleiben vorerst als historische Quell- bzw. Testabhängigkeiten samt Lizenztexten im Projekt erhalten; sie werden von der aktuellen Spielgrafik nicht verwendet.

Schriftdateien und alle zur Laufzeit benötigten Spielassets werden aus dem Projekt ausgeliefert. Die jeweiligen Lizenztexte befinden sich unter [`public/licenses/`](public/licenses/); Lizenzangaben der übrigen Entwicklungsabhängigkeiten liegen außerdem in den installierten Paketen. Der vollständige Abhängigkeitsstand ist in `package-lock.json` festgehalten.
