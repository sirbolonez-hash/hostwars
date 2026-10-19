# Progress

## Gate 0 · setup — accepted 19.10.2026

- 302 images mapped and processed; 326 assets including the code-built logo; 15 atlas pages; nothing missing.
- Review decisions applied: White Line set A, unit sizes kept, crown expressions "Virus Queen", English logo.
- Asset contract check, asset gallery, project skeleton.

## Gate 1 · simulation core — done, waiting to be built on

Acceptance: 1,000 ticks run twice give the same hash at every one of 20 checkpoints (`tests/sim/determinism.test.ts`).

Also proven by tests:
- save at tick 500 and resume gives the same final hash as never stopping;
- players' commands can arrive in any order within a tick;
- command validation and the queue's rules (`tests/sim/commands.test.ts`);
- integer maths, RNG and hash (`tests/sim/core.test.ts`);
- neutrophil lifespan and supply return (`tests/sim/lifespan.test.ts`);
- no forbidden API in `src/sim` (`tests/sim/purity.test.ts`);
- slice content validates, with art for every unit and building (`tests/content.test.ts`).

Not yet: navigation (gate 2), economy (3), construction and production (4), combat and vision (5).

## Open
- GitHub repository connected to the session, and Netlify linked to it.
- Exact model of the reference machine's graphics (the gate 0 shell shows it once it runs on Yakir's computer).
