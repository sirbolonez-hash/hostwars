# Progress

## Gate 0 · setup — in review

Done:
- 302 uploaded images mapped to asset ids (`tools/assets/source_map.json`); nothing unidentified.
- Asset pipeline (`tools/assets/process.py`): background keying, trimming, scaling to game size, frame cutting for 54 effects, seamless tiles, 2x map upscale, atlas packing, manifest.
- Asset contract check (`npm run check:assets`): every manifest reference resolves.
- Asset gallery (`public/gallery.html`) for review, loaded from the same files the game will load.
- Project skeleton: Vite, TypeScript (strict), PixiJS 8, Vitest; module folders per the architecture.

Waiting on:
- Yakir's four review decisions (White Line building set, unit scale, Crown expression sheet, logo).
- GitHub repository connected to the session, and Netlify linked to it.
- Exact model of the reference machine's processor and graphics.

Acceptance (gate 0): the images pass through the pipeline and show correctly in the gallery — pending Yakir's review.
