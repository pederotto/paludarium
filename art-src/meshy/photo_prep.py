"""Prepares one reference photo (a single animal on a plain studio background, head to the left) for art-src/meshy/project_texture.py:
  - finds the animal's mask (the background is fitted as a smooth surface to the picture's border; `--mode=diff` keeps what differs from
    it, `--mode=sat` what is more colourful than it (use sat, with a high --thr, when the animal casts a shadow), `--mode=both` either);
  - crops to the mask, bleeds the animal's own edge colours outward over the background (so a texture lookup that lands a pixel
    outside the animal's outline still returns skin colour, never grey), writes <out>.png;
  - writes <out>.json: the crop size, the mask's top and bottom row for 256 columns across the animal (the outline the mesh is fitted to).
  python3 art-src/meshy/photo_prep.py <photo> <out-base> [--mode=diff|sat] [--thr=14] [--blur=2] [--pad=0.02] [--max=2048]
A debug picture <out>-mask.png (mask over the photo) is written too: look at it before using the result.
"""
import sys, json
import numpy as np
from PIL import Image, ImageFilter

a = sys.argv[1:]
SRC, OUT = a[0], a[1]
opt = dict(x[2:].split('=', 1) for x in a[2:] if x.startswith('--') and '=' in x)
MODE = opt.get('mode', 'diff'); THR = float(opt.get('thr', 14)); BLUR = int(opt.get('blur', 2)); PAD = float(opt.get('pad', 0.02)); MAXW = int(opt.get('max', 2048))

im = Image.open(SRC).convert('RGB')
img = np.asarray(im, dtype=np.float64)
H, W = img.shape[:2]
ys, xs = np.mgrid[0:H, 0:W]
X = xs / W - 0.5; Y = ys / H - 0.5
feat = lambda x, y: np.stack([np.ones_like(x), x, y, x * x, x * y, y * y, x ** 3, y ** 3, x * x * y, x * y * y], -1)
band = (ys < 0.05 * H) | (ys > 0.95 * H) | (xs < 0.04 * W) | (xs > 0.96 * W)
A = feat(X, Y)
coef, *_ = np.linalg.lstsq(A[band], img[band], rcond=None)
bg = A @ coef                                                    # the background as a smooth surface
sat = lambda c: (c.max(-1) - c.min(-1)) / (c.max(-1) + 1e-3)
if MODE == 'sat':
    d = (sat(img) - sat(bg)) * 255.0
elif MODE == 'both':                                             # colourful OR different from the background (a red animal with white legs)
    d = np.maximum((sat(img) - sat(bg)) * 255.0, np.linalg.norm(img - bg, axis=-1) * float(opt.get('diffw', 0.6)))
else:
    d = np.linalg.norm(img - bg, axis=-1)
dm = Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(BLUR))
d = np.asarray(dm, dtype=np.float64) / 4
mask = d > THR
m = Image.fromarray((mask * 255).astype(np.uint8))
m = m.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MedianFilter(5))   # close small gaps, drop specks
mask = np.asarray(m) > 127
# keep the biggest blob (a flood fill from the mask's centre of mass would miss thin parts: label with a cheap pass)
lab = np.zeros((H, W), dtype=np.int32); n = 0; sizes = {}
for y0 in range(0, H, 2):
    for x0 in range(0, W, 2):
        if mask[y0, x0] and lab[y0, x0] == 0:
            n += 1; stack = [(y0, x0)]; lab[y0, x0] = n; cnt = 0
            while stack:
                y, x = stack.pop(); cnt += 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and lab[yy, xx] == 0:
                            lab[yy, xx] = n; stack.append((yy, xx))
            sizes[n] = cnt
if not sizes: raise SystemExit('no animal found: lower --thr or try --mode=sat')
keep = {k for k, v in sizes.items() if v > 0.04 * max(sizes.values())}      # the animal and its large parts; specks go
mask = np.isin(lab, list(keep))
ys_, xs_ = np.nonzero(mask)
x0, x1, y0, y1 = xs_.min(), xs_.max(), ys_.min(), ys_.max()
px, py = int((x1 - x0) * PAD) + 2, int((y1 - y0) * PAD) + 2
cx0, cx1, cy0, cy1 = max(0, x0 - px), min(W, x1 + px + 1), max(0, y0 - py), min(H, y1 + py + 1)
crop = img[cy0:cy1, cx0:cx1].copy(); cm = mask[cy0:cy1, cx0:cx1]
# bleed the animal's colour outward: background pixels take the mean of their filled neighbours, ring by ring. The outline pixels
# themselves carry a halo of the background, so the bleeding starts a few pixels inside the outline (--erode, default 4)
ER = int(opt.get('erode', 4))
inner = np.asarray(Image.fromarray((cm * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(2 * ER + 1))) > 127
filled = inner.copy()
dist = np.zeros(filled.shape)
for it in range(60):
    if filled.all(): break
    acc = np.zeros_like(crop); cnt = np.zeros(filled.shape)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0: continue
            f = np.roll(np.roll(filled, dy, 0), dx, 1); c = np.roll(np.roll(crop, dy, 0), dx, 1)
            acc += c * f[..., None]; cnt += f
    new = (~filled) & (cnt > 0)
    crop[new] = acc[new] / cnt[new][..., None]
    dist[new] = it + 1
    filled = filled | new
# the ring-by-ring copy leaves streaks across the bled zone (seen from above on the back and belly, which read the picture's edge rows):
# blur that zone, the more the farther it is from the animal
smoothed = np.stack([np.asarray(Image.fromarray(np.clip(crop[..., k], 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(float(opt.get('smooth', 10))))) for k in range(3)], -1).astype(np.float64)
w = np.clip(dist / float(opt.get('ramp', 6)), 0, 1)[..., None]
crop = crop * (1 - w) + smoothed * w
# countershading for fish: the zone above the body's midline (the back, seen from above) is darkened with distance (--dorsal=0.78)
DOR = float(opt.get('dorsal', 1.0))
if DOR < 1.0:
    colt = np.where(cm.any(0), cm.argmax(0), 0); colb = np.where(cm.any(0), cm.shape[0] - 1 - cm[::-1].argmax(0), cm.shape[0] - 1)
    mid = ((colt + colb) / 2)[None, :]
    rows = np.arange(cm.shape[0])[:, None]
    wd = np.clip(dist / 8.0, 0, 1) * (rows < mid)
    crop = crop * (1 - wd[..., None] * (1 - DOR))
Hc, Wc = crop.shape[:2]
out = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8))
if Wc > MAXW:
    out = out.resize((MAXW, int(Hc * MAXW / Wc)), Image.LANCZOS)
out.save(OUT + '.png')
# a normal map from the picture's own fine detail (scales, shell bumps, fin rays): the high-pass of the luminance is taken as height
tex = np.asarray(out, dtype=np.float64) / 255.0
lum = tex @ np.array([0.299, 0.587, 0.114])
L8 = Image.fromarray((lum * 255).astype(np.uint8))
hp = lum - np.asarray(L8.filter(ImageFilter.GaussianBlur(5)), dtype=np.float64) / 255.0
hp = np.asarray(Image.fromarray((np.clip(hp * 4 + 0.5, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float64) / 255.0 - 0.5
dx = (np.roll(hp, -1, 1) - np.roll(hp, 1, 1)) * 0.5; dy = (np.roll(hp, -1, 0) - np.roll(hp, 1, 0)) * 0.5
K = float(opt.get('relief', 6.0))
nx, ny, nz = -dx * K, dy * K, np.ones_like(dx)                 # tangent space, +Y up in uv (image rows run downward)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
Image.fromarray((nrm * 255).astype(np.uint8)).save(OUT + '-normal.png')
# the outline per column across the mask's own width (inside the crop)
mx0, mx1 = x0 - cx0, x1 - cx0
NC = 256; top = []; bot = []
for i in range(NC):
    xa = int(mx0 + (mx1 - mx0) * i / NC); xb = max(xa + 1, int(mx0 + (mx1 - mx0) * (i + 1) / NC))
    col = cm[:, xa:xb].any(1); r = np.nonzero(col)[0]
    top.append(int(r.min()) if len(r) else None); bot.append(int(r.max()) if len(r) else None)
last = None
for arr in (top, bot):                                           # columns with nothing (a gap in a thin part): the neighbour's value
    for i in range(NC):
        if arr[i] is None: arr[i] = arr[i - 1] if i and arr[i - 1] is not None else next((v for v in arr if v is not None), 0)
json.dump({'crop': [int(Wc), int(Hc)], 'maskX': [int(mx0), int(mx1)], 'cols': NC, 'top': top, 'bottom': bot, 'photo': SRC, 'box': [int(cx0), int(cy0), int(cx1), int(cy1)]}, open(OUT + '.json', 'w'))
dbg = (img * 0.5).copy(); dbg[mask] = dbg[mask] * 0.4 + np.array([255, 80, 80]) * 0.6
Image.fromarray(np.clip(dbg, 0, 255).astype(np.uint8)).save(OUT + '-mask.png')
print(f'{SRC}: animal {x1 - x0 + 1} x {y1 - y0 + 1} px, crop {Wc} x {Hc}, mask {mask.sum()} px, parts kept {len(keep)} of {n}')
