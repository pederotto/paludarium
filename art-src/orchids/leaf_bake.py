"""Orchid leaf maps, baked with Blender. blender -b --factory-startup -P art-src/orchids/leaf_bake.py -- <species|all>
Writes art-src/orchids/baked/<species>.npz (uint8 leaf, relief, tint arrays, row 0 = the leaf's BASE); pack_leaf.py turns them into the
game's WebP files. The channel contract is src/sim/orchid-leaves.js + render/shaders.js plantMaterial:
  leaf   RGBA  R shade (x2), G toward leafPale, B back-face tint, A the true outline (alpha cut)
  relief RGBA  R,G slopes across / along (0.5 + slope / (2 SLOPE), SLOPE 2), B wax mask, A 255
  tint   RGB   colour multiplier x2 (0.5 = neutral): the hue the leaf gets across its blade (new in orchids2)
The outline, size and relief geometry are the game's own (leaf-shapes.json from tools/orchids/dump-leaf-shapes.mjs); Blender's Noise / Voronoi
nodes (bakefields.py) supply the natural variation. No photo pixels."""
import sys, os, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import bakefields as bf

sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
SLOPE = 2.0
BOW = dict(pleurothallis=0.5, masdevallia=0.3, dracula=0.15, cuthbertsonii=0.2)
PL_V = [0.2, 0.37, 0.53, 0.68, 0.81, 0.92]

def coords(S):
    W, H = S["W"], S["H"]
    T = np.array(S["T"], np.float32)[:, None]; env = np.array(S["env"], np.float32)[:, None]
    t = ((np.arange(H) + .5) / H)[:, None] * np.ones((1, W), np.float32)
    u = (((np.arange(W) + .5) / W) * 2 - 1)[None, :] * np.ones((H, 1), np.float32)
    X = u * env; lat = np.abs(X); Y = t * S["asp"]
    rel = np.minimum(1, lat / np.maximum(T, 1e-3))
    d = T - lat
    if S["notch"]:
        n = S["notch"]; d = np.minimum(d, lat - 0.11 * np.power(np.maximum(0, 1 - t / n), 0.7) + (t >= n))
    aa = (1.6 * 2 * env) / W
    alpha = sst(-aa, aa, d)
    return dict(W=W, H=H, t=t, u=u, X=X, lat=lat, Y=Y, rel=rel, hw=np.broadcast_to(T, t.shape), env=np.broadcast_to(env, t.shape), alpha=alpha, d=d)

def veins(rel, centres, w): 
    v = np.zeros_like(rel)
    for c in centres: v = np.maximum(v, sst(w, 0, np.abs(rel - c)))
    return v
def par(rel, n, frm): return (0.5 + 0.5 * np.cos(rel * n * np.pi * 2)) ** 14 * sst(frm, frm + 0.08, rel) * sst(1, 0.88, rel)
def Z(f, k=1.0): return (f - 0.5) * 2 * k          # a field (mean 0.5) to roughly -k..k

SPECS = {   # the Blender fields every species bakes (scale in cycles per leaf width; sy stretches along the blade)
    "low":    dict(kind="noise", scale=2.6, detail=3, rough=0.5, distortion=0.45, seed=1),
    "mid":    dict(kind="noise", scale=9.0, detail=4, rough=0.55, seed=2),
    "fine":   dict(kind="noise", scale=46.0, detail=2, rough=0.5, seed=3),
    "streak": dict(kind="noise", scale=10.0, detail=3, rough=0.5, sy=0.16, seed=4),
    "ret":    dict(kind="vor_edge", scale=30.0, sy=0.8, randomness=1.0, seed=5),
    "cell":   dict(kind="vor_dist", scale=12.0, sx=1.0, sy=0.8, randomness=0.85, seed=6),
    "cellr":  dict(kind="vor_cell", scale=12.0, sx=1.0, sy=0.8, randomness=0.85, seed=6),
    "cell2":  dict(kind="vor_dist", scale=20.0, randomness=1.0, seed=8),
    "cell2r": dict(kind="vor_cell", scale=20.0, randomness=1.0, seed=8),
}

# --- species recipes: return height, shade, pale, back, wax, tint(3) from coordinates C and fields F -----------------------------------------
def pleurothallis(C, F):
    t, lat, rel, y, X = C["t"], C["lat"], C["rel"], C["Y"], C["X"]; notch = 0.2
    onb = (t > notch - 0.02).astype(np.float32)
    rib = sst(0.014, 0.004, lat) * (1 - 0.6 * t) * onb
    ribw = sst(0.05, 0.01, lat) * (1 - 0.5 * t) * onb                          # a pale halo either side of the midrib
    vein = veins(rel, PL_V, 0.022) * np.where(t > notch, 1, 0.6) * sst(1, 0.9, t)
    between = 1 - vein
    ret = sst(0.02, 0.2, F["ret"]) * 0.5 + 0.5                                  # faint reticulate cell network between veins
    shade = (0.51 + 0.14 * rib + 0.06 * ribw + 0.07 * vein - 0.13 * sst(0.8, 1, rel) + Z(F["low"], 0.2) + Z(F["mid"], 0.09) + Z(F["fine"], 0.03)
             + 0.03 * (ret - 0.75) + 0.05 * (0.45 - t) * (1 - 0.5 * rel))
    pale = 0.17 * rib + 0.05 * ribw + 0.04 * vein * sst(0.5, 1, F["mid"])
    back = np.full_like(t, 0.7)
    dome = 0.1 * C["hw"] * np.sin(np.pi * np.minimum(1, rel)); bow = BOW["pleurothallis"] * y / np.maximum(t, 1e-4) * np.sin(np.pi * t) / np.pi
    h = bow + dome - 0.012 * rib + 0.0015 * vein + 0.0038 * Z(F["fine"], 0.5) + 0.0018 * Z(F["mid"], 0.5)
    wax = sst(0.95, 0.55, rel) * sst(0, 0.06, t) * (0.55 + 0.9 * sst(0.3, 0.7, F["mid"]))
    flush = sst(0.4, 0.0, t) * sst(0.3, 1, rel) + sst(0.82, 1, rel) * 0.6
    tint = np.stack([1 + 0.08 * (ribw + rib) + 0.08 * flush + 0.07 * Z(F["low"]), 1 + 0.06 * (ribw + rib) - 0.06 * flush + 0.05 * Z(F["mid"]), 1 - 0.18 * (ribw + rib) - 0.08 * flush - 0.06 * Z(F["low"])], -1)
    return h, shade, pale, back, wax, tint

def masdevallia(C, F):
    t, lat, rel, y = C["t"], C["lat"], C["rel"], C["Y"]
    groove = sst(0.022, 0.004, lat) * (1 - 0.7 * t + 0.3 * sst(0.32, 0.2, t)); shoulder = sst(0.015, 0.035, lat) * sst(0.075, 0.04, lat)
    vein = par(rel, 6, 0.12) * (0.7 + 0.3 * sst(0.3, 0.7, F["streak"]))
    streak = Z(F["streak"], 0.06)                                               # long faint streaks along the blade
    shade = (0.51 - 0.2 * groove + 0.09 * shoulder + 0.08 * vein + Z(F["low"], 0.15) + Z(F["mid"], 0.06) + Z(F["fine"], 0.026) + 1.6 * streak
             - 0.08 * sst(0.8, 1, rel) + 0.06 * sst(0.32, 0.12, t) - 0.03 * sst(0.6, 1, t))
    pale = 0.13 * shoulder + 0.05 * sst(0.3, 0.05, t) + 0.03 * vein
    back = np.full_like(t, 0.6)
    dome = 0.08 * C["hw"] * np.sin(np.pi * np.minimum(1, rel)); bow = BOW["masdevallia"] * y / np.maximum(t, 1e-4) * np.sin(np.pi * t) / np.pi
    h = bow + dome - 0.012 * groove * sst(0.03, 0, lat) / np.maximum(sst(0.03, 0, lat), 1e-6) * 0 - 0.012 * sst(0.03, 0, lat) * (1 - 0.6 * t + 0.4 * sst(0.32, 0.2, t)) + 0.0032 * par(rel, 6, 0.12) + 0.0032 * Z(F["fine"], 0.5) + 0.0025 * Z(F["streak"], 0.5)
    wax = sst(0.95, 0.55, rel) * sst(0, 0.06, t) * (0.55 + 0.9 * sst(0.3, 0.7, F["low"]))
    base = sst(0.34, 0.0, t)                                                    # the petiole: purple-brown, a yellower blade
    tint = np.stack([1 + 0.16 * base + 0.06 * Z(F["low"]), 1 - 0.07 * base + 0.06 * Z(F["mid"]) + 0.04 * sst(0.4, 1, t), 1 - 0.16 * base - 0.07 * Z(F["low"])], -1)
    return h, shade, pale, back, wax, tint

def dracula(C, F):
    t, lat, rel, y = C["t"], C["lat"], C["rel"], C["Y"]
    fold = sst(0.014, 0.003, lat); edge = sst(0.012, 0.024, lat) * sst(0.045, 0.026, lat)
    pleat = par(rel, 7, 0.1)                                                     # plicate: pleats along the strap, alternately lit
    pl2 = 0.5 + 0.5 * np.cos(rel * 7 * np.pi * 2 + 0.6 * Z(F["streak"]))
    shade = (0.51 - 0.16 * fold + 0.05 * edge + 0.09 * pleat + 0.07 * (pl2 - 0.5) + Z(F["low"], 0.12) + Z(F["mid"], 0.05) + Z(F["fine"], 0.024) + Z(F["streak"], 0.08)
             - 0.07 * sst(0.85, 1, rel) + 0.04 * sst(0.25, 0.05, t) - 0.03 * sst(0.6, 1, t))
    pale = 0.17 * edge + 0.03 * pleat
    back = np.ones_like(t)
    dome = 0.05 * C["hw"] * np.sin(np.pi * np.minimum(1, rel)); bow = BOW["dracula"] * y / np.maximum(t, 1e-4) * np.sin(np.pi * t) / np.pi
    h = bow + dome - 0.008 * sst(0.02, 0, lat) + 0.005 * pleat + 0.0032 * Z(F["fine"], 0.5) + 0.002 * Z(F["streak"], 0.5)
    wax = sst(0.95, 0.55, rel) * sst(0, 0.06, t) * (0.5 + 0.9 * sst(0.3, 0.7, F["low"]))
    base = sst(0.22, 0.0, t)
    tint = np.stack([1 + 0.12 * base + 0.05 * Z(F["low"]), 1 - 0.03 * base + 0.07 * (pl2 - 0.5) + 0.05 * Z(F["mid"]), 1 - 0.12 * base - 0.05 * (pl2 - 0.5)], -1)
    return h, shade, pale, back, wax, tint

def cuthbertsonii(C, F):
    t, lat, rel, y = C["t"], C["lat"], C["rel"], C["Y"]
    # silver-white warts (photo 1): Voronoi cells, each with a random radius, present in about half the cells, denser along the midrib
    d, r = F["cell2"] if False else F["cell"], F["cellr"]
    rad = 0.24 + 0.17 * r                                                        # cell units
    present = (F["cellr"] > 0.10 + 0.40 * rel).astype(np.float32)
    wart = sst(rad, rad * 0.45, d) * present
    rim = sst(rad * 1.7, rad, d) * (1 - sst(rad, rad * 0.45, d)) * present
    fade = sst(0.97, 0.75, rel) * sst(0.02, 0.1, t) * sst(1, 0.85, t)
    wart *= fade; rim *= fade
    shade = 0.5 + Z(F["low"], 0.12) + Z(F["mid"], 0.07) + Z(F["fine"], 0.03) - 0.12 * rim - 0.07 * sst(0.8, 1, rel) + 0.04 * sst(0.012, 0, lat) + 0.03 * (0.5 - t) + 0.08 * wart
    pale = 0.9 * wart
    back = np.ones_like(t)
    dome = 0.07 * C["hw"] * np.sin(np.pi * np.minimum(1, rel)); bow = BOW["cuthbertsonii"] * y / np.maximum(t, 1e-4) * np.sin(np.pi * t) / np.pi
    h = bow + dome - 0.006 * sst(0.02, 0, lat) + 0.03 * wart * 0.6 * np.minimum(rad, 0.4) / 0.4 * 0.5 + 0.002 * Z(F["fine"], 0.5)
    wax = sst(0.95, 0.55, rel) * sst(0, 0.06, t) * (0.55 + 0.9 * sst(0.3, 0.7, F["low"])) * (1 - 0.5 * wart)
    redge = sst(0.6, 1, rel) + sst(0.012, 0, lat) * 0.5                          # a red-brown flush along the margin and the midrib
    tint = np.stack([1 + 0.16 * redge * (1 - wart) + 0.02 * Z(F["low"]), 1 - 0.06 * redge * (1 - wart) + 0.02 * Z(F["mid"]), 1 - 0.10 * redge * (1 - wart) - 0.02 * Z(F["low"])], -1)
    return h, shade, pale, back, wax, tint

RECIPES = dict(pleurothallis=pleurothallis, masdevallia=masdevallia, dracula=dracula, cuthbertsonii=cuthbertsonii)

def pack(C, S, h, shade, pale, back, wax, tint):
    W, H = C["W"], C["H"]
    # slopes of the height (per width unit) exactly as sim/orchid-leaves.js orchidLeafRelief
    env = C["env"][:, :1]
    i0 = np.maximum(0, np.arange(W) - 1); i1 = np.minimum(W - 1, np.arange(W) + 1); j0 = np.maximum(0, np.arange(H) - 1); j1 = np.minimum(H - 1, np.arange(H) + 1)
    sx = (h[:, i1] - h[:, i0]) / (((i1 - i0)[None, :] * 2 * env) / W)
    sy = (h[j1, :] - h[j0, :]) / (((j1 - j0)[:, None] * S["asp"]) / H)
    enc = lambda s: np.clip(0.5 + s / (2 * SLOPE), 0, 1)
    q = lambda a: np.round(255 * np.clip(a, 0, 1)).astype(np.uint8)
    leaf = np.stack([q(shade), q(pale), q(back), q(C["alpha"])], -1)
    relief = np.stack([q(enc(sx)), q(enc(sy)), q(wax), np.full((H, W), 255, np.uint8)], -1)
    tintm = np.concatenate([q(tint / 2), np.full((H, W, 1), 255, np.uint8)], -1)
    return leaf, relief, tintm

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:]
    shapes = json.load(open(os.path.join(HERE, "leaf-shapes.json")))
    names = list(RECIPES) if a[0] == "all" else a
    os.makedirs(os.path.join(HERE, "baked"), exist_ok=True)
    for sp in names:
        S = shapes[sp]; C = coords(S)
        F = bf.fields(S["W"], S["H"], C["X"], C["Y"], SPECS)
        h, shade, pale, back, wax, tint = RECIPES[sp](C, F)
        leaf, relief, tintm = pack(C, S, h, shade, pale, back, wax, tint)
        np.savez_compressed(os.path.join(HERE, "baked", sp + ".npz"), leaf=leaf, relief=relief, tint=tintm)
        print("BAKED", sp, S["W"], S["H"], "mean shade %.3f" % float(shade[C["alpha"] > 0.5].mean()), "alpha cover %.3f" % float(C["alpha"].mean()))
