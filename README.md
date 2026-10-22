# Castaway Cove

Ocean survival for phones and the web: survive on a home island, build a raft,
and sail to other islands. Built with Phaser 3, TypeScript and Vite, packaged
for Android with Capacitor. The game brief is in
[`docs/Castaway_Cove_Game_Brief.pdf`](docs/Castaway_Cove_Game_Brief.pdf). The
art direction is the reference images in [`art/reference/`](art/reference).

## Run it

```sh
npm install
npm run dev          # http://localhost:5173  (add ?seed=123 for a fixed island, ?debug for fps)
npm run build        # typecheck + production bundle in dist/
```

`npm run web-page` packs the build into one self-contained page (`dist/castaway-cove.html`) with the code, fonts and images inline. It needs no other files, so it can be shared or published as a link.

Controls: tap or click the ground to walk there. WASD or the arrow keys walk directly. On the dock or at the water's edge the hand button turns into **Fish**: hold the big button (or Space) to cast, strike when the float goes under, and hold to reel while keeping the tension out of the red. **Inventory** opens the Bag: tap a slot to select it, then Use or Equip, the amount toggle, or the bin (tap twice). The Craft tab lists every recipe from the brief with what you have against what it needs. Items and recipes live in `src/data/items.json` and `src/data/recipes.json`.

## Android

```sh
npm run cap:sync     # build, then copy dist/ into the Android project
npx cap open android # open in Android Studio to run on a phone or build an App Bundle
```

The app targets Android 16 (API 36), the Google Play minimum from 31 August 2026. It is locked to portrait.
The app id is `com.ceptivo.castawaycove`. It is a placeholder until it is confirmed, and it can't change once the first build is uploaded to Play.

## Art pipeline

Every sprite is cut from the reference images by `tools/build_assets.py`. The
script writes the atlases and ground textures in `public/assets/`.

```sh
pip install numpy scipy pillow
npm run assets
```

| Reference | Used for |
| --- | --- |
| `02-character-turnaround.png` | Character design reference (HUD portrait later) |
| `03-character-15-angles.png` | The castaway's 15 facing poses. 90°, 150°, 240° and 270° are mirrored, as the brief's facing rule says. |
| `04-palm-trees.png` | Palms at 8 angles, the sway loop, the trunk stump and coconuts |
| `05-inventory-ui.png` | The Bag: both panels, slots, buttons, equipment tiles and meter icons, cut out and cleaned so the game fills them live |
| `06-island-concept.png` | Camp props, rocks, pebbles, starfish, fern, the deep-water tile, and the camp layout |
| `07-fishing-pov.png` | The fishing screen: the dock scene, his hand on the rod, the panel, power bar and button, cut out and cleaned so the game draws them live |
| `08-island-hud-mockup.png` | Island HUD mock-up |
| `09-tools-weapons.png` | Tool and material icons in the Bag (axe, knife, hammer, rod; wood, stone, rope, hide, scrap) |
| `10-rocks.png` | The island's rocks and pebbles (35, in four sizes) |
| `11-cave-entrance.png`, `12-cave-interior.png` | Caves (later milestone) |
| `13-shark.png` | Sharks (milestone 5) |
| `14-fish.png` | The 20 fish you can catch, shown on the catch card |
| `15-fishing-shore-pov.png` | Fishing from the beach (same layout as image 07) |

In both fishing views the distant island is lifted out and kept as its own sprite (`distant_island`). The game shows it only when there is land in that direction; for now there is none, so the horizon is open ocean.

The sand and grass textures are painted by `tools/paint_textures.py` in the brief's palette.
Art that the images don't cover is listed in [`docs/ASSETS-NEEDED.md`](docs/ASSETS-NEEDED.md).

## Tuning

Every number lives in [`src/data/tuning.json`](src/data/tuning.json): sizes, counts, speeds and timings.
The camp layout is in [`src/data/camp.json`](src/data/camp.json). Its positions are measured from image 06.

## Screenshots

`npm run dev` in one terminal, then `npm run screens`. This writes screenshots at 360×780 portrait and at desktop size to `screenshots/`.

## Milestones

1. **Foundations** (done; under review):
   - project, art pipeline, tuning file, camera
   - generated home island with painted terrain, with the camp laid out as in image 06
   - castaway with 15-angle facing, tap-to-walk with pathfinding, keyboard movement
   - Capacitor Android project
2. Survival core: stats, day/night, weather, gathering, the Bag (image 05), messages, goals
3. Camp: crafting, building, fire lighting, cooking, rain catcher, garden
4. Wildlife
5. Into the water: swimming, diving, dock and raft, sharks, fishing (image 07)
6. Sailing
7. The wider ocean
8. Polish and ship
