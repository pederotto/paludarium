#!/bin/sh
# The fire salamander's skin chain after a new mouth: UVs and plain GLB from the dressed mouth, the maps, the embed, the manifest (6 Oct 2026).
#   sh tools/rig/firesal-skin-chain.sh [../firesal/tmp/mouth_full.glb]     (the mouth from `tools/blender/skull.py ... --fit-cavity <out.glb>`; run from the repo root)
set -e
MOUTH="${1:-../firesal/tmp/mouth_full.glb}"; W=../firesal/skin
node tools/rig/firesal-finish.mjs "$MOUTH" --uv --plain $W/firesal.plain.glb --bones $W/firesal.bones.json 2>&1 | grep -v prune | cut -c1-300
python3 tools/skin/firesal-skin.py $W/firesal.plain.glb $W/firesal.bones.json $W/fs --size 1024 --skull art-src/skull/firesal.skull.json | tail -3
node -e "const sharp=require('sharp');(async()=>{await sharp('$W/fs_color.png').webp({quality:90}).toFile('art-src/textures/firesal/color.webp');await sharp('$W/fs_normal.png').webp({quality:92}).toFile('art-src/textures/firesal/normal.webp');})();"
node tools/rig/firesal-finish.mjs "$MOUTH" --uv --color art-src/textures/firesal/color.webp --normal art-src/textures/firesal/normal.webp 2>&1 | grep -v prune | cut -c1-300
node tools/import-creatures.mjs --baked=firesal
