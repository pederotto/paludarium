"""Leaf maps for the S3 plants (nidus, crypt, limnobium, aponogeton). python3 art-src/plants/leafbake.py [id ...]
Per plant: public/assets/plants/<id>-{leaf,relief,tint}.webp, 128 x 512 lossless, row 0 = the leaf's TIP; channels as hartstongue_bake.py
(leaf R shade x2 / G pale / B back tint / A outline; relief R,G slopes + B wax; tint colour x2). The tint is RESAMPLED REFERENCE DATA
(owner-approved): a crop of the owner's reference leaf (composite or crypt picture in .agents/refs/new-species-1007/), rotated so the midrib is
vertical (or unwrapped to polar for the round limnobium leaf), resized, blurred 1.2 px, divided by its own mean. Everything else is painted here.
Aponogeton has no reference tint (a net over water): its tint is neutral; its ALPHA is a lace lattice (the geometry's holes are removed)."""
import sys, os, math
import numpy as np
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REFS = os.environ.get('REFS', os.path.join(ROOT, '..', 'refs', 'new-species-1007'))
COMP = os.path.join(REFS, 'Gemini_Generated_Image_6hggw76hggw76hgg.jpg'); CRYPT = os.path.join(REFS, 'Gemini_Generated_Image_ejppm7ejppm7ejpp.jpg')
OUT = os.path.join(ROOT, 'public', 'assets', 'plants')
W, H, SL = 128, 512, 2.0
sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
t = ((np.arange(H) + 0.5) / H)[::-1][:, None] * np.ones((1, W))      # row 0 = tip
u = (((np.arange(W) + 0.5) / W) * 2 - 1)[None, :] * np.ones((H, 1))
au = np.abs(u)
def hash2(i, j, s):
    h = (i * 374761393 + j * 668265263 + s * 982451653) & 0xffffffff; h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffffffff) / 4294967296.0
def vnoise(x, y, s):
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64); fx, fy = x - xi, y - yi
    f = lambda a: a * a * (3 - 2 * a); h = np.vectorize(hash2)
    a, b, c, d = h(xi, yi, s), h(xi + 1, yi, s), h(xi, yi + 1, s), h(xi + 1, yi + 1, s)
    return a + (b - a) * f(fx) + (c - a) * f(fy) + (a - b - c + d) * f(fx) * f(fy)
def rotcrop(path, box, center, ang, hl, hw):
    im = Image.open(path).convert('RGB').crop(box); cx, cy = center
    im = im.rotate(ang, resample=Image.BICUBIC, center=(cx, cy))
    return im.crop((int(cx - hw), int(cy - hl), int(cx + hw), int(cy + hl))).resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
def polar(path, c, R):
    im = Image.open(path).convert('RGB'); a = np.asarray(im, np.float64)
    ang = u / 0.7 * math.pi; r = np.clip(t, 0, 1) * R * 0.96
    x = np.clip(c[0] + r * np.cos(ang), 0, a.shape[1] - 1.01); y = np.clip(c[1] + r * np.sin(ang), 0, a.shape[0] - 1.01)
    xi, yi = x.astype(int), y.astype(int); fx, fy = (x - xi)[..., None], (y - yi)[..., None]
    p = a[yi, xi] * (1 - fx) * (1 - fy) + a[yi, xi + 1] * fx * (1 - fy) + a[yi + 1, xi] * (1 - fx) * fy + a[yi + 1, xi + 1] * fx * fy
    return Image.fromarray(p.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
def tint_of(img, mask=None):
    ref = np.asarray(img, np.float64); m = (au < 0.8)[..., None] if mask is None else mask[..., None]
    mean = (ref * m).sum((0, 1)) / max(m.sum(), 1)
    return np.clip(0.5 * ref / mean, 0, 1)
def relief_of(hgt, LEN, HW, wax):
    gy, gx = np.gradient(hgt, LEN / H, 2 * HW / W); gy = -gy
    enc = lambda s: np.clip(0.5 + s / (2 * SL), 0, 1)
    return np.stack([enc(gx), enc(gy), wax, np.ones_like(wax)], -1)
def save(a, pid, name, mode):
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), mode).save(os.path.join(OUT, f'{pid}-{name}.webp'), lossless=True, quality=100, exact=True)

def nidus():
    LEN, HW = 11.0, 1.3; x = u * HW; y = t * LEN
    ref = rotcrop(COMP, (0, 60, 137, 700), (64, 290), -7, 170, 44); ref.save(os.path.join(HERE, 'nidus-ref-crop.png'))
    vein = np.power(np.clip(np.cos(2 * np.pi * (y * 7.5 - au * 0.5)), 0, 1), 4) * sst(0.06, 0.2, au) * sst(1.0, 0.9, au)
    mid = sst(0.1, 0.0, au) * sst(0, 0.04, t)
    shade = 0.5 + 0.04 * vein - 0.22 * mid - 0.06 * sst(0.75, 1, au)
    back = np.clip(0.25 + 0.75 * mid, 0, 1)
    leaf = np.stack([shade, 0 * mid, back, np.ones_like(mid)], -1)
    hgt = -0.02 * np.exp(-((x / 0.07) ** 2)) + 0.004 * vein
    wax = sst(1.0, 0.6, au) * sst(0, 0.05, t)
    return leaf, relief_of(hgt, LEN, HW, wax), tint_of(ref)
def crypt():
    LEN, HW = 5.2, 0.9; x = u * HW; y = t * LEN
    ref = rotcrop(CRYPT, (0, 0, 1408, 768), (581, 218), -21.4, 190, 52); ref.save(os.path.join(HERE, 'crypt-ref-crop.png'))
    vein = np.power(np.clip(np.cos(2 * np.pi * (y * 3.4 - au * 0.9)), 0, 1), 3) * sst(0.05, 0.2, au) * sst(1.0, 0.85, au)
    mid = sst(0.09, 0.0, au) * sst(0, 0.04, t)
    pk = vnoise(u * 4.0 + 7, t * 14.0 + 3, 11) * 0.65 + vnoise(u * 9.0, t * 30.0, 5) * 0.35     # bullate puckers between the veins
    shade = 0.5 + 0.05 * vein - 0.05 * (pk - 0.5) + 0.06 * mid
    pale = 0.5 * mid
    leaf = np.stack([shade, pale, np.ones_like(mid) * 0.9, np.ones_like(mid)], -1)               # pinkish-grey underside everywhere
    hgt = 0.05 * (pk - 0.5) * sst(0.08, 0.3, au) - 0.012 * np.exp(-((x / 0.05) ** 2)) + 0.01 * vein
    wax = sst(1.0, 0.7, au) * sst(0, 0.05, t) * 0.8
    return leaf, relief_of(hgt, LEN, HW, wax), tint_of(rotcrop(CRYPT, (0, 0, 1408, 768), (581, 218), -21.4, 190, 52))
def limnobium():
    # round leaf: polar unwrap, u = angle / pi * 0.7, t = radius (the leaf coordinate the builder gives its circle)
    R = 1.0; rad = t
    ref = polar(COMP, (915, 388), 54); ref.save(os.path.join(HERE, 'limnobium-ref-crop.png'))
    ang = u / 0.7 * math.pi
    radial = np.power(np.clip(np.cos(ang * 9), 0, 1), 5) * sst(0.1, 0.4, rad) * sst(1.0, 0.8, rad)       # arcuate veins fanning from the stalk
    rim = sst(0.82, 1.0, rad)
    shade = 0.5 + 0.05 * radial - 0.03 * rim + 0.05 * sst(0.2, 0.0, rad)
    pale = 0.45 * rim + 0.35 * sst(0.16, 0.0, rad)                                                      # pale rim and pale centre
    leaf = np.stack([shade, pale, np.ones_like(rad) * 0.95, np.ones_like(rad)], -1)                       # spongy, paler underside
    hgt = 0.006 * radial + 0.01 * vnoise(u * 6, t * 6, 3)
    gy, gx = np.gradient(hgt, 1.0 / H, 2.0 / W); gy = -gy
    wax = sst(1.0, 0.7, rad) * 0.7
    enc = lambda s: np.clip(0.5 + s / (2 * SL), 0, 1)
    return leaf, np.stack([enc(gx * 0.15), enc(gy * 0.15), wax, np.ones_like(wax)], -1), tint_of(ref, (rad < 0.85)[..., None][..., 0])
def aponogeton():
    LEN, HW = 6.5, 0.9; x = u * HW; y = t * LEN
    # lace lattice: bars along and across the blade, leaving open cells; the midrib and margin stay solid
    px, py = 0.24, 0.30
    cx = np.abs(((x / px) % 1.0) - 0.5) * 2; cy = np.abs(((y / py) % 1.0) - 0.5) * 2
    cell = (cx < 0.62) & (cy < 0.66)
    solid = (au < 0.07) | (au > 0.9) | (t < 0.03) | (t > 0.985)
    a = np.where(cell & ~solid, 0.0, 1.0)
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float64) / 255
    a = np.clip((a - 0.3) / 0.4, 0, 1)
    bars = 1 - sst(0.0, 0.5, np.minimum(cx * 0.62 / 0.62, cy * 0.66 / 0.66))
    mid = sst(0.08, 0.0, au)
    shade = 0.5 + 0.05 * mid + 0.04 * bars
    leaf = np.stack([shade, 0.3 * mid, np.ones_like(mid) * 0.3, a], -1)
    hgt = 0.01 * bars - 0.01 * np.exp(-((x / 0.05) ** 2))
    return leaf, relief_of(hgt, LEN, HW, a * sst(1, 0.7, au) * 0.6), np.full((H, W, 3), 0.5)
BUILD = dict(nidus=nidus, crypt=crypt, limnobium=limnobium, aponogeton=aponogeton)
if __name__ == '__main__':
    for pid in (sys.argv[1:] or list(BUILD)):
        leaf, rel, tint = BUILD[pid]()
        save(leaf, pid, 'leaf', 'RGBA'); save(rel, pid, 'relief', 'RGBA'); save(tint, pid, 'tint', 'RGB'); print('wrote', pid)
