#!/bin/sh
# Rebuilds the Meshy fish of run "sets" (docs/PREMADE_SETS.md section 5) from their originals in art-src/raw/ and the owner's photos.
#   sh art-src/meshy/build_fish.sh [work dir]          (run from the repo root, one heavy job at a time: Blender)
# The work dir (default art-src/meshy/work, git-ignored) holds the intermediates; the prepared GLBs land in art-src/creatures-sets/,
# then `npm run import-creatures -- --src=art-src/creatures-sets` writes public/assets/creatures/ (and rewrite the manifest in the
# compact skeleton format afterwards, see the doc). Photos: PHOTOS (default .agents/refs/new-species-1007, outside git).
set -e
W="${1:-art-src/meshy/work}"; PHOTOS="${PHOTOS:-../refs/new-species-1007}"
mkdir -p "$W"
PREP="python3 art-src/meshy/photo_prep.py"
BL="blender -b --factory-startup -P"

# --- the two geometry-only models: texture from the photo, then mark the fins ---
# id           photo                                          mask options                    axis   length cm  fold
fish() {
  id=$1; photo=$2; maskopt=$3; axis=$4; cm=$5; fold=$6
  $PREP "$PHOTOS/$photo" "$W/$id" $maskopt
  $BL art-src/meshy/project_texture.py -- "art-src/raw/meshy_${id}_generate.glb" "$W/$id" "$W/${id}_tex.glb" --axis=$axis
  $BL art-src/meshy/mark_fins.py -- "$W/${id}_tex.glb" "$W/${id}_fin.glb"
  node tools/meshy-prep.mjs "$W/${id}_fin.glb" $id --cm=$cm --head=-x ${fold:+--fold=$fold}
}
fish zacco      Gemini_Generated_Image_kwcn1qkwcn1qkwcn.jpg "--mode=diff --thr=10 --erode=10 --dorsal=0.7" x 12.5 1.0:0.4
fish tanichthys Gemini_Generated_Image_q5m8ebq5m8ebq5m8.jpg "--mode=diff --thr=12 --erode=8 --dorsal=0.8"  y 4.2

# --- the two models Meshy textured itself: mark the fins ---
meshy() {
  id=$1; src=$2; cm=$3; fold=$4
  $BL art-src/meshy/mark_fins.py -- "art-src/raw/$src" "$W/${id}_fin.glb"
  node tools/meshy-prep.mjs "$W/${id}_fin.glb" $id --cm=$cm --head=-x ${fold:+--fold=$fold}
}
meshy bullhead meshy_bullhead_texture.glb 10.8
meshy bedotia  meshy_bedotia_texture.glb  9.6 1.0:0.3
echo "prepared: art-src/creatures-sets/{zacco,tanichthys,bullhead,bedotia}.glb"
