#!/usr/bin/env python3
# The fire salamander's skin maps (6 Oct 2026), made from the owner's photographs (.agents/refs/firesal-1006, kept out of git; no photo pixels are used, only what
# was measured and read off them: the black (sRGB about 24 23 20 as albedo, 35-41 lit), the lemon yellow (236 204 22), where the blotches sit and how big they are).
#   python3 tools/skin/firesal-skin.py <plain.glb> <bones.json> <out_prefix> [--size 1024]
#   plain.glb and bones.json: node tools/rig/firesal-finish.mjs <mouth.glb> --uv --plain ... --bones ...   (the UVs are xatlas's, shared by both levels of detail)
#   writes <out_prefix>_color.png (sRGB) and <out_prefix>_normal.png (tangent space, OpenGL: green up, as the toad's), then
#   python3 tools/skin/clean_normal.py is not needed (the gutter is filled here); convert to WebP and embed with firesal-finish.mjs --color --normal.
# The pattern is a function of the body's own coordinates (z along it, the angle round it, the limb bone and the distance along it), so it does not care how the UVs were cut:
#   black glossy skin; two rows of long irregular lemon blotches down the back and smaller ones on the flanks (alternating); a big stippled parotoid gland behind each eye,
#   a spot above each eye, a throat crescent; a patch on each upper arm and thigh, a band at each wrist and ankle, the toe bases; spots on the tail root;
#   relief: costal grooves (about 12 across the trunk, 0.42 cm apart), a dorsal furrow, pores in the glands, a fine granularity; the inside of the mouth dark red.
import sys, json, struct, math
import numpy as np
from PIL import Image

args = sys.argv[1:]
GLB, BONES, OUT = args[0], args[1], args[2]
SIZE = int(args[args.index('--size') + 1]) if '--size' in args else 1024
SKULL = json.load(open(args[args.index('--skull') + 1])) if '--skull' in args else None          # art-src/skull/firesal.skull.json: the tongue's pad (an ellipse on the floor of the mouth)

# ---- read the plain GLB (positions, normals, uv, vertex colour, indices) -------------------------------------------------------------
def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); off = 20 + jl; bl = struct.unpack('<I', b[off:off + 4])[0]; bin_ = b[off + 8:off + 8 + bl]
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]; dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
        o = v.get('byteOffset', 0) + a.get('byteOffset', 0); isz = np.dtype(dt).itemsize; stride = v.get('byteStride', nc * isz)    # (gltf-transform interleaves a primitive's attributes)
        arr = np.ndarray(shape=(a['count'], nc), dtype=dt, buffer=bin_, offset=o, strides=(stride, isz))
        return arr.astype(np.float64 if dt == np.float32 else np.int64)
    p = j['meshes'][0]['primitives'][0]; at = p['attributes']
    return acc(at['POSITION']) * 100.0, acc(at['NORMAL']), acc(at['TEXCOORD_0']), acc(at['COLOR_0']), acc(p['indices']).reshape(-1, 3)   # cm

P, N, UV, COL, IDX = read_glb(GLB)
TOOTH = (COL[:, 2] > 0.9) & (COL[:, 0] < 0.12)                                       # tools/blender/skull.py marks the teeth blue (and the mouth's lining green)
sk = json.load(open(BONES)); B = sk['bones']
print('mesh', len(P), 'verts', len(IDX), 'tris', 'uv', UV.min(0).round(3), UV.max(0).round(3))

# ---- noise (value noise on a hashed lattice) ------------------------------------------------------------------------------------------
def hsh(i, j, k, s):
    n = (i * 374761393 + j * 668265263 + k * 2147483647 + s * 1274126177) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFF) / float(0xFFFFFF)
def vnoise(p, f, s=0):                       # smooth value noise in [0, 1] at frequency f (cycles per cm)
    q = p * f; i = np.floor(q).astype(np.int64); u = q - i; u = u * u * (3 - 2 * u)
    c = lambda a, b, d: hsh(i[:, 0] + a, i[:, 1] + b, i[:, 2] + d, s)
    x = lambda a, b: c(0, a, b) * (1 - u[:, 0]) + c(1, a, b) * u[:, 0]
    y = lambda b: x(0, b) * (1 - u[:, 1]) + x(1, b) * u[:, 1]
    return y(0) * (1 - u[:, 2]) + y(1) * u[:, 2]
def worley(p, cell):                         # distance (cm) to the nearest jittered lattice point
    q = p / cell; i = np.floor(q).astype(np.int64); best = np.full(len(p), 9.0)
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for d in (-1, 0, 1):
                jx = hsh(i[:, 0] + a, i[:, 1] + b, i[:, 2] + d, 11); jy = hsh(i[:, 0] + a, i[:, 1] + b, i[:, 2] + d, 12); jz = hsh(i[:, 0] + a, i[:, 1] + b, i[:, 2] + d, 13)
                dx = (i[:, 0] + a + jx) - q[:, 0]; dy = (i[:, 1] + b + jy) - q[:, 1]; dz = (i[:, 2] + d + jz) - q[:, 2]
                best = np.minimum(best, np.sqrt(dx * dx + dy * dy + dz * dz))
    return best * cell
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a + 1e-12), 0, 1))

# ---- the body's own coordinates --------------------------------------------------------------------------------------------------------
names = [b['name'] for b in B]
LIMB_NAMES = [n for n in names if n[:-1] in ('thigh', 'shin', 'foot', 'arm', 'forearm', 'hand') and n[-1] in 'LR']
heads = np.array([b['head'] for b in B]); tails = np.array([b['tail'] for b in B]); rad = np.array([b.get('r', 0.3) for b in B])
axial = [i for i, n in enumerate(names) if n in ('pelvis', 'spine', 'neck', 'head') or n.startswith('tail')]
zb = np.linspace(-8.2, 8.2, 83)                                           # the body's middle line, from the vertices nearest the axial bones
def nearest_bone(Q):
    d = np.full((len(Q), len(B)), 1e9); tt = np.zeros((len(Q), len(B)))
    for k, b in enumerate(B):
        if b['name'] == 'jaw': continue
        a, e = heads[k], tails[k]; ab = e - a; L2 = float(ab @ ab) + 1e-9
        t = np.clip(((Q - a) @ ab) / L2, 0, 1); d[:, k] = np.linalg.norm(Q - (a + t[:, None] * ab), axis=1) - rad[k]; tt[:, k] = t
    k = d.argmin(1); return k, tt[np.arange(len(Q)), k], d[np.arange(len(Q)), k]
vk, vt, vd = nearest_bone(P)
is_ax = np.isin(vk, axial)
cx = np.zeros(len(zb)); cy = np.zeros(len(zb))
for i, z in enumerate(zb):
    m = is_ax & (np.abs(P[:, 2] - z) < 0.35)
    if m.sum() > 3: lo, hi = P[m, 0].min(), P[m, 0].max(); cx[i] = (lo + hi) / 2; ylo, yhi = P[m, 1].min(), P[m, 1].max(); cy[i] = (ylo + yhi) / 2
    else: cx[i] = np.nan; cy[i] = np.nan
ok = ~np.isnan(cx); cx = np.interp(zb, zb[ok], cx[ok]); cy = np.interp(zb, zb[ok], cy[ok])
print('body line x', cx[::20].round(2), 'y', cy[::20].round(2))

def body_coords(Q):
    z = Q[:, 2]; lat = Q[:, 0] - np.interp(z, zb, cx); up = Q[:, 1] - np.interp(z, zb, cy)
    return z, np.degrees(np.arctan2(lat, up)), lat, up                    # theta: 0 on the back, + toward +x, 180 on the belly

# ---- the pattern -----------------------------------------------------------------------------------------------------------------------
rs = np.random.RandomState(7)
BLOTCHES = []     # (z, theta, half-length cm, half-width deg, kind)
for k, z in enumerate(np.arange(5.0, -0.6, -1.45)):                        # two rows down the back, alternating: long irregular blotches (the photos: 1.4-2.2 cm long, 0.7-1.1 wide)
    for side in (-1, 1):
        zz = z + (0.7 if side > 0 else 0.0) + rs.uniform(-0.15, 0.15)
        BLOTCHES.append((zz, side * rs.uniform(26, 38), rs.uniform(0.62, 0.95), rs.uniform(17, 26), 'back'))
for z in np.arange(4.6, 0.2, -1.5):                                        # fewer, smaller ones low on the flanks, between the back's
    for side in (-1, 1):
        BLOTCHES.append((z + rs.uniform(-0.2, 0.2) + (0.75 if side > 0 else 0), side * rs.uniform(68, 84), rs.uniform(0.3, 0.48), rs.uniform(10, 15), 'flank'))
for side in (-1, 1):
    BLOTCHES.append((6.15, side * 50, 0.7, 24, 'parotoid'))               # the gland behind the eye (a big oval, the photos)
    BLOTCHES.append((7.45, side * 40, 0.2, 10, 'brow'))                   # the spot over the eye
for z, r, th in ((-0.9, 0.34, 0), (-1.75, 0.3, 14), (-1.9, 0.28, -16), (-2.7, 0.24, 0), (-3.5, 0.18, 12)):   # the tail's root
    BLOTCHES.append((z, th, r, 26, 'tail'))
def ellipse(z, th, z0, t0, az, ath, w):
    zw = z + 0.11 * (w[0] - 0.5); tw = th + 7 * (w[1] - 0.5)
    dt = (tw - t0 + 180) % 360 - 180
    return ((zw - z0) / az) ** 2 + (dt / ath) ** 2
def yellow_body(Q, w1, w2, wp):
    z, th, lat, up = body_coords(Q); m = np.zeros(len(Q)); par = np.zeros(len(Q))
    for (z0, t0, az, ath, kind) in BLOTCHES:
        e = ellipse(z, th, z0, t0, az, ath, (w1, w2)); v = sstep(1.12, 0.88, e)
        m = np.maximum(m, v)
        if kind == 'parotoid': par = np.maximum(par, v)
    # the throat's crescent, on the belly side of the head: an ellipse minus a shifted one
    dth = (th - 180 + 180) % 360 - 180
    cres = sstep(1.1, 0.9, ((z - 7.0) / 0.5) ** 2 + (dth / 48) ** 2) * (1 - sstep(1.1, 0.9, ((z - 7.28) / 0.5) ** 2 + (dth / 48) ** 2))
    m = np.maximum(m, cres)
    return m, par
def limb_info(Q, k, t):
    nm = names[k]; base = nm[:-1]; side = nm[-1]
    return base, t
def yellow_limb(Q, k, t, nrm_up):
    base = np.array([names[i][:-1] for i in k]); m = np.zeros(len(Q))
    f = lambda cond: cond.astype(float)
    m = np.maximum(m, f(base == 'arm') * sstep(0.3, 0.42, t) * sstep(0.85, 0.72, t) * sstep(-0.1, 0.3, nrm_up))      # the upper arm's patch, on top
    m = np.maximum(m, f(base == 'forearm') * sstep(0.55, 0.62, t) * sstep(0.98, 0.9, t))                              # the wrist's band
    m = np.maximum(m, f(base == 'hand') * sstep(0.5, 0.4, t) * sstep(-0.2, 0.2, nrm_up))                               # the toe bases
    m = np.maximum(m, f(base == 'thigh') * sstep(0.28, 0.4, t) * sstep(0.8, 0.68, t) * sstep(-0.1, 0.3, nrm_up))     # the thigh's patch
    m = np.maximum(m, f(base == 'shin') * sstep(0.55, 0.62, t) * sstep(0.98, 0.9, t))                                  # the ankle's band
    m = np.maximum(m, f(base == 'foot') * sstep(0.45, 0.35, t) * sstep(-0.2, 0.2, nrm_up))
    return m
BLACK = np.array([24, 23, 20.0]); YEL = np.array([236, 204, 22.0]); MOUTH = np.array([112, 26, 40.0])

def fields(Q, Nn, ctx, with_colour):
    """Yellow share, relief height (cm) and, if asked, the sRGB colour at the points Q (cm) with normals Nn, for texels of kind ctx."""
    n = len(Q); R = np.array([[0.8, -0.6, 0.0], [0.6, 0.8, 0.0], [0.0, 0.0, 1.0]]); Qr = Q @ R.T                      # (a turned lattice and two octaves hide value noise's cell edges)
    w1 = 0.7 * vnoise(Qr, 2.2, 3) + 0.3 * vnoise(Qr, 5.7, 4); w2 = 0.7 * vnoise(Qr, 2.6, 5) + 0.3 * vnoise(Qr, 6.3, 6); wp = vnoise(Q, 1.0, 9)
    z, th, lat, up = body_coords(Q)
    Y = np.zeros(n); par = np.zeros(n)
    yb, pb = yellow_body(Q, w1, w2, wp); Y = np.where(ctx['limb'], 0.0, yb); par = np.where(ctx['limb'], 0.0, pb)
    if ctx['limb'].any():
        ylb = yellow_limb(Q, ctx['bone'], ctx['t'], Nn[:, 1])
        Y = np.where(ctx['limb'], ylb * sstep(0.35, 0.65, w1 + 0.15), Y)
    h = 0.012 * (vnoise(Q, 24, 21) - 0.5) + 0.006 * (vnoise(Q, 60, 22) - 0.5)                                       # fine granularity
    body = ~ctx['limb']
    # costal grooves across the flanks of the trunk (z 0.2 to 5.6), about 0.42 cm apart, wobbling a little
    ph = (z - 0.2 + 0.05 * (w1 - 0.5)) / 0.42; fr = ph - np.floor(ph)
    gro = np.exp(-((fr - 0.5) / 0.13) ** 2) * sstep(24, 52, np.abs(th)) * sstep(165, 120, np.abs(th)) * sstep(0.0, 0.35, z) * sstep(5.7, 5.3, z)
    h = h - 0.032 * gro * body
    h = h - 0.02 * np.exp(-(lat / 0.14) ** 2) * sstep(35, 12, np.abs(th)) * sstep(5.5, 5.0, z) * sstep(-4.0, -3.0, z) * body    # the dorsal furrow
    # the mouth line (owner's mouth rule, tools/rig/skull.mjs: the lip surface is the tooth line): a fine crease along the lip surface from the snout to the mouth angle, a darker
    # groove on both lips (tools/blender/firesal-mouth.py cut the head there: the two lips are separate surfaces meeting on the plane); it fades out at the mouth angle
    lipv = Q[:, 1] - (2.178 + 0.0595 * (Q[:, 2] - 5.8))
    lg = np.exp(-(lipv / 0.022) ** 2) * sstep(5.72, 5.95, Q[:, 2]) * (np.abs(Q[:, 0] + 0.45) < 1.35) * body
    h = h - 0.03 * lg
    # glands: a little proud, pitted with pores, in the parotoids and the back blotches
    gl = np.maximum(par, 0.55 * Y * body)
    if (gl > 0.05).any():
        sel = gl > 0.05; d = worley(Q[sel], 0.11); pore = np.exp(-(d / 0.028) ** 2)
        h[sel] += 0.02 * gl[sel] - 0.03 * gl[sel] * pore
    out = {'Y': Y, 'h': h}
    if with_colour:
        base = BLACK[None, :] + (vnoise(Q, 9, 31) - 0.5)[:, None] * np.array([4, 4, 3.0])[None, :]
        yel = YEL[None, :] + (vnoise(Q, 14, 32) - 0.5)[:, None] * np.array([14, 18, 10.0])[None, :]
        rim = sstep(0.0, 0.5, Y) * (1 - sstep(0.5, 1.0, Y)) * 0.18                                                  # a touch of orange at the blotch edge
        yel = yel * (1 - rim[:, None]) + np.array([225, 150, 15.0])[None, :] * rim[:, None]
        col = base * (1 - Y[:, None]) + yel * Y[:, None]
        out['col'] = col * (1 - 0.5 * lg[:, None])
    return out

import os
if os.environ.get('FS_DEBUG'):          # evaluate the pattern at the mesh vertices and say where the yellow is (no maps written)
    limbv = np.array([names[i] in LIMB_NAMES for i in vk]) & (vd < 0.35)
    fv = fields(P, N, {'limb': limbv, 'bone': vk, 't': vt}, False)
    z, th, lat, up = body_coords(P)
    for lo, hi in ((7.4, 8.1), (6.9, 7.4), (6.0, 6.9), (5.0, 6.0), (2.0, 5.0), (-0.5, 2.0), (-4.0, -0.5)):
        m = (z >= lo) & (z < hi) & ~limbv; y = m & (fv['Y'] > 0.5)
        print('z %5.1f..%4.1f: %5d verts, yellow %4.0f %%, theta of the yellow:' % (lo, hi, m.sum(), 100 * y.sum() / max(1, m.sum())), np.percentile(th[y], [5, 50, 95]).round(0) if y.sum() else '-')
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (1700, 700), (25, 25, 28)); d = ImageDraw.Draw(im); sc = 50
    for k in range(len(P)):
        c = (255, 220, 30) if fv['Y'][k] > 0.5 else (70, 70, 80)
        if N[k, 1] > 0.1: d.point((850 + P[k, 2] * -0 + (P[k, 2]) * sc - 0, 340 - P[k, 0] * sc * 1.0), fill=c) if False else None
        if N[k, 1] > 0.0: d.point((100 + (8 - P[k, 2]) * sc, 120 - P[k, 0] * sc), fill=c)           # top view, head to the left
        if abs(N[k, 0]) > 0.3: d.point((100 + (8 - P[k, 2]) * sc, 330 + (3 - P[k, 1]) * sc), fill=c)   # side view (flanks)
    d.text((10, 5), 'TOP (x vs z, head left)', fill=(255, 255, 255)); d.text((10, 200), 'SIDE (flanks, head left)', fill=(255, 255, 255))
    im.save('../firesal/renders/yellow_debug.png')
    print('blotches near the snout:', [(round(b[0], 2), round(b[1]), b[4]) for b in BLOTCHES if b[0] > 6.8])
    sys.exit(0)
# ---- rasterise the UV layout, then evaluate ---------------------------------------------------------------------------------------------
S = SIZE
pos = np.zeros((S, S, 3)); nor = np.zeros((S, S, 3)); vcol = np.zeros((S, S, 3)); cov = np.zeros((S, S), bool)
Tn = np.zeros((S, S, 3)); Bn = np.zeros((S, S, 3)); tmouth = np.zeros((S, S), bool)
for t in range(len(IDX)):
    i0, i1, i2 = IDX[t]
    if TOOTH[i0] and TOOTH[i1] and TOOTH[i2]: continue                                   # teeth share one strip of the atlas (painted below)
    q = UV[[i0, i1, i2]] * S                                                  # glTF's own orientation: v runs down the image (row = v * S), as the game samples it
    x0, y0 = np.floor(q.min(0)).astype(int).clip(0, S - 1); x1, y1 = np.ceil(q.max(0)).astype(int).clip(0, S - 1)
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    v0, v1 = q[1] - q[0], q[2] - q[0]; den = v0[0] * v1[1] - v1[0] * v0[1]
    if abs(den) < 1e-9: continue
    w1 = ((xs - q[0, 0]) * v1[1] - v1[0] * (ys - q[0, 1])) / den; w2 = (v0[0] * (ys - q[0, 1]) - (xs - q[0, 0]) * v0[1]) / den; w0 = 1 - w1 - w2
    m = (w0 >= -.02) & (w1 >= -.02) & (w2 >= -.02) & ~cov[y0:y1 + 1, x0:x1 + 1]
    if not m.any(): continue
    e1, e2 = P[i1] - P[i0], P[i2] - P[i0]; duv1, duv2 = UV[i1] - UV[i0], UV[i2] - UV[i0]; det = duv1[0] * duv2[1] - duv2[0] * duv1[1]
    if abs(det) < 1e-14: continue
    Pu = (e1 * duv2[1] - e2 * duv1[1]) / det; Pv = (e2 * duv1[0] - e1 * duv2[0]) / det
    sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
    for arr, A in ((pos, P), (nor, N), (vcol, COL)):
        arr[sl][m] = w0[m, None] * A[i0] + w1[m, None] * A[i1] + w2[m, None] * A[i2]
    tmouth[sl][m] = all(COL[i, 1] > 0.7 and COL[i, 0] < 0.25 and COL[i, 2] < 0.25 for i in (i0, i1, i2))      # a mouth texel is in a triangle that is green at all three corners (the lip's outer skin shares its edge vertices with the cavity)
    Tn[sl][m] = Pu / (np.linalg.norm(Pu) + 1e-12); Bn[sl][m] = Pv / (np.linalg.norm(Pv) + 1e-12)
    cov[sl] |= m
print('texels covered', round(cov.mean(), 3))
yy, xx = np.nonzero(cov)
Q = pos[yy, xx]; Nn = nor[yy, xx]; Nn /= np.linalg.norm(Nn, axis=1, keepdims=True) + 1e-12; Tt = Tn[yy, xx]; Bt = Bn[yy, xx]
k, t, d = nearest_bone(Q)
limb = np.array([names[i] in LIMB_NAMES for i in k]) & (d < 0.35)
ctx = {'limb': limb, 'bone': k, 't': t}
f0 = fields(Q, Nn, ctx, True)
eps = 0.02                                                                       # cm: the step for the relief's gradient
h0 = f0['h']; hT1 = fields(Q + eps * Tt, Nn, ctx, False)['h']; hB1 = fields(Q + eps * Bt, Nn, ctx, False)['h']
gT = (hT1 - h0) / eps; gB = (hB1 - h0) / eps
nts = np.stack([-gT, gB, np.ones_like(gT)], 1)                                  # OpenGL, green up = toward -v of the file (the game's NORMALMAP_GREEN = -1 undoes the glTF flip); nts /= np.linalg.norm(nts, axis=1, keepdims=True)
# the inside of the mouth: the vertex colour is red there (tools/blender/firesal-mouth.py): dark red, no relief
mouth = tmouth[yy, xx]          # tools/blender/firesal-mouth.py paints the inside of the mouth pure green
print('mouth texels', int(mouth.sum()), 'in 3D x', Q[mouth].min(0).round(2), 'to', Q[mouth].max(0).round(2))
_lv = Q[:, 1] - (2.178 + 0.0595 * (Q[:, 2] - 5.8)); _nl = (np.abs(_lv) < 0.03) & (Q[:, 2] > 5.95) & (np.abs(Q[:, 0] + 0.45) < 1.35)
print('texels on the lip surface', int(_nl.sum()), '| of them in the mouth mask', int((_nl & mouth).sum()), '| groove depth range', round(float((f0['h'][_nl]).min()), 3) if _nl.any() else '-')
if os.environ.get('FS_STOP'): sys.exit(0)
col = f0['col'].copy()
# the lining of the mouth (6 Oct, the owner: "refine the inside of the mouth adding a tongue and teeth skin cover"): a pink-red palate with the vomers' ridges, a darker floor, a lighter tongue pad with
# papillae, a pale gum along the tooth rows; relief on the tongue (papillae) and a fine grain on the rest
Qm = Q[mouth]; lipq = 2.178 + 0.0595 * (Qm[:, 2] - 5.8); dyq = Qm[:, 1] - lipq
tg = SKULL['dress']['tongue'] if SKULL and SKULL.get('dress') else None
def tongue_of(Qx):
    if tg is None: return np.zeros(len(Qx), bool)
    return (np.hypot((Qx[:, 0] - tg['cx']) / tg['ax'], (Qx[:, 2] - tg['cz']) / tg['az']) < 1.04) & (Qx[:, 1] - (2.178 + 0.0595 * (Qx[:, 2] - 5.8)) < 0.0)
tng = tongue_of(Qm); roof = dyq > 0.02
grain = (vnoise(Qm, 10, 41) - 0.5)[:, None]; mott = (vnoise(Qm, 4, 43) - 0.5)[:, None]
lin = np.where(roof[:, None], np.array([172, 62, 74.0])[None, :], np.array([150, 48, 60.0])[None, :])
lin = np.where(tng[:, None], np.array([200, 92, 102.0])[None, :], lin)
gum = (1 - sstep(0.012, 0.05, np.abs(dyq))) * (~tng)
lin = lin * (1 - gum[:, None]) + np.array([218, 132, 136.0])[None, :] * gum[:, None]
lin = lin + grain * np.array([20, 8, 10.0])[None, :] + mott * np.array([18, 10, 10.0])[None, :] * 1.0
pap = np.exp(-(worley(Qm, 0.05) / 0.017) ** 2) * tng                                         # papillae: small pale bumps, a little paler
lin = lin + pap[:, None] * np.array([18, 16, 14.0])[None, :]
col[mouth] = lin
def hmouth(Qx):
    t_ = tongue_of(Qx); return 0.011 * np.exp(-(worley(Qx, 0.05) / 0.017) ** 2) * t_ + 0.004 * (vnoise(Qx, 30, 44) - 0.5)
hm0 = hmouth(Qm); gTm = (hmouth(Qm + eps * Tt[mouth]) - hm0) / eps; gBm = (hmouth(Qm + eps * Bt[mouth]) - hm0) / eps
nm = np.stack([-gTm, gBm, np.ones_like(gTm)], 1); nm /= np.linalg.norm(nm, axis=1, keepdims=True)
nts[mouth] = nm
img = np.zeros((S, S, 3), np.float32); nimg = np.zeros((S, S, 3), np.float32); nimg[..., :] = [0.5, 0.5, 1.0]
img[yy, xx] = np.clip(col, 0, 255) / 255.0; nimg[yy, xx] = nts * 0.5 + 0.5
# fill the gutter outward so bilinear filtering and mipmaps never reach the background
def fill(a, mask, iters=8):
    a = a.copy(); mask = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(a); cnt = np.zeros(mask.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0: continue
                sm = np.roll(np.roll(mask, dy, 0), dx, 1); sa = np.roll(np.roll(a, dy, 0), dx, 1)
                acc += sa * sm[..., None]; cnt += sm
        new = (~mask) & (cnt > 0); a[new] = acc[new] / cnt[new][:, None]; mask |= new
    return a
img = fill(img, cov); nimg = fill(nimg, cov)
# the teeth's strip (u 0.985-0.995, v 0.08 base to 0.92 tip: tools/rig/firesal-finish.mjs): gum pink at the root, ivory enamel toward the tip, a faint warm tip
x0 = int(0.975 * S)
for r in range(S):
    t = np.clip(((r + 0.5) / S - 0.08) / 0.84, 0, 1); k = sstep(0.12, 0.38, t)
    c = (np.array([214, 130, 134.0]) * (1 - k) + np.array([236, 230, 212.0]) * k) * (1 - 0.06 * sstep(0.85, 1.0, t)) / 255.0
    img[r, x0:, :] = c; nimg[r, x0:, :] = [0.5, 0.5, 1.0]
Image.fromarray((np.clip(img, 0, 1) * 255 + .5).astype(np.uint8)).save(OUT + '_color.png')
Image.fromarray((np.clip(nimg, 0, 1) * 255 + .5).astype(np.uint8)).save(OUT + '_normal.png')
Yl = f0['Y']; print('yellow share of the skin %.1f %%' % (100 * (Yl > 0.5).mean()), '| relief height range cm', round(float(f0['h'].min()), 3), round(float(f0['h'].max()), 3), '| mean normal tilt deg %.1f' % float(np.degrees(np.arccos(nts[:, 2])).mean()))
print('wrote', OUT + '_color.png', OUT + '_normal.png')
