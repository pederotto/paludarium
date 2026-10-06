"""strip.py out.jpg img1 img2 ... : the images side by side at one height (render | render | photo). System python3 + PIL."""
import sys
from PIL import Image
out, fs = sys.argv[1], sys.argv[2:]
H = 440
ims = []
for f in fs:
    im = Image.open(f).convert("RGB"); ims.append(im.resize((max(1, int(im.width * H / im.height)), H)))
W = sum(i.width for i in ims)
sheet = Image.new("RGB", (W, H), (18, 18, 18)); x = 0
for i in ims: sheet.paste(i, (x, 0)); x += i.width
sheet.save(out, quality=88); print(out, sheet.size)
