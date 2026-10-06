"""The orchid petal RELIEF atlas (orchids2 texture pass), baked with Blender. blender -b --factory-startup -P art-src/orchids/petal_relief_bake.py
Same layout as petal_bake.py (8 columns x 8 bands of 128 px; band = palette pattern code, column = part of a flower). Writes baked/petals_n.npz
(uint8 RGBA, row 0 = the BOTTOM of the image). Channels:
  R,G  slopes of the surface height across (x) and along (y) the tile, 0.5 + slope / (2 SLOPE)  (SLOPE 2, per tile unit; the shader turns them
       into a normal with a frame built from the atlas coordinate, as plantMaterial does for the leaves)
  B    roughness multiplier x2 (0.5 = the material's own): satin where cells are smooth, matte on velvet, glossy on crystals
  A    thickness / translucency (255 = thick, opaque; 0 = thin, glowing): veins and cell walls hold the light back
Heights are in tile units (1 = the tile's width); fields come from Blender Noise / Voronoi nodes (bakefields.py). No photo pixels."""
import sys, os
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bakefields as bf
from petal_bake import N, T, SPECS, tile_grid, sst, Z, dots

SLOPE = 2.0

def height(F, col, band, xl, yl):
    """Height field (tile units) + roughness multiplier + thickness for one tile, or None."""
    u = xl * 2 - 1; au = np.abs(u); s = yl
    low, mid, fine, st = F["low"], F["mid"], F["fine"], F["str"]
    rough = np.ones_like(xl); thick = np.ones_like(xl)
    cell = sst(0.5, 0.0, F["vfd"])                       # a dome per Voronoi cell: 1 at its centre
    cellm = sst(0.55, 0.0, F["vmd"])
    if col in (0, 3) and band in (0, 1, 2):              # Dracula blade / hood: velvet, veins as ridges, the hood warty
        vein = sst(0.8, 1.0, 0.5 + 0.5 * np.cos((u / (0.55 + 0.45 * (1 - s))) * 9 * np.pi + 1.3 * Z(st)))
        h = 0.012 * vein + 0.006 * Z(fine, 1.0) + 0.004 * Z(mid)
        if col == 3: h += 0.02 * cellm * (0.6 + 0.4 * sst(0.3, 0.7, low))
        rough = 1.0 + 0.45 * sst(0.3, 0.8, fine) + 0.2                   # velvet: matte
        thick = 1.0 - 0.45 * vein - 0.15 * sst(0.7, 1, au)
    elif col == 1 and band in (0, 1, 2):                 # Dracula lip: ribs down the dome, a fleshy shell
        rib = (0.5 + 0.5 * np.cos(xl * 2 * np.pi * 8 + 0.8 * Z(mid))) ** 2
        h = 0.035 * rib * sst(0.0, 0.5, s) + 0.006 * Z(fine, 1.0) + 0.01 * cellm
        rough = 1.55 - 0.3 * rib + 0.2 * Z(mid); thick = 1.0 - 0.35 * rib
    elif col == 2 and band in (0, 1):                    # Masdevallia blade: veins grooved, the speckles a touch raised, satin
        vein = sst(0.82, 1.0, 0.5 + 0.5 * np.cos(u * 8 * np.pi * (0.7 + 0.3 * (1 - s)) + 1.1 * Z(st)))
        h = -0.008 * vein + 0.004 * Z(fine) + 0.003 * Z(mid)
        if band == 1: h += 0.006 * dots(F["vmd"], F["vmr"], 0.22, 0.42, None, 0.7)
        rough = 0.85 + 0.25 * Z(mid); thick = 1.0 - 0.4 * vein
    elif col == 4 and band == 4:                         # cuthbertsonii tepal: crystalline papillae, fine veins
        vein = sst(0.84, 1.0, 0.5 + 0.5 * np.cos(u * 7 * np.pi * (0.6 + 0.4 * (1 - s)) + 0.8 * Z(st)))
        h = -0.006 * vein + 0.018 * cell * (0.5 + 0.5 * sst(0.3, 0.8, F["vfr"])) + 0.004 * Z(fine)
        rough = 0.7 - 0.35 * cell + 0.15 * Z(mid); thick = 1.0 - 0.35 * vein
    elif col == 5 and band == 4:
        h = 0.004 * Z(fine); rough = np.full_like(xl, 0.8); thick = np.ones_like(xl)
    else:
        return None
    return h, np.broadcast_to(np.clip(rough, 0.1, 1.9), xl.shape), np.broadcast_to(np.clip(thick, 0, 1), xl.shape)

if __name__ == "__main__":
    col, band, xl, yl, X, Y = tile_grid()
    F = bf.fields(N, N, X.astype(np.float32), Y.astype(np.float32), SPECS)
    atlas = np.zeros((N, N, 4), np.float32); atlas[..., 0] = 0.5; atlas[..., 1] = 0.5; atlas[..., 2] = 0.5; atlas[..., 3] = 1.0
    d = 1.0 / T                                                         # one texel in tile units
    for c in range(8):
        for b in range(8):
            sl = (slice(b * T, (b + 1) * T), slice(c * T, (c + 1) * T))
            r = height({k: v[sl] for k, v in F.items()}, c, b, xl[sl], yl[sl])
            if r is None: continue
            h, rough, thick = r
            gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * d); gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * d)     # per tile unit
            enc = lambda g: np.clip(0.5 + g / (2 * SLOPE), 0, 1)
            atlas[sl] = np.stack([enc(gx), enc(gy), np.clip(rough / 2, 0, 1), np.clip(thick, 0, 1)], -1); print("relief tile col", c, "band", b)
    np.savez_compressed(os.path.join(HERE, "baked", "petals_n.npz"), atlas=np.round(255 * atlas).astype(np.uint8))
    print("BAKED petals_n", N)
