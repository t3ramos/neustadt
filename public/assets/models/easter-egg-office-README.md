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
