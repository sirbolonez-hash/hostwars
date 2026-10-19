# Rules

Every gameplay rule and edge case gets written here before it is coded, and every rule here has a test. Sections fill in gate by gate.

## Assets (gate 0)

- An asset is referenced by id only. A missing asset renders as a coloured box with its id; it never crashes the game.
- Display size comes from the manifest. Gameplay size (body radius, footprint) is independent of the picture, so a redrawn image never changes the game.
- Units face lower-left; facing right is a horizontal flip. Walking, breathing, attack lunge and hit flash are procedural.
- A building blocks exactly its footprint rectangle. Art that hangs over the footprint does not block.
- Additive (`add`) effects are light: they brighten the ground. Keyed (`key`) effects are objects and draw normally.

## Simulation (gate 1 onwards)

To be written: tick order, command validation, resources, construction, production, combat, death, victory. The architecture tab, sections 3 to 6, is the source.
