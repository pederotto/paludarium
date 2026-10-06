"""The orchid petal atlas, baked with Blender. blender -b --factory-startup -P art-src/orchids/petal_bake.py
Writes art-src/orchids/baked/petals.npz (uint8 RGB, row 0 = the BOTTOM of the image); pack_petals.py -> public/assets/orchids/petals.webp.
Layout: 8 columns x 8 bands of 128 px. A band is the palette's pattern code (iPal.w: 0 plain, 1 spots, 2 net, 3 veins, 4 sparkle ...), a column is a
part of a flower (below). Inside a tile x = across the part (u -1..1 -> 0..1), y = along it (base 0 .. tip 1).
  R  ink    how far the palette's ACCENT colour covers the main colour (spots, net, blotches, ribs)
  G  tone   x2 multiplier on the petal colour (0.5 = none): veins, creases, a lighter margin
  B  glint  light added where crystals / papillae catch the lamp
Columns: 0 Dracula blade + hood, 1 Dracula lip (polar: x round, y out), 2 Masdevallia blade, 4 D. cuthbertsonii tepal, 5 its lip.
No photo pixels: every pattern is made by Blender's Noise / Voronoi nodes (bakefields.py) and numpy."""
import sys, os
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bakefields as bf

N, T = 1024, 128
sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
Z = lambda f, k=1.0: (f - 0.5) * 2 * k

SPECS = {
    "low":   dict(kind="noise", scale=2.4, detail=3, rough=0.5, distortion=0.4, seed=11),
    "mid":   dict(kind="noise", scale=7.0, detail=4, rough=0.55, seed=12),
    "fine":  dict(kind="noise", scale=30.0, detail=2, rough=0.5, seed=13),
    "str":   dict(kind="noise", scale=9.0, detail=3, rough=0.5, sy=0.3, seed=14),
    "vfd":   dict(kind="vor_dist", scale=24.0, randomness=1.0, seed=15),
    "vfr":   dict(kind="vor_cell", scale=24.0, randomness=1.0, seed=15),
    "vmd":   dict(kind="vor_dist", scale=11.0, randomness=1.0, seed=16),
    "vmr":   dict(kind="vor_cell", scale=11.0, randomness=1.0, seed=16),
    "ve":    dict(kind="vor_edge", scale=20.0, sy=0.8, randomness=1.0, seed=17),
    "ve2":   dict(kind="vor_edge", scale=9.0, randomness=1.0, seed=18),
}

def tile_grid():
    """Per atlas texel: tile column, band, local x, y (0..1), and the field coordinates (offset per tile so no two tiles share noise)."""
    ys, xs = np.mgrid[0:N, 0:N]
    col, band = xs // T, ys // T
    xl, yl = ((xs % T) + .5) / T, ((ys % T) + .5) / T
    X = (xl * 2 - 1) * 1.0 + 9.7 * col + 3.1 * band
    Y = yl * 1.2 + 6.3 * band + 2.9 * col
    return col, band, xl, yl, X, Y

def dots(d, r, rad0, rad1, present, dens):
    """Round dots on a Voronoi grid: radius rad0..rad1 (cell units) by the cell's random value, a fraction `dens` of the cells (0..1 per texel)."""
    rad = rad0 + (rad1 - rad0) * r
    on = (r * 7.31 % 1.0) < dens
    return sst(rad, rad * 0.55, d) * on

def tile(F, col, band, xl, yl):
    """Returns (ink, tone, glint) float arrays shaped like xl for one tile, or None for an empty tile."""
    u = xl * 2 - 1; au = np.abs(u); s = yl
    low, mid, fine, st = F["low"], F["mid"], F["fine"], F["str"]
    ink = np.zeros_like(xl); tone = np.full_like(xl, 0.5); glint = np.zeros_like(xl)
    if col == 0:                                   # Dracula blade / hood
        vein = 0.5 + 0.5 * np.cos((u / (0.55 + 0.45 * (1 - s))) * 9 * np.pi + 1.3 * Z(st))          # veins fan from the base toward the tip
        vein = sst(0.8, 1.0, vein)
        tone = 0.5 - 0.10 * vein + Z(fine, 0.03) + Z(mid, 0.04) + 0.03 * sst(0.7, 1, au)
        if band == 1:                              # D. simia: dense maroon speckle, blotches at the base and margin, a cream-yellow field between
            dens = np.clip(0.62 + 0.38 * (1 - s) + 0.3 * sst(0.55, 1, au), 0, 1)
            sp = np.maximum(dots(F["vfd"], F["vfr"], 0.2, 0.42, None, dens), dots(F["vmd"], F["vmr"], 0.16, 0.34, None, dens * 0.7))
            bl = sst(0.54, 0.6, low * (0.8 + 0.9 * (1 - s) + 0.6 * au * au + 0.5 * (mid - 0.5)))
            cream = sst(0.62, 0.2, au) * sst(0.12, 0.38, s) * sst(0.98, 0.55, s)
            ink = np.clip(np.maximum(sp * (1 - 0.35 * cream), bl * (1 - 0.9 * cream)) + 0.10 * sst(0.45, 0.9, vein), 0, 1)
            ink = np.maximum(ink, 0.85 * sst(0.8, 0.96, au) * (1 - cream))
        elif band == 2:                            # D. vampira: a black blade (ink everywhere) with a fine orange net of veins left open
            net = np.maximum(sst(0.07, 0.02, F["ve"]), 0.8 * vein)
            ink = np.clip(1 - 0.92 * net * sst(0.0, 0.1, s) * (1 - 0.6 * sst(0.8, 1, s)), 0, 1)
            tone = tone + 0.06 * net
        elif band == 0:                            # D. hirtzii and the plain forms: a faint tone, a little speckle toward the base
            ink = 0.55 * dots(F["vfd"], F["vfr"], 0.12, 0.24, None, 0.3 * (1 - s)) + 0.15 * sst(0.55, 0.7, low) * (1 - s)
        else: return None
    elif col == 3 and band in (0, 1, 2):           # Dracula hood: speckled all over (simia), the net of the blade (vampira), dark with a pale bloom (hirtzii)
        vein = sst(0.8, 1.0, 0.5 + 0.5 * np.cos((u / (0.6 + 0.4 * (1 - s))) * 8 * np.pi + 1.3 * Z(st)))
        tone = 0.5 - 0.08 * vein + Z(fine, 0.03) + Z(mid, 0.04)
        if band == 1:
            sp = np.maximum(dots(F["vfd"], F["vfr"], 0.22, 0.44, None, 0.85), dots(F["vmd"], F["vmr"], 0.18, 0.36, None, 0.75))
            ink = np.clip(0.5 * sst(0.46, 0.6, low) + sp * 0.9 + 0.1 * vein, 0, 1)
        elif band == 2:
            net = np.maximum(sst(0.07, 0.02, F["ve"]), 0.8 * vein)
            ink = np.clip(1 - 0.92 * net * (1 - 0.5 * sst(0.7, 1, s)), 0, 1)
        else:
            ink = np.clip(0.9 - 0.25 * sst(0.4, 0.6, mid) + 0.1 * Z(fine), 0, 1)
    elif col == 1 and band in (0, 1, 2):           # Dracula lip: x = round the dome, y = out from the apex; pink ribs and creases
        rib = (0.5 + 0.5 * np.cos(xl * 2 * np.pi * 8 + 0.8 * Z(mid))) ** 2
        ink = (0.16 + 0.42 * rib) * sst(0.0, 0.45, s) * (0.7 + 0.3 * sst(0.4, 0.7, fine)) + 0.3 * sst(0.75, 1.0, s)
        tone = 0.5 - 0.09 * rib * sst(0.0, 0.5, s) - 0.08 * sst(0.55, 1, s) - 0.05 + Z(fine, 0.03)
    elif col == 2:                                 # Masdevallia blade
        vein = sst(0.82, 1.0, 0.5 + 0.5 * np.cos(u * 8 * np.pi * (0.7 + 0.3 * (1 - s)) + 1.1 * Z(st)))
        tone = 0.5 - 0.07 * vein + Z(fine, 0.025) + Z(mid, 0.03) + 0.04 * sst(0.75, 1, au)
        if band == 1:                              # M. decumana: fine dark speckle, denser toward the throat, veins along it
            dens = np.clip(0.7 + 0.3 * (1 - s) + 0.2 * (mid - 0.5), 0, 1)
            ink = np.clip(np.maximum(dots(F["vmd"], F["vmr"], 0.22, 0.42, None, dens), dots(F["vfd"], F["vfr"], 0.22, 0.4, None, dens * 0.9)) * (0.75 + 0.25 * (1 - s)) + 0.3 * vein * (1 - s), 0, 1)
        elif band == 0:
            ink = 0.18 * sst(0.55, 0.75, low) * (1 - s)
        else: return None
    elif col == 4 and band == 4:                   # cuthbertsonii tepal: fine veins along the petal, a satin tone; crystal papillae catch the light
        vein = sst(0.84, 1.0, 0.5 + 0.5 * np.cos(u * 7 * np.pi * (0.6 + 0.4 * (1 - s)) + 0.8 * Z(st)))
        tone = 0.5 - 0.055 * vein + Z(fine, 0.02) + Z(low, 0.04) + 0.03 * sst(0.7, 1, au)
        glint = 0.5 * sst(0.55, 0.9, F["vfr"]) * sst(0.4, 0.15, F["vfd"]) * (0.6 + 0.4 * sst(0.3, 0.9, fine))
    elif col == 5 and band == 4:                   # its lip
        tone = 0.5 - 0.04 * sst(0.8, 1.0, 0.5 + 0.5 * np.cos(u * 5 * np.pi)) + Z(fine, 0.02)
    else:
        return None
    return np.clip(ink, 0, 1), np.clip(tone, 0, 1), np.clip(glint, 0, 1)

if __name__ == "__main__":
    col, band, xl, yl, X, Y = tile_grid()
    F = bf.fields(N, N, X.astype(np.float32), Y.astype(np.float32), SPECS)
    atlas = np.zeros((N, N, 3), np.float32); atlas[..., 1] = 0.5            # neutral everywhere: no ink, no tone change, no glint
    for c in range(8):
        for b in range(8):
            sl = (slice(b * T, (b + 1) * T), slice(c * T, (c + 1) * T))
            r = tile({k: v[sl] for k, v in F.items()}, c, b, xl[sl], yl[sl])
            if r is None: continue
            atlas[sl] = np.stack(r, -1); print("tile col", c, "band", b)
    np.savez_compressed(os.path.join(HERE, "baked", "petals.npz"), atlas=np.round(255 * atlas).astype(np.uint8))
    print("BAKED petals", N)
