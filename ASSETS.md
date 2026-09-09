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

## Procedural game assets

The playable 3D assets are original project code. Geometry, colors, materials, and deterministic variants are assembled locally at startup. No models or textures from SimCity 2000 are used.

### v3.1.0 additions

Residential details, curved commercial geometry, roof relief, shared facade textures, resident facial/clothing geometry and temporary event furniture are original procedural project assets. No photographic textures or downloaded character models are included.

The red sweater's black double-headed eagle is an original simplified geometry drawing based on the public-domain Albanian national flag, with [Wikimedia's flag reference](https://commons.wikimedia.org/wiki/File:Flag_of_Albania.svg) used only for visual guidance. The source SVG is not bundled. Front/back prints are conformed to the sweater mesh.

The mounted Skanderbeg is an original stylized horse-and-rider model. The goat-crested helmet refers to the [Kunsthistorisches Museum's Skanderbeg presentation](https://www.khm.at/en/exhibitions/imperial-armoury/skanderbeg). Armor, red cloak, horse, tack and animation are artistic choices, not an exact historical reconstruction. No museum photograph, scan or other museum asset is redistributed.

The office refinement preserves the previously supplied GLB and its provenance; only terrace geometry is added. Official BCIS photographs were used for facade comparison, not embedded or redistributed. See the [office asset documentation](public/assets/models/easter-egg-office-README.md).

- **Buildings and facilities:** original houses, duplexes, compact apartment blocks, blue commercial high-rises with Manhattan-inspired silhouettes, and sawtooth-roof factories. Large continuous models cover the power plant, waterworks, police and fire stations, clinic, school, university, recycling center, stadium, airport, and seaport. Stadium activity, aircraft movements, and other facility details have original animations.
- **Building style and windows:** solid stylized structures with original facades, roof details, and opaque window materials. Building and window lights can be switched independently of the time of day. Building geometry also supplies collision bounds for residents and vehicles.
- **Terrain and roads:** saved terrain heights, coasts and hills, original repeatable grass materials with color, normal, and roughness maps, and roads and bridges that follow terrain elevation. Material maps are generated locally.
- **Utility structures:** original electricity poles and overhead spans. Connected residential, commercial, and industrial blocks share power without individual house cables. Visible service connections are reserved for large multi-tile facilities and are routed to the lot boundary without crossing roadways or other buildings.
- **Lighting and weather:** a procedural sky with sun and moon, day–night lighting, soft stabilized real-time shadows, sky-environment material reflections, original water and rain surfaces, puddle geometry, and raindrops. Streetlights have original fixtures, soft light pools on the road, and a limited number of actual lights near the camera.
- **Fire effects:** original animated flame geometry, warm glow, rising smoke, and drifting embers mark burning sites. These effects are generated locally in the renderer.
- **Vehicles:** original sedans, taxis with roof signs and checker bands, enclosed delivery vans, and six-wheeled flatbed trucks with separate cabs and cargo. Modeled details include shaped hoods, roofs and fenders, wheel openings, sloping windscreens, tire tread, rims and spokes, mirrors, wipers, grilles, bumpers, and lights. Paint and opaque windows use original material settings. Boats are original models too.
- **Residents:** small adult figures with rounded heads, limbs, hands, shoes, hair and backpacks, modeled facial details, and variations in skin, clothing, and accessories. Walking and recovery animations, sidewalk and crossing routing, grab interaction, and the hand marker are original code. Ragdoll joint and collision physics use `cannon-es`. Impact particles and stains are procedural.
- **Dialogue and localization:** 494 original situation and event lines, each provided in German and English. Topic selection, speech bubbles, and per-resident selection without repeating a line before cycling through a topic are computed locally. Interface, help, notifications, quest, and challenge translations are maintained in the source. Dialogue and translation do not call language models or external services at runtime.
- **Animals:** original small cat, dog, deer, and rabbit models built from shared geometry, with species-specific proportions, movement, and habitats.
- **Construction interaction:** original building-footprint previews, outlines, and tool markers. Interface icons come from Lucide and retain their separate license.

The cover above is the existing ImageGen artwork. Later gameplay assets were created as code-based geometry and materials; no additional raster images were generated for those features.

## Libraries and fonts

The current renderer uses **Three.js**. **cannon-es** provides ragdoll physics. The interface uses **Lucide**, **DM Sans**, and **Manrope**. These are third-party libraries and fonts, not original project assets.

The former ray-tracing mode is not part of the running game. **three-mesh-bvh**, **three-gpu-pathtracer**, and its **glslSmartDeNoise** shader remain as historical source or test dependencies, with their license notices. The current game renderer does not use them.

Fonts and all required runtime game assets are served from the project. License notices are in [`public/licenses/`](public/licenses/); installed packages also contain the notices for development dependencies. `package-lock.json` records the dependency versions.

## Licensing

Original game source, procedural asset code, materials, dialogue, translations, and cover artwork are made available under the repository's [MIT License](LICENSE), Copyright 2026 t3ramos, to the extent the contributor holds rights in them. The cover's provenance is AI-generated artwork as described above; no exclusive ownership or copyright protection of generated output is asserted.

Third-party components retain their own licenses. The MIT license for NEUSTADT does not replace the notices for Three.js, cannon-es, Lucide, the bundled fonts, or the historical graphics dependencies. Keep the applicable notices when redistributing source or a built game. The build copies `public/licenses/` into the website package, including `neustadt.txt`, an exact copy of the root MIT `LICENSE`. The release ZIP additionally includes `LICENSE` at its root.
