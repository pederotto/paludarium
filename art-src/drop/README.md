# Drop folder

Put raw assets here: models (`.glb` / `.gltf`), textures, plant cards, images, audio.
Any file name, any mix, no sorting needed. Then tell Claude you dropped something.

From another computer or a browser, use the **Paludarium Drop** page
(https://claude.ai/artifact/3vUJANJZcqCpwkR9gudWs4): drop the files there, then tell Claude.
Claude copies them into this folder with `tools/drop-pull.mjs`, which checks each file's
size and SHA-256 against what the browser sent.

Claude works out what each file is, optimises it into `public/assets/`, moves your
original to `art-src/raw/` (the untouched archive), notes the source and licence in
`CREDITS.md`, runs the tests and commits. The drop folder ends up empty.

Which file is an animal, a rock, a ground texture or a plant card is decided from the
file itself and its name. Naming it after what it is (`dartfrog.glb`, `cliff_side.jpg`)
helps; if Claude cannot tell, it asks.

## Rule: file size

GitHub refuses any file over 100 MB. **Keep each file under 50 MB.** For a bigger one,
tell Claude to set up Git LFS first. Do not commit it as it is.
