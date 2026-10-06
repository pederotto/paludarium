"""petal_preview.py out.jpg : the atlas tiles coloured with the game palettes (main x (1-ink) + accent x ink, x tone). System python3 + PIL."""
import os, sys, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); a = np.load(os.path.join(HERE, "baked", "petals.npz"))["atlas"].astype(np.float32) / 255
T = 128
hx = lambda h: np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], np.float32) / 255
# (col, band, main, accent, label)
ITEMS = [(0, 1, 0xf0e6d8, 0x6a1020), (0, 2, 0xc07a3c, 0x24101a), (0, 0, 0x4a0e1c, 0x2a0810), (1, 1, 0xfaf4f0, 0xd06080), (2, 1, 0xe89ab0, 0x6a0f2a), (2, 0, 0xc2185b, 0x6a0a30), (4, 4, 0xe878b8, 0xf6e8d2)]
tiles = []
for c, b, m, ac in ITEMS:
    t = a[b * T:(b + 1) * T, c * T:(c + 1) * T]; ink, tone, gl = t[..., 0:1], t[..., 1:2], t[..., 2:3]
    col = (hx(m) * (1 - ink) + hx(ac) * ink) * (tone * 2) + gl * 0.5
    tiles.append(np.flipud(np.clip(col, 0, 1)))
sheet = np.concatenate([np.pad(t, ((0, 0), (0, 4), (0, 0))) for t in tiles], 1)
Image.fromarray((sheet * 255).astype(np.uint8)).resize((sheet.shape[1] * 3, sheet.shape[0] * 3), Image.NEAREST).save(sys.argv[1], quality=90)
