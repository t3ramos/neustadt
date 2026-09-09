# Neustadt

**A 3D city builder with living streets, growing neighborhoods, and landscapes worth exploring.**

**English** · [German](README.de.md)

[Play in your browser](https://t3ramos.github.io/neustadt/) · [Source](https://github.com/t3ramos/neustadt) · [Releases](https://github.com/t3ramos/neustadt/releases) · [Release guide](docs/RELEASING.md)

Neustadt is an independent, open-source city-building simulation by [t3ramos](https://github.com/t3ramos). Build roads and utilities, shape the terrain, balance public services, and guide a town into a metropolis. Then explore the result from street level by driving one of its vehicles. The German name means “new town”; the game is fully playable in English and German.

This README describes v3.1.0. See the [release notes](docs/RELEASE-v3.1.0.md) for the graphics and interaction update.

## Choose your starting point

- **Take over Kassel:** begin with a populated, authored metropolis on a 128 × 128 region, with avenues, a central park, waterfront, services, a dense downtown, a medium-rise belt, and lower-density suburbs. This is a stylized scenario rather than a geographic reconstruction.
- **Found your own city:** start on an undeveloped 128 × 128 region with a substantial, level central building area and mountains toward the outer edges. Enter a numeric or text seed to generate a repeatable landscape.
- **Continue an existing city:** compatible browser saves load automatically, paused. Existing map sizes, including 40 × 40 and 128 × 128, remain supported. Any smaller region can be expanded directly to 128 × 128.

Export your current city before replacing it with a new scenario or an imported save.

## Build a city that works

Draw roads and zone residential, commercial, and industrial land. All three zone types offer low, medium, and high density through three floating buttons. Their building-level caps are 1, 2, and 4 respectively; demand and city-stage requirements still govern growth. Buildings grow when demand, services, and happiness support them. Five architectural variants per building type make neighborhoods more varied; zoned development includes single-tile buildings and larger lots covering two, four, or six tiles. Larger lots are selected, supplied, and demolished as whole buildings. Medium-density commercial development has five distinct office families; windows cover all four facade sides through the wall material without additional window meshes.

Roads, power lines, and water pipes form separate networks. Connected zoned blocks share electricity through their tile edges, including undeveloped zones. Roads and gaps interrupt that connection unless you bridge them with a power line. Water pipes serve nearby lots, and waterworks need electricity. Use the Power and Water overlays to check both connections and capacity.

Provide parks, schools, clinics, police, and fire protection. Adjust taxes and service budgets, manage borrowing, and unlock railways, renewable energy, recycling, a stadium, a seaport, a university, and an airport as the city develops. Construction previews and the toolbar show current prices, footprints, requirements, and obstacles directly in the game.

Dragging roads automatically finds a connected route around zoned areas and occupied buildings. The final preview is the route that gets built.

Raise, lower, or level undeveloped terrain to prepare building sites. Large facilities need dry, level space; rotate them with **R**. Suitable adjacent roads connect to their driveways and yards. Ports also need a waterfront. Building previews let you inspect the full footprint before committing; right-click or **Esc** cancels a draft.

The progression system has three permanent stages: Small Town, City at 5,000 residents, and Metropolis at 15,000. Fourteen quests and three timed challenges offer additional objectives. The city-wide goal asks you to sustain a large, happy, healthy, educated population with a positive balance; reaching it unlocks continued free play.

## Time, weather, and city life

The bottom bar shows the current **month and year**, starting in **January 2000**, with progress through the month. At 1×, one month takes 60 simulation seconds; twelve months make a year. Pause stops the calendar, and 2×/3× accelerate it. Economic and growth updates still run every five simulation seconds, preserving the established pace.

Budget reports show **monthly projections** based on the current simulation rates. These are game-economy values in the existing in-game currency, not real-world financial forecasts. The day–night cycle is an independent visual setting.

Seeded landscapes combine mountains, valleys, coasts, forests, and rock groups on a finite terrain slab with closed sides and underside. Dynamic weather alternates clear periods and rain, with GPU-driven rainfall across the map; showers fade and puddles dry afterward. Glass and wet surfaces reflect the sky environment. They do not provide accurate reflections of nearby buildings. Puddles use eight instanced geometry batches to limit rendering overhead.

Residents walk along streets, cross at marked crossings, and comment on their surroundings, weather, and events. There are **680 authored dialogue lines in each language**, with less frequent speech and more time to read each bubble. Detailed figures, neighborhood pets, and woodland wildlife add activity without simulating every resident individually. Up to 720 pedestrians populate developed street frontages, with off-camera rendering culled. Instanced vehicle graphics support up to 70 ordinary traffic cars, subject to available roads.

The **City life / Stadtleben** button beside the lighting controls opens daily routine counts and sandbox invitations. Visible pedestrians seek actual workplace frontages from 07:00–16:00, parks from 16:00–20:00, and residential frontages at other hours. They dwell at their destination and then stroll; this is a visual street-life system, not a simulation of every household or job. A neighborhood gathering or city festival invites up to 18 reachable nearby pedestrians to an existing park. Invitations last 90/150 walking seconds, followed by a 20-second cooldown. Events, routines and timers pause with the simulation or an open modal. These free actions do not award money or modify the save schema.

Cars follow lanes, traffic lights, junction reservations, and queues. Service vehicles use station driveways to join the road network. Select a vehicle and click its steering-wheel button to drive it; **W/S** accelerate and reverse, **A/D** steer, **Space** applies the handbrake, and **Esc** returns to city building. Traffic can still become congested when roads are overloaded or blocked.

The resident-grab tool supports lifting and throwing people with ragdoll physics. Serious collisions and falls can cause deaths and visible blood; witnessed incidents affect city happiness. Fire, earthquakes, and storms are available through the optional disaster experiment mode. Disaster actions pause the simulation for inspection and can be undone before continuing or making incompatible changes.

Carried residents remain above the local ground. Gentle placement and releasing over the interface preserve the current position; a real flick preserves recent hand momentum. Cancel safely places the resident at their current location. Unsafe roof/water placements still resolve to a nearby safe sidewalk.

The graphics upgrade uses Three.js r186 with WebGL2, detailed residential families, rounded and gabled commercial silhouettes, richer facade materials, and restrained office rooftop detailing while preserving the original facade. Balanced/Ultra profiles combine MSAA and SMAA where the framebuffer supports it; Performance retains direct rendering. Small distant pedestrians use shared simplified silhouettes while hovered and physical actors retain full detail. The 60-FPS rendering cap remains in place. See [graphics and interaction verification](docs/GRAPHICS-INTERACTION-UPGRADE.md) for scope, checks and local inspection pages.

Gatherings and festivals build temporary canopies, tables, stalls or a stage beside a suitable park path; they need actual free space and never cover roads. Attendees remain together until the event ends. A purple-hatted resident wears a red sweater with a black double-headed eagle on its front and back. A single stylized Skanderbeg on horseback rides existing clear pedestrian routes; he is a visual historical tribute, not a saved character or quest. While holding a resident, **WASD/arrows** move the camera and the mouse wheel zooms without turning camera movement into a throw.

Rural commercial lots can develop farmhouse-style architecture, and their rural identity persists in saves. Meadows add grass, flowers, and stones. Suitable lakes support three windsurfers and a rowing boat on a checked water route. A placeable shoreline beach adds another recreation option; Kassel does not start with one automatically. Airports have five layout variants, with aircraft routes checked for clearance from their terminal structures.

## Sound and music

An original, procedurally generated Web Audio score accompanies wind, rain, waterfront ambience, traffic, aircraft, and city sounds. Engines respond to your driving; spatial sirens follow moving emergency vehicles. Playback unlocks after a real click or keypress. Sound controls provide independent master, music, effects, and ambience levels, plus a separate music toggle.

Audio preferences are saved in the browser, separately from city exports. Pausing fades transport sounds while music and stationary ambience can continue; hiding the tab mutes audio. The soundtrack and effects use no external recordings or streaming service.

## A small architectural Easter egg

An office-building Easter Egg appears at the fourth qualifying medium-density commercial opening, provided its six-tile lot and clear frontage fit. It faces a landscaped forecourt and street. At most one exists on a map, and the Kassel scenario includes it. It adapts the **left office building** from the supplied Blender source, completes its unfinished elevations, and places the original wordmark high on the front facade. Its menu entry is hidden until discovered in the city menu. The isolated model preview returns to the existing city.

See the [Easter Egg asset notes](public/assets/models/easter-egg-office-README.md) for source identity, modifications, technical budgets, and reproduction details. The original source remains unchanged. Inclusion of the original wordmark does not grant trademark rights.

## Controls

| Input                                             | Action                                              |
| ------------------------------------------------- | --------------------------------------------------- |
| Left click / drag                                 | Apply the selected tool                             |
| W A S D / arrow keys                              | Move the camera                                     |
| M, then left drag / middle drag / Alt + left drag | Pan                                                 |
| Right drag without a draft / Q and E              | Rotate the camera                                   |
| Mouse wheel                                       | Zoom                                                |
| 1 / 2 / 3 / 4 / 5                                 | Road / residential / commercial / industrial / park |
| B / V / C                                         | Demolish / select / grab resident                   |
| R                                                 | Rotate a large building                             |
| Space with the world focused                      | Pause / resume                                      |
| G / N / H / L                                     | Grid / day or night / help / city lights            |
| Cmd/Ctrl + S                                      | Save                                                |
| Cmd/Ctrl + Z                                      | Undo an available construction or disaster action   |
| Esc                                               | Cancel a draft, close a dialog, or leave a vehicle  |

The minimap moves the camera to a location; the globe frames the region and the crosshair returns to the city center. The city sidebar contains budgets, reports, weather and lighting, goals, disasters, the journal, and help. Menus support keyboard navigation, scrolling in smaller windows, and focus restoration. Game shortcuts leave text fields and focused controls alone.

Construction undo keeps up to ten eligible actions in the current session and refunds their actual costs without reversing elapsed income or unrelated growth. New cities, imports, and reloads clear the session history. A city photo command exports the current view as PNG.

## Run locally

Use Node.js **20.19+ on the Node 20 line, or 22.12+**, npm, and a desktop browser with **WebGL2** enabled.

```sh
npm ci
npm run build
npm run preview
```

Open [localhost:4399](http://127.0.0.1:4399/). Keep the terminal running while you play. For development with live updates:

```sh
npm run dev
```

Use `npm run format` to format maintained source, tests, and tooling. Run the checks and production build before submitting a change:

```sh
npm run format:check
npm run check:architecture
npm test
npm run build
```

The production build is in `dist/` and can be served over HTTP or HTTPS by a static web server. Fonts and assets ship locally; no external asset server is needed during play. Choose a lower graphics profile if a large city is too demanding. Performance depends on the device, browser, resolution, and city; there is no universal frame-rate guarantee.

## Save and move your city

Autosave runs periodically, after edits, and when the page becomes hidden. Use the save button or **Cmd/Ctrl + S** and wait for confirmation before closing. Saves primarily use IndexedDB, with local fallback storage when available.

Each browser and server address has its own active city. Local preview, development, and GitHub Pages therefore use separate storage. **Cities are not uploaded to GitHub.** Export a JSON save from the city menu and import it at the destination to move between addresses, browsers, or devices. Import replaces the active city; the size limit is 12 MB.

Current-format saves retain their map dimensions, including 128 × 128 regions. Original v1 saves migrate to a 64 × 64 region to accommodate larger facilities. Unreadable or invalid saved data blocks automatic overwriting. Clearing browser data removes local cities, so exported files remain useful backups.

## Contributing and licenses

Neustadt uses TypeScript, Three.js, Vite, and Cannon ES. The [architecture guide](docs/ARCHITECTURE.md) maps application, simulation, persistence, rendering, and audio modules. Economic steps run in a Web Worker, while queued scene updates share a cooperative frame budget. Initial scene creation remains synchronous; these changes do not guarantee a fixed frame rate. Bug reports and contributions are welcome in the [repository](https://github.com/t3ramos/neustadt). Include reproduction steps, browser, and operating system. Keep visible text available in both languages, and only attach a city export if you intend to share it.

The game is released under the [MIT license](LICENSE), copyright 2026 t3ramos. Third-party libraries, fonts, and icons retain their own licenses; distributed notices are in [public/licenses](public/licenses/). See [ASSETS.md](ASSETS.md) and the [Easter Egg asset notes](public/assets/models/easter-egg-office-README.md) for provenance and asset-specific details.

Neustadt draws inspiration from classic city builders such as SimCity 2000. It uses its own simulation and visual assets, without original SimCity graphics, music, or save files, and does not claim full feature parity with that game.
