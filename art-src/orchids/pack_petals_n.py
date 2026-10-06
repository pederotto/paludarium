"""pack_petals_n.py : baked/petals_n.npz -> public/assets/orchids/petals_n.webp (RGBA, lossy q95 with a lossless alpha, RGB kept under any alpha; loaded unpremultiplied by
render/assets.js loadData) + a preview of the relief (lit) and roughness. System python3 + PIL."""
import os, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
a = np.load(os.path.join(HERE, "baked", "petals_n.npz"))["atlas"]
out = os.path.join(ROOT, "public", "assets", "orchids", "petals_n.webp")
Image.fromarray(np.flipud(a), "RGBA").save(out, quality=95, alpha_quality=100, exact=True, method=6)
print("petals_n.webp", os.path.getsize(out) // 1024, "KB")
v = a.astype(np.float32) / 255
sx, sy = (v[..., 0] - 0.5) * 8, (v[..., 1] - 0.5) * 8
lit = np.clip(0.5 + 0.5 * (-sx * -0.5 + -sy * 0.6) / np.sqrt(1 + sx * sx + sy * sy) * 2, 0, 1)
prev = np.concatenate([np.repeat(lit[..., None], 3, -1), np.repeat(v[..., 2:3], 3, -1), np.repeat(v[..., 3:4], 3, -1)], 1)
Image.fromarray((np.flipud(prev) * 255).astype(np.uint8)).resize((1536, 512)).save(os.path.abspath(os.path.join(ROOT, "..", "orchids", "shots", "B-petals-n.png")))
