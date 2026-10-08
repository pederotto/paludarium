"""Hart's-tongue leaf maps (run sets, S3 plants pilot). python3 art-src/plants/hartstongue_bake.py
Writes public/assets/plants/hartstongue-{leaf,relief,tint}.webp (128 x 512, lossless, row 0 = the leaf's TIP), the same channel contract as
the orchids' maps (src/sim/orchid-leaves.js, render/shaders.js plantMaterial):
  leaf   RGBA  R shade x2 (fine lateral veins, margin), G toward leafPale (the pale midrib), B back-face tint (sori lines on the underside), A true outline
  relief RGBA  R,G slopes across / along (0.5 + slope / (2 SLOPE), SLOPE 2), B wax mask, A 255
  tint   RGB   colour multiplier x2 (0.5 = neutral): THE OWNER'S REFERENCE LEAF, RESAMPLED (the front frond of strip 2 of
                .agents/refs/new-species-1007/Gemini_Generated_Image_6hggw76hggw76hgg.jpg: cropped, rotated so the midrib is vertical, resized, blurred
                1.2 px and divided by its own mean colour). Resampled reference data (owner-approved, 7 Oct 2026): the atlas holds it.
The outline functions below are the same as plant-leaves.js hartstongueTrue/hartstongueEnv (keep them in step)."""
import sys, os, math
import numpy as np
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REF = os.environ.get('HART_REF', os.path.join(ROOT, '..', 'refs', 'new-species-1007', 'Gemini_Generated_Image_6hggw76hggw76hgg.jpg'))
OUT = os.path.join(ROOT, 'public', 'assets', 'plants')
W, H, NR = 128, 512, 16
LEN_CM, HW_CM = 8.5, 1.2          # a typical frond: length and the envelope's half width, for the slope units
sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))

def T(t):   # the true half width (a fraction of `width`; 0.5 = full): heart-shaped base, wavy margin, tapering tip
    t = np.asarray(t, np.float64)
    base = 0.28 + 0.72 * sst(0, 0.07, t) + 0.12 * np.exp(-(((t - 0.07) / 0.035) ** 2))
    mid = np.power(np.sin(np.pi * np.minimum(1, 0.04 + t * 0.96)), 0.3) * (1 - 0.25 * t)
    wave = 1 + 0.035 * np.sin(t * 52 + 1) + 0.02 * np.sin(t * 23)
    return 0.5 * base * mid * wave
def env_fn():
    rows = np.arange(NR + 1) / NR; Wd = []
    for i in range(NR + 1):
        a, b = rows[max(0, i - 1)], rows[min(NR, i + 1)]
        Wd.append(max(T(a + (b - a) * k / 48) for k in range(49)) + 0.03)
    return lambda t: np.interp(t, rows, Wd)
ENV = env_fn()

t = ((np.arange(H) + 0.5) / H)[::-1][:, None] * np.ones((1, W))     # row 0 = tip (t = 1)
u = (((np.arange(W) + 0.5) / W) * 2 - 1)[None, :] * np.ones((H, 1))
env = ENV(t); tr = T(t) / env; au = np.abs(u)
alpha = sst(-0.03, 0.03, tr - au)                                      # the true margin inside the coarse blade
rel = np.minimum(1, au / np.maximum(tr, 1e-3))                         # 0 on the midrib, 1 at the margin
# -- the reference leaf, resampled
im = Image.open(REF).convert('RGB').crop((90, 20, 330, 740))
cx, cy, ang = 148, 435, -15.4
im = im.rotate(ang, resample=Image.BICUBIC, center=(cx, cy))
crop = im.crop((cx - 74, cy - 200, cx + 74, cy + 200)).resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
crop.save(os.path.join(HERE, 'hartstongue-ref-crop.png'))
ref = np.asarray(crop, np.float64)
inner = (au < 0.8 * tr)[..., None]
mean = (ref * inner).sum((0, 1)) / np.maximum(inner.sum() , 1)
tint = np.clip(0.5 * ref / mean, 0, 1)
# -- leaf map: veins (fine lateral ridges fanning from the midrib toward the tip), pale midrib, sori on the underside
y = t * LEN_CM                                                           # cm along
x = u * env * HW_CM / 0.5 * 0.5                                          # cm across (envelope half width = HW_CM)
x = u * HW_CM
vphase = (y * 4.2 - np.abs(x) * 1.9)                                     # a vein every ~0.24 cm along, swept toward the tip
vein = np.power(np.clip(np.cos(2 * np.pi * vphase), 0, 1), 3) * sst(0.07, 0.25, rel) * sst(1.0, 0.88, rel)
mid = sst(0.12, 0.0, rel) * sst(0, 0.03, t)
shade = 0.5 + 0.06 * vein - 0.07 * sst(0.7, 1.0, rel) + 0.05 * mid
pale = np.clip(0.75 * mid, 0, 1)
sori_line = np.power(np.clip(np.cos(2 * np.pi * (y * 2.1 - np.abs(x) * 0.95 + 0.25)), 0, 1), 6)
sori = sori_line * sst(0.18, 0.3, rel) * sst(0.92, 0.7, rel) * (0.5 + 0.5 * np.clip(np.sin(y * 31) * 3, 0, 1))   # dashed, between midrib and margin
back = np.clip(0.12 + 0.88 * sori, 0, 1)
leaf = np.stack([shade, pale, back, alpha], -1)
# -- relief: a groove on the midrib, ridged veins; slopes in height per cm
hgt = -0.030 * np.exp(-((x / 0.075) ** 2)) * sst(0, 0.04, t) + 0.0075 * vein + 0.012 * rel ** 2 * 0
dy = LEN_CM / H; dx = 2 * HW_CM / W
gy, gx = np.gradient(hgt, dy, dx)
gy = -gy                                                                  # rows run tip -> base: slope along +t
SL = 2.0
enc = lambda s: np.clip(0.5 + s / (2 * SL), 0, 1)
wax = sst(0.95, 0.55, rel) * sst(0, 0.06, t)
relief = np.stack([enc(gx), enc(gy), wax, np.ones_like(wax)], -1)
os.makedirs(OUT, exist_ok=True)
def save(a, name, mode):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), mode).save(os.path.join(OUT, f'hartstongue-{name}.webp'), lossless=True, quality=100, exact=True)
save(leaf, 'leaf', 'RGBA'); save(relief, 'relief', 'RGBA'); save(tint, 'tint', 'RGB')
print('wrote', OUT, 'mean ref colour', mean.round(1), 'T(0.5)=%.3f env(0.5)=%.3f' % (T(0.5), ENV(0.5)))
