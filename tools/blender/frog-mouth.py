# A frog's mouth in Blender, cut from its fitted skull (6 Oct night; the owner's mouth rule, wt-firesal CLAUDE.md "Mouth rule"; same work as
# tools/blender/firesal-mouth.py, for a frog head). Headless:
#   Blender -b -P frog-mouth.py -- <plain.glb> <skull.json> <out.glb> [--jaw-index N] [--preview prefix] [--xc X --hw W]
# <plain.glb>   the frog body as a plain GLB in the baked frame (metres: x lateral, y up, z forward, head to +z), with the game's custom attributes if it has them
#               (_SKIN, _SKINX, _RIG, _MUSC, _MUSU: tools/rig/glb-plain.mjs writes it from a baked body). UVs and the vertex order of everything the cut does not touch are kept
#               (old vertices keep their index; new ones are appended; the new vertex count is printed and written to <out.glb>.jaw.json).
# <skull.json>  tools/rig/skull.mjs-style fit (here .agents/skin/skull/frogskull.mjs): the lip plane (the tooth line) y = lip.y0 + lip.slope (z - lip.zh), the hinge pair, snoutZ.
# What it does, with Blender's own mesh operators (bmesh):
#   1. cuts the head by the lip plane (bisect_plane) from the snout back to the mouth angle (the jaw hinge), splits the cut edges open (split_edges)
#   2. extrudes six rings inward from each lip, shrinking toward the throat just behind the hinge: a palate dome above (up to +0.30 cm, the frog's arched roof), a floor below
#      (down to -0.30 cm, the tongue's bed); the two hinge ends capped, the two sheets welded at the throat, the cavity rounded, normals recalculated
#   3. paints the inside pure green in the colour attribute `Color` (COLOR_0): the marker the skin bake turns into the mouth's mucosa
#   4. builds a `jaw` vertex group: everything below the lip plane in front of the hinge, eased in over 0.3 cm either side of the hinge, kept out of the limb roots; folds it into
#      the game's four-bone skin (_SKIN/_SKINX: strongest four bones a vertex) as bone index --jaw-index (default 18: the 19th bone, after the 18 of the swimming frog)
#   5. writes <out.glb> in metres, same frame, with the game's attributes, and <out.glb>.jaw.json: the jaw bone for the manifest skeleton in the baked frame (cm): head at the
#      hinge pair's middle, tail toward the chin, the new vertex count, the cavity vertex list size.
# Order for a new animal (docs/SKELETON.md): skull JSON fitted and verified, THEN this, then muscles. Check afterwards: skull_build.py ... --mouth <out.glb> (cavity inside the skin).
import bpy, bmesh, math, sys, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
IN, SKJ, OUT = argv[0], argv[1], argv[2]
opt = lambda k, d=None: (argv[argv.index(k) + 1] if k in argv else d)
PREVIEW = opt('--preview')
JAW = int(opt('--jaw-index', 18))
SK = json.load(open(SKJ))
LIP0, SLOPE, ZH_LIP = SK['lip']['y0'], SK['lip']['slope'], SK['lip']['zh']           # baked cm: height of the tooth-line plane at z = zh, rise per cm toward the snout
ZH = (SK['hinge'][0]['at'][2] + SK['hinge'][1]['at'][2]) / 2                         # the mouth angle: baked z of the jaw hinge pair
HY = (SK['hinge'][0]['at'][1] + SK['hinge'][1]['at'][1]) / 2
SNOUT = SK['snoutZ']
KS = float(opt('--scale', SK.get('skullLengthCm', 3.05) / 3.05))                     # sizes below were set on the 3.05 cm lab skull: scaled to this head
BL = 0.3 * KS                                                                           # the jaw's weight eases in over this far either side of the hinge
lipz = lambda y: LIP0 + SLOPE * (-y - ZH_LIP)          # local frame (glTF import): x lateral, y = -z_baked (head toward -y), z up; cm
smooth = lambda t: (0 if t < 0 else 1 if t > 1 else t * t * (3 - 2 * t))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
body = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = body; body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = body.data
me.transform(Matrix.Scale(100, 4)); me.update()                                       # metres -> cm
zs = [v.co.z for v in me.vertices]
assert min(zs) < 0.5, ('the mesh is not in the baked frame (belly near y = 0)', min(zs))
ZLOW = float(opt('--zlow', 0.6))                                                     # cm: nothing lower is the head (the forelegs under the chin)
for nm in ('custom_normal', 'sharp_face', 'sharp_edge'):
    if nm in me.attributes: me.attributes.remove(me.attributes[nm])
me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
N0 = len(me.vertices)

# the head's own middle line and half width at the lip plane, from the skull fit's profile rows in front of the eyes (or --xc / --hw)
rows = [r for r in SK['profile'] if SNOUT - 1.9 < r['z'] < SNOUT - 0.7]
XC = float(opt('--xc', sum(r['mid'] for r in rows) / max(1, len(rows))))
HW = float(opt('--hw', max(r['half'] for r in rows) + 0.12))
print('head: centre x %.3f, half width %.3f, mouth angle z %.2f cm, lip plane y %.3f + %.3f (z - %.2f)' % (XC, HW, ZH, LIP0, SLOPE, ZH_LIP))

# 1-3. the cut, the rings, the caps, the back wall
bm = bmesh.new(); bm.from_mesh(me)
# a plain GLB with UVs has its vertices split along every UV seam (17,000 'open' edges on the slim scan): weld them by position for the topology work; the UVs live on the loops
# and stay as they are, the point attributes (_SKIN ...) of coincident vertices are the same. The glTF export splits them again by UV and attribute, so the vertex COUNT changes: it is printed.
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
N_WELDED = len(bm.verts)
if not bm.loops.layers.color.get('Color'):
    lay0 = bm.loops.layers.color.new('Color')
    for f in bm.faces:
        for l in f.loops: l[lay0] = (1.0, 1.0, 1.0, 1.0)
lay = bm.loops.layers.color.get('Color')
from mathutils.bvhtree import BVHTree
SKIN0 = BVHTree.FromBMesh(bm)                                         # the uncut skin: the vault and the basin are clamped to stay inside it
BND0 = {e for e in bm.edges if e.is_boundary}                             # open edges the scan already had (a raw scan is not always watertight): never touched below
print('boundary edges before the cut (real holes after the weld):', len(BND0), '| vertices %d -> %d welded' % (N0, N_WELDED))
P0 = Vector((XC, -ZH_LIP, LIP0)); N = Vector((0, SLOPE, 1)).normalized()
YMAX = -(ZH - 0.7 * KS)                                      # the region reaches a little behind the hinge
inreg = lambda v: v.co.y < YMAX and abs(v.co.x - XC) < HW + 0.1 and v.co.z > ZLOW
faces = [f for f in bm.faces if all(inreg(v) for v in f.verts)]
gv = list({v for f in faces for v in f.verts}); ge = list({e for f in faces for e in f.edges})
res = bmesh.ops.bisect_plane(bm, geom=gv + ge + faces, dist=1e-6, plane_co=P0, plane_no=N, clear_inner=False, clear_outer=False)
cut = [g for g in res['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
slit = [e for e in cut if (e.verts[0].co.y + e.verts[1].co.y) / 2 <= -ZH and abs(e.verts[0].co.x - XC) < HW + 0.1 and abs(e.verts[1].co.x - XC) < HW + 0.1]
bmesh.ops.split_edges(bm, edges=slit)
bnd = [e for e in bm.edges if e.is_boundary and e not in BND0]
is_upper = lambda e: e.link_faces[0].calc_center_median().z > lipz(e.link_faces[0].calc_center_median().y)
up = [e for e in bnd if is_upper(e)]; lo = [e for e in bnd if not is_upper(e)]
assert len(up) == len(lo) and len(up) > 30, ('the lip cut is wrong', len(up), len(lo))
C = Vector((XC, -(ZH - 0.25 * KS), lipz(-(ZH - 0.25 * KS))))      # the rings shrink toward the throat, just behind the mouth angle, where palate and floor meet and are welded
SKIN_GAP = 0.09 * KS                                        # cm of skin kept over the roof and under the floor
K = 16                                                  # rings per sheet: quads about 0.1-0.2 cm deep (a coarse fan of long slivers was the first version)
ALPHA = [(k + 1) / K for k in range(K)]
CUMK = [(1 - a) ** 1.35 * (1 - 0.02) + 0.02 * (1 - a) for a in ALPHA]; CUMK[-1] = 0.02          # shrink toward the throat, eased: fine rings near the lips
sinp = lambda a: max(0.0, math.sin(math.pi * a ** 0.7)) ** 0.9
HROOF, HFLOOR = 0.30 * KS, 0.20 * KS                             # the palate's arch (cm above the tooth-line plane) and the floor's basin (below it)
roofH = lambda a: HROOF * sinp(a); floorH = lambda a: HFLOOR * sinp(a)
# the eyeballs bulge into the roof of the mouth (a frog swallows by pulling them down): under each globe the palate gets a smooth round depression that clears the globe by
# EYE_GAP, so the cavity and the eyeballs never intersect. Eye data from the skull JSON (baked cm: x, up, fwd) in this script's frame (x, -fwd, up).
EYE_GAP, EYE_REACH = 0.06 * KS, 0.30 * KS
EYES_L = [(e['c'][0], -e['c'][2], e['c'][1], e['r']) for e in SK.get('eyes', [])]
def smin(a, b, k=0.06): return -k * math.log(math.exp(-a / k) + math.exp(-b / k))
def under_eye(x_, y_, z_):
    for ex, ey, ez, er in EYES_L:
        dh = math.hypot(x_ - ex, y_ - ey)
        if dh < er + EYE_GAP + EYE_REACH:
            zs = ez - math.sqrt(max((er + EYE_GAP) ** 2 - dh ** 2, 0.0)) if dh < er + EYE_GAP else ez - 0.0
            if dh < er + EYE_GAP: z_ = smin(z_, zs)
    return z_
ringv = []
def rings(edges, sign):
    cur, last, prev = edges, [], 1.0
    for cs, al in zip(CUMK, ALPHA):
        s_ = cs / prev; prev = cs
        ret = bmesh.ops.extrude_edge_only(bm, edges=cur)
        nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            p = v.co; x_ = C.x + (p.x - C.x) * s_; y_ = C.y + (p.y - C.y) * s_
            z_ = lipz(y_) + sign * (roofH(al) if sign > 0 else floorH(al))                        # follows the SLOPING tooth-line plane, then the vault
            hit = SKIN0.ray_cast(Vector((x_, y_, lipz(y_))), Vector((0, 0, sign)), 3.0)          # ... but never closer than SKIN_GAP to the skin above (roof) or below (floor)
            if hit[0] is not None: z_ = min(z_, hit[0].z - SKIN_GAP) if sign > 0 else max(z_, hit[0].z + SKIN_GAP)
            if sign > 0: z_ = under_eye(x_, y_, z_)
            v.co = Vector((x_, y_, z_))
        nvs = set(nv); cur = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMEdge) and g.verts[0] in nvs and g.verts[1] in nvs]
        last = nv; ringv.extend(nv)
    return last
last_u = rings(up, +1); last_l = rings(lo, -1)
key = lambda v: (round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4))
ckeys = {key(v) for v in last_u}
bmesh.ops.remove_doubles(bm, verts=last_u + last_l, dist=1e-5)
closing = {v for v in bm.verts if v.is_valid and key(v) in ckeys}
bnd = [e for e in bm.edges if e.is_boundary and e not in BND0]
filled = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)['faces']
assert 2 <= len(filled) <= 4, ('the two hinge ends should be the only holes', len(filled), len(bnd))
inner = {v for v in ringv if v.is_valid}
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in set(filled) | set(f for v in inner for f in v.link_faces):
    for l in f.loops: l[lay] = (0.0, 1.0, 0.0, 1.0)          # the inside of the mouth: pure green, the marker the skin bake turns into mucosa
for _ in range(8): bmesh.ops.smooth_vert(bm, verts=list(inner), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# 3b. THE TONGUE (gate 4, 7 Oct 2026; the lab's blade was wrong: 2.6-2.9 mm thick in a 3 mm cavity, its underside sunk 0.4-0.6 mm into the floor). A soft PAD lying ON the floor:
# attached in front just behind the symphysis, the free end back over the hyoid and notched (bifid in Rana), about 1 mm thick (THK), widest at 60 % of its length; every
# vertex's underside set onto the floor sheet by a ray down (TGAP clearance), so it never sinks into it. Blue COLOR_0 = tongue; _TONGW 1; _TONGT 0 (attachment) .. 1 (notched end):
# the bake binds it to the tongue bones by _TONGT. tongue.json holds the attachment, the tip, its length and thickness.
from mathutils.bvhtree import BVHTree as _BVH
L_SK = SK.get('skullLengthCm', 3.05)
TL0, TL1 = SNOUT - float(opt('--tongue-front', 0.10)) * L_SK, ZH + float(opt('--tongue-back', 0.25)) * L_SK
THK, TGAP = float(opt('--tongue-thick', 0.10)), float(opt('--tongue-gap', 0.012 * KS))        # (--tongue-thick/--tongue-gap: cm; a small frog's tongue is thinner: the harlequin's 0.045 thick, 0.02 off the floor)
yA, yT = -TL0, -TL1
_fl = [f for f in bm.faces if f.is_valid and all(v in inner for v in f.verts) and f.calc_center_median().z < lipz(f.calc_center_median().y)]
_fv = list({v for f in _fl for v in f.verts}); _fi = {v: k for k, v in enumerate(_fv)}
FLOORT = _BVH.FromPolygons([v.co.copy() for v in _fv], [[_fi[v] for v in f.verts] for f in _fl])
def floor_at(x_, y_):
    h = FLOORT.ray_cast(Vector((x_, y_, lipz(y_) + 0.05)), Vector((0, 0, -1)), 3.0)
    return h[0].z if h[0] is not None else lipz(y_) - floorH(0.5)
prof = sorted(SK['profile'], key=lambda r: r['z'])
def half_mouth(z):
    for a_, b_ in zip(prof, prof[1:]):
        if a_['z'] <= z <= b_['z']: t_ = (z - a_['z']) / (b_['z'] - a_['z']); return a_['half'] + (b_['half'] - a_['half']) * t_
    return prof[0]['half'] if z < prof[0]['z'] else prof[-1]['half']
TWIDTH = float(opt('--tongue-width', 0.40))
half_w = lambda t, z: TWIDTH * half_mouth(z) * ((0.55 + 0.45 * math.sin(min(1.0, t / 0.6) * math.pi / 2)) if t < 0.6 else (1.0 - 0.12 * (t - 0.6) / 0.4))
half_h = lambda t: THK / 2 * (0.6 + 0.4 * math.sin(math.pi * min(1.0, t)))
NT, NM = 36, 16
tv, trings = [], []
for i in range(NT + 1):
    t = i / NT; yc = yA + (yT - yA) * t; zb = -yc
    rt = 1.0 if t < 0.92 else math.sqrt(max(0.0, 1.0 - ((t - 0.92) / 0.08) ** 2))
    notch = 0.12 * (TL0 - TL1) * smooth((t - 0.80) / 0.20)
    hw, hh = half_w(t, zb), half_h(t)
    ring = []
    for j in range(NM):
        th = 2 * math.pi * j / NM; xl = hw * math.cos(th) * rt; sn = math.sin(th)
        dy = -notch * max(0.0, 1.0 - abs(xl) / (0.55 * hw))
        x_, y_ = XC + xl, yc + dy
        fz = floor_at(x_, y_) + TGAP                                    # the floor under this point
        z_ = fz + hh * (1 + sn) * rt if sn >= 0 else fz + hh * (1 + 0.25 * sn) * rt     # flat underside on the floor, domed top
        v = bm.verts.new(Vector((x_, y_, z_))); ring.append(v); tv.append((v, t))
    trings.append(ring)
tfaces = []
for i in range(NT):
    for j in range(NM):
        a_, b_, c_, d_ = trings[i][j], trings[i][(j + 1) % NM], trings[i + 1][(j + 1) % NM], trings[i + 1][j]
        try: tfaces.append(bm.faces.new((a_, b_, c_, d_)))
        except ValueError: pass
bmesh.ops.remove_doubles(bm, verts=[v for v, _ in tv], dist=1e-5)
tfaces = [f for f in tfaces if f.is_valid]
try: tfaces.append(bm.faces.new([v for v in trings[0] if v.is_valid]))
except ValueError: pass
bmesh.ops.recalc_face_normals(bm, faces=tfaces)
for f in tfaces:
    f.smooth = True
    for l in f.loops: l[lay] = (0.0, 0.0, 1.0, 1.0)
tong_verts = [(v, t) for v, t in tv if v.is_valid]
zA = floor_at(XC, yA) + TGAP + half_h(0); zT = floor_at(XC, yT) + TGAP + half_h(1)
TONGUE = {'attach': [round(XC, 3), round(zA, 3), round(TL0, 3)], 'tip': [round(XC, 3), round(zT, 3), round(TL1, 3)], 'lengthCm': round(TL0 - TL1, 3), 'thicknessCm': THK,
          'halfWidthMaxCm': round(half_w(0.6, -(yA + (yT - yA) * 0.6)), 3), 'bifidDepthCm': round(0.12 * (TL0 - TL1), 3),
          'axis': 'attached at the front of the lower jaw just behind the symphysis; rest pose lying back on the floor over the hyoid, notched end toward the throat'}
bm.verts.index_update(); closing_idx = {v.index for v in closing}
tong_idx = {v.index: t for v, t in tong_verts}
# 4. the jaw's and the hyoid's weights (gate 4, 7 Oct 2026). Two tries taught the rule:
#  - the first eased the jaw in over +-BL at the hinge only: the open mouth tore at its corner and the throat stayed behind as the lower jaw swung down like a blade;
#  - the second ran the JAW's weight back along the throat: skin behind the hinge then ROTATES with the jaw, swings up and back into the body, and the cheek tore.
# A frog's throat is not on the mandible: the buccal floor and the throat skin hang from the HYOID, which drops as the mouth opens (buccal depression) and stretches the throat.
#  - jaw: the skin below the lip plane in front of the hinge, easing in over BL in front of it (nothing behind: a turn about the hinge lifts what lies behind it); the corner smoothed among lower-side vertices only (the upper lip and the
#    head never take jaw weight); the tongue rides with the jaw (attached at the symphysis)
#  - hyoid: the throat behind the hinge and the floor's deep middle, by depth under the lip (full from HDEPTH) and fading back to the chest over THROAT
#  - neither ever on a foreleg lying under the chin (the bake's binding: its dominant bone is a limb's)
THROAT = float(opt('--throat', 0.9)) * KS; HDEPTH = 0.35 * KS; JSMOOTH = int(opt('--jaw-smooth', 8))
sk_lay = bm.verts.layers.float_color.get('_SKIN') or bm.verts.layers.color.get('_SKIN')
LIMB = set(range(4, 18))                                                    # frogBones order: pelvis 0, spine 1, spineB 2, head 3, then each side's thigh ... hand
def dom_bone(v):
    if sk_lay is None: return 3
    c = v[sk_lay]; return int(round(c[0] * 32)) if c[2] >= c[3] else int(round(c[1] * 32))
bm.verts.ensure_lookup_table(); bm.verts.index_update()
inner_set = {v for v in inner if v.is_valid}; tong_set = {v for v, _ in tong_verts}
J0, LOWER, hyo = {}, set(), {}
for v in bm.verts:
    p = v.co; z = -p.y
    if abs(p.x - XC) > HW + 0.3 or p.z < ZLOW or (v.index < N_WELDED and dom_bone(v) in LIMB): continue
    d = p.z - lipz(p.y)
    if abs(d) < 1e-3:
        if v.index in closing_idx or abs(z - ZH) < 0.12 * KS: side = 0.5
        else: side = 0.0 if sum(f.calc_center_median().z - lipz(f.calc_center_median().y) for f in v.link_faces) > 0 else 1.0
    else: side = 0.0 if d > 0 else 1.0
    if side > 0:
        J0[v.index] = side * smooth((z - ZH) / BL); LOWER.add(v.index)        # in FRONT of the hinge only: a rotation about the hinge lifts what lies behind it (the third try's spikes)
        depth = max(0.0, -d)
        h = smooth(depth / HDEPTH) * (1.0 if z >= ZH else 1.0 - smooth((ZH - z) / THROAT))
        if v in inner_set and z > ZH: h *= smooth((ZH + 0.6 * (SNOUT - ZH) - z) / (0.3 * (SNOUT - ZH)))   # the floor's back half sits on the hyoid, the front on the rami
        if v not in tong_set and h > 0.01: hyo[v.index] = h
cur = dict(J0)
for v in tong_set: cur[v.index] = 1.0
free = [i for i in LOWER if bm.verts[i] not in tong_set and ZH < -bm.verts[i].co.y < ZH + 3 * BL]
nb = {i: [k for k in (e.other_vert(bm.verts[i]).index for e in bm.verts[i].link_edges) if k in LOWER and -bm.verts[k].co.y >= ZH] for i in free}
for _ in range(JSMOOTH):
    cur.update({i: 0.5 * cur[i] + 0.5 * (sum(cur[k] for k in nb[i]) / len(nb[i]) if nb[i] else cur[i]) for i in free})
jaw = {i: w for i, w in cur.items() if w > 0.002}
# a vertex's jaw and hyoid shares together never above 1 (the rest stays on the head): the hyoid gives way to the jaw in front
for i in list(hyo): hyo[i] = min(hyo[i], 1.0 - jaw.get(i, 0.0)) if i in jaw else hyo[i]
hyo = {i: w for i, w in hyo.items() if w > 0.01}
print('jaw weights: %d weighted (%d smoothed at the corner, %d passes); hyoid: %d weighted, throat reach %.2f cm' % (len(jaw), len(free), JSMOOTH, len(hyo), THROAT))
cav_n = len({v.index for v in inner if v.is_valid})
for f_ in bm.faces: f_.smooth = True                                       # faces made by the extrusions are flat by default: the radial streaks on the palate and floor were their facets
bm.to_mesh(me); bm.free(); me.update()
jw_attr = me.attributes.new('_JAWW', 'FLOAT', 'POINT')                      # the jaw weights as data too (the lab poses the jaw from it; the lead can read it)
jw_attr.data.foreach_set('value', [jaw.get(i, 0.0) for i in range(len(me.vertices))])
hy_attr = me.attributes.new('_HYOW', 'FLOAT', 'POINT'); hy_attr.data.foreach_set('value', [hyo.get(i, 0.0) for i in range(len(me.vertices))])
for nm_, fn_ in (('_TONGW', lambda i: 1.0 if i in tong_idx else 0.0), ('_TONGT', lambda i: tong_idx.get(i, 0.0))):
    at_ = me.attributes.new(nm_, 'FLOAT', 'POINT'); at_.data.foreach_set('value', [fn_(i) for i in range(len(me.vertices))])
if 'Color' in me.color_attributes:
    me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = me.color_attributes.find('Color')   # exported as COLOR_0 (the mouth marker)

# 5. fold the jaw into the game's four-bone skin (when the body has it); repair the bone ids and muscle channels the fan averaged by copying the nearest untouched vertex's
if '_SKIN' in me.attributes:
    S, X, R = me.attributes['_SKIN'].data, me.attributes['_SKINX'].data, me.attributes['_RIG'].data
    MU = [me.attributes[n].data for n in ('_MUSC', '_MUSU') if n in me.attributes]
    bones_of = lambda i: [(S[i].color[0] * 32, S[i].color[2]), (S[i].color[1] * 32, S[i].color[3]), (X[i].color[0] * 32, X[i].color[2]), (X[i].color[1] * 32, X[i].color[3])]
    bad = [i for i in range(len(me.vertices)) if any(w > 1e-4 and abs(b - round(b)) > 0.02 for b, w in bones_of(i))]
    badset = set(bad); pool = [v.index for v in me.vertices if v.index not in badset and v.index < N0 and v.co.y < YMAX and abs(v.co.x - XC) < HW and v.co.z > ZLOW]
    for i in bad:
        j = min(pool, key=lambda k: (me.vertices[k].co - me.vertices[i].co).length_squared)
        S[i].color = tuple(S[j].color); X[i].color = tuple(X[j].color); R[i].color = tuple(R[j].color)
        for a in MU: a[i].color = tuple(a[j].color)
    for i, w in jaw.items():
        bw = {}
        for b, q in bones_of(i):
            if q > 0: bw[int(round(b))] = bw.get(int(round(b)), 0) + q * (1 - w)
        bw[JAW] = bw.get(JAW, 0) + w
        top = sorted(bw.items(), key=lambda kv: (-kv[1], kv[0]))[:4]; s = sum(q for _, q in top) or 1
        while len(top) < 4: top.append((top[0][0], 0.0))
        S[i].color = (top[0][0] / 32, top[1][0] / 32, top[0][1] / s, top[1][1] / s); X[i].color = (top[2][0] / 32, top[3][0] / 32, top[2][1] / s, top[3][1] / s)
    print('skin folded: jaw-weighted', len(jaw), 'repaired', len(bad))
else:
    print('no _SKIN attributes on this mesh (a raw scan): jaw weights only as the `jaw` vertex group of the preview')

# the jaw bone for the manifest skeleton, baked cm (x lateral, y up, z forward): head at the hinge pair's middle, tail toward the chin tip on the lower lip
tail_z = SNOUT - 0.15; jaw_bone = {'name': 'jaw', 'parent': 'head', 'index': JAW, 'head': [round(XC, 3), round(HY, 3), round(ZH, 3)], 'tail': [round(XC, 3), round(lipz(-tail_z) - 0.10, 3), round(tail_z, 3)],
                                   'r': 0.25, 'limb': 0, 'verts_before': N0, 'verts_after': len(me.vertices), 'jawWeighted': len(jaw), 'cavityVerts': cav_n}
jaw_bone['tongue'] = TONGUE
print('mouth built: verts', N0, '->', len(me.vertices), 'jaw-weighted', len(jaw), 'cavity', cav_n, 'jaw bone', jaw_bone['head'], '->', jaw_bone['tail'])

if PREVIEW:
    vg = body.vertex_groups.new(name='jaw')
    for i, w in jaw.items(): vg.add([i], w, 'REPLACE')
    vh = body.vertex_groups.new(name='hyoid')
    for i, w in hyo.items(): vh.add([i], w, 'REPLACE')
    ad = bpy.data.armatures.new('jawrig'); arm = bpy.data.objects.new('jawrig', ad); bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
    b = ad.edit_bones.new('jaw'); b.head = Vector((XC, -ZH, HY)); b.tail = Vector((XC, -(SNOUT - 0.15), lipz(-(SNOUT - 0.15))))
    bh = ad.edit_bones.new('hyoid'); bh.head = Vector((XC, -(ZH + 0.2 * KS), lipz(-(ZH + 0.2 * KS)) - 0.3 * KS)); bh.tail = bh.head + Vector((0, 0, -0.3 * KS))   # pointing down: its local y is down
    bpy.ops.object.mode_set(mode='OBJECT')
    body.modifiers.new('jaw', 'ARMATURE').object = arm; arm.pose.bones['jaw'].rotation_mode = 'XYZ'
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'VERTEX'; sc.view_settings.view_transform = 'Standard'
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.05, 0.05, 0.06)
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = 6.2 * KS; cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (30, -(SNOUT + ZH) / 2, HY + 0.2); cam.rotation_euler = (math.pi / 2, 0, math.pi / 2); sc.render.resolution_x = sc.render.resolution_y = 700
    DROP = float(opt('--hyoid-drop', 0.30))                                  # cm the hyoid drops at the widest gape (a guess; buccal depression on opening)
    for deg in (0, 22, 38):
        arm.pose.bones['jaw'].rotation_euler = (math.radians(deg), 0, 0); arm.pose.bones['hyoid'].location = (0, DROP * KS * deg / 38.0, 0); bpy.context.view_layer.update()
        sc.render.filepath = f'{PREVIEW}jaw{deg}.png'; bpy.ops.render.render(write_still=True)
    body.modifiers.remove(body.modifiers['jaw']); body.vertex_groups.remove(vg); body.vertex_groups.remove(vh)

# 6. out, in metres
me.transform(Matrix.Scale(0.01, 4)); me.update()
for o in bpy.context.selected_objects: o.select_set(False)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False, export_attributes=True, export_skins=False, export_animations=False,
    export_morph=False, export_yup=True, export_normals=True, export_texcoords=True, export_all_vertex_colors=False, export_vertex_color='ACTIVE', export_extras=False,
    export_cameras=False, export_lights=False)
json.dump(jaw_bone, open(OUT + '.jaw.json', 'w'), indent=1)
print('exported', OUT)
