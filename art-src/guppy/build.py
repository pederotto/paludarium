"""Build a guppy in Blender from its anatomy (anatomy.py): skeleton -> muscles -> skin -> fins from their rays, then check that every
bone lies inside the muscles and the skin, and render x-ray and skin views.

  blender -b --factory-startup -P art-src/guppy/build.py -- <variant> <out dir> [--glb=<file>] [--views=side,top,front,three] [--xray]

variant: male_<tail>[_dumbo] (tail: delta fan round doublesword lyre), female[_<tail>][_gravid][_dumbo], juv.
Writes <out dir>/<variant>-<view>.png (skin), <variant>-xray-<view>.png (skin see-through, muscles, bones) and prints CHECK lines.
Units: 1 Blender unit = 1 cm; the fish along +Y (snout at 0), Z up.
"""
import sys, os, math
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import anatomy as A

# Texture atlas rects (Blender uv: x0, y0, x1, y1; v up). Must match ATLAS in src/render/creatures/guppypaint.js.
ATLAS = dict(body=(0.0, 0.0, 1.0, 0.34), caudal=(0.0, 0.36, 0.62, 1.0), dorsal=(0.64, 0.36, 1.0, 0.62), pectoral=(0.64, 0.64, 0.82, 0.82),
             pelvic=(0.84, 0.64, 1.0, 0.82), anal=(0.64, 0.84, 1.0, 1.0))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['male_delta', '/tmp/guppy']
VARIANT, OUT = argv[0], argv[1]
OPT = dict(a[2:].split('=', 1) if '=' in a else (a[2:], '1') for a in argv[2:] if a.startswith('--'))
os.makedirs(OUT, exist_ok=True)

parts = VARIANT.split('_')
SEX = 'male' if parts[0] == 'male' else 'juv' if parts[0] == 'juv' else 'female'
TAIL = next((p for p in parts if p in A.TAILS), 'delta' if SEX == 'male' else 'round')
DUMBO, GRAVID = 'dumbo' in parts, 'gravid' in parts
B = A.Body('male' if SEX == 'male' else 'female', GRAVID)
L = B.L

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
reset()

def coll(name):
    c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c
C_SKIN, C_MUS, C_BONE, C_FIN = coll('skin'), coll('muscles'), coll('bones'), coll('fins')

def mesh_obj(name, bm, col, mat=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); col.objects.link(ob)
    if mat: me.materials.append(mat)
    return ob

def material(name, rgba, alpha=1.0, emit=0.0, rough=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = rough
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    return m

# ---- Stations along the body: dense at the head and the stalk --------------------------------------------------------------------
LO = OPT.get('lod') == 'lo'
def stations(n=60 if LO else 150):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(0.5 - 0.5 * math.cos(math.pi * t) if t < 0.5 else t)       # (cosine spacing at the snout)
    return sorted(set(round(s, 5) for s in out))
S = stations()
NTH = 40 if LO else 96                                                                   # vertices round a section (both sides)

def section(s, inset=0.0):
    """Ring of points at station s, `inset` (cm) inside the skin along the section's own normal (a muscle or a cavity wall)."""
    pts = []
    for k in range(NTH):
        th = 2 * math.pi * k / NTH
        x, y, z = B.ring(s, th)
        if inset:
            zw = B.zw(s); d = math.hypot(x, z - zw) or 1
            f = max(0.0, 1 - inset / d); x *= f; z = zw + (z - zw) * f
        pts.append(Vector((x, y, z)))
    return pts

# ---- Skin: the lofted body, with the eye bulge, the mouth, the gill cover and the nostril pressed in ------------------------------
EYE_C = None
def eye_centre():
    s = A.EYE['s']; r = A.EYE['r'] * L
    z = B.zw(s) + A.EYE['up'] * 0.5 * (B.top(s) - B.bot(s))
    # find the skin's half width at that height
    best = 0
    for k in range(200):
        th = math.pi * k / 200; x, y, zz = B.ring(s, th)
        if abs(zz - z) < 0.004 * L: best = max(best, x)
    return Vector((best - A.EYE['sink'] * r * 0.9, s * L, z)), r

def build_skin(inset=0.0, name='skin', col=None, mat=None, details=True):
    global EYE_C
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    rings = []
    for s in S:
        ring = [bm.verts.new(p) for p in section(s, inset)]
        rings.append((s, ring))
    tip = bm.verts.new(Vector((0, -0.003 * L, B.top(0) * 0.75 + B.bot(0) * 0.25)))
    end = bm.verts.new(Vector((0, L + 0.004 * L, B.mid(1.0))))
    # The body's corner of the atlas (ATLAS['body'], the same in src/render/creatures/guppypaint.js): u = s, v from the dorsal midline
    # (top of the rect) down to the ventral midline (bottom), both sides on the same texels.
    bx0, by0, bx1, by1 = ATLAS['body']
    UV = lambda s, k: (bx0 + (bx1 - bx0) * s, by1 - (by1 - by0) * ((k / NTH * 2) if k <= NTH // 2 else (2 - k / NTH * 2)))
    for (s0, r0), (s1, r1) in zip(rings, rings[1:]):
        for k in range(NTH):
            k1 = (k + 1) % NTH
            f = bm.faces.new((r0[k], r1[k], r1[k1], r0[k1]))
            for lp, (s_, kk) in zip(f.loops, ((s0, k), (s1, k), (s1, k + 1), (s0, k + 1))):
                u, v = UV(s_, kk); lp[uvl].uv = (u, v)
    for k in range(NTH):
        k1 = (k + 1) % NTH
        f = bm.faces.new((tip, rings[0][1][k1], rings[0][1][k])); [setattr(l[uvl], 'uv', UV(0.0, NTH // 4)) for l in f.loops]
        f = bm.faces.new((end, rings[-1][1][k], rings[-1][1][k1])); [setattr(l[uvl], 'uv', UV(1.0, NTH // 4)) for l in f.loops]
    bm.normal_update()
    if details and not inset:
        ec, er = eye_centre(); EYE_C = (ec, er)
        for v in bm.verts:
            p = v.co
            for sd in (1, -1):
                c = Vector((ec.x * sd, ec.y, ec.z)); d = (p - c).length
                # the eye bulges out of the head: skin within reach moves out onto the eyeball, with a soft rim (the orbit edge)
                if d < er * 1.35 and p.x * sd > 0:
                    target = c + (p - c).normalized() * er
                    k = A.smooth(er * 1.35, er * 0.95, d)
                    if (target - c).length > d: v.co = p.lerp(target, k)
        groove = []
        # mouth: the gape opens at the top of the snout (superior mouth), from the tip back and down to the corner
        groove += [(Vector((0, 0.0, B.top(0.0) * 0.55)), 0.012 * L, 0.006 * L), (Vector((0.6, 0.02, 0.0)), 0, 0)]
        def press(curve, depth, width):
            pts = [Vector(q) for q in curve]
            for v in bm.verts:
                d = min(segdist(v.co, pts[i], pts[i + 1]) for i in range(len(pts) - 1))
                if d < width: v.co -= v.normal * depth * (1 - (d / width) ** 2)
        def side(sd, pts): return [(sd * B.wid(q[0]) * q[1], q[0] * L, q[2]) for q in pts]
        for sd in (1, -1):
            # the mouth: a short gape line at the top of the snout, rising to the tip (a superior mouth), barely seen from the side
            press([(sd * 0.25 * B.wid(0.006), 0.006 * L, B.top(0.006) * 0.8), (sd * 0.7 * B.wid(0.025), 0.025 * L, B.zw(0.025) + 0.35 * (B.top(0.025) - B.zw(0.025)))], 0.0025 * L, 0.005 * L)
            # the gill cover's free edge: from behind the eye, round the back of the head, forward along the throat
            oc = []
            for i in range(9):
                t = i / 8; a = math.pi * (0.15 + 0.8 * t)
                s = 0.235 + 0.035 * math.sin(a) - 0.06 * t * t
                z = B.zw(s) + (B.top(s) - B.zw(s)) * 0.75 * math.cos(a) if math.cos(a) > 0 else B.zw(s) + (B.zw(s) - B.bot(s)) * 0.85 * math.cos(a)
                th = math.acos(max(-1, min(1, (z - B.zw(s)) / ((B.top(s) - B.zw(s)) if z > B.zw(s) else (B.zw(s) - B.bot(s))))))
                oc.append((sd * B.wid(s) * abs(math.sin(th)) ** B.exp(s), s * L, z))
            press(oc, 0.005 * L, 0.008 * L)
            # nostril: a small pit in front of the eye
            nz = B.zw(0.05) + 0.6 * (B.top(0.05) - B.zw(0.05))
            press([(sd * 0.7 * B.wid(0.05), 0.048 * L, nz), (sd * 0.7 * B.wid(0.055), 0.055 * L, nz)], 0.004 * L, 0.004 * L)
    ob = mesh_obj(name, bm, col or C_SKIN, mat)
    return ob

def segdist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / (ab.dot(ab) or 1e-9))); return (p - (a + ab * t)).length

# ---- Skeleton ----------------------------------------------------------------------------------------------------------------------
BONE = material('bone', (0.93, 0.9, 0.82, 1), rough=0.6)
def capsule(bm, a, b, ra, rb, seg=8, rings=4):
    """A tapered tube from a to b (no caps needed at this size)."""
    a, b = Vector(a), Vector(b); ax = (b - a)
    if ax.length < 1e-6: return
    d = ax.normalized(); up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(up).normalized(); w = d.cross(u)
    prev = None
    for i in range(rings + 1):
        t = i / rings; c = a + ax * t; r = ra + (rb - ra) * t
        ring = [bm.verts.new(c + (u * math.cos(2 * math.pi * k / seg) + w * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)]
        if prev:
            for k in range(seg): bm.faces.new((prev[k], ring[k], ring[(k + 1) % seg], prev[(k + 1) % seg]))
        prev = ring
def ellipsoid(bm, c, r, seg=14, rings=8):
    c = Vector(c)
    vs = []
    for i in range(rings + 1):
        ph = math.pi * i / rings
        vs.append([bm.verts.new(c + Vector((r[0] * math.sin(ph) * math.cos(2 * math.pi * k / seg), r[1] * math.cos(ph), r[2] * math.sin(ph) * math.sin(2 * math.pi * k / seg)))) for k in range(seg)])
    for i in range(rings):
        for k in range(seg): bm.faces.new((vs[i][k], vs[i + 1][k], vs[i + 1][(k + 1) % seg], vs[i][(k + 1) % seg]))

BONES = []                      # (name, object) for the containment check
def bone_obj(name, fill):
    bm = bmesh.new(); fill(bm); ob = mesh_obj(name, bm, C_BONE, BONE); BONES.append(ob); return ob

def build_skeleton():
    # Skull: neurocranium (braincase) over the orbits, the jaws at the top of the snout, the gill cover plates, the hyoid below.
    bone_obj('neurocranium', lambda bm: ellipsoid(bm, (0, 0.135 * L, B.zw(0.135) + 0.035 * L), (0.036 * L, 0.095 * L, 0.03 * L)))
    for sd in (1, -1):
        bone_obj(f'premaxilla{sd}', lambda bm: capsule(bm, (0, 0.008 * L, B.top(0.008) * 0.6), (sd * 0.028 * L, 0.035 * L, B.zw(0.035) + 0.012 * L), 0.005 * L, 0.004 * L))
        bone_obj(f'dentary{sd}', lambda bm: capsule(bm, (0, 0.004 * L, B.top(0.004) * 0.45), (sd * 0.03 * L, 0.05 * L, B.zw(0.05) - 0.008 * L), 0.006 * L, 0.005 * L))
        bone_obj(f'opercle{sd}', lambda bm: ellipsoid(bm, (sd * 0.82 * B.wid(0.215), 0.215 * L, B.zw(0.215) - 0.01 * L), (0.006 * L, 0.035 * L, 0.05 * L), 10, 6))
        bone_obj(f'hyoid{sd}', lambda bm: capsule(bm, (sd * 0.01 * L, 0.07 * L, B.bot(0.07) + 0.02 * L), (sd * 0.04 * L, 0.2 * L, B.bot(0.2) + 0.03 * L), 0.005 * L, 0.004 * L))
        # pectoral girdle: the cleithrum, an arc behind the gill cover
        def clei(bm, sd=sd):
            pts = [(sd * 0.55 * B.wid(0.25), 0.25 * L, B.zw(0.25) + 0.05 * L), (sd * 0.7 * B.wid(0.255), 0.255 * L, B.zw(0.255) - 0.02 * L), (sd * 0.5 * B.wid(0.24), 0.24 * L, B.bot(0.24) + 0.025 * L), (sd * 0.15 * B.wid(0.22), 0.215 * L, B.bot(0.22) + 0.015 * L)]
            for a, b in zip(pts, pts[1:]): capsule(bm, a, b, 0.005 * L, 0.0045 * L, 6, 2)
        bone_obj(f'cleithrum{sd}', clei)
    # Vertebral column: centra, neural spines up, ribs (trunk) or haemal spines (tail) down.
    def column(bm):
        for i, (s0, s1, r, abd) in enumerate(A.vertebrae(B)):
            sm = 0.5 * (s0 + s1); zc = B.col(sm)
            capsule(bm, (0, s0 * L + 0.004 * L, B.col(s0)), (0, s1 * L - 0.004 * L, B.col(s1)), r, r, 8, 1)
            top = B.top(sm + 0.03); bot = B.bot(sm + 0.03)
            st = min(sm + 0.05, 0.99)
            capsule(bm, (0, sm * L, zc + r), (0, st * L, lerp(B.col(st), B.top(st), 0.72)), 0.0035 * L, 0.002 * L, 5, 2)          # neural spine
            if abd and i > 0:
                for sd in (1, -1):                                                                           # pleural ribs round the gut
                    def under(s_, th, k):                                                    # a point k of the way out to the skin at angle th
                        x, y, z = B.ring(s_, th); zw = B.zw(s_); return (sd * abs(x) * k, y, zw + (z - zw) * k)
                    pts = [(sd * 0.3 * B.wid(sm), sm * L, zc - r * 0.5), under(sm + 0.02, 1.75, 0.8), under(sm + 0.04, 2.45, 0.78)]
                    for a, b in zip(pts, pts[1:]): capsule(bm, a, b, 0.0028 * L, 0.002 * L, 5, 2)
            elif not abd:
                capsule(bm, (0, sm * L, zc - r), (0, st * L, lerp(B.col(st), B.bot(st), 0.72)), 0.0035 * L, 0.002 * L, 5, 2)    # haemal spine
        # hypural plate: the fan of bones the tail rays sit on
        zc = B.col(0.975); h = 0.5 * (B.top(0.99) - B.bot(0.99)) * 0.82
        for k in range(5):
            t = k / 4 * 2 - 1
            capsule(bm, (0, 0.962 * L, zc + t * 0.01 * L), (0, 0.99 * L, B.mid(0.99) + t * h * 0.85), 0.006 * L, 0.004 * L, 6, 2)
    bone_obj('column', column)
lerp = A.lerp

# ---- Fins: membranes stretched between rays, pleated, feathered at the edge ---------------------------------------------------------
FINS = []
def fin_mesh(name, rays, place, notch, pleat, mat, uvrect, thick=None, cols=3, rows=12, cutDiff=0.0):
    if LO: cols, rows = max(1, cols - 1), max(4, rows // 2)
    """rays: [(key, pts2d)] in order; place(key, u, w) -> (point Vector, plane normal Vector). Builds a thin solid membrane."""
    thick = thick or 0.0045 * L
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    n = len(rays)
    def at(pts, t):
        f = t * (len(pts) - 1); i = min(int(f), len(pts) - 2); g = f - i
        return (lerp(pts[i][0], pts[i + 1][0], g), lerp(pts[i][1], pts[i + 1][1], g))
    grid = []                        # columns across the fin, each a list of (point, uv)
    for j in range(n - 1):
        (ka, pa), (kb, pb) = rays[j], rays[j + 1]
        la = math.hypot(*pa[-1]); lb = math.hypot(*pb[-1])
        rnd = 0.35 + 1.3 * ((math.sin(j * 12.9898 + len(name) * 78.233) * 43758.5453) % 1)    # each gap frays its own amount
        cut = notch * rnd + cutDiff * abs(la - lb) / max(la, lb, 1e-6)    # a deep cut between a short ray and a long one (sword, lyre)
        for c in range(cols if j < n - 2 else cols + 1):
            f = c / cols
            col = []
            for r in range(rows + 1):
                t = r / rows
                tt = t * (1 - cut * math.sin(math.pi * f) ** 1.5 * t ** 4)  # the membrane edge pulled in between the ray tips
                ua, wa = at(pa, tt); ub, wb = at(pb, tt)
                pA, nA = place(ka, ua, wa); pB, nB = place(kb, ub, wb)
                p = pA.lerp(pB, f); nrm = nA.lerp(nB, f).normalized()
                p = p + nrm * pleat * t * math.cos(2 * math.pi * f)       # pleats: rays proud, membrane between them sunk
                col.append((p, nrm, ((j + f) / (n - 1), tt)))
            grid.append(col)
    x0, y0, x1, y1 = uvrect
    for side in (1, -1):
        vs = [[bm.verts.new(p + nrm * side * thick) for (p, nrm, _) in col] for col in grid]
        for a in range(len(grid) - 1):
            for r in range(rows):
                q = (vs[a][r], vs[a + 1][r], vs[a + 1][r + 1], vs[a][r + 1])
                f = bm.faces.new(q if side > 0 else q[::-1])
                for lp, (aa, rr) in zip(f.loops, ((a, r), (a + 1, r), (a + 1, r + 1), (a, r + 1)) if side > 0 else ((a, r + 1), (a + 1, r + 1), (a + 1, r), (a, r))):
                    u, v = grid[aa][rr][2]; lp[uvl].uv = (x0 + (x1 - x0) * u, y0 + (y1 - y0) * v)
        if side > 0: front = vs
        else: back = vs
    # close the rim (edge and both side rays) so the sheet is watertight
    def rim(a, b):
        for i in range(len(a) - 1):
            f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    ed_f = [col[-1] for col in front]; ed_b = [col[-1] for col in back]
    rim(ed_b, ed_f)
    rim(front[0], back[0]); rim(back[-1], front[-1])
    bm.normal_update()
    ob = mesh_obj(name, bm, C_FIN, mat); FINS.append(ob); return ob

FIN = material('fin', (0.85, 0.2, 0.15, 1), 0.75, rough=0.4)
def build_fins():
    zc = B.mid(0.99)
    cd = A.caudal(B, TAIL, female=SEX == 'female', juv=SEX == 'juv')
    root = 0.962 * L
    fin_mesh('fin_caudal', cd['rays'], lambda key, u, w: (Vector((0, root + u, zc + key + w)), Vector((1, 0, 0))), cd['notch'], 0.0012 * L, FIN, ATLAS['caudal'], cols=3, rows=14, cutDiff=0.6)
    dd = A.dorsal(B, 'male' if SEX == 'male' else 'female', TAIL, juv=SEX == 'juv')
    fin_mesh('fin_dorsal', dd['rays'], lambda s, u, w: (Vector((0, s * L + u, B.top(s) - 0.006 * L + w)), Vector((1, 0, 0))), dd['notch'], 0.003 * L, FIN, ATLAS['dorsal'])
    if SEX == 'male':
        g = A.gonopodium(B)
        def gono(bm):
            base = Vector((0, g['s'] * L, B.bot(g['s']) + 0.006 * L)); pts = [base + Vector((0, u, -w)) for u, w in g['rod']]
            for i in range(len(pts) - 1): capsule(bm, pts[i], pts[i + 1], lerp(g['r0'], g['r1'], i / (len(pts) - 1)), lerp(g['r0'], g['r1'], (i + 1) / (len(pts) - 1)), 8, 2)
        bm = bmesh.new(); gono(bm)
        uvl = bm.loops.layers.uv.new('UVMap'); ax0, ay0, ax1, ay1 = ATLAS['anal']
        for f in bm.faces:
            for lp in f.loops: lp[uvl].uv = (ax0 + 0.02, ay0 + 0.02)                  # the rod takes the anal fin's base colour
        FINS.append(mesh_obj('fin_gonopodium', bm, C_FIN, FIN))
        fin_mesh('fin_anal', g['short'], lambda s, u, w: (Vector((0, s * L + u, B.bot(s) + 0.006 * L - w)), Vector((1, 0, 0))), 0.06, 0.002 * L, FIN, ATLAS['anal'], cols=2, rows=6)
    else:
        ad = A.anal(B)
        fin_mesh('fin_anal', ad['rays'], lambda s, u, w: (Vector((0, s * L + u, B.bot(s) + 0.006 * L - w)), Vector((1, 0, 0))), ad['notch'], 0.003 * L, FIN, ATLAS['anal'])
    # paired fins, both sides
    pc = A.pectoral(B, DUMBO); s = pc['s']
    for sd in (1, -1):
        zb = B.zw(s) - 0.18 * (B.zw(s) - B.bot(s)); xb = None
        for k in range(100):
            th = math.pi * k / 100; x, y, z = B.ring(s, th)
            if abs(z - zb) < 0.01 * L: xb = x
        xb = (xb or B.wid(s)) * 0.92
        ux = Vector((0.5 * sd, 1.0, -0.15)).normalized(); nx = Vector((sd, -0.35, 0.25)).normalized(); wx = nx.cross(ux).normalized() * -sd
        nx = ux.cross(wx).normalized()
        base = Vector((sd * xb, s * L, zb))
        fin_mesh(f'fin_pectoral{sd}', pc['rays'], lambda t, u, w, base=base, ux=ux, wx=wx, nx=nx: (base + wx * (pc['base'] * (t - 0.5)) + ux * u + wx * w, nx), pc['notch'], 0.001 * L, FIN, ATLAS['pectoral'])
    pv = A.pelvic(B, SEX if SEX != 'juv' else 'female'); s = pv['s']
    for sd in (1, -1):
        base = Vector((sd * 0.25 * B.wid(s), s * L, B.bot(s) + 0.008 * L))
        ux = Vector((0.15 * sd, 1.0, -0.45)).normalized(); wx = Vector((sd, 0, 0.1)).normalized(); nx = ux.cross(wx).normalized()
        fin_mesh(f'fin_pelvic{sd}', pv['rays'], lambda t, u, w, base=base, ux=ux, wx=wx, nx=nx: (base + wx * (pv['base'] * t) + ux * u + wx * w, nx), pv['notch'], 0.002 * L, FIN, ATLAS['pelvic'], cols=2, rows=8)

# fin rays as bones (lepidotrichia): thin tubes along each ray, for the x-ray and the check that rays stay in their membranes
def build_rays():
    zc = B.mid(0.99); root = 0.962 * L
    def rayset(bm, rays, place, r0):
        for key, pts in rays:
            P = [place(key, u, w) for u, w in pts]
            for i in range(len(P) - 1): capsule(bm, P[i], P[i + 1], r0 * (1 - 0.6 * i / len(P)), r0 * (1 - 0.6 * (i + 1) / len(P)), 4, 1)
    cd = A.caudal(B, TAIL, female=SEX == 'female', juv=SEX == 'juv')
    bone_obj('rays_caudal', lambda bm: rayset(bm, cd['rays'], lambda k, u, w: Vector((0, root + u, zc + k + w)), 0.0028 * L))
    dd = A.dorsal(B, 'male' if SEX == 'male' else 'female', TAIL, juv=SEX == 'juv')
    bone_obj('rays_dorsal', lambda bm: rayset(bm, dd['rays'], lambda s, u, w: Vector((0, s * L + u, B.top(s) - 0.006 * L + w)), 0.0025 * L))
    # pterygiophores: the rods inside the back that carry the dorsal rays
    bone_obj('pterygiophores', lambda bm: [capsule(bm, (0, s * L, B.top(s) - 0.012 * L), (0, s * L - 0.015 * L, lerp(B.col(s), B.top(s), 0.45)), 0.003 * L, 0.002 * L, 5, 1) for s, _ in dd['rays']])

# ---- Muscles: the myomeres (one per vertebra, W-shaped) under the skin, split at the horizontal septum; the gut cavity in the trunk --
MUS_EPI = material('epaxial', (0.75, 0.25, 0.22, 1), 1.0, rough=0.7)
MUS_HYP = material('hypaxial', (0.62, 0.2, 0.2, 1), 1.0, rough=0.7)
GUT = material('gut', (0.85, 0.65, 0.45, 1), 1.0)
SKIN_T = 0.008                                                             # skin + scales, × SL (GUESS)
def build_muscles():
    ob = build_skin(inset=SKIN_T * L, name='muscle', col=C_MUS, details=False)
    me = ob.data; me.materials.append(MUS_EPI); me.materials.append(MUS_HYP)
    sp = 1 / A.N_VERT * (A.COL_TO - A.COL_FROM)
    for p in me.polygons:
        c = p.center; s = c.y / L; zc = B.col(min(max(s, 0), 1))
        up = c.z >= zc
        # W-shaped myosepta: the segment boundary leans forward toward the septum and the dorsal/ventral edges
        dz = abs(c.z - zc) / (0.5 * (B.top(s) - B.bot(s)) + 1e-6)
        shift = 0.6 * sp * (1 - abs(2 * dz - 1))
        idx = int((s + shift - A.COL_FROM) / sp)
        p.material_index = (0 if up else 1) if idx % 2 == 0 else (1 if up else 0)
    # gut cavity (the body cavity in the trunk under the column)
    bm = bmesh.new(); ellipsoid(bm, (0, 0.42 * L, lerp(B.bot(0.42), B.col(0.42), 0.42)), (0.7 * B.wid(0.42), 0.17 * L, 0.3 * (B.col(0.42) - B.bot(0.42))))
    mesh_obj('gut', bm, C_MUS, GUT)
    return ob

# ---- Checks: every bone inside the skin; muscles inside the skin -------------------------------------------------------------------
def bvh(ob):
    dg = bpy.context.evaluated_depsgraph_get(); bm = bmesh.new(); bm.from_object(ob, dg); bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm); bm.free(); return t
def inside(tree, p):
    hits = 0; d = Vector((0.31, 0.17, 0.93)).normalized(); o = p.copy()
    for _ in range(40):
        h = tree.ray_cast(o, d)
        if h[0] is None: break
        hits += 1; o = h[0] + d * 1e-5
    return hits % 2 == 1
def check(skin):
    tree = bvh(skin); bad = {}; total = 0
    for ob in BONES:
        if ob.name.startswith('rays_') or ob.name == 'pterygiophores' and False: continue
        n = 0
        for v in ob.data.vertices:
            total += 1
            if not inside(tree, ob.matrix_world @ v.co): n += 1
        if n:
            bad[ob.name] = n
            ys = [round((ob.matrix_world @ v.co).y / L, 2) for v in ob.data.vertices if not inside(tree, ob.matrix_world @ v.co)]
            print('  outside', ob.name, 's from', min(ys), 'to', max(ys))
    print('CHECK bones inside skin:', 'all' if not bad else f'{sum(bad.values())} of {total} vertices outside: {bad}')
    mus = bpy.data.objects.get('muscle'); n = 0
    for v in mus.data.vertices:
        if not inside(tree, v.co): n += 1
    print('CHECK muscle inside skin:', 'all' if not n else f'{n} of {len(mus.data.vertices)} outside')
    return bad

# ---- Render -------------------------------------------------------------------------------------------------------------------------
def scene_setup():
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        try: sc.render.engine = 'BLENDER_EEVEE'
        except TypeError: pass
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    sc.render.film_transparent = False
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (0.16, 0.17, 0.18, 1); bg.inputs[1].default_value = 0.6
    for loc, e in (((4, -3, 6), 900), ((-5, 2, 3), 400), ((0, 6, -4), 200)):
        ld = bpy.data.lights.new('l', 'AREA'); ld.energy = e; ld.size = 4
        lo = bpy.data.objects.new('l', ld); lo.location = loc; sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0, L * 0.7, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    return cam

def shoot(cam, view, path):
    ctr = Vector((0, L * 0.85, 0)); span = L * 2.0
    dirs = {'side': Vector((1, 0, 0)), 'top': Vector((0, 0, 1)), 'front': Vector((0, -1, 0.05)), 'three': Vector((1, -0.8, 0.6)), 'below': Vector((0.3, 0, -1))}
    d = dirs[view].normalized(); cam.location = ctr + d * 20
    if view == 'top': cam.rotation_euler = (0, 0, math.pi / 2)
    elif view == 'below': cam.rotation_euler = (math.pi, 0, -math.pi / 2)
    else: cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = span * (0.75 if view == 'front' else 1.0)
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)

def textured(maps, look):
    """The game's material in Blender: the look's colour atlas (alpha = fin opacity) and the shared normal map, for lit renders."""
    col = bpy.data.images.load(os.path.join(maps, look + '.png')); nrm = bpy.data.images.load(os.path.join(maps, 'normal.png'))
    nrm.colorspace_settings.name = 'Non-Color'
    mats = {}
    for kind in ('body', 'fin'):
        m = bpy.data.materials.new('guppy_' + kind); m.use_nodes = True; nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = col
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
        nt.links.new(ti.outputs['Color'], bsdf.inputs['Base Color']); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        bsdf.inputs['Roughness'].default_value = 0.38 if kind == 'body' else 0.55
        try: bsdf.inputs['Coat Weight'].default_value = 0.15 if kind == 'body' else 0.0
        except Exception: pass
        if kind == 'fin':
            nt.links.new(ti.outputs['Alpha'], bsdf.inputs['Alpha'])
            try: bsdf.inputs['Transmission Weight'].default_value = 0.25
            except Exception: pass
            try: m.surface_render_method = 'BLENDED'
            except Exception: pass
        mats[kind] = m
    return mats

if __name__ == '__main__':
    skin_mat = material('skin', (0.72, 0.74, 0.66, 1), rough=0.45)
    skin = build_skin(mat=skin_mat)
    build_skeleton(); build_rays(); build_muscles(); build_fins()
    bad = check(skin)
    cam = scene_setup()
    if OPT.get('maps'):
        mats = textured(OPT['maps'], OPT.get('look', 'red'))
        skin.data.materials.clear(); skin.data.materials.append(mats['body'])
        for f in FINS: f.data.materials.clear(); f.data.materials.append(mats['fin'])
        for ob in BONES: ob.hide_render = True
        bpy.data.objects['muscle'].hide_render = True; bpy.data.objects['gut'].hide_render = True
        tag = OPT.get('look', 'red')
        ec, er = EYE_C; albino = 'albino' in tag
        for sd in (1, -1):
            bm = bmesh.new(); ellipsoid(bm, (sd * ec.x, ec.y, ec.z), (er * 1.02, er * 1.02, er * 1.02), 24, 14)
            eo = mesh_obj(f'eye{sd}', bm, C_SKIN)
            em = bpy.data.materials.new('eye'); em.use_nodes = True; nt = em.node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            # radial iris by the angle from the eye's outward axis: pupil, iris ring, dark limbus
            tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
            ramp = nt.nodes.new('ShaderNodeValToRGB'); mth = nt.nodes.new('ShaderNodeMath'); mth.operation = 'MULTIPLY'; mth.inputs[1].default_value = sd / er
            nt.links.new(sep.outputs['X'], mth.inputs[0]); nt.links.new(mth.outputs[0], ramp.inputs['Fac'])
            cr = ramp.color_ramp; cr.elements[0].position = 0.55; cr.elements[0].color = (0.05, 0.05, 0.05, 1) if not albino else (0.6, 0.35, 0.3, 1)
            cr.elements[1].position = 0.78; cr.elements[1].color = (0.75, 0.74, 0.66, 1) if not albino else (0.9, 0.4, 0.4, 1)
            e3 = cr.elements.new(0.9); e3.color = (0.02, 0.02, 0.02, 1) if not albino else (0.85, 0.1, 0.12, 1)
            nt.links.new(ramp.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.05
            try: b.inputs['Coat Weight'].default_value = 1.0
            except Exception: pass
            eo.data.materials.append(em)
        for v in OPT.get('views', 'side,three').split(','): shoot(cam, v, os.path.join(OUT, f'{VARIANT}-{tag}-{v}.png'))
        print('DONE textured', tag); sys.exit(0)
    views = OPT.get('views', 'side,top,front,three').split(',')
    for v in views: shoot(cam, v, os.path.join(OUT, f'{VARIANT}-{v}.png'))
    if 'xray' in OPT:
        bsdf = next(n for n in skin_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); bsdf.inputs['Alpha'].default_value = 0.18
        try: skin_mat.surface_render_method = 'BLENDED'
        except Exception: pass
        for f in FINS: f.hide_render = False
        fb = next(n for n in FIN.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); fb.inputs['Alpha'].default_value = 0.25
        for v in views: shoot(cam, v, os.path.join(OUT, f'{VARIANT}-xray-{v}.png'))
        bpy.data.objects['muscle'].hide_render = True
        for v in ('side',): shoot(cam, v, os.path.join(OUT, f'{VARIANT}-bones-{v}.png'))
    if OPT.get('blend'): bpy.ops.wm.save_as_mainfile(filepath=OPT['blend'])
    print('DONE', VARIANT)
