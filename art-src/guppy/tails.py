"""The twelve guppy tails (veil, flag, fan, delta, double sword, lyre, round, pin, top sword, bottom sword, spear, spade: the Encyclo-Fish
shapes sheet) built on the owner's male (art-src/guppy/out/male.glb, made by prep_glb.py), for the game to put in place of his own tail.

Each tail is a clean membrane: rays fan out from a short base inside the end of the tail stalk (so the join never shows) to the tail's
outline, which is drawn from the sheet in units of the standard length. Its surface and its texture come from the owner's own tail: every
point of a new tail looks up the point at the same place in the owner's tail (across the rays, out along them) and takes its sideways
wave, its UVs (so the strain painter, src/render/creatures/guppypaint.js, paints it like the owner's tail) and its thickness. Two
sheets, front and back, as the game draws membranes one-sided.

  blender -b --factory-startup -P art-src/guppy/tails.py -- <male.glb> <male-parts.png> <out dir> [--render=<sheet.png>]

Writes <out>/tails.glb and tails.lo.glb (a mesh 'tail_<shape>' for each tail, material 'guppy_fin'), <out>/tails.json (per tail: length,
height, triangles, folded triangles: must be 0).
"""
import sys, os, math, json
import bpy, bmesh, mathutils, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

a_ = sys.argv[sys.argv.index('--') + 1:]
SRC, PARTS, OUT = a_[0], a_[1], a_[2]
OPT = dict(x[2:].split('=', 1) for x in a_[3:] if x.startswith('--') and '=' in x)
SL = float(OPT.get('sl', 2.2))
RES = {'hi': 0.04, 'lo': 0.085}
TLOOK = 0.78
PLEAT, NPLEAT, BILLOW = 0.009, 14, 0.05
FRAY_CM = 0.09                                               # the margin the game thins and frays (cm from the rim)                      # cm of pleat along the rays, pleats across the fin, cm of billow
# the tails' texture strip: below the male's own atlas (W x W), STRIP_H texels high, in the game's maps (tools/guppy-import.mjs pads them)
W_ATLAS, STRIP_H = 512, 256
H_ATLAS = W_ATLAS + STRIP_H
def strip_uv(a, t):
    """(u, v) of ray coordinates in the game's convention (v down the image)."""
    return (0.5 + a * (W_ATLAS - 1)) / W_ATLAS, (W_ATLAS + 0.5 + t * (STRIP_H - 1)) / H_ATLAS                          # spacing of the mesh (cm)
os.makedirs(OUT, exist_ok=True)

# Outlines from the sheet, in standard lengths: x back from the end of the stalk, y up from the body axis there. From the bottom of the
# stalk round to its top; '!' marks a sharp point (a sword's or the lyre's tip).
SHAPES = {
    'delta':       [(0, -.10), (.30, -.27), (.72, -.46, '!'), (.75, -.16), (.76, 0), (.75, .16), (.72, .46, '!'), (.30, .27), (0, .10)],
    'veil':        [(0, -.10), (.36, -.28), (.80, -.42, '!'), (.74, -.12), (.66, .12), (.58, .32, '!'), (.26, .24), (0, .10)],
    'flag':        [(0, -.10), (.06, -.16), (.40, -.18), (.70, -.19, '!'), (.72, 0), (.70, .19, '!'), (.40, .18), (.06, .16), (0, .10)],
    'fan':         [(0, -.10), (.28, -.24), (.54, -.33), (.62, -.18), (.65, 0), (.62, .18), (.54, .33), (.28, .24), (0, .10)],
    'round':       [(0, -.10), (.12, -.18), (.28, -.21), (.40, -.15), (.45, 0), (.40, .15), (.28, .21), (.12, .18), (0, .10)],
    'spade':       [(0, -.10), (.10, -.19), (.26, -.22), (.34, -.16), (.37, 0), (.34, .16), (.26, .22), (.10, .19), (0, .10)],
    'spear':       [(0, -.10), (.10, -.17), (.24, -.21), (.44, -.11), (.66, 0, '!'), (.44, .11), (.24, .21), (.10, .17), (0, .10)],
    'pin':         [(0, -.10), (.12, -.18), (.26, -.16), (.36, -.07), (.52, -.02), (.82, 0, '!'), (.52, .02), (.36, .07), (.26, .16), (.12, .18), (0, .10)],
    # (the swords and the lyre from the owner's photos, 7 Oct: broad lobes from the stalk tapering to fine tips, a deep V between them)
    'topsword':    [(0, -.10), (.12, -.16), (.28, -.15), (.40, -.07), (.54, .03), (.98, .12, '!'), (.56, .20), (.28, .21), (.10, .16), (0, .10)],
    'bottomsword': [(0, -.10), (.10, -.17), (.32, -.23), (.62, -.31), (.95, -.40, '!'), (.60, -.18), (.44, -.06), (.32, .08), (.14, .15), (0, .10)],
    'doublesword': [(0, -.10), (.15, -.18), (.45, -.23), (.95, -.25, '!'), (.62, -.13), (.42, -.04), (.36, 0), (.42, .04), (.62, .13), (.95, .25, '!'), (.45, .23), (.15, .18), (0, .10)],
    'lyre':        [(0, -.10), (.20, -.25), (.48, -.39), (.84, -.50, '!'), (.60, -.26), (.48, -.10), (.44, 0), (.48, .10), (.60, .26), (.84, .50, '!'), (.48, .39), (.20, .25), (0, .10)],
}

# ---- the owner's male ------------------------------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
me = ob.data
bm = bmesh.new(); bm.from_mesh(me); bm.transform(ob.matrix_world)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
uvl = bm.loops.layers.uv.active
isfin = [me.materials[f.material_index].name.startswith('guppy_fin') for f in bm.faces]
body = [f for f, k in zip(bm.faces, isfin) if not k]
BV = np.array([v.co[:] for f in body for v in f.verts])
y_end = float(BV[:, 1].max())                             # the end of the stalk (the head is toward -y)
ring = BV[(BV[:, 1] > y_end - 0.09) & (BV[:, 1] < y_end - 0.03)]
zc = float((ring[:, 2].max() + ring[:, 2].min()) / 2); hh = float((ring[:, 2].max() - ring[:, 2].min()) / 2)
# the tail: the fin faces behind a line CAUDAL_AHEAD cm ahead of the stalk's end (its lobes reach forward over and under the stalk; the
# dorsal fin ends 0.5 cm and the belly fins 0.6 cm ahead of the end: the game removes the same faces, guppymodel.js)
CAUDAL_AHEAD = 0.4
caud = [f for f, k in zip(bm.faces, isfin) if k and f.calc_center_median().y > y_end - CAUDAL_AHEAD]
fpart = [200 if (k and f.calc_center_median().y > y_end - CAUDAL_AHEAD) else 0 for f, k in zip(bm.faces, isfin)]
print('FACES caudal', len(caud), 'body', len(body), 'of', len(bm.faces))
print(f'STALK end y {y_end:.3f}  axis z {zc:.3f}  half height {hh:.3f} cm ({hh / SL:.3f} SL)')

tris = [[v.co.copy() for v in f.verts] for f in caud]
tuv = [[l[uvl].uv.copy() for l in f.loops] for f in caud]
# UV islands of the owner's tail: triangles joined across an edge whose two ends have the same UVs in both
cidx = {f: i for i, f in enumerate(caud)}; par = list(range(len(caud)))
def root(i):
    while par[i] != i: par[i] = par[par[i]]; i = par[i]
    return i
for f in caud:
    for l in f.loops:
        for g in l.edge.link_faces:
            if g is f or g not in cidx: continue
            uf = {v.index: l2[uvl].uv.copy() for l2 in f.loops for v in [l2.vert]}
            ug = {v.index: l2[uvl].uv.copy() for l2 in g.loops for v in [l2.vert]}
            if all((uf[v.index] - ug[v.index]).length < 1e-5 for v in l.edge.verts): par[root(cidx[f])] = root(cidx[g])
island = [root(i) for i in range(len(caud))]
print('ISLANDS of the owner tail', len(set(island)))
T = BVHTree.FromPolygons([c for t in tris for c in t], [[3 * i, 3 * i + 1, 3 * i + 2] for i in range(len(tris))])
def bary(t, p):
    a, b, c = t; v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
    den = d00 * d11 - d01 * d01 or 1e-12
    v = (d11 * d20 - d01 * d21) / den; w = (d00 * d21 - d01 * d20) / den
    return 1 - v - w, v, w
def hit(y, z, side):
    h = T.ray_cast(Vector((3 * side, y, z)), Vector((-side, 0, 0)), 6)
    if h[0] is None: return None
    i = h[2]; u, v, w = bary(tris[i], h[0]); q = tuv[i]
    return h[0].x, (q[0] * u + q[1] * v + q[2] * w)

# where the owner's tail is, seen from the side: rays out from the middle of the stalk's end, the farthest point of tail on each
r_c = Vector((0, y_end - 0.04 * SL, zc))
STEP = 0.006
def on_tail(y, z): return T.ray_cast(Vector((3, y, z)), Vector((-1, 0, 0)), 6)[0] is not None
TH = np.radians(np.arange(-178, 178.1, 0.5)); RS = np.zeros(len(TH))
for k, th in enumerate(TH):
    r = 0.0; far = 0.0
    while r < 2.5 * SL:
        if on_tail(r_c.y + r * math.cos(th), r_c.z + r * math.sin(th)): far = r
        r += STEP
    RS[k] = far
ok = RS > 0.12 * SL
i0 = int(np.argmin(np.abs(TH)))
lo_i = i0
while lo_i > 0 and ok[lo_i - 1]: lo_i -= 1
hi_i = i0
while hi_i < len(TH) - 1 and ok[hi_i + 1]: hi_i += 1
TH0, TH1 = TH[lo_i], TH[hi_i]
print(f'OWNER TAIL spread {math.degrees(TH0):.0f} .. {math.degrees(TH1):.0f} deg, reach {RS.max():.2f} cm ({RS.max() / SL:.2f} SL)')
def hit_tri(y, z, side):
    h = T.ray_cast(Vector((3 * side, y, z)), Vector((-side, 0, 0)), 6)
    return None if h[0] is None else (h[0].x, h[2])
def uv_at(i, y, z, side):
    """UV of the point (y, z) for a triangle whose UVs come from owner triangle i's island: the owner triangle under the point when it
    is in that island, else i's plane extrapolated (across a seam)."""
    h = hit_tri(y, z, side)
    if h and island[h[1]] == island[i]: return uv_in(h[1], y, z)
    return uv_in(i, y, z)
def uv_in(i, y, z):
    """UV of the point (y, z) in the plane of owner triangle i, seen from the side (extrapolated past its edges if need be)."""
    A, Bv, C = [Vector((0, c.y, c.z)) for c in tris[i]]
    u, v, w = bary((A, Bv, C), Vector((0, y, z)))
    u, v, w = (max(-1.5, min(2.5, k)) for k in (u, v, w)); q = tuv[i]
    return q[0] * u + q[1] * v + q[2] * w
def owner_at(a, t):
    """The owner's tail at (a across the rays 0 bottom … 1 top, t out along them 0 … 1): the point seen from the side (y, z), the
    middle of its membrane x, half its thickness, and the owner triangles hit on the front and the back."""
    th = TH0 + (0.02 + 0.96 * a) * (TH1 - TH0); R = float(np.interp(th, TH, RS))
    # (inside the stalk there is no tail: the nearest tail out along the same ray, else back toward the stalk)
    for tt in [t] + [t + d for d in np.arange(0.02, 1.0 - t + 1e-9, 0.02)] + [t - d for d in np.arange(0.02, t + 1e-9, 0.02)]:
        r = max(tt, 0.02) * R * 0.985
        y, z = r_c.y + r * math.cos(th), r_c.z + r * math.sin(th)
        f, b = hit_tri(y, z, 1), hit_tri(y, z, -1)
        if f and b: return y, z, (f[0] + b[0]) / 2, max(0.0025, min(0.012, (f[0] - b[0]) / 2)), f[1], b[1]
    raise RuntimeError(f'no owner tail near a={a:.2f} t={t:.2f}')

# ---- outlines ----------------------------------------------------------------------------------------------------------------------
def outline(pts):
    """Centripetal Catmull-Rom through the points (a sharp point is passed twice: a corner), sampled finely."""
    P = []
    for p in pts:
        q = Vector((y_end + p[0] * SL, zc + p[1] * SL))
        P.append(q)
        if len(p) > 2: P.append(q.copy())
    ext = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        if (p2 - p1).length < 1e-9: continue
        t0 = 0; t1 = t0 + max((p1 - p0).length, 1e-6) ** 0.5; t2 = t1 + (p2 - p1).length ** 0.5; t3 = t2 + max((p3 - p2).length, 1e-6) ** 0.5
        for s in np.linspace(t1, t2, 24, endpoint=False):
            a1 = p0 * ((t1 - s) / (t1 - t0)) + p1 * ((s - t0) / (t1 - t0)); a2 = p1 * ((t2 - s) / (t2 - t1)) + p2 * ((s - t1) / (t2 - t1))
            a3 = p2 * ((t3 - s) / (t3 - t2)) + p3 * ((s - t2) / (t3 - t2))
            b1 = a1 * ((t2 - s) / (t2 - t0)) + a2 * ((s - t0) / (t2 - t0)); b2 = a2 * ((t3 - s) / (t3 - t1)) + a3 * ((s - t1) / (t3 - t1))
            out.append(b1 * ((t2 - s) / (t2 - t1)) + b2 * ((s - t1) / (t2 - t1)))
    out.append(P[-1])
    return out
def resample(curve, n):
    L = [0.0]
    for i in range(1, len(curve)): L.append(L[-1] + (curve[i] - curve[i - 1]).length)
    L = np.array(L); s = np.linspace(0, L[-1], n); res = []
    for x in s:
        j = min(len(curve) - 2, int(np.searchsorted(L, x, side='right') - 1)); f = (x - L[j]) / max(L[j + 1] - L[j], 1e-12)
        res.append(curve[j].lerp(curve[j + 1], f))
    return res

def inside(poly, P):
    """Even-odd test of points P (n x 2) against the polygon (m x 2)."""
    x, y = P[:, 0], P[:, 1]; res = np.zeros(len(P), bool)
    for k in range(len(poly)):
        (x1, y1), (x2, y2) = poly[k], poly[(k + 1) % len(poly)]
        c = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1)
        res ^= c
    return res
def seg_dist(poly, P):
    d = np.full(len(P), 1e9)
    for k in range(len(poly)):
        A = poly[k]; Bq = poly[(k + 1) % len(poly)]; AB = Bq - A; L2 = max(AB @ AB, 1e-12)
        t = np.clip(((P - A) @ AB) / L2, 0, 1); Q = A + t[:, None] * AB
        d = np.minimum(d, np.hypot(*(P - Q).T))
    return d

def build(shape, h):
    """The tail as a constrained Delaunay mesh of its outline (no triangle can fold), with ray coordinates (a, t) per vertex: a by
    a harmonic field (0 the bottom ray … 1 the top ray along the outline, straight up the base), t the distance from the base through
    the membrane over the outline's distance at that ray (or the farthest, for a sword: a sword's length runs out along it)."""
    yb, hb = y_end - 0.05 * SL, 0.8 * hh
    ends = [(-0.05, -hb / SL)], [(-0.05, hb / SL)]
    curve = outline(ends[0] + SHAPES[shape] + ends[1])
    L = sum((curve[i + 1] - curve[i]).length for i in range(len(curve) - 1))
    rim = resample(curve, max(24, int(L / (0.6 * h))))
    nb = max(3, int(2 * hb / h))
    base = [Vector((yb, zc + hb - 2 * hb * k / nb)) for k in range(1, nb)]          # top to bottom, ends excluded (they are rim[-1], rim[0])
    poly = rim + base; npoly = len(poly)
    P2 = np.array([[p.x, p.y] for p in poly])
    lo2, hi2 = P2.min(0), P2.max(0); pts = []
    for r_, yy in enumerate(np.arange(lo2[1], hi2[1], h * 0.866)):
        xs = np.arange(lo2[0] + (h / 2 if r_ % 2 else 0), hi2[0], h)
        pts += [(x, yy) for x in xs]
    Q = np.array(pts); Q = Q[inside(P2, Q)]; Q = Q[seg_dist(P2, Q) > 0.45 * h]
    allv = [Vector(p) for p in P2] + [Vector(q) for q in Q]
    vo, eo, fo, ov, oe, of = mathutils.geometry.delaunay_2d_cdt(allv, [], [list(range(npoly))], 1, 1e-7)
    V = np.array([[v.x, v.y] for v in vo]); n = len(V)
    F = [f for f in fo if len(f) == 3]
    area = [((V[f[1]] - V[f[0]])[0] * (V[f[2]] - V[f[0]])[1] - (V[f[1]] - V[f[0]])[1] * (V[f[2]] - V[f[0]])[0]) for f in F]
    fold = sum(1 for a in area if a <= 0)
    # boundary values: which output vertex is which input point
    nr = len(rim); src = [o[0] if o else -1 for o in ov]
    isrim = np.array([0 <= s_ < nr for s_ in src]); isbase = np.array([nr <= s_ < npoly for s_ in src])
    A = np.zeros(n); fixed = isrim | isbase
    for i, s_ in enumerate(src):
        if 0 <= s_ < nr: A[i] = s_ / (nr - 1)
        elif nr <= s_ < npoly: A[i] = 1 - (s_ - nr + 1) / nb
    E = set()
    for f in F:
        for k in range(3): E.add(tuple(sorted((f[k], f[(k + 1) % 3]))))
    E = np.array(sorted(E)); deg = np.bincount(E.ravel(), minlength=n).astype(float)
    free = ~fixed; A[free] = 0.5
    for _ in range(6000):
        S_ = np.zeros(n); np.add.at(S_, E[:, 0], A[E[:, 1]]); np.add.at(S_, E[:, 1], A[E[:, 0]])
        A[free] = S_[free] / np.maximum(deg[free], 1)
    # t: distance from the base through the membrane (Dijkstra over the edges)
    import heapq
    nbr = [[] for _ in range(n)]
    for i, j in E:
        d = float(np.hypot(*(V[i] - V[j]))); nbr[i].append((j, d)); nbr[j].append((i, d))
    D = np.full(n, np.inf); hq = []
    for i in np.where(isbase | (np.array(src) == 0) | (np.array(src) == nr - 1))[0]: D[i] = 0; hq.append((0.0, int(i)))
    heapq.heapify(hq)
    while hq:
        d, i = heapq.heappop(hq)
        if d > D[i]: continue
        for j, w in nbr[i]:
            if d + w < D[j]: D[j] = d + w; heapq.heappush(hq, (d + w, j))
    ra = A[isrim]; rd = D[isrim]; o_ = np.argsort(ra)
    Dr = np.interp(A, ra[o_], rd[o_]); Dmax = rd.max()
    Tt = np.clip(D / np.maximum(0.5 * (Dr + Dmax), 1e-6), 0, 1)
    # how near the outline each point is (0 the base … 1 the rim): the game frays and thins the margin by it (material.js finFray)
    Dm = np.full(n, np.inf); hq = []
    for i in np.where(isrim)[0]: Dm[i] = 0; hq.append((0.0, int(i)))
    heapq.heapify(hq)
    while hq:
        d, i = heapq.heappop(hq)
        if d > Dm[i]: continue
        for j, w in nbr[i]:
            if d + w < Dm[j]: Dm[j] = d + w; heapq.heappush(hq, (d + w, j))
    # (by real distance, the last FRAY_CM: a share of the fin would put the whole of a thin sword in its margin)
    Erim = np.clip(1 - Dm / FRAY_CM, 0, 1)
    # a real membrane is pleated along its rays and billows across the fin: a sideways offset (none on the far model: too coarse)
    big = min(1.6, Dmax / (0.6 * SL))
    pleat = (PLEAT if h < 0.06 else 0) * (0.25 + 0.75 * Tt) * np.clip((Tt - 0.04) / 0.3, 0, 1) * np.sin(2 * np.pi * NPLEAT * A + 0.7 * np.sin(3 * A))
    billow = BILLOW * big * Tt ** 2 * np.sin(np.pi * (1.4 * A + 0.1))
    if 'dry' in OPT: return None, dict(folded=fold, tris=len(F), verts=n)
    # the owner's tail at each vertex, and per triangle the UVs of its corners in ONE owner triangle (the one under its middle), so no
    # triangle blends UVs across two islands of the owner's texture
    # (looked up in the inner TLOOK of the owner's tail: its outer band is where the painter darkens the rim, and a sword drawn from
    # it was a dim thread; a real sword carries the tail's colour to its tip)
    Sv = [owner_at(A[i], TLOOK * Tt[i]) for i in range(n)]
    m = bpy.data.meshes.new(f'tail_{shape}')
    verts = [(Sv[i][2] + pleat[i] + billow[i] + side * Sv[i][3] * (1 - 0.7 * Tt[i]), V[i][0], V[i][1]) for side in (1, -1) for i in range(n)]
    faces = [tuple(f) for f in F] + [tuple(n + k for k in reversed(f)) for f in F]
    m.from_pydata(verts, [], faces); m.update()
    # UVs in the strip below the male's atlas (STRIP): across the rays left to right, root to tip down the strip; the game's v runs
    # down the image (row = v * height), Blender's up
    uvl2 = m.uv_layers.new(name='UVMap')
    for poly_ in m.polygons:
        poly_.use_smooth = True
        for li in poly_.loop_indices:
            vi = m.loops[li].vertex_index % n
            u, v = strip_uv(A[vi], Tt[vi]); uvl2.data[li].uv = (u, 1 - v)
    uve = m.uv_layers.new(name='edge')                          # TEXCOORD_1: (closeness to the rim, 0)
    for poly_ in m.polygons:
        for li in poly_.loop_indices: uve.data[li].uv = (float(Erim[m.loops[li].vertex_index % n]), 0.0)
    o = bpy.data.objects.new(f'tail_{shape}', m); bpy.context.scene.collection.objects.link(o)
    return o, dict(lengthSL=round((V[:, 0].max() - y_end) / SL, 3), heightSL=round((V[:, 1].max() - V[:, 1].min()) / SL, 3), tris=2 * len(F), folded=fold)

FIN = bpy.data.materials.new('guppy_fin')
report = {}
for lod, h in RES.items():
    objs = []
    for shape in SHAPES:
        o, st = build(shape, h)
        if o is None: print('TAIL', lod, shape, st); continue
        o.data.materials.append(FIN); objs.append(o)
        report.setdefault(shape, {})[lod] = st
        print('TAIL', lod, shape, st)
    if not objs: continue
    for o2 in bpy.context.scene.objects: o2.select_set(o2 in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'tails' + ('' if lod == 'hi' else '.lo') + '.glb'), use_selection=True,
                              export_format='GLB', export_yup=True, export_apply=True, export_materials='PLACEHOLDER')
    if lod == 'lo':
        for o in objs: bpy.data.objects.remove(o)
# ---- the strip: per texel, where on a tail it is (a, t) and the owner's texture there (his tail at the same place across and along the
# rays), written raw (RGBA bytes, row 0 at the top) for tools/guppy-import.mjs
import os as _os
img = next(nd.image for m_ in me.materials for nd in m_.node_tree.nodes if nd.type == 'TEX_IMAGE' and nd.image)
IW, IH = img.size; px = np.array(img.pixels[:], dtype=np.float32).reshape(IH, IW, 4)
def sample(uv):                                            # bilinear, Blender's v (row 0 at the bottom)
    x = uv[0] * IW - 0.5; y = uv[1] * IH - 0.5; x0 = int(math.floor(x)); y0 = int(math.floor(y)); fx = x - x0; fy = y - y0
    g = lambda yy, xx: px[min(IH - 1, max(0, yy)), min(IW - 1, max(0, xx))]
    return (g(y0, x0) * (1 - fx) + g(y0, x0 + 1) * fx) * (1 - fy) + (g(y0 + 1, x0) * (1 - fx) + g(y0 + 1, x0 + 1) * fx) * fy
coords = np.zeros((STRIP_H, W_ATLAS, 4), np.uint8); parts = np.zeros((STRIP_H, W_ATLAS, 4), np.uint8); basep = np.zeros((STRIP_H, W_ATLAS, 4), np.uint8)
for r in range(STRIP_H):
    t = r / (STRIP_H - 1)
    for c in range(W_ATLAS):
        a = c / (W_ATLAS - 1)
        y, z, xm, th_, ftri, btri = owner_at(a, TLOOK * t)
        col = sample(uv_in(ftri, y, z))
        coords[r, c] = (round(a * 255), round(t * 255), 255, 255); parts[r, c] = (200, 0, 0, 255)   # (coords blue 255: the strip, painted with its own rays)
        basep[r, c] = [round(max(0, min(1, k)) * 255) for k in col[:3]] + [255]
for nm, arr in (('coords', coords), ('parts', parts), ('base', basep)): arr.tofile(_os.path.join(OUT, f'strip-{nm}.rgba'))
print('STRIP', W_ATLAS, 'x', STRIP_H)
json.dump(dict(slCm=SL, strip=dict(w=W_ATLAS, h=STRIP_H), stalkEnd=round(y_end, 4), axis=round(zc, 4), caudalAhead=CAUDAL_AHEAD, ownerSpreadDeg=[round(math.degrees(TH0)), round(math.degrees(TH1))], tails=report),
          open(os.path.join(OUT, 'tails.json'), 'w'), indent=1)

# ---- a look: every tail on the male, the owner's texture, side view ------------------------------------------------------------------
if 'render' in OPT:
    keep = [f for f, p in zip(bm.faces, fpart) if not abs(p - 200) < 20]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in set(keep)], context='FACES')
    bm.to_mesh(me); ob.matrix_world.identity(); bm.free()
    src_mats = list(me.materials)
    tex = next((n.image for m in src_mats for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    for m in src_mats:
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Roughness'].default_value = 0.45
        for l in list(b.inputs['Metallic'].links): m.node_tree.links.remove(l)
        b.inputs['Metallic'].default_value = 0
    nt_ = FIN.node_tree if FIN.use_nodes else None
    FIN.use_nodes = True; nt_ = FIN.node_tree
    bsdf = next(n for n in nt_.nodes if n.type == 'BSDF_PRINCIPLED'); ti = nt_.nodes.new('ShaderNodeTexImage'); ti.image = tex
    nt_.links.new(ti.outputs['Color'], bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = 0.45
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError: sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 520, 360
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (0.55, 0.57, 0.6, 1); bg.inputs[1].default_value = 1.4
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 4.6
    cam.location = (8, 0.6, -0.1); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    tails = [o for o in sc.objects if o.name.startswith('tail_')]
    import subprocess
    shots = []
    for o in tails:
        for o2 in tails: o2.hide_render = o2 is not o
        p = os.path.join(OUT, f'look-{o.name}.png'); sc.render.filepath = p; bpy.ops.render.render(write_still=True); shots.append(p)
    print('SHOTS', len(shots))
