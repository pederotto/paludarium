"""pack_petals.py : baked/petals.npz -> public/assets/orchids/petals.webp (opaque RGB, lossy q95) + a preview. System python3 + PIL."""
import os, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
a = np.load(os.path.join(HERE, "baked", "petals.npz"))["atlas"]
out = os.path.join(ROOT, "public", "assets", "orchids", "petals.webp"); os.makedirs(os.path.dirname(out), exist_ok=True)
Image.fromarray(np.flipud(a), "RGB").save(out, quality=95, method=6)
print("petals.webp", os.path.getsize(out) // 1024, "KB")
prev = os.path.abspath(os.path.join(ROOT, "..", "orchids", "shots", "B-petals.png"))
# preview: ink red, tone grey, glint blue side by side, only the used rows/cols
v = np.flipud(a).astype(np.float32) / 255
ink = np.repeat(v[..., :1], 3, -1); tone = np.repeat(v[..., 1:2], 3, -1); gl = np.repeat(v[..., 2:3], 3, -1)
Image.fromarray((np.concatenate([ink, tone, gl], 1) * 255).astype(np.uint8)).resize((1536, 512)).save(prev); print(prev)
