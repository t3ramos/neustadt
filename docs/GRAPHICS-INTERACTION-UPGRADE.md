# Graphics and interaction upgrade · v3.1.0 verification

Checked on 9 September 2026 for v3.1.0. Existing saves keep their schema; visual routines, invitations and the mounted tribute are intentionally transient. Distribution and hosting follow the [release guide](RELEASING.md).

## Implemented

- Three.js 0.183.2 → 0.186.0; still a WebGL2 renderer, with the existing custom city simulation and worker. No Unreal/WebGPU engine migration.
- Balanced/Ultra: existing multisampling plus SMAA before the output pass when floating-point framebuffers are supported. Direct rendering remains available in Performance mode. The 60-FPS limiter is retained.
- Five residential architecture families: articulated roofs, subtle roof-tile relief, recessed windows, entrances, gardens, terraces, rounded bays and curved balconies. Commercial families now include rounded occupied shells, gabled crowns and attached roof gardens, with fewer repeated thin fins.
- Shared commercial facade textures provide different glazing, interior/blind patterns, roughness and shallow relief. Night and wet-weather material updates reuse these resources.
- The BCIS office retains the original GLB facade, white/dark-grey surfaces, window grid, entrance and wordmark. Added bronze profiles and invented arrival geometry were removed after reference comparison. Only low terrace landscaping and restrained terrace lighting remain. The original Blender/GLB and provenance are unchanged; studio lighting and shadows improve its isolated preview.
- Resident faces, clothing and joint silhouettes are more detailed. Close-up residents use 33 shared batches, including front/back emblems, within a 5,700-triangle geometry budget; small distant residents use three silhouette batches, entering full detail at 18 screen pixels and leaving below 14. Held, hovered, ragdoll and recovering people stay detailed. Variant 3 has a red sweater, purple hat and surface-following black double-headed eagle on both sides.
- A single stylized Skanderbeg on horseback follows collision-checked pedestrian edges. Its animation freezes when paused. The rider and horse are original procedural geometry; the goat helmet is a historical visual reference, not a reconstruction claim.
- Held-body ground support and actual-location placement replace below-terrain dragging and origin snapback. Captured release is committed over the interface too; duplicate/zero-button and late capture events do not cancel a completed release.
- Release velocity uses an 80-ms gesture window, restarting a fresh movement after silent stationary holds. Tiny final movements and coalesced samples retain the real flick; long stationary pauses discard it. WASD/arrow movement and wheel zoom rebase the held interaction without generating phantom momentum.
- Selection uses a real world-aligned parcel rectangle, resolving linked child cells to the full parcel. It follows terrain and actual low facility supports. Foundation steps and terrain deviations split the strip locally; the overlay no longer uses a fixed elevated, stretched diamond. Batched building hits preserve source parcel ownership, including overhangs.
- Orthographic framing stays centered after resize. Hover picking is refreshed after camera changes, even when the mouse has not moved.
- Stadtleben adds visible work/home/park routines and two park-based invitations. People use the existing pedestrian graph and normal walking speed, remain together until the event ends, then resume ordinary routines. Real canopies, tables, stalls and a small stage replace the placeholder circle. A safe free furniture site is required before invitations/cooldown are committed. The UI distinguishes visible pedestrians from total population, requires explicit resume when paused, and offers focus/stop controls.

## Verification

- Final complete release run: **804 passed, 0 failed**, including venue and apparel integration.
- `npm run typecheck`, `npm run build`, `npm run format:check`, `npm run check:architecture`, and `git diff --check`: passed.
- The build retains its warning about chunks larger than 500 kB. No new build error; no claim that load-time/bundle optimization is complete.
- Coverage includes actual roof triangles for fire effects, all rotated facilities, mixed-size lots, cached-resource ownership, camera framing, L/T pedestrian junctions, workplace/home arrivals, event arrivals at real pace, pause/stop/rebuild lifecycle, ground clamping and release momentum.
- Browser: real downward mouse drag remained above elevated ground; careful release retained the location. Real release over a side overlay moved resident 1 from approximately `(2.04, 0.095)` to `(6.01, 2.82)` in world X/Z without snapping back.
- Browser: after holding still for 500 ms, a fast 100-pixel upward sweep with a 0.05-pixel tail released as a ragdoll and rose from Y 1.29 to 2.47 after 150 ms. A separate held-camera check moved the camera target and zoomed from 5.74 to 7 while the resident remained held at the same X/Z; release remained physical.
- Browser: in the actual Kassel city, the UI accepted an invitation for five residents and subsequently showed four arrivals with 34 seconds remaining. An isolated 24-person scene also showed real arrivals among 18 invitees.
- Browser: a 1600×1000 Ultra close-up measured **59.7 rendered FPS over five seconds**, with 720 simulated pedestrians and eight detailed on-screen residents. This is a bounded local observation, not a guarantee for the whole map or other devices. Large overview scenes remain more expensive.
- Browser console on the clean final game navigation: no errors or warnings. Day/night and rain views, close-up geometry, the German Stadtleben panel, and centered framing after resize were visually checked. The city was returned to pause after the live interaction check.

## Local inspection

With `npm run dev` running:

- Main game: `http://127.0.0.1:4399/`.
- Model gallery: `http://127.0.0.1:4399/tools/previews/graphics.html`. Homes, skyline, residents and office use the actual game geometry. Studio lighting and enlarged residents are only for inspection.
- Isolated interaction scene: `http://127.0.0.1:4399/tools/previews/interaction-qa.html`. It does not read or write the saved city; use it for grab/release, selection, camera and gathering tests.

Inspection pages are development-only and are not included in the production entry. Screenshots are under `output/playwright/` and stay out of the website archive and public source. The [versioned release](https://github.com/t3ramos/neustadt/releases/tag/v3.1.0) carries the compiled distribution separately from this source-level report.
