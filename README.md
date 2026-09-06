# NEUSTADT · Regions & City Life

**English** · [Deutsch](README.de.md)

An open-source game by [t3ramos](https://github.com/t3ramos). [Source code](https://github.com/t3ramos/neustadt) · [Releases](https://github.com/t3ramos/neustadt/releases) · [Releases and hosting](docs/RELEASING.md). Play in your browser: [t3ramos.github.io/neustadt](https://t3ramos.github.io/neustadt/).

A playable 3D city-building simulation with original graphics, large regions, and a city-wide goal. Develop hilly land, build utility networks, grow a small town **through three stages into a metropolis**, and explore its streets behind the wheel. NEUSTADT is an independent game inspired by classic city builders such as SimCity 2000.

## Getting started

The complete game is available in **English and German**. Change language while playing; your choice is saved in the browser. Menus, building tools, help, notifications, quests, challenges, and all **494 NPC dialogue lines** are available in both languages. Changing language does not reset your city, and custom city names stay as you entered them.

On macOS, double-click **[Neustadt starten.command](<Neustadt starten.command>)**. The launcher builds the current production version and opens **[NEUSTADT on port 4173](http://127.0.0.1:4173/)**. It also updates an already running version and preserves the files needed by game windows that remain open. Reload the game to see the update. Keep the server's terminal window open.

You need **Node.js 20.19 or later on the Node 20 line, or Node.js 22.12 or later**, npm, and a desktop browser with **WebGL2** enabled. To start manually:

```sh
npm ci
npm run build
npm run preview -- --port 4173 --strictPort
```

For development with automatic updates:

```sh
npm run dev
```

Open the address printed in the terminal. The production build is in `dist/` and can be served by a static web server. Run the automated checks for simulation, construction, saves, and other game systems with:

```sh
npm test
```

An existing save opens automatically with the simulation paused. On your first visit, the game already creates **Lindenbucht**, a small playable starter town, so you can explore and build straight away. Use **City menu → New city** to choose **Begin with a starter city** for a fresh ready-made town or **Begin on open land** for an empty region. You can also set the name, terrain seed, and region size: **64 × 64**, **96 × 96**, or **128 × 128 tiles**. Starting either option replaces the active save, so export your current city first if you want to keep it. The default is 128 × 128: **16,384 tiles, more than ten times the area of the original 40-tile map**. Both the starter town and an undeveloped region begin with **€85,000**.

## Construction and utilities

1. **Draw roads.** Lots need a road within two tiles. Roads follow the terrain, and roads over water become bridges. The preview shows the footprint, cost, and obstacles before you release the mouse.
2. **Connect power and water.** Roads, electricity, and water pipes are separate networks. Connect the power plant with power lines and the waterworks with pipes. **One power connection serves a connected block:** residential, commercial, and industrial zones sharing tile edges pass electricity to each other, including zoned lots that have not developed yet. Ordinary zoned buildings need no individual overhead cables or service connections, including their high-rises. Roads and open gaps separate blocks unless you explicitly connect them with power lines. Only large facilities with multi-tile footprints can receive a visible dedicated service cable. It terminates at the lot boundary on the same side of the street and must not cross the roadway or another building. Water pipes supply lots within two tiles; the waterworks itself needs power. Explicitly placed utility lines can run beneath roads and buildings, with visible electricity poles in open land. Use the **Power** and **Water** overlays to check coverage.
3. **Zone land.** For residential, commercial, or industrial zones, drag from one corner to the opposite corner to select a rectangle. Both corner tiles are included, and you can drag in any direction. Moving back toward the starting corner shrinks the area and its cost before you release. Housing attracts residents; commerce and industry provide jobs. Buildings develop automatically when demand, utilities, and happiness are sufficient. Missing utilities can cause them to shrink. Houses, apartments, shops, high-rises, and factories show the city's growth.
4. **Support quality of life.** Parks, police, fire stations, clinics, and education facilities serve their surroundings. Industry and fossil-fuel power plants pollute nearby lots. City services need roads, power, and water; their budgets determine their effectiveness.
5. **Balance the budget.** Taxes affect income and happiness. Police, fire, health, and education have separate budgets. Borrow and repay in €10,000 steps, up to €50,000 of debt. Interest is included in the running balance.

Basic utilities provide **6,000 power units per power plant** and **6,000 water units per supplied waterworks**. Later, wind farms provide 1,200 and solar farms 3,200 power units. Check capacity as well as continuous connections: a disconnected network is not supplied by a plant elsewhere on the map.

**Review before building:** the floating preview shows the current area, dimensions, cost, and placement warnings and stays within the visible window. Release over the game world to build. **Right-click or Esc** cancels an unfinished draft while keeping the current tool selected; use **V** or **Select** when you want to inspect lots instead. Releasing over a menu or control panel, outside the playable world, or after an interrupted pointer interaction cancels the draft. Opening a dialog also cancels an unfinished draft.

The bottom bar shows **elapsed simulation time** instead of a fast-forwarding calendar. Income, costs, and balance are shown **per simulation minute**; 1× follows elapsed seconds, while **2×** and **3×** accelerate the simulation. The independent day–night cycle controls the scenery. The existing economic and growth pacing is preserved. Dialogs and a hidden browser tab pause the economic simulation.

### Terrain and large facilities

Use **Terrain** tools to raise or lower undeveloped land in **5-meter steps**. **Level** uses the height of the first clicked tile for the area you edit. The cost is **€35 per tile for each 5-meter change**. Lowering land below sea level creates water; raising it creates land. Clear developed tiles before changing their height.

Public facilities are **single buildings occupying continuous footprints**. They need an empty, dry, level site. Press **R** to rotate the building and footprint. Demolition removes the entire facility.

**Driveways and yards:** all 13 large facility types support paved access from an adjacent road, including rotated placements. Usable sites have a continuous driveway and ramp into the forecourt or parking area, with the same surface used for the visible pavement and vehicle wheels. Roads may meet the front, side, or rear; the route stays within the existing lot and does not move saved buildings or neighboring tiles. Put a road directly beside the lot and keep a manageable height difference. Industrial buildings have a smaller loading apron; if the road is too steep for a usable ramp, the site is not treated as having a drivable entrance.

| Facility | Footprint | Construction | Operation / simulation minute |
| --- | ---: | ---: | ---: |
| Power plant | 4 × 4 | €6,500 | €3,840 |
| Waterworks | 2 × 2 | €2,200 | €2,160 |
| Police station | 2 × 2 | €1,900 | €1,500 |
| Fire station | 3 × 2 | €1,600 | €1,140 |
| Clinic | 3 × 3 | €3,200 | €1,800 |
| School | 3 × 2 | €1,800 | €1,200 |
| Stadium | 6 × 5 | €9,000 | €2,160 |
| Seaport | 5 × 3 | €9,500 | €1,920 |
| University | 5 × 4 | €12,000 | €3,360 |
| Airport | 10 × 6 | €16,000 | €3,480 |

Prices are **per facility**; service operating costs assume a 100% budget. A seaport needs at least **two tiles along its quay directly beside water**; press R to rotate the waterfront. The stadium, airport, and seaport have their own details and animations.

Roads cost €18 per tile, water pipes €8, and power lines €12. Roads and railways over water cost an extra €90 per tile; underwater utility lines cost an extra €12. Clearing a tree while building costs €2. The toolbar also lists prices, footprints, and unlock requirements.

## Three development stages, quests, and the city goal

Open **City development** using the flag or the city menu. Population determines your city's stage. Once earned, a stage and its unlocks remain available even if population later falls.

| Stage | Population | New options | Zoned building growth |
| --- | ---: | --- | --- |
| **Small Town** | From 0 | Basic utilities, city services, parks, terrain, and utility lines | Up to building level 2 |
| **City** | From 5,000 | Railways, wind and solar power, stadium, seaport, recycling | Up to building level 3 |
| **Metropolis** | From 15,000 | University, airport, tallest residential and commercial buildings | Up to building level 4 |

**14 quests** reward roads, housing, your own utility networks, balanced finances, clean energy, and other milestones with money and experience points. Claim completed quests in **City development**. Existing starter-town buildings do not count as your own new construction. Experience records your achievements; stage progression depends on the population thresholds.

You can also attempt one of **three timed challenges** at a time:

- **Metropolitan Growth:** add 5,000 residents within 5 simulation minutes.
- **Green Capital:** reach 10,000 residents with pollution below 10 within 10 simulation minutes.
- **Golden Treasury:** increase city funds by €150,000 within 5 simulation minutes. Taking a new loan ends the attempt.

Successful challenges award money, experience, and a permanent badge. Failed attempts can be restarted.

The **city goal** requires **30 consecutive simulation seconds** with all of the following: at least **25,000 residents**, **80 happiness**, **70 education**, **70 health**, and a **positive running balance**. You can keep building afterward in free play. Quests and challenges help you get there; completing every quest is not required for the city goal.

## Camera, cars, and residents

| Input | Action |
| --- | --- |
| Left click / left drag | Use the selected tool |
| **M**, then left drag | Pan the camera |
| **W A S D / arrow keys** | Move the camera |
| Middle mouse or **Alt + left drag** | Pan the camera |
| Right drag, with no active draft / **Q and E** | Rotate the camera |
| Right-click during a building drag | Cancel the draft; keep the current tool |
| Mouse wheel | Zoom |
| **1 / 2 / 3 / 4 / 5** | Road / residential / commercial / industrial / park |
| **B / V / C** | Demolish / select and inspect a lot / grab resident |
| **R** | Rotate a large facility |
| **Space**, with the game world focused | Pause / resume at 1× |
| **G / N / H** | Grid / switch day or night / game help |
| **L** | Toggle city lights |
| **Cmd/Ctrl + S** | Save |
| **Cmd/Ctrl + Z** | Undo the latest available construction or disaster action |
| **Esc** | Leave the car, close a dialog, or cancel a draft; keep the construction tool |

The **globe** shows the whole region; the **crosshair** returns to the city center. Click the minimap to move the view directly to a location. Open the city menu to slide in the **city-management sidebar**. Its persistent navigation opens your budget, reports, weather and lighting, disasters, goals, journal, and controls directly. Navigation help is under **Controls**. The **City journal** is always available from the city menu, including in narrow laptop and mobile-sized layouts.

**Keyboard in menus:** Tab and Shift+Tab move between dialog controls. Focused buttons keep their normal Enter/Space behavior; game shortcuts do not take over while you operate menu controls or type in a field. Closing a dialog returns focus to the control that opened it, when available. When the same dialog updates, it retains its scroll position and focus where possible. Side panels and dialog content can scroll in smaller windows; NPC speech bubbles stay behind interface panels.

**Drive a car:** press **V** to select, hover over a vehicle, and click its **steering wheel** button. The camera follows the car. **W/S** or **↑/↓** accelerate, brake, and reverse; **A/D** or **←/→** steer. **Space** applies the handbrake: steering while moving and holding it lets the car drift sideways. Press **Esc** to leave the car.

Driving allows **50 km/h on roads near buildings**, **70 km/h on open roads outside developed areas**, and **25 km/h off-road**. Your speed and the current limit appear in the driving display. Sedans, taxis, vans, and trucks have different body shapes and sizes, with round wheels, rims, mirrors, and lights.

**Traffic and signals:** vehicles keep to the right-hand lane. Traffic lights appear automatically at T-junctions and crossroads; closely spaced junctions operate as one group. The visible red, yellow, and green lights follow the same controller as the AI traffic, with a brief all-red interval between approaches. AI vehicles stop at red or yellow, wait for occupied junctions, and enter only when the exit has enough space for the whole vehicle. Unsignalized conflicts use right-hand priority; tight bends, dead-end turnarounds, and service-yard merges also admit vehicles only when the shared space is clear. Cars queue behind traffic and account for vehicle size, including trucks. A short cul-de-sac next to a junction shares its clearance area, preventing a turning vehicle from blocking the very exit it needs. Congestion can still occur on crowded or obstructed roads.

**Service vehicles:** police cars, fire engines, and ambulances start in their station or hospital yard. With a usable connection, they drive along the access route and ramp, wait for a safe gap, and join the AI road traffic. You can select their steering-wheel button and drive them yourself, just like the other vehicles.

Vehicles collide with other vehicles and visible building structures. Open forecourts and gaps are drivable when the vehicle fits; water and map boundaries remain obstacles. Residents hit by a vehicle can fall or die from severe impacts. The population-loss and witness rules below apply to these collisions too.

**Residents and city life:** pedestrians use sidewalks and marked crossings. Their speech bubbles draw from **494 distinct lines, each available in English and German**, about their surroundings, weather, and observed events. Each resident cycles through a topic's lines before reusing them; recently spoken lines from other residents are avoided where possible. Lines may repeat after the available set is exhausted.

Cats and dogs appear occasionally in residential neighborhoods and parks. Small groups of deer and rabbits live in suitable woodland away from buildings. Their distribution follows the terrain and existing residential areas.

**Grab residents:** press **C** to pick up and move the small adult figures with the mouse. A hand icon marks the resident under the pointer. Drag upward to lift them, and put them down slowly near the ground so they can walk away. Figures have rounded shapes, modeled facial details, and different hairstyles, clothing, and accessories. Speech bubbles respond to being grabbed and to witnessed events. Survivable falls end with a getting-up animation.

A strong throw activates ragdoll physics; fatal impacts leave a blood mark on the ground or building. A fatal impact or carrying a resident beyond the map edge removes **exactly one resident** from the population. If other residents or a police station are within observation range, happiness also drops by **2 points**; without witnesses, that penalty does not apply. Observation uses a simplified distance rule. Visible residents and vehicles represent a limited sample of city life, not a full simulation of every citizen and commute.

**Construction undo** retains up to **ten successful construction actions** in the current city session. It survives economic updates and changes to settings, taxes, budgets, or loans. Undo reverses the selected construction edit and refunds its actual cost; it does not rewind elapsed play time, running income and expenses, current settings, or unrelated city growth. Undoing a zone removes that placement even if it has since developed; undoing a utility line leaves unrelated development in place. If the affected tiles have changed incompatibly, undo is rejected rather than overwriting the newer state. Claiming a quest reward or triggering a disaster clears the construction history.

**Disaster undo** is separate: triggering an event automatically pauses the city so you can inspect it or press **Cmd/Ctrl+Z**. Resuming the simulation or making another incompatible city change ends that undo window. Neither undo history is stored in save files; reloading, importing a city, or starting a new city begins a fresh history.

## Weather, graphics, and disasters

**Graphics & lighting** offers **Performance**, **Balanced**, and **Ultra** profiles controlling resolution, shadow detail, and antialiasing. Solid stylized houses, blue high-rises with Manhattan-inspired silhouettes, and sawtooth-roof factories define the city. Original grass and terrain materials, water, an atmospheric sky, and fog around the region complete the landscape. Rendering uses Three.js with WebGL2, soft stabilized real-time shadows, and sky reflections in materials.

The automatic **day–night cycle takes about four minutes** while the city runs. The sun, moon, and shadows follow the time of day. You can disable the cycle and set a fixed time. Toggle **city lights** independently using the **light bulb at the top**, **L**, or the graphics dialog. This controls building windows and streetlights together. **Every powered streetlight** illuminates its surroundings at night in every graphics profile; moving the camera no longer reassigns or switches off lamps. Unpowered lamps stay dark. **Dynamic weather** is enabled by default: clear spells of roughly 2½–5 simulation minutes alternate with 1–2½ minute showers. Rain wets the streets; raindrops fade and puddles dry after a shower. Choosing Clear or Rain manually pauses the automatic cycle; re-enable **Dynamic weather** to resume it. Weather phase and remaining duration survive save/reload. Ordinary rain never damages buildings or utility networks.

Lane markings, crosswalks, and stop lines are part of the asphalt texture, with variants for the actual road connections and intersections. Painted and unpainted pavement share the same surface, including on sloped roads.

Use **City menu → Take a photo** to export the current game view as a PNG. Large, dense regions require more memory and processing power; choose a lower graphics profile if needed. No particular frame rate is guaranteed across devices.

Enable **Sandbox mode** under **City menu → Disasters** before deliberately triggering a **major fire, earthquake, or severe storm**. Disasters damage buildings, roads, or utility networks. Burning sites show animated flames, a warm glow, rising smoke, and drifting embers. Floods have been removed. Fires can spread, while supplied fire stations limit them. Removing the flood tool does not automatically rebuild existing disaster damage. Clear debris and repair broken utility lines to restore services.

## Saves and assets

The city saves automatically **every 30 seconds**, shortly after changes, and when the page becomes hidden. The disk icon or **Cmd/Ctrl + S** saves manually. Wait for the save confirmation before closing; a final save during closing alone is not guaranteed.

Large saves primarily use **IndexedDB**, with fallback local storage when needed. There is one active save per browser and server address. **The local address on port 4173, a development address, and GitHub Pages use separate storage. Saves are not uploaded to GitHub.** Use **City menu → Export / import save** to back up a city as JSON or transfer it between browsers, devices, and addresses. To move online, first export from the local game, then import at the GitHub Pages address. Publishing the game does not transfer a save automatically. Importing a save or starting a new city replaces the active save. Import files are limited to **12 MB**; invalid data is rejected.

Old **40 × 40 saves** expand to **128 × 128 tiles** when loaded, preserving existing city development. The original v1 browser save is not overwritten. If an existing save cannot be read or validated, the game blocks automatic overwriting and shows a warning. Clearing browser data also removes local cities and backups, so JSON exports are useful for lasting backups.

The cover was created specifically for NEUSTADT with ImageGen. Buildings, terrain, roads, vehicles, and figures use original procedural models and materials. See [ASSETS.md](ASSETS.md) for provenance and generation details. Fonts and assets are served locally; the game does not require external asset servers at runtime. The game’s MIT license and the library and font license texts are in [public/licenses/](public/licenses/).

NEUSTADT uses no original SimCity 2000 graphics, music, or saves. It implements core city-building mechanics with its own simulation; complete feature parity with the historical game is outside the scope of this version.

## Open source and license

NEUSTADT is released under the [MIT License](LICENSE): Copyright 2026 t3ramos. It covers the original game code, procedural models and materials, dialogue text, and original cover artwork to the extent rights exist. External libraries, icons, and fonts retain their respective licenses; the notices in [public/licenses/](public/licenses/) are included with the distributed game. [ASSETS.md](ASSETS.md) explains provenance and the distinction between original and third-party assets.

Bug reports and contributions are welcome in the [personal GitHub repository](https://github.com/t3ramos/neustadt). For bugs, include reproduction steps, browser, and operating system. Check changes with `npm test` and `npm run build`; add both languages whenever you introduce visible text. Attach personal saves to a public report only if you intend to share them.
