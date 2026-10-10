#!/usr/bin/env python3
"""Seamless 512 px ground textures for the terrain slots, cut from the colour atlases of the generated (Meshy) landscape models.

    python3 tools/bake-ground.py <atlas dir> [--out public/assets/ground] [--sheet sheet.png] [--only id,id]

<atlas dir> holds the models' colour maps as PNG (any size, they were dumped from the decimated GLBs by tools/meshy-decor.mjs' outputs,
see art-src/ground/README.md). Each recipe crops a region, turns the saturation and the tint, scales the mean luminance to what the
terrain slot it replaces expects (render/shaders.js GROUND tints were chosen for the old photos), makes the crop tile (offset +
cross-fade: the picture is blended with itself shifted by half, the weight zero along the old edges, so the join runs through
the middle where the first copy is whole) and writes <out>/<id>.jpg. The atlases are mosaics of flat colour patches, so a tile
reads as fine sand, gravel or scree at the 10-25 cm a slot repeats over; they are not photographs and not for close, big prints.
Slots (content/ground.js): 0 soil, 1 sand, 2 gravel, 3 rock, 5 dark stone. No photo pixels: the sources are generated models.
"""
import argparse, os, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageDraw

# id: (atlas, crop (x0, y0, x1, y1) as fractions, saturation, target mean luminance 0-255, tint (r, g, b), rotate degrees, zoom)
# contrast (optional, default 1): the picture's spread around its mean (the bright limestone patches read as crushed marble at 1)
# zoom 2: the tile is the picture repeated 2 x 2 (the patches half the size: the atlases' patches are 2-4 cm at a slot's scale)
RECIPES = {
    # sand slot (tile 12 cm): fine, pale
    'desert_sand':   ('desert_terrain_model_225904', (0.0, 0.0, 1.0, 1.0), 1.0, 150, (1.02, 0.98, 0.92), 0, 1),
    'quartz_sand':   ('desert_terrain_model_225904', (0.0, 0.0, 1.0, 1.0), 0.45, 175, (1.0, 1.0, 0.98), 90, 1),
    # soil slot (tile 20 cm): dark, earthy
    'dry_earth':     ('rocky_hill_230325', (0.0, 0.0, 1.0, 1.0), 1.0, 100, (1.05, 0.98, 0.9), 0, 1),
    'red_earth':     ('rocky_hill_230325', (0.0, 0.0, 1.0, 1.0), 0.8, 84, (1.14, 0.92, 0.8), 180, 1),
    'mud_dark':      ('rocky_hill_230325', (0.0, 0.0, 1.0, 1.0), 0.8, 62, (1.0, 0.95, 0.9), 90, 1),
    'litter_forest': ('rocky_landscape_225932', (0.1, 0.1, 0.9, 0.9), 0.55, 98, (1.1, 0.95, 0.8), 0, 2),
    # gravel slot (tile 11 cm): coarse
    'scree_sandstone': ('rock_formation_model_225841', (0.0, 0.0, 1.0, 1.0), 0.9, 130, (1.0, 0.97, 0.92), 0, 2),
    'scree_red':     ('desert_monolith_230009', (0.0, 0.0, 1.0, 1.0), 0.8, 120, (1.0, 0.95, 0.9), 0, 2),
    'scree_limestone': ('floating_plateau_225924', (0.2, 0.2, 0.8, 0.8), 0.3, 108, (1.0, 1.0, 1.0), 0, 2, 0.55),
    # rock slot (tile 22 cm)
    'sandstone':     ('cliff2_230048', (0.0, 0.0, 1.0, 1.0), 0.9, 118, (1.0, 0.97, 0.92), 90, 2),
    'limestone':     ('floating_plateau_225924', (0.2, 0.2, 0.8, 0.8), 0.3, 110, (1.0, 1.0, 1.0), 90, 2, 0.6),
    # dark stone slot (tile 26 cm)
    'redrock':       ('sunlit_canyon_rocks_1_230219', (0.0, 0.0, 1.0, 1.0), 0.85, 72, (1.0, 0.92, 0.88), 0, 2),
    'darkrock':      ('sentinel_peak_225844', (0.0, 0.0, 1.0, 1.0), 0.7, 62, (1.0, 0.97, 0.94), 0, 2),
}

def lum(a):
    return (a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114).mean()

def seamless(a):
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), (0, 1))
    wy = np.sin(np.pi * np.arange(h) / h) ** 2
    wx = np.sin(np.pi * np.arange(w) / w) ** 2
    win = np.outer(wy, wx)[:, :, None]
    return a * win + b * (1 - win)

def edge_error(a):
    # how well the picture tiles: mean absolute difference across the wrap seam against the mean difference of neighbouring pixels
    seam = (np.abs(a[0] - a[-1]).mean() + np.abs(a[:, 0] - a[:, -1]).mean()) / 2
    inner = (np.abs(a[1:] - a[:-1]).mean() + np.abs(a[:, 1:] - a[:, :-1]).mean()) / 2
    return seam, inner

def bake(id, atlas_dir, out):
    src, (x0, y0, x1, y1), sat, target, tint, rot, zoom, *more = RECIPES[id]
    contrast = more[0] if more else 1.0
    im = Image.open(os.path.join(atlas_dir, src + '.png')).convert('RGB')
    w, h = im.size
    im = im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    s = min(im.size)
    im = im.crop((0, 0, s, s))
    if rot:
        im = im.rotate(rot)
    im = ImageEnhance.Color(im).enhance(sat)
    a = np.asarray(im, dtype=np.float32)
    raw = edge_error(a)
    a = seamless(a)
    if contrast != 1.0:
        a = a.mean((0, 1)) + (a - a.mean((0, 1))) * contrast
    a = a * np.array(tint, dtype=np.float32)
    a = a * (target / max(lum(a), 1e-3))
    a = np.clip(a, 0, 255)
    img = Image.fromarray(a.astype(np.uint8)).resize((512 // zoom, 512 // zoom), Image.LANCZOS)
    if zoom > 1:
        tile = img
        img = Image.new('RGB', (512, 512))
        for i in range(zoom):
            for j in range(zoom):
                img.paste(tile, (i * 512 // zoom, j * 512 // zoom))
    fixed = edge_error(np.asarray(img, dtype=np.float32))
    img.save(os.path.join(out, id + '.jpg'), quality=86, optimize=True)
    return img, raw, fixed

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('atlas')
    ap.add_argument('--out', default='public/assets/ground')
    ap.add_argument('--sheet', default='')
    ap.add_argument('--only', default='')
    o = ap.parse_args()
    ids = [i for i in RECIPES if not o.only or i in o.only.split(',')]
    tiles = []
    for id in ids:
        img, raw, fixed = bake(id, o.atlas, o.out)
        # seam: edge step / ordinary neighbour step; about 1 = invisible, the raw atlas edges are far worse
        print(f'{id:18s} seam/inner raw {raw[0] / raw[1]:5.2f} -> {fixed[0] / fixed[1]:5.2f}   {os.path.getsize(os.path.join(o.out, id + ".jpg")) // 1000} kB')
        tiles.append((id, img))
    if o.sheet:
        cols, S = 4, 256
        rows = (len(tiles) + cols - 1) // cols
        # each tile shown 2 x 2 repeated, so a seam would show
        sheet = Image.new('RGB', (cols * S, rows * (S + 16)), (30, 30, 30))
        d = ImageDraw.Draw(sheet)
        for i, (id, img) in enumerate(tiles):
            big = Image.new('RGB', (S * 2, S * 2))
            for dx in (0, 1):
                for dy in (0, 1):
                    big.paste(img.resize((S, S), Image.LANCZOS), (dx * S, dy * S))
            cell = big.resize((S, S), Image.LANCZOS)
            sheet.paste(cell, ((i % cols) * S, (i // cols) * (S + 16)))
            d.text(((i % cols) * S + 4, (i // cols) * (S + 16) + S + 2), id, fill=(230, 230, 230))
        sheet.save(o.sheet)

if __name__ == '__main__':
    main()
