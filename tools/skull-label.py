# Labels the skull x-ray renders (tools/blender/skull.py) with the bone codes of the plate, side and top, and lays the views out as one sheet.
#   python3 tools/skull-label.py art-src/skull/firesal.skull.json ../firesal/renders/skull   -> <prefix>_sheet.png (side, side_open, top, palate)
import json, sys
from PIL import Image, ImageDraw, ImageFont
SK, PRE = sys.argv[1], sys.argv[2]
D = json.load(open(SK)); K = 900 / 0.034                                  # pixels per metre (orthographic scale 3.4 cm over 900 px)
cx = (D['hinge'][0]['at'][0] + D['hinge'][1]['at'][0]) / 200.0; cy, cz = -6.7 / 100, 2.4 / 100          # the cameras' centre in Blender metres (x, y = -z_baked, z = y_baked)
font = ImageFont.load_default(size=22); small = ImageFont.load_default(size=17)
def side(p): return (450 + (-p[2] / 100 - cy) * K, 450 - (p[1] / 100 - cz) * K)       # from +x, head to the left
def top(p): return (450 - (p[0] / 100 - cx) * K, 450 + (-p[2] / 100 - cy) * K)        # from above, head up
def labelled(name, proj, which):
    im = Image.open(f'{PRE}_{name}.png').convert('RGB'); dr = ImageDraw.Draw(im); seen = {}
    for b in D['bones']:
        if b['name'].endswith('.L') and which == 'side': continue                        # the near side only (+x) in the side view
        if b['name'].endswith('.L') and which == 'top': continue
        part = b['parts'][0]; c = part['c'] if part['k'] == 'ell' else part['pts'][len(part['pts']) // 2][:3]
        if b['code'] in seen and which == 'top' and not b['name'].endswith('.R'): continue
        x, y = proj(c); seen[b['code']] = (x, y)
        dr.text((x + 6, y - 22), b['code'], fill=(255, 235, 130), font=small, stroke_width=2, stroke_fill=(20, 20, 24))
    dr.text((14, 12), f"fire salamander skull (schematic) - {which}", fill=(235, 235, 240), font=font, stroke_width=2, stroke_fill=(20, 20, 24))
    return im
tiles = [labelled('side', side, 'side'), labelled('side_open', side, 'side, jaw open 34 deg'), labelled('top', top, 'top'), Image.open(f'{PRE}_palate.png').convert('RGB')]
dr = ImageDraw.Draw(tiles[3]); dr.text((14, 12), 'roof of the mouth from below (jaw and skin away)', fill=(235, 235, 240), font=font, stroke_width=2, stroke_fill=(20, 20, 24))
sheet = Image.new('RGB', (1800, 1800)); [sheet.paste(t, ((i % 2) * 900, (i // 2) * 900)) for i, t in enumerate(tiles)]
sheet.save(f'{PRE}_sheet.png'); print('wrote', f'{PRE}_sheet.png')
