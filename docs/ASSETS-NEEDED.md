# Art needed

The reference images cover the castaway's standing poses, palms, the inventory
layout, the home camp and the fishing view. Everything below still needs art
in the same style.

## How to make a sheet the pipeline can cut

Draw it like images 03 and 04:

- **Background:** one flat, plain muted brown background (about `#857055`), with nothing else on it.
- **Spacing:** leave a clear gap around every object, so no two objects touch.
- **Outline:** every object gets the thick dark-brown outline (`#211912`), drawn as a closed line all the way round.
- **Shadows:** a soft ground shadow is fine if it doesn't touch the outline. The game draws its own shadows.
- **Labels:** put each label in a banner below its object, as images 03 and 04 do.
- **Scale:** keep everything at the castaway's scale. He is about 300 px tall on a sheet, and a palm tree is about 1.7 times his height.
- **Camera:** use the same three-quarter top-down camera as image 06.

## Milestone 1: needed now

| # | Sheet | What's on it | Why |
| --- | --- | --- | --- |
| 1 | **Walk cycle** | 6 to 8 frames per direction for 8 directions (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°), drawn like image 03. Legs step in turn, with a slight body bob and no side-to-side waddle. Label each direction the way image 03 is labelled, and face each pose the way its label says. | The game only has standing poses for now, so he glides with a small bob instead of stepping. |
| 2 | **Camp props on a flat background** | Hut, supply chest, crate, map sign, barrel, water pot, campfire ring (unlit) and flames (separately), dock, raft with sail, garden with fence. | Today these are cut out of image 06, so some carry bits of grass and water at their edges, most visibly the hut and the sign. A clean sheet fixes that and gives the unlit fire pit the brief needs. |
| 3 | **Nature sheet** | 4 to 5 rocks of different sizes; rock rubble (gathered rock); berry fern with berries; the same fern with bare stalks (picked); grass tufts; small flowers; 3 pebbles; 2 shells; a starfish. | Rocks, ferns and decals are cut from image 06 and are rough. The fern has no berries, and there is no rubble or bare-stalk art for the "used up" states in milestone 2. |

## Later milestones (from the brief, in priority order)

- **Action animations:** chop, mine, swing a weapon, eat, drink from a bottle, swim, climb onto the raft.
- **Creatures** (move and attack frames): shark (fin above water and full body below), lizard, monkey, gull, bug swarm, crab, wild pig, snake, jellyfish.
- **Item icons:** every material, food, tool and bottle state (empty, fresh, dirty), painted like the icons in image 05.
- **Camp structures:** lean-to, reinforced hut, rain catcher with tarp and barrel, solar still, drying rack, storage chest, workbench, research table, scarecrow and spike fence, plus a damaged version of each.
- **Farm:** an empty plot, and three growth stages each for cabbage, carrot and tomato.
- **Raft parts** (from above): floor tile, damaged tile, sail, anchor, net, storage crate, tarp roof, steering oar.
- **Other islands:** jungle trees and vines, a stream, rocky atoll rocks, a shipwreck above and below water, fishing camp shacks, the lighthouse.
- **First-person concepts:** the fire-lighting view and an underwater diving view, made to match image 07.
- **World map:** parchment frame, island icons, fog, route line.
- **Title screen:** painted key art of the castaway, the raft and the islands.
- **Weather:** rain, lightning flash, storm waves, heat shimmer, night overlay.
- **Audio** (none exists yet):
  - ambience: waves and wind by weather, jungle birds, rain on a tarp, fire crackle
  - effects: reel click and splash, shark warning sting, gathering hits, UI clicks
  - music: calm day, tense night, storm
