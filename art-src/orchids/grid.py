"""grid.py out.jpg cols width img... : the images in a grid, each resized to `width` px wide. System python3 + PIL."""
import sys
from PIL import Image
out, cols, w, fs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
ims = [Image.open(f).convert("RGB") for f in fs]; ims = [i.resize((w, int(i.height * w / i.width))) for i in ims]
h = max(i.height for i in ims); rows = (len(ims) + cols - 1) // cols
sh = Image.new("RGB", (cols * w + (cols - 1) * 6, rows * h + (rows - 1) * 6), (18, 18, 18))
for k, i in enumerate(ims): sh.paste(i, ((k % cols) * (w + 6), (k // cols) * (h + 6)))
sh.save(out, quality=88); print(out, sh.size)
