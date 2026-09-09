# Easter Egg

The office model comes from the left foreground building in a provided Blender scene. Its original facade and six contour pieces are preserved. The single visible sign sits high on the street-facing facade just below the roofline, with no sign above the entrance; source names are omitted from published filenames, scene objects, materials and metadata.

The rear and far-end walls are built from solid piers and spandrels around actual window openings. Glazing is recessed behind the wall plane, with thin inset frames and narrow sills matching the original front. The measured recess is 0.012980 game units at the rear and 0.013570 at the end. Continuous white/dark surfaces, a recessed rear door, drainage, parapet caps and a ground apron complete all elevations. These additions complete the supplied architectural model; they are not surveyed building details. The original source remains unchanged and private.

Integration uses a commercial 3×2 lot, switching to 2×3 for odd rotations. The lot system controls uniqueness and street-facing orientation. `preloadEasterEggBuilding()` loads `assets/models/easter-egg-office.glb`; `createEasterEggBuilding()` places a shared-resource clone at `(1, 0, 0.5)` in the nominal lot. The front faces local **+Z**, the long axis is X, and the ground is Y=0.

The roof has six solar panels and two ventilation units on the left. The middle canopy covers only the rear half, leaving the front half open. The right terrace contains two dark rustic wooden tables, each with two opposing chair pairs, plus two dark wooden standing tables. Full-height glass forms an L along the rear and side; the remaining perimeter has glass balcony railing with an aluminum handrail.

The model contains 24,292 triangles, ten material batches, zero textures and 1,349,532 bytes. Exact size, SHA-256, source checksum and bounds are recorded in `easter-egg-office-provenance.json`. Bounds before anchor offset are X `[-1.368800, 1.368800]`, Y `[0, 0.960815]`, Z `[-0.519200, 0.569350]`. The uncovered main roof is at `0.806188`. The highest surface is the rear-half canopy at `0.960815`. Its empty safe patch is centered X `[-0.22, 0.10]`, Z `[-0.28, -0.07]`; effects must avoid the solar racks and furniture.

Material names use the `Easter Egg` prefix, including `Easter Egg glass`, transparent `Easter Egg roof-glass` and dark `Easter Egg furniture-wood`. Cached geometry and materials are shared; static batching clones geometry before merging. The renderer marks shared resources with `userData.easterEggShared`.

To reproduce locally with a supplied scene copied to the neutral private input path:

```sh
blender --factory-startup -b output/easter-egg-assets/provided-scene.blend --python tools/assets/easter-egg-source-reference.py
blender --factory-startup -b output/easter-egg-assets/provided-scene.blend --python tools/assets/easter-egg-export.py
node tools/assets/easter-egg-verify.mjs
```

The exporter chooses the left foreground office using geometry and position relative to the reference camera, without a company or collection-name literal. The original contour materials are selected by their color tags. It writes the neutral derived file `output/easter-egg-assets/easter-egg-office.blend` and seven local review images: `front.png`, `back.png`, `left.png`, `right.png`, `front-detail.png`, `rear-detail.png` and `roof.png`. Large input scenes and review images are excluded from publication.

Verification loads the shipped GLB using Three.js, checks geometry budgets and bounds, checks all four elevations and their glazing, and verifies the upper-facade sign position and original amber color. Raycast checks verify actual rear/end window recess, the uncovered front roof, consistent rear canopy height and furniture feet resting on the decking. All seven review images were visually checked. City placement and orientation are verified separately by the application integration.

The provided name and logo remain the property of their respective owner; inclusion does not grant trademark rights.

## Runtime architectural refinement

`src/rendering/buildings/landmark-office.ts` adds only the explicitly retained low terrace planters, timber fronts, foliage and small terrace light strips. The GLB and its provenance remain unchanged. All elevations, original window grid and recessed frames, entrance canopy and original contour wordmark now come solely from the supplied GLB. No source material is recolored. The previous bronze reveals, projecting window lintels, broad sun blades, roof-edge bronze/light strips and timber entrance soffit have been removed. The invented arrival planters, trees, benches, bollards and paving overlay have also been removed; the source apron and game lot access remain.

The reference is the [official BCIS building photograph](https://bcis.de/wp-content/uploads/2024/04/BCIS_-Frimengebaeude-e1713346390379.png), linked from the [BCIS anniversary article](https://bcis.de/wir-lieben-digitale-prozesse-seit-25-jahren/) and visually inspected on 2026-09-09. It shows white wall fields, dark grey bands and slim window profiles. Its large foreground logo is an image overlay, not evidence for changing the modeled sign scale or location. The GLB remains a simplified game adaptation, not a surveyed reconstruction of every recess or rooftop structure in the photo. Terrace landscaping is retained by request, not claimed as a photographed detail.

All remaining overlay parts merge into five static material batches (1,248 triangles) once during preload. Clones share these geometries and materials, marked `easterEggShared`, and the existing asset disposal traversal owns their lifecycle. Source window-island extraction is now only a test/inspection helper, with no runtime preload cost. No runtime textures, network assets, real lights, animation, collision objects or per-frame work are added. Terrace emissive strips have fixed low intensity; they do not cast light or need a day/night update hook.

The overlay remains inside the nominal 3×2 lot and below the original canopy maximum. Its entire geometry is confined to the accepted terrace strip above Y=0.824; no overlay occupies the facade or arrival court. The center entrance approach, original sign, uncovered front roof and documented canopy effect patch remain clear. `tests/buildings/landmark-office.test.ts` loads the shipped GLB and checks these constraints with geometry bounds and rays, including unobstructed window centers and shared clone resources. Runtime visual QA and frame-rate measurements are separate integration checks.
