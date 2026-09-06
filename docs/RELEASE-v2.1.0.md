# Neustadt v2.1.0

## English

Neustadt becomes an open-source city builder under the personal [t3ramos/neustadt](https://github.com/t3ramos/neustadt) repository, with the original game source and assets available under the MIT License. Third-party libraries, fonts, and icons retain their own licenses.

- **Cleaner electricity connections:** a connected residential, commercial, or industrial block shares its power supply. Ordinary zoned buildings, including their high-rises, no longer receive individual overhead service cables. Undeveloped zoned tiles also carry the block's supply.
- **Dedicated connections for large facilities:** visible service cables are limited to multi-tile facilities and end at their lot boundary. They must not cross a roadway or another building; opposite sides of a street need an explicitly connected network.
- **Complete English and German:** switch language during play without resetting the city. Menus, tools, help, notifications, quests, challenges, and all 494 NPC dialogue lines are available in both languages. The language preference is saved locally; custom city names are preserved.
- **Public GitHub Pages hosting:** play in your browser at [t3ramos.github.io/neustadt](https://t3ramos.github.io/neustadt/). The GitHub Actions workflow validates, builds, and deploys the static game. English and German documentation includes local-to-online save transfer.
- **A ready-to-play first visit:** the game creates a small starter town automatically. The new-city menu lets you start a fresh prepared town or an empty region; export your current city first to keep it.
- **Animated fire:** burning sites have moving flames, a warm glow, rising smoke, and drifting embers.

Regions up to 128 × 128 tiles, terrain editing, three development stages, quests and challenges, driving and collisions, handbrake drifting, residents, animals, weather, and switchable building and street lighting remain part of the game.

The website ZIP contains the compiled static game, the MIT `LICENSE`, and third-party license notices. The bundled `licenses/neustadt.txt` also reproduces the game’s MIT license. It needs an HTTP/HTTPS server and a desktop browser with WebGL2. Saves remain in your browser and are not uploaded to GitHub. Export your city from the local game and import it online to continue playing there.

Validation for this release includes automated tests, TypeScript checking, a production build, and browser verification. See the release publication and Actions run for the completed checks and hosted-game status.

## Deutsch

Neustadt wird zum Open-Source-Städtebauspiel im persönlichen Repository [t3ramos/neustadt](https://github.com/t3ramos/neustadt). Eigener Spielcode und eigene Assets stehen unter der MIT-Lizenz. Drittanbieter-Bibliotheken, Schriftarten und Symbole behalten ihre jeweiligen Lizenzen.

- **Weniger Kabel im Stadtbild:** Ein zusammenhängender Wohn-, Gewerbe- oder Industrieblock teilt sich seine Stromversorgung. Normale Zonenhäuser einschließlich ihrer Hochhäuser erhalten keine einzelnen Freileitungen mehr. Auch noch unbebaute ausgewiesene Grundstücke leiten den Strom im Block weiter.
- **Eigene Anschlüsse für große Anlagen:** Sichtbare Anschlusskabel bleiben auf Anlagen mit mehrteiliger Baufläche beschränkt und enden an ihrer Grundstücksgrenze. Sie dürfen weder eine Fahrbahn noch ein anderes Gebäude kreuzen; die gegenüberliegende Straßenseite benötigt ein ausdrücklich verbundenes Netz.
- **Vollständig Deutsch und Englisch:** Die Sprache lässt sich während des Spiels ohne Neustart der Stadt wechseln. Menüs, Werkzeuge, Hilfe, Meldungen, Aufträge, Challenges und alle 494 NPC-Sprüche sind zweisprachig verfügbar. Die Sprachwahl wird lokal gespeichert; eigene Stadtnamen bleiben erhalten.
- **Öffentliches Hosting auf GitHub Pages:** Spiele im Browser unter [t3ramos.github.io/neustadt](https://t3ramos.github.io/neustadt/). Der GitHub-Actions-Workflow prüft, baut und veröffentlicht das statische Spiel. Die deutsche und englische Dokumentation erklärt auch den Spielstandumzug von lokal nach online.
- **Direkt spielbarer erster Besuch:** Das Spiel erstellt automatisch eine kleine Starterstadt. Im Neue-Stadt-Menü kannst du eine frische vorbereitete Kleinstadt oder eine leere Region beginnen; exportiere deine bisherige Stadt vorher, um sie zu behalten.
- **Animiertes Feuer:** An brennenden Stellen bewegen sich Flammen, warmer Lichtschein, aufsteigender Rauch und treibende Glutpartikel.

Regionen bis 128 × 128 Felder, Terraforming, drei Ausbaustufen, Aufträge und Challenges, Autofahren und Kollisionen, Handbremsdrift, Bewohner, Tiere, Wetter sowie schaltbare Gebäude- und Straßenbeleuchtung bleiben enthalten.

Das Website-ZIP enthält das kompilierte statische Spiel, die MIT-Datei `LICENSE` und Drittanbieter-Lizenztexte. Die mitgelieferte Datei `licenses/neustadt.txt` enthält die MIT-Lizenz des Spiels zusätzlich. Es benötigt einen HTTP-/HTTPS-Server und einen Desktop-Browser mit WebGL2. Spielstände bleiben im Browser und werden nicht zu GitHub hochgeladen. Exportiere die Stadt im lokalen Spiel und importiere sie online, um dort weiterzuspielen.

Die Release-Prüfung umfasst automatisierte Tests, TypeScript-Prüfung, Produktionsbuild und Browserprüfung. Die Release-Veröffentlichung und der Actions-Lauf dokumentieren die abgeschlossenen Prüfungen und den Status des gehosteten Spiels.
