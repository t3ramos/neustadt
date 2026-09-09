# Neustadt v3.1.0 · A more varied city, more life on its streets

9 September 2026 · [Play](https://t3ramos.github.io/neustadt/) · [Versioned release](https://github.com/t3ramos/neustadt/releases/tag/v3.1.0)

## Deutsch

- **Ein neues Stadtbild:** fünf überarbeitete Wohnhausfamilien mit Dachrelief, tiefen Fenstern, Balkonen und Gärten; rundere Bürofassaden, markante Giebel und bepflanzte Terrassen. Weniger dünne, wiederholte Fassadenlinien und zusätzliche Kantenglättung beruhigen das Bild.
- **Bewohner mit mehr Charakter:** feinere Gesichter, Kleidung und bewegte Knie/Ellenbogen. Der violette Hut gehört nun zum kräftig roten Pullover mit schwarzem Doppeladler vorn und hinten. Skanderbeg reitet als stilisierte historische Hommage zu Pferd auf freien Wegen.
- **Stadtleben:** sichtbare Wege zur Arbeit, ins Wohnviertel und in den Park. Nachbarschaftstreff und Stadtfest laden bis zu 18 erreichbare Personen zu einem tatsächlich aufgebauten kleinen Veranstaltungsplatz ein. Die Personen bleiben bis zum Ende zusammen; Pause und Abbruch werden berücksichtigt.
- **Greifen, Schwingen, Loslassen:** kein Ziehen unter den Boden, kein Rücksprung zum Aufnahmeort. Schnelle Wurfbewegungen bleiben auch nach kurzem Stillhalten und winzigen letzten Mausbewegungen erhalten. Kamera mit WASD/Pfeiltasten und Zoom während des Festhaltens.
- **Präzisere Auswahl:** die gelbe Markierung folgt Gelände, Fundamenten und dem vollständigen Grundstück. Gedrehte und zusammengefasste Gebäude bleiben ihrem richtigen Grundstück zugeordnet; Kamerazentrierung und Hover reagieren auf Größen- und Perspektivwechsel.
- **Firmengebäude:** die weiße/anthrazitfarbene Originalfassade und Fensterordnung des bereitgestellten Modells bleiben erhalten. Nur die Dachterrasse erhält dezente Ergänzungen; keine erfundenen Bronzeprofile oder neue Fassadenachsen.

## English

Three.js advances from 0.183.2 to 0.186.0, retaining WebGL2 and the custom city simulation. Balanced/Ultra use SMAA alongside existing multisampling when supported. The 60-FPS cap stays intact; distant pedestrians switch to three lightweight shared silhouettes.

The update adds authored residential architecture, rounded and gabled commercial forms, richer shared facade surfaces, articulated resident detail, a red double-eagle sweater, and a single mounted historical tribute. The original office facade is preserved with restrained terrace additions.

City life adds time-of-day destinations and temporary park gatherings with real venue furniture. Interaction fixes cover ground-constrained carrying, robust release gestures, camera control while holding, actual-location placement, terrain-following selection and batched parcel picking.

## Compatibility and limits

Existing saves retain their format. Daily routines, invitations, temporary venues and the mounted tribute are visual/transient and do not introduce household economics or persistent character IDs. Export a backup before replacing a city or moving between local and hosted addresses.

The game still uses stylized procedural models, not photorealistic people or surveyed architecture. Larger overview scenes can fall below 60 FPS. The production build retains the existing large-chunk warning. See the [verification report](GRAPHICS-INTERACTION-UPGRADE.md) for checked scenarios and measurements.

The website ZIP contains only the compiled game, assets and license notices. Private Blender input, reference photographs, local saves and QA screenshots are not included.
