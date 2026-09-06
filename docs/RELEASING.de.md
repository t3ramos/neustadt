# Releases und Hosting

[English](RELEASING.md) · **Deutsch** · [Spielanleitung](../README.de.md)

Das Open-Source-Repository [t3ramos/neustadt](https://github.com/t3ramos/neustadt) gehört dem persönlichen Konto **t3ramos**. Eigener Quellcode und eigene Assets stehen unter der [MIT-Lizenz](../LICENSE); Drittanbieter-Komponenten behalten ihre in [ASSETS.md](../ASSETS.md) dokumentierten Lizenzen.

## Prüfung und Webpaket

```sh
npm ci
npm test
npm run build -- --outDir dist-release
cp LICENSE dist-release/LICENSE
```

Verwende für jedes Release ein sauberes Ausgabeverzeichnis. `dist-release/` ist ein statischer Website-Build. Relative Asset-Pfade unterstützen sowohl das Root einer Domain als auch einen Projektpfad wie `/neustadt/`. Die Dateien müssen über HTTP oder HTTPS ausgeliefert werden; direktes Öffnen von `index.html` per `file://` wird nicht unterstützt.

Verpacke ausschließlich den Inhalt dieses frischen Builds; `index.html`, `LICENSE`, `assets/` und `licenses/` liegen direkt im ZIP. `licenses/neustadt.txt` enthält außerdem die identische MIT-Lizenz des Spiels; die übrigen Dateien bewahren die Drittanbieter-Lizenztexte. Lokale QA-Ausgaben, persönliche Spielstände, Browseraufnahmen, `node_modules/` und ältere Builds gehören weder ins Repository noch ins Webpaket. Das Quellcode-Repository enthält Spielcode und Tests; das Website-ZIP enthält das kompilierte Browserspiel, die MIT-Lizenz des Spiels und die mitgelieferten Drittanbieter-Lizenztexte.

Der Workflow **Test and build** installiert die gesperrten Abhängigkeiten, führt Tests und TypeScript-Prüfung aus, baut das Spiel und lädt bei geeigneten Läufen ein Pages-Website-Artefakt hoch. Pull Requests durchlaufen dieselben Prüfungen, ohne die Website zu veröffentlichen. Der Release-Tag muss zur Version in `package.json` passen, beispielsweise `v2.1.0`. Füge das frische Website-ZIP mit den zugehörigen Release-Notizen hinzu.

## GitHub Pages

Im Browser spielen: **[t3ramos.github.io/neustadt](https://t3ramos.github.io/neustadt/)**. Repository und Website sind öffentlich; das Tarifupgrade für Pages aus einem privaten Repository wird damit nicht benötigt. GitHub Pages ist bei öffentlichen Repositories mit GitHub Free verfügbar, innerhalb der Nutzungsgrenzen des Dienstes. Siehe [GitHubs Pages-Dokumentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Einrichtung des Repositories:

1. Unter **Settings → Pages** als Quelle für Build und Deployment **GitHub Actions** wählen.
2. Die Actions-Repository-Variable **PAGES_ENABLED** auf `true` setzen.
3. **Test and build** auf `main` starten oder die fertigen Änderungen nach `main` pushen.
4. Die erfolgreiche Veröffentlichung in der Umgebung `github-pages` prüfen und die Spieladresse öffnen.

Der Deployment-Job läuft nach erfolgreichem Build ausschließlich für `main`, wenn `PAGES_ENABLED` auf `true` steht. Pull Requests und Versions-Tags veröffentlichen die Website nicht selbstständig. Der Wert `false` oder das Entfernen der Variable stoppt künftige automatische Deployments; eine bereits veröffentlichte Website wird dadurch nicht entfernt.

Vor der Release-Ankündigung die tatsächlich gehostete Adresse, Asset-Pfade unter `/neustadt/`, Sprachwechsel sowie Spielstand-Export und -Import prüfen. Ein erfolgreicher lokaler Build oder ein hochgeladenes Artefakt bestätigt allein noch keine laufende Pages-Website. Das Repository bleibt bei aktivem Pages öffentlich, sodass sowohl Originalquellcode als auch Browserbuild öffentlich zugänglich sind.

## Spielstände

Spielstände bleiben im Browser der Spieler und werden nicht zu GitHub hochgeladen. Eine lokale Stadt erscheint nicht automatisch unter der Online-Adresse. So überträgst du sie:

1. Das lokale Spiel im Browserprofil öffnen, in dem die Stadt gespeichert ist.
2. **Stadtmenü → Spielstand exportieren** auswählen und die heruntergeladene JSON-Datei aufbewahren.
3. Das gehostete Spiel öffnen und die Datei über **Stadtmenü → Spielstand importieren** auswählen.

Der Import ersetzt die aktive Stadt am Ziel. Der bisherige lokale Spielstand bleibt der lokalen Adresse zugeordnet. Auch beim Wechsel von Domain, Browserprofil oder Gerät ist Export/Import erforderlich. Vor dem Löschen von Browserdaten JSON-Sicherungen aufbewahren.
