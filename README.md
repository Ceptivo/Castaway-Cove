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

Controls: tap or click the ground to walk there. WASD or the arrow keys walk directly.

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
| `05-inventory-ui.png` | The Bag screen (milestone 2) |
| `06-island-concept.png` | Camp props, rocks, pebbles, starfish, fern, the deep-water tile, and the camp layout |
| `07-fishing-pov.png` | First-person screens and HUD parts (milestones 2 and 5) |
| `08-island-hud-mockup.png` | Island HUD mock-up |
| `09-tools-weapons.png` | Tool and weapon icons |

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
