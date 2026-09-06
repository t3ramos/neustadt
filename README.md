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
3. **Zone land.** Housing attracts residents; commerce and industry provide jobs. Buildings develop automatically when demand, utilities, and happiness are sufficient. Missing utilities can cause them to shrink. Houses, apartments, shops, high-rises, and factories show the city's growth.
4. **Support quality of life.** Parks, police, fire stations, clinics, and education facilities serve their surroundings. Industry and fossil-fuel power plants pollute nearby lots. City services need roads, power, and water; their budgets determine their effectiveness.
5. **Balance the budget.** Taxes affect income and happiness. Police, fire, health, and education have separate budgets. Borrow and repay in €10,000 steps, up to €50,000 of debt; monthly interest is 0.5%.

Basic utilities provide **6,000 power units per power plant** and **6,000 water units per supplied waterworks**. Later, wind farms provide 1,200 and solar farms 3,200 power units. Check capacity as well as continuous connections: a disconnected network is not supplied by a plant elsewhere on the map.

At **1×**, a game month takes about five seconds. The bottom bar also offers **2×**, **3×**, and pause. Dialogs and a hidden browser tab pause the simulation.

### Terrain and large facilities

Use **Terrain** tools to raise or lower undeveloped land in **5-meter steps**. **Level** uses the height of the first clicked tile for the area you edit. The cost is **€35 per tile for each 5-meter change**. Lowering land below sea level creates water; raising it creates land. Clear developed tiles before changing their height.

Public facilities are **single buildings occupying continuous footprints**. They need an empty, dry, level site. Press **R** to rotate the building and footprint. Demolition removes the entire facility.

| Facility | Footprint | Construction | Operation / month |
| --- | ---: | ---: | ---: |
| Power plant | 4 × 4 | €6,500 | €320 |
| Waterworks | 2 × 2 | €2,200 | €180 |
| Police station | 2 × 2 | €1,900 | €125 |
| Fire station | 3 × 2 | €1,600 | €95 |
| Clinic | 3 × 3 | €3,200 | €150 |
| School | 3 × 2 | €1,800 | €100 |
| Stadium | 6 × 5 | €9,000 | €180 |
| Seaport | 5 × 3 | €9,500 | €160 |
| University | 5 × 4 | €12,000 | €280 |
| Airport | 10 × 6 | €16,000 | €290 |

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

- **Metropolitan Growth:** add 5,000 residents within 60 months.
- **Green Capital:** reach 10,000 residents with pollution below 10 within 120 months.
- **Golden Treasury:** increase city funds by €150,000 within 60 months. Taking a new loan ends the attempt.

Successful challenges award money, experience, and a permanent badge. Failed attempts can be restarted.

The **city goal** requires **six consecutive months** with all of the following: at least **25,000 residents**, **80 happiness**, **70 education**, **70 health**, and a **positive monthly budget**. You can keep building afterward in free play. Quests and challenges help you get there; completing every quest is not required for the city goal.

## Camera, cars, and residents

| Input | Action |
| --- | --- |
| Left click / left drag | Use the selected tool |
| **M**, then left drag | Pan the camera |
| **W A S D / arrow keys** | Move the camera |
| Middle mouse or **Alt + left drag** | Pan the camera |
| Right drag / **Q and E** | Rotate the camera |
| Mouse wheel | Zoom |
| **1 / 2 / 3 / 4 / 5** | Road / residential / commercial / industrial / park |
| **B / V / C** | Demolish / inspect lot / grab resident |
| **R** | Rotate a large facility |
| **Space** | Pause / resume at 1× |
| **G / N / H** | Grid / switch day or night / game help |
| **L** | Toggle city lights |
| **Cmd/Ctrl + S** | Save |
| **Cmd/Ctrl + Z** | Undo |
| **Esc** | Leave the car, close a dialog, or activate the selection tool |

The **globe** shows the whole region; the **crosshair** returns to the city center. Click the minimap to move the view directly to a location. Find navigation help under **City menu → Camera & residents**.

**Drive a car:** press **V** to select, hover over a vehicle, and click its **steering wheel** button. The camera follows the car. **W/S** or **↑/↓** accelerate, brake, and reverse; **A/D** or **←/→** steer. **Space** applies the handbrake: steering while moving and holding it lets the car drift sideways. Press **Esc** to leave the car.

Driving allows **50 km/h on roads near buildings**, **70 km/h on open roads outside developed areas**, and **25 km/h off-road**. Your speed and the current limit appear in the driving display. Sedans, taxis, vans, and trucks have different body shapes and sizes, with round wheels, rims, mirrors, and lights.

Vehicles collide with other vehicles and visible building structures. Open forecourts and gaps are drivable when the vehicle fits; water and map boundaries remain obstacles. Residents hit by a vehicle can fall or die from severe impacts. The population-loss and witness rules below apply to these collisions too.

**Residents and city life:** pedestrians use sidewalks and marked crossings. Their speech bubbles draw from **494 distinct lines, each available in English and German**, about their surroundings, weather, and observed events. Each resident cycles through a topic's lines before reusing them; recently spoken lines from other residents are avoided where possible. Lines may repeat after the available set is exhausted.

Cats and dogs appear occasionally in residential neighborhoods and parks. Small groups of deer and rabbits live in suitable woodland away from buildings. Their distribution follows the terrain and existing residential areas.

**Grab residents:** press **C** to pick up and move the small adult figures with the mouse. A hand icon marks the resident under the pointer. Drag upward to lift them, and put them down slowly near the ground so they can walk away. Figures have rounded shapes, modeled facial details, and different hairstyles, clothing, and accessories. Speech bubbles respond to being grabbed and to witnessed events. Survivable falls end with a getting-up animation.

A strong throw activates ragdoll physics; fatal impacts leave a blood mark on the ground or building. A fatal impact or carrying a resident beyond the map edge removes **exactly one resident** from the population. If other residents or a police station are within observation range, happiness also drops by **2 points**; without witnesses, that penalty does not apply. Observation uses a simplified distance rule. Visible residents and vehicles represent a limited sample of city life, not a full simulation of every citizen and commute.

**Undo** retains up to **ten construction and disaster actions** during the current session. The next game month or another state change, such as taxes, loans, weather, or a resident event, clears this history. Pause while planning if you want to undo several building steps.

## Weather, graphics, and disasters

**Graphics & lighting** offers **Performance**, **Balanced**, and **Ultra** profiles controlling resolution, shadow detail, and antialiasing. Solid stylized houses, blue high-rises with Manhattan-inspired silhouettes, and sawtooth-roof factories define the city. Original grass and terrain materials, water, an atmospheric sky, and fog around the region complete the landscape. Rendering uses Three.js with WebGL2, soft stabilized real-time shadows, and sky reflections in materials.

The automatic **day–night cycle takes about four minutes** while the city runs. The sun, moon, and shadows follow the time of day. You can disable the cycle and set a fixed time. Toggle **city lights** independently using the **light bulb at the top**, **L**, or the graphics dialog. This controls building windows and streetlights together. Powered streetlights have warm light fixtures and visible pools of light on the road at night; unpowered ones stay dark. **Rain** adds wet surfaces, puddles, and raindrops.

Use **City menu → Take a photo** to export the current game view as a PNG. Large, dense regions require more memory and processing power; choose a lower graphics profile if needed. No particular frame rate is guaranteed across devices.

Enable **Sandbox mode** under **City menu → Disasters** before deliberately triggering a **major fire, earthquake, flood, or severe storm**. Disasters damage buildings, roads, or utility networks. Burning sites show animated flames, a warm glow, rising smoke, and drifting embers. Low coastal land is vulnerable to flooding; fires can spread, while supplied fire stations limit them. Clear debris and repair broken utility lines to restore services.

## Saves and assets

The city saves automatically **every 30 seconds**, shortly after changes, and when the page becomes hidden. The disk icon or **Cmd/Ctrl + S** saves manually. Wait for the save confirmation before closing; a final save during closing alone is not guaranteed.

Large saves primarily use **IndexedDB**, with fallback local storage when needed. There is one active save per browser and server address. **The local address on port 4173, a development address, and GitHub Pages use separate storage. Saves are not uploaded to GitHub.** Use **City menu → Export / import save** to back up a city as JSON or transfer it between browsers, devices, and addresses. To move online, first export from the local game, then import at the GitHub Pages address. Publishing the game does not transfer a save automatically. Importing a save or starting a new city replaces the active save. Import files are limited to **12 MB**; invalid data is rejected.

Old **40 × 40 saves** expand to **128 × 128 tiles** when loaded, preserving existing city development. The original v1 browser save is not overwritten. If an existing save cannot be read or validated, the game blocks automatic overwriting and shows a warning. Clearing browser data also removes local cities and backups, so JSON exports are useful for lasting backups.

The cover was created specifically for NEUSTADT with ImageGen. Buildings, terrain, roads, vehicles, and figures use original procedural models and materials. See [ASSETS.md](ASSETS.md) for provenance and generation details. Fonts and assets are served locally; the game does not require external asset servers at runtime. The game’s MIT license and the library and font license texts are in [public/licenses/](public/licenses/).

NEUSTADT uses no original SimCity 2000 graphics, music, or saves. It implements core city-building mechanics with its own simulation; complete feature parity with the historical game is outside the scope of this version.

## Open source and license

NEUSTADT is released under the [MIT License](LICENSE): Copyright 2026 t3ramos. It covers the original game code, procedural models and materials, dialogue text, and original cover artwork to the extent rights exist. External libraries, icons, and fonts retain their respective licenses; the notices in [public/licenses/](public/licenses/) are included with the distributed game. [ASSETS.md](ASSETS.md) explains provenance and the distinction between original and third-party assets.

Bug reports and contributions are welcome in the [personal GitHub repository](https://github.com/t3ramos/neustadt). For bugs, include reproduction steps, browser, and operating system. Check changes with `npm test` and `npm run build`; add both languages whenever you introduce visible text. Attach personal saves to a public report only if you intend to share them.
