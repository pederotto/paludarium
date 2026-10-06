"""pack_leaf.py [species ...] : baked/<species>.npz -> public/assets/orchids/<species>-{leaf,relief,tint}.webp (lossy q95, alpha lossless, RGB kept under alpha 0)
and a preview sheet. System python3 + PIL. Image row 0 = the TIP (t = 1): the game loads them with flipY off via ImageBitmapLoader, see sim/orchid-leaves.js."""
import sys, os
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "orchids"); os.makedirs(OUT, exist_ok=True)
PREV = os.path.abspath(os.path.join(ROOT, "..", "orchids", "shots")); os.makedirs(PREV, exist_ok=True)
BASE = dict(pleurothallis=(0.20, 0.42, 0.14), masdevallia=(0.12, 0.36, 0.10), dracula=(0.22, 0.45, 0.14), cuthbertsonii=(0.10, 0.26, 0.09))
names = sys.argv[1:] or list(BASE)
tot = 0
for sp in names:
    d = np.load(os.path.join(HERE, "baked", sp + ".npz"))
    for k in ("leaf", "relief", "tint"):
        a = np.flipud(d[k])                                       # row 0 = tip
        Image.fromarray(a, "RGBA" if a.shape[-1] == 4 else "RGB").save(os.path.join(OUT, f"{sp}-{k}.webp"), quality=95, alpha_quality=100, exact=True, method=6)
        tot += os.path.getsize(os.path.join(OUT, f"{sp}-{k}.webp"))
    # preview: base colour x shade x tint, lit from the upper left by the relief slopes, over a dark ground, next to the wax mask
    leaf, rel, tint = [d[k].astype(np.float32) / 255 for k in ("leaf", "relief", "tint")]
    col = np.array(BASE[sp])[None, None, :] * (leaf[..., :1] * 2) * (tint[..., :3] * 2)
    pale = np.array([0.8, 0.85, 0.65])[None, None, :] * 0.5
    col = col * (1 - leaf[..., 1:2]) + pale * leaf[..., 1:2]
    sx, sy = (rel[..., 0] - 0.5) * 8, (rel[..., 1] - 0.5) * 8
    nx, ny, nz = -sx, -sy, np.ones_like(sx); n = np.sqrt(nx * nx + ny * ny + nz * nz); lam = np.clip((nx * -0.5 + ny * 0.6 + nz * 0.62) / n, 0, 1)
    spec = np.clip((nx * -0.3 + ny * 0.5 + nz * 0.8) / n, 0, 1) ** 40 * rel[..., 2] * 1.2
    lit = np.clip(col * (0.35 + 0.9 * lam[..., None]) + spec[..., None], 0, 1)
    img = lit * leaf[..., 3:4] + 0.05 * (1 - leaf[..., 3:4])
    H, W = img.shape[:2]; sc = 480 / max(H, W) if max(H, W) > 480 else 1
    panels = [np.flipud(img), np.flipud(np.repeat(leaf[..., :1], 3, -1)), np.flipud(np.repeat(rel[..., 2:3], 3, -1)), np.flipud(tint[..., :3])]
    ims = [Image.fromarray((np.clip(p, 0, 1) * 255).astype(np.uint8)).resize((int(W * 480 / H), 480)) for p in panels]
    sheet = Image.new("RGB", (sum(i.width for i in ims) + 8 * len(ims), 480), (20, 20, 20)); x = 0
    for i in ims: sheet.paste(i, (x, 0)); x += i.width + 8
    sheet.save(os.path.join(PREV, f"B-leaf-{sp}.jpg"), quality=88)
    print(sp, {k: os.path.getsize(os.path.join(OUT, f"{sp}-{k}.webp")) // 1024 for k in ("leaf", "relief", "tint")}, "KB")
print("TOTAL KB", tot // 1024)
