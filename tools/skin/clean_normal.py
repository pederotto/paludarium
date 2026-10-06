# Clean a Blender-baked tangent normal map: texels far outside every UV island and texels with an invalid normal become flat (0.5,0.5,1).
# usage: python3 tools/skin/clean_normal.py <uvdump.npz> <in_normal.png> <out_normal.png> [margin px]
import sys, numpy as np
from PIL import Image, ImageFilter
dump, src, dst = sys.argv[1:4]; margin = int(sys.argv[4]) if len(sys.argv) > 4 else 12
uv = np.load(dump)['uv']; R = Image.open(src).size[0]
cov = np.zeros((R, R), bool)
for q in uv:
    q = q * R; q = np.stack([q[:, 0], R - q[:, 1]], 1)
    x0, y0 = np.floor(q.min(0)).astype(int).clip(0, R - 1); x1, y1 = np.ceil(q.max(0)).astype(int).clip(0, R - 1)
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    v0, v1 = q[1] - q[0], q[2] - q[0]; den = v0[0] * v1[1] - v1[0] * v0[1]
    if abs(den) < 1e-9: continue
    w1 = ((xs - q[0, 0]) * v1[1] - v1[0] * (ys - q[0, 1])) / den; w2 = (v0[0] * (ys - q[0, 1]) - (xs - q[0, 0]) * v0[1]) / den
    cov[y0:y1 + 1, x0:x1 + 1] |= (w1 >= -.02) & (w2 >= -.02) & (w1 + w2 <= 1.02)
near = np.asarray(Image.fromarray((cov * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * margin + 1))) > 0
n = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255 * 2 - 1
bad = (n[..., 2] < 0.35) | (np.abs(np.linalg.norm(n, axis=2) - 1) > 0.25)
flat = np.zeros_like(n); flat[..., 2] = 1
kill = (~near) | bad
out = np.where(kill[..., None], flat, n)
out = out / np.maximum(np.linalg.norm(out, axis=2, keepdims=True), 1e-6)
Image.fromarray(np.clip((out * .5 + .5) * 255 + .5, 0, 255).astype(np.uint8)).save(dst)
print(f'island texels {cov.mean():.3f}; flattened {kill.mean()*100:.2f}% (outside {(~near).mean()*100:.1f}%, invalid inside {(bad&near).sum()} texels)')
