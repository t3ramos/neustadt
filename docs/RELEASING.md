# Releases und Hosting

Das Quellcode-Repository ist privat unter `t3ramos/neustadt`. Es gehört dem persönlichen Konto t3ramos.

## Prüfung und Webpaket

```sh
npm ci
npm test
npm run build -- --outDir dist-release
```

`dist-release/` ist ein frischer statischer Build. Er funktioniert sowohl am Root einer Domain als auch unter einem Projektpfad wie `/neustadt/`. Die Dateien müssen über HTTP beziehungsweise HTTPS ausgeliefert werden. Direktes Öffnen per `file://` wird nicht unterstützt.

Für ein Release wird ausschließlich der Inhalt dieses frischen Builds verpackt. `output/`, persönliche Spielstände, Browseraufnahmen, `node_modules/` und ältere Builds gehören weder ins Repository noch ins Webpaket. `public/licenses/` wird mitgeliefert.

Der Workflow **Test and build** installiert die gesperrten Abhängigkeiten, führt die Tests aus und erstellt einen Pages-kompatiblen Website-Artefakt. Releases werden mit einer zur `package.json` passenden Version markiert, beispielsweise `v2.0.0`.

## GitHub Pages

GitHub Pages aus einem privaten persönlichen Repository benötigt einen unterstützten Tarif, beispielsweise GitHub Pro. Am 6. September 2026 lehnte GitHub die Aktivierung für dieses Repository mit einem Tarifhinweis ab. Das Repository bleibt privat.

Sobald der Tarif Pages aus diesem Repository unterstützt:

1. Unter **Settings → Pages** als Quelle **GitHub Actions** aktivieren.
2. Die Repository-Variable **PAGES_ENABLED** auf `true` setzen.
3. Den Workflow **Test and build** auf `main` manuell starten.

Die Projektadresse ist dann `https://t3ramos.github.io/neustadt/`. Der ausgelieferte Webauftritt ist öffentlich; das Repository bleibt privat.

Alternativ kann nach ausdrücklicher Freigabe ein separates öffentliches Repository ausschließlich den fertigen Webbuild ausliefern. Dieses enthält keine ursprünglichen TypeScript-Dateien, Tests, persönlichen Spielstände oder private Repository-Historie. Wie bei jeder Browseranwendung bleiben die ausgelieferten JavaScript-Dateien öffentlich abrufbar.

## Spielstände

Spielstände liegen im jeweiligen Browser und werden nicht zu GitHub hochgeladen. Ein lokaler Spielstand wandert nicht automatisch zur Online-Adresse: zuerst im lokalen Stadtmenü exportieren, anschließend online importieren. Auch beim Wechsel der Domain oder des Browserprofils ist Export/Import erforderlich.
