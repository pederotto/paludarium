# Skin lab (tools/skin): bakes realistic skin maps for a creature in headless Blender (Cycles) and previews them. See docs/SKIN.md.
#   Blender -b -P tools/skin/skinlab.py -- --mesh <plain.glb> --variant after --geo --bones <bones.json> --eyebaked "x,up,fwd,r" --bake <base>
#       writes <base>_color.png, <base>_normal.png (1024) and <base>_uv.npz; then python3 tools/skin/clean_normal.py <base>_uv.npz <base>_normal.png <out>.png
#   --variant before | after | baked (render the game's old look, the procedural skin, or the baked maps) --view macro|photo|head|swim|...
#
import bpy, sys, math, argparse, os, ast
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument('--mesh'); ap.add_argument('--color'); ap.add_argument('--out')
ap.add_argument('--variant', default='before'); ap.add_argument('--view', default='macro')
ap.add_argument('--samples', type=int, default=96); ap.add_argument('--res', type=int, default=1100)
ap.add_argument('--save', default='')
ap.add_argument('--bake', default=''); ap.add_argument('--bakeres', type=int, default=1024)
ap.add_argument('--maps', default='')
ap.add_argument('--params', default='')   # python dict literal overriding SKIN
ap.add_argument('--geo', action='store_true')      # regions (belly, limb bands, toe tips) from the mesh itself, not from the old atlas
ap.add_argument('--orient', type=float, default=0.0)   # degrees about Z so that the head points to -Y
ap.add_argument('--cm', type=float, default=0.0)       # scale so the longest horizontal extent is this many cm
ap.add_argument('--smooth', type=int, default=0)       # Laplacian smoothing passes (a faceted scan)
ap.add_argument('--tlo', type=float, default=0.18); ap.add_argument('--thi', type=float, default=0.29)   # trunk/limb thickness thresholds, fractions of the body extent
ap.add_argument('--tiprad', type=float, default=0.07)   # toe-tip search radius, fraction of the body extent
ap.add_argument('--bones', default='')               # manifest skeleton bones (json, baked frame cm): exact limb membership, distance along the limb, toe zone
ap.add_argument('--eyebaked', default='')            # eyes as 'x,up,fwd,r;...' in the baked frame (cm); mirrored across x=0 when only one is given
ap.add_argument('--eyeaxis', default='')              # gaze axis 'x,up,fwd' (baked frame, +x eye), default the game's (0.617, 0.448, 0.647)
ap.add_argument('--eyedome', action='store_true')    # preview: push the mesh out into a sphere at each eye (a mesh without eye bumps)
ap.add_argument('--eyes', action='store_true')       # find the eye globes on the mesh and shade them as eyes
ap.add_argument('--eyecm', default='')                # override: 'x,y,z,r;x,y,z,r' in cm, local frame
ap.add_argument('--autouv', action='store_true')       # Smart UV Project when the mesh has no UVs
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

# All lengths in metres (object space, scale applied). Palette in sRGB 0-255, from the owner's reference photo (toad_ref1).
SKIN = dict(
    cell=0.00095,            # tubercle cell size (m), photo: ~0.9 mm
    rad_min=0.55, rad_max=0.88, dome_pow=1.25, hv_min=0.55, warp=0.00045,
    wart_bump=0.00028, wart_strength=1.0,
    gran_cell=0.00032, gran_strength=0.10,
    belly_wart=0.40,         # share of dorsal wart height kept on the underside
    blotch_cell=0.0032, blotch_stretch=0.5, blotch_thresh=0.505, blotch_soft=0.035, speck=0.05,
    green=(112, 154, 22), orange=(226, 96, 30), black=(15, 15, 10),
    rough_green=0.36, rough_black=0.72, rough_orange=0.45,
    coat_green=0.28, coat_black=0.0, coat_rough=0.20, sss=0.18,
    vent_hi=0.05, vent_lo=-0.30, marble_cell=0.0045, marble_thresh=0.50,
    band=0.0062, band_wobble=4.0, band_thr=0.16, tip_orange=0.0013, tip_black=0.0045,
)
if args.params: SKIN.update(ast.literal_eval(args.params))
P = SKIN

def lin(c):  # sRGB 0-255 -> linear
    f = lambda v: ((v / 255 + 0.055) / 1.055) ** 2.4 if v / 255 > 0.04045 else v / 255 / 12.92
    return (f(c[0]), f(c[1]), f(c[2]), 1.0)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
cy = sc.cycles; cy.samples = args.samples; cy.use_denoising = True
try: cy.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = (d.type == 'METAL')
    cy.device = 'GPU'
except Exception as e:
    print('GPU setup failed, CPU render:', e)
sc.render.resolution_x = args.res; sc.render.resolution_y = int(args.res * 0.75)
sc.render.image_settings.file_format = 'PNG'
PHOTO = args.view.startswith('photo')
PHOTO_ENV = float(os.environ.get('PHOTO_ENV', 0.25)); KEY_W = float(os.environ.get('KEY_W', 2.2))
for name in (['Standard'] if PHOTO else []) + ['AgX', 'Filmic', 'Standard']:
    try:
        sc.view_settings.view_transform = name; break
    except TypeError:
        pass


# ---------------------------------------------------------------- mesh
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.mesh))
frog = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
for o in bpy.context.scene.objects: o.select_set(False)
frog.select_set(True); bpy.context.view_layer.objects.active = frog
if frog.parent:
    m = frog.matrix_world.copy(); frog.parent = None; frog.matrix_world = m
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
frog.name = 'frog'
loc0 = frog.location.copy()   # glTF node translation (the baked frame's origin), metres, Blender axes
if args.orient:
    frog.rotation_mode = 'XYZ'; frog.rotation_euler = (0, 0, math.radians(args.orient)); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
if args.cm:
    b0 = [Vector(c) for c in frog.bound_box]
    ext = max(max(v.x for v in b0) - min(v.x for v in b0), max(v.y for v in b0) - min(v.y for v in b0))
    k = args.cm / 100.0 / ext; frog.scale = (k, k, k); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
if args.smooth:
    md = frog.modifiers.new('sm', 'SMOOTH'); md.factor = 0.5; md.iterations = args.smooth; bpy.ops.object.modifier_apply(modifier='sm')
if args.autouv and not frog.data.uv_layers:
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
bb = [frog.matrix_world @ Vector(c) for c in frog.bound_box]
frog.location.z -= min(v.z for v in bb)
bpy.context.view_layer.update()
bb = [frog.matrix_world @ Vector(c) for c in frog.bound_box]
lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
ctr = (lo + hi) / 2
print('FROG bbox cm', [round(x * 100, 2) for x in (hi - lo)])
bpy.ops.object.shade_smooth()

def geo_attrs(obj, ext):
    # per-vertex: limbness (thin tube vs trunk, from the local thickness), limb_s (surface distance from the trunk, m), tipd (distance to the
    # nearest toe tip, m). Computed from the mesh alone so it works on any baked frog.
    import bmesh, heapq
    import numpy as np
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    me = obj.data; bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.normal_update()
    n = len(bm.verts); bvh = BVHTree.FromBMesh(bm)
    thick = np.zeros(n)
    for v in bm.verts:
        d = -v.normal; hit = bvh.ray_cast(v.co + d * 2e-5, d, 0.2)
        thick[v.index] = hit[3] if hit[0] is not None else 0.0
    nb = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    for _ in range(4):
        thick = np.array([(thick[i] + sum(thick[j] for j in nb[i])) / (1 + len(nb[i])) for i in range(n)])
    t0, t1 = args.tlo * ext, args.thi * ext
    x = np.clip((thick - t0) / (t1 - t0), 0, 1); limb = 1 - x * x * (3 - 2 * x)
    INF = 1e9; sd = [INF] * n; pq = []
    for i in range(n):
        if limb[i] < 0.02: sd[i] = 0.0; pq.append((0.0, i))
    heapq.heapify(pq)
    while pq:
        d, i = heapq.heappop(pq)
        if d > sd[i]: continue
        vi = bm.verts[i]
        for e in vi.link_edges:
            j = e.other_vert(vi).index; nd = d + e.calc_length()
            if nd < sd[j]: sd[j] = nd; heapq.heappush(pq, (nd, j))
    sd = np.array([0.0 if v >= INF else v for v in sd])
    kd = KDTree(n)
    for v in bm.verts: kd.insert(v.co, v.index)
    kd.balance()
    tips = []
    for i in range(n):
        if sd[i] < 0.12 * ext: continue
        if all(sd[j] <= sd[i] for (_, j, _) in kd.find_range(bm.verts[i].co, args.tiprad * ext)): tips.append(i)
    tipd = np.full(n, 0.2)
    if tips:
        kt = KDTree(len(tips))
        for k, i in enumerate(tips): kt.insert(bm.verts[i].co, k)
        kt.balance()
        for i in range(n): tipd[i] = kt.find(bm.verts[i].co)[2]
    toe_fb = np.clip(1.0 - tipd / 0.008, 0, 1) * limb
    for name, arr in (('limbness', limb), ('limb_s', sd), ('tipd', tipd), ('toe', toe_fb)):
        a = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT'); a.data.foreach_set('value', arr.astype('float32'))
    print('GEO thickness cm p5/p25/p50/p75/p95', [round(float(q) * 100, 2) for q in np.percentile(thick, [5, 25, 50, 75, 95])], 'ext cm', round(ext * 100, 2),
          '| limb verts %.0f%%' % (100 * (limb > 0.5).mean()), '| tips', len(tips), '| max s cm', round(sd.max() * 100, 2))
    bm.free()

def bone_attrs(obj, bones_json):
    # Limb membership from the game's own skeleton (manifest bones, baked frame cm: x, up, forward -> local (x, -fwd, up) metres):
    # limbness (0 trunk/head, 1 limb), limb_s = surface-ish arc length from the limb root along the bone chain (m), toe = 0..1 along the last
    # bone (hand / toes), so the last fifth is the orange tip. Each vertex follows the bone with the smallest distance / bone radius.
    import json, numpy as np
    bones = json.load(open(bones_json)); idx = {b['name']: i for i, b in enumerate(bones)}
    def loc(B): return np.array([B[0] / 100 - loc0.x, -B[2] / 100 - loc0.y, B[1] / 100 - loc0.z])
    A = np.array([loc(b['head']) for b in bones]); Bt = np.array([loc(b['tail']) for b in bones]); R = np.array([b['r'] / 100 for b in bones])
    ln = np.linalg.norm(Bt - A, axis=1)
    cum = np.zeros(len(bones))
    for i, b in enumerate(bones):
        if b['limb'] and b['parent'] is not None and bones[idx[b['parent']]]['limb'] == b['limb']:
            cum[i] = cum[idx[b['parent']]] + ln[idx[b['parent']]]
    V = np.array([v.co[:] for v in obj.data.vertices]); n = len(V)
    D = np.zeros((len(bones), n)); T = np.zeros((len(bones), n))
    for i in range(len(bones)):
        ab = Bt[i] - A[i]; t = np.clip(((V - A[i]) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        D[i] = np.linalg.norm(V - (A[i] + t[:, None] * ab), axis=1); T[i] = t
    N = D / R[:, None]
    isl = np.array([bool(b['limb']) for b in bones])
    dT = N[~isl].min(0); dL = N[isl].min(0)
    tr = dT / np.maximum(dT + dL, 1e-9)
    x = np.clip((tr - 0.45) / 0.20, 0, 1); limb = x * x * (3 - 2 * x)
    li = np.where(isl)[0]; best = li[np.argmin(N[li], axis=0)]
    # distance along the limb: surface distance (Dijkstra over the mesh edges) from the trunk side, not the nearest bone's cum + t*len: with a
    # fattened limb the nearest bone flips between neighbouring vertices and that value jumps (|ds|/edge up to 30); this one is 1-Lipschitz.
    import heapq
    # (the game mesh duplicates vertices along UV seams: weld by position first, or the surface graph falls into islands)
    _, inv = np.unique(np.round(V * 1e7).astype(np.int64), axis=0, return_inverse=True); inv = inv.reshape(-1); m_ = int(inv.max()) + 1
    nbr = [dict() for _ in range(m_)]
    for e in obj.data.edges:
        a_, b_ = inv[e.vertices[0]], inv[e.vertices[1]]
        if a_ != b_:
            w_ = float(np.linalg.norm(V[e.vertices[0]] - V[e.vertices[1]])); nbr[a_][b_] = w_; nbr[b_][a_] = w_
    # triangles of a seam-split mesh still connect through the welded ids, but edges of the loop triangles are not all mesh edges: add them
    obj.data.calc_loop_triangles()
    for t_ in obj.data.loop_triangles:
        for k0, k1 in ((0, 1), (1, 2), (2, 0)):
            a_, b_ = inv[t_.vertices[k0]], inv[t_.vertices[k1]]
            if a_ != b_ and b_ not in nbr[a_]:
                w_ = float(np.linalg.norm(V[t_.vertices[k0]] - V[t_.vertices[k1]])); nbr[a_][b_] = w_; nbr[b_][a_] = w_
    limb_w = np.full(m_, 1.0); np.minimum.at(limb_w, inv, limb)
    sdw = np.full(m_, 1e9); pq = []
    for i_ in range(m_):
        if limb_w[i_] < 0.05: sdw[i_] = 0.0; pq.append((0.0, i_))
    heapq.heapify(pq)
    while pq:
        d_, i_ = heapq.heappop(pq)
        if d_ > sdw[i_]: continue
        for j_, w_ in nbr[i_].items():
            nd_ = d_ + w_
            if nd_ < sdw[j_]: sdw[j_] = nd_; heapq.heappush(pq, (nd_, j_))
    sd = sdw[inv]
    ls = np.where(sd >= 1e9, 0.0, sd)
    last = np.array([bones[b]['name'].startswith(('hand', 'toes')) for b in best])
    tt = np.array([T[best[k], k] for k in range(n)])
    toe = np.where(last, tt, 0.0) * limb
    for name, arr in (('limbness', limb), ('limb_s', ls), ('toe', toe)):
        a = obj.data.attributes.get(name) or obj.data.attributes.new(name, 'FLOAT', 'POINT'); a.data.foreach_set('value', arr.astype('float32'))
    E = np.array([[t_.vertices[k0], t_.vertices[k1]] for t_ in obj.data.loop_triangles for k0, k1 in ((0, 1), (1, 2), (2, 0))]); Vq = V
    el = np.linalg.norm(Vq[E[:, 0]] - Vq[E[:, 1]], axis=1); sv = ls
    both = (limb[E[:, 0]] > 0.5) & (limb[E[:, 1]] > 0.5)
    ratio = np.abs(sv[E[:, 0]] - sv[E[:, 1]])[both] / np.maximum(el[both], 1e-9)
    print('S-SLOPE |ds|/edge on limb edges p50/p90/p99/max', [round(float(q), 2) for q in np.percentile(ratio, [50, 90, 99, 100])], '| edges >2:', int((ratio > 2).sum()), 'of', len(ratio))
    print('BONES limb verts %.0f%%' % (100 * (limb > 0.5).mean()), '| toe>0.8 verts', int((toe > 0.8).sum()), '| max s cm', round(float((ls * (limb > 0.5)).max()) * 100, 2),
          '| median d/r trunk-or-limb %.2f' % float(np.median(np.minimum(dT, dL))))

EYES = []
def find_eyes(obj):
    # The two eye globes: the highest bump of each side of the head (front of the body, head towards -Y). Sphere fitted by least squares around
    # the top of each bump. Local frame, metres. A per-vertex mask 'eyem' (1 on the globe) is stored for the baked variant's gloss.
    import numpy as np
    me = obj.data
    V = np.array([v.co[:] for v in me.vertices])
    ymin = V[:, 1].min(); L = V[:, 1].max() - ymin
    head = V[V[:, 1] < ymin + 0.40 * L]
    out = []
    for sgn in (-1, 1):
        side = head[(head[:, 0] * sgn) > 0.004]
        top = side[np.argmax(side[:, 2])]
        sel = side[(np.linalg.norm(side - top, axis=1) < 0.0042) & (side[:, 2] > top[2] - 0.0034)]
        A = np.c_[2 * sel, np.ones(len(sel))]; b = (sel ** 2).sum(1)
        sol = np.linalg.lstsq(A, b, rcond=None)[0]; c = sol[:3]; r = float(np.sqrt(max(sol[3] + (c ** 2).sum(), 1e-12)))
        out.append((c, float(np.clip(r, 0.0016, 0.0034)), top))
    return out
if args.eyebaked:
    for part in args.eyebaked.split(';'):
        x, up, fw, r = [float(t) for t in part.split(',')]
        for sg in ((1, -1) if len(args.eyebaked.split(';')) == 1 else (1,)):
            EYES.append((Vector((sg * x / 100 - loc0.x, -fw / 100 - loc0.y, up / 100 - loc0.z)), r / 100))
elif args.eyecm:
    for part in args.eyecm.split(';'):
        x, y, z, r = [float(t) / 100.0 for t in part.split(',')]; EYES.append((Vector((x, y, z)), r))
elif args.eyes or args.geo or args.bones:
    for c, r, top in find_eyes(frog):
        EYES.append((Vector(c.tolist()), r)); wc = frog.matrix_world @ Vector(c.tolist()); print('EYE world cm (x, up, forward)', [round(wc.x * 100, 3), round(wc.z * 100, 3), round(-wc.y * 100, 3)], 'centre local cm', [round(float(t) * 100, 2) for t in c], 'r cm', round(r * 100, 2), 'top cm', [round(float(t) * 100, 2) for t in top])
if EYES and args.eyedome:
    import numpy as np
    for v in frog.data.vertices:
        for c_, r_ in EYES:
            dv = v.co - c_; dl = dv.length
            if 1e-9 < dl < r_: v.co = c_ + dv * (r_ / dl)
    frog.data.update()
    try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as e: print('could not clear custom normals', e)
if EYES:
    import numpy as np
    em = frog.data.attributes.get('eyem') or frog.data.attributes.new('eyem', 'FLOAT', 'POINT')
    arr = np.zeros(len(frog.data.vertices), dtype='float32')
    for i, v in enumerate(frog.data.vertices):
        m = 0.0
        for c_, r_ in EYES:
            d = (v.co - c_).length / r_
            m = max(m, min(1.0, max(0.0, (1.30 - d) / 0.25)))
        arr[i] = m
    em.data.foreach_set('value', arr)
if args.bones:
    bone_attrs(frog, os.path.abspath(args.bones))
elif args.geo:
    _b = [frog.matrix_world @ Vector(c) for c in frog.bound_box]
    geo_attrs(frog, max(max(v.x for v in _b) - min(v.x for v in _b), max(v.y for v in _b) - min(v.y for v in _b)))

# ---------------------------------------------------------------- material helpers
mat = bpy.data.materials.new('skin'); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear(); N = nt.nodes; L = nt.links
def node(t, x=0, y=0, **kw):
    n = N.new(t); n.location = (x, y)
    for k, v in kw.items(): setattr(n, k, v)
    return n
def link(src, dst):
    L.new(src, dst)
def feed(sock, v):
    if v is None: return
    if hasattr(v, 'node'): link(v, sock)
    else: sock.default_value = v
def M(op, a=None, b=None, c=None, clamp=False):
    n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
    feed(n.inputs[0], a); feed(n.inputs[1], b)
    if c is not None: feed(n.inputs[2], c)
    return n.outputs[0]
def MR(v, a, b, c, d, clamp=True, smooth=False):
    n = node('ShaderNodeMapRange', clamp=clamp)
    if smooth: n.interpolation_type = 'SMOOTHSTEP'
    feed(n.inputs['Value'], v); n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
    n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
    return n.outputs['Result']
def rgba(n, name, out=False):
    return [k for k in (n.outputs if out else n.inputs) if k.name == name and k.type == 'RGBA'][0]
def MIXC(fac, a, b):
    n = node('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
    feed(n.inputs['Factor'], fac); feed(rgba(n, 'A'), a); feed(rgba(n, 'B'), b)
    return rgba(n, 'Result', True)
def set_in(n, names, v):
    for nm in names:
        if nm in n.inputs: n.inputs[nm].default_value = v; return True
    return False

out = node('ShaderNodeOutputMaterial'); bsdf = node('ShaderNodeBsdfPrincipled')
link(bsdf.outputs['BSDF'], out.inputs['Surface'])
uvn = node('ShaderNodeUVMap'); uvn.uv_map = frog.data.uv_layers[0].name
if args.color:
    img = bpy.data.images.load(os.path.abspath(args.color)); img.colorspace_settings.name = 'sRGB'
    tex = node('ShaderNodeTexImage'); tex.image = img; link(uvn.outputs['UV'], tex.inputs['Vector'])
frog.data.materials.clear(); frog.data.materials.append(mat)
set_in(bsdf, ['IOR'], 1.4)

def finish(rough, coat, coat_rough, normal=None, coat_normal=None):
    feed(bsdf.inputs['Roughness'], rough)
    feed(bsdf.inputs['Coat Weight'], coat); feed(bsdf.inputs['Coat Roughness'], coat_rough)
    if normal is not None: link(normal, bsdf.inputs['Normal'])
    if coat_normal is not None and 'Coat Normal' in bsdf.inputs: link(coat_normal, bsdf.inputs['Coat Normal'])
    feed(bsdf.inputs['Subsurface Weight'], P['sss'])
    bsdf.inputs['Subsurface Radius'].default_value = (0.0012, 0.0005, 0.0003); bsdf.inputs['Subsurface Scale'].default_value = 1.0


# ---------------------------------------------------------------- eyes (lab preview of the game's analytic eyes; flat dark base when baking)
EYE_INNER = (0.30, 0.115, 0.018, 1.0); EYE_OUTER = (0.045, 0.017, 0.005, 1.0)   # lab iris: coppery ring, chocolate globe (owner's photos). The game's toad eye today: inner (0.893,0.485,0.036), outer (0.349,0.133,0.009)
EYE_AXIS = (0.617, 0.448, 0.647); EYE_H = (-0.7236, 0.0, 0.6902); EYE_W = (0.3091, -0.8941, 0.3241)  # baked frame (x out, y up, z forward), as the game
if args.eyeaxis:
    import math as _m
    _a = [float(t) for t in args.eyeaxis.split(',')]; _n = _m.sqrt(sum(t * t for t in _a)); EYE_AXIS = tuple(t / _n for t in _a)
    _h = (-EYE_AXIS[2], 0.0, EYE_AXIS[0]); _hn = _m.sqrt(_h[0] ** 2 + _h[2] ** 2); EYE_H = (_h[0] / _hn, 0.0, _h[2] / _hn)
    EYE_W = (EYE_AXIS[1] * EYE_H[2] - EYE_AXIS[2] * EYE_H[1], EYE_AXIS[2] * EYE_H[0] - EYE_AXIS[0] * EYE_H[2], EYE_AXIS[0] * EYE_H[1] - EYE_AXIS[1] * EYE_H[0])
def _bl(v, sgn):   # baked frame -> this lab's local frame (x, -z, y), mirrored for the -x eye
    return (sgn * v[0], -v[2], v[1])
def eye_zone(Pobj):
    zs = []
    for c, r in EYES:
        cv = node('ShaderNodeVectorMath', operation='SUBTRACT'); link(Pobj, cv.inputs[0]); cv.inputs[1].default_value = tuple(c)
        ln = node('ShaderNodeVectorMath', operation='LENGTH'); link(cv.outputs['Vector'], ln.inputs[0])
        zs.append(MR(ln.outputs['Value'], 1.32 * r, 1.05 * r, 0.0, 1.0, smooth=True))
    z = zs[0]
    for t_ in zs[1:]: z = M('MAXIMUM', z, t_)
    return z
def eye_colour(Pobj, base, flat):
    dark = (0.012, 0.012, 0.008, 1.0)
    for c, r in EYES:
        sgn = 1.0 if c.x > 0 else -1.0
        cv = node('ShaderNodeVectorMath', operation='SUBTRACT'); link(Pobj, cv.inputs[0]); cv.inputs[1].default_value = tuple(c)
        ln = node('ShaderNodeVectorMath', operation='LENGTH'); link(cv.outputs['Vector'], ln.inputs[0])
        zone = MR(ln.outputs['Value'], 1.32 * r, 1.05 * r, 0.0, 1.0, smooth=True)
        if flat:
            base = MIXC(zone, base, dark); continue
        dn = node('ShaderNodeVectorMath', operation='NORMALIZE'); link(cv.outputs['Vector'], dn.inputs[0])
        def dot(vec):
            d = node('ShaderNodeVectorMath', operation='DOT_PRODUCT'); link(dn.outputs['Vector'], d.inputs[0]); d.inputs[1].default_value = vec; return d.outputs['Value']
        ca, u, w_ = dot(_bl(EYE_AXIS, sgn)), dot(_bl(EYE_H, sgn)), dot(_bl(EYE_W, sgn))
        uu, vv = M('DIVIDE', u, 0.31), M('DIVIDE', w_, 0.23)
        pupil = MR(M('ADD', M('MULTIPLY', uu, uu), M('MULTIPLY', vv, vv)), 0.70, 1.0, 1.0, 0.0, smooth=True)
        rho = M('SQRT', M('ADD', M('MULTIPLY', u, u), M('MULTIPLY', w_, w_)))
        iris_in = MR(ca, -0.10, 0.12, 0.0, 1.0, smooth=True)          # the whole visible globe is iris, not just a disc
        iris = MIXC(MR(rho, 0.18, 0.98, 0.0, 1.0), EYE_INNER, EYE_OUTER)
        col = MIXC(iris_in, dark, iris)
        col = MIXC(pupil, col, (0.0, 0.0, 0.0, 1.0))
        base = MIXC(zone, base, col)
    return base

def eye_normal(Pobj, normal):
    # inside each eye globe use the analytic sphere normal (the baked mesh dome is faceted); the game's analytic eye does the same
    for c, r in EYES:
        cv = node('ShaderNodeVectorMath', operation='SUBTRACT'); link(Pobj, cv.inputs[0]); cv.inputs[1].default_value = tuple(c)
        ln = node('ShaderNodeVectorMath', operation='LENGTH'); link(cv.outputs['Vector'], ln.inputs[0])
        nn = node('ShaderNodeVectorMath', operation='NORMALIZE'); link(cv.outputs['Vector'], nn.inputs[0])
        wv = node('ShaderNodeVectorTransform', vector_type='NORMAL', convert_from='OBJECT', convert_to='WORLD'); link(nn.outputs['Vector'], wv.inputs[0])
        z = MR(ln.outputs['Value'], 1.10 * r, 1.0 * r, 0.0, 1.0, smooth=True)
        mv = node('ShaderNodeMix', data_type='VECTOR'); feed(mv.inputs['Factor'], z)
        link(normal, [k for k in mv.inputs if k.name == 'A' and k.type == 'VECTOR'][0]); link(wv.outputs['Vector'], [k for k in mv.inputs if k.name == 'B' and k.type == 'VECTOR'][0])
        normal = [k for k in mv.outputs if k.name == 'Result' and k.type == 'VECTOR'][0]
    return normal
def eye_finish(rough, coat, coat_rough, ez):
    one_minus = M('SUBTRACT', 1.0, ez)
    return (M('ADD', M('MULTIPLY', rough, one_minus), M('MULTIPLY', ez, 0.035)),
            M('ADD', M('MULTIPLY', coat, one_minus), ez),
            M('SUBTRACT', coat_rough, M('MULTIPLY', ez, coat_rough - 0.03)))

if args.variant == 'before':
    link(tex.outputs['Color'], bsdf.inputs['Base Color'])
    set_in(bsdf, ['Roughness'], 0.5); set_in(bsdf, ['Coat Weight'], 0.35); set_in(bsdf, ['Coat Roughness'], 0.3)
    set_in(bsdf, ['Subsurface Weight'], 0.3)

elif args.variant == 'baked':
    imc = bpy.data.images.load(os.path.abspath(args.maps + '_color.png')); imc.colorspace_settings.name = 'sRGB'
    imn = bpy.data.images.load(os.path.abspath(args.maps + '_normal.png')); imn.colorspace_settings.name = 'Non-Color'
    tc_ = node('ShaderNodeTexImage'); tc_.image = imc; link(uvn.outputs['UV'], tc_.inputs['Vector'])
    tn_ = node('ShaderNodeTexImage'); tn_.image = imn; link(uvn.outputs['UV'], tn_.inputs['Vector'])
    nm_ = node('ShaderNodeNormalMap', space='TANGENT'); nm_.uv_map = uvn.uv_map; link(tn_.outputs['Color'], nm_.inputs['Color'])
    tcx = node('ShaderNodeTexCoord')
    colb = tc_.outputs['Color']
    if EYES: colb = eye_colour(tcx.outputs['Object'], colb, False)
    link(colb, bsdf.inputs['Base Color'])
    # no third map: matte-black vs wet-green comes from the colour's own luminance (a one-line shader rule the game can copy)
    bwb = node('ShaderNodeRGBToBW'); link(tc_.outputs['Color'], bwb.inputs['Color'])
    blk = MR(bwb.outputs['Val'], 0.035, 0.008, 0.0, 1.0, smooth=True)
    rb = M('ADD', M('MULTIPLY', M('SUBTRACT', 1.0, blk), P['rough_green']), M('MULTIPLY', blk, P['rough_black']))
    cb = M('ADD', M('MULTIPLY', M('SUBTRACT', 1.0, blk), P['coat_green']), M('MULTIPLY', blk, P['coat_black']))
    crb = P['coat_rough']
    if EYES: rb, cb, crb = eye_finish(rb, cb, P['coat_rough'], eye_zone(tcx.outputs['Object']))
    nb_ = nm_.outputs['Normal']
    if EYES: nb_ = eye_normal(tcx.outputs['Object'], nb_)
    finish(rb, cb, crb, nb_, nb_)

else:  # 'after': the procedural skin
    tc = node('ShaderNodeTexCoord')
    Pobj = tc.outputs['Object']
    # --- tubercle field: domain-warped Voronoi, per-cell radius and height
    warp = node('ShaderNodeTexNoise', noise_dimensions='3D'); warp.inputs['Scale'].default_value = 1.0 / (P['cell'] * 2.2)
    warp.inputs['Detail'].default_value = 2; link(Pobj, warp.inputs['Vector'])
    wv = node('ShaderNodeVectorMath', operation='SUBTRACT'); link(warp.outputs['Color'], wv.inputs[0]); wv.inputs[1].default_value = (.5, .5, .5)
    ws = node('ShaderNodeVectorMath', operation='SCALE'); link(wv.outputs['Vector'], ws.inputs[0]); ws.inputs['Scale'].default_value = P['warp']
    pw = node('ShaderNodeVectorMath', operation='ADD'); link(Pobj, pw.inputs[0]); link(ws.outputs['Vector'], pw.inputs[1])
    v1 = node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1'); v1.inputs['Scale'].default_value = 1.0 / P['cell']
    v1.inputs['Randomness'].default_value = 1.0; link(pw.outputs['Vector'], v1.inputs['Vector'])
    cs = node('ShaderNodeSeparateColor'); link(v1.outputs['Color'], cs.inputs['Color'])
    rcell = MR(cs.outputs['Red'], 0, 1, P['rad_min'], P['rad_max'], clamp=True)
    xr = M('DIVIDE', v1.outputs['Distance'], rcell)
    dome = M('POWER', M('SQRT', M('SUBTRACT', 1.0, M('POWER', xr, 2.0), clamp=True)), P['dome_pow'])
    hcell = MR(cs.outputs['Green'], 0, 1, P['hv_min'], 1.0)
    # underside and limb undersides are smoother: object-space normal z
    nz = node('ShaderNodeSeparateXYZ'); link(tc.outputs['Normal'], nz.inputs['Vector'])
    up = MR(nz.outputs['Z'], -0.25, 0.35, P['belly_wart'], 1.0, smooth=True)
    nlow = node('ShaderNodeTexNoise', noise_dimensions='3D'); nlow.inputs['Scale'].default_value = 70; nlow.inputs['Detail'].default_value = 3; link(Pobj, nlow.inputs['Vector'])
    ez = eye_zone(Pobj) if EYES else None
    dens = M('MULTIPLY', up, MR(nlow.outputs['Fac'], 0.30, 0.55, 0.8, 1.0))
    if ez is not None: dens = M('MULTIPLY', dens, M('SUBTRACT', 1.0, ez))
    wart = M('MULTIPLY', M('MULTIPLY', dome, hcell), dens)
    v2 = node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1'); v2.inputs['Scale'].default_value = 1.0 / P['gran_cell']; link(Pobj, v2.inputs['Vector'])
    gran = MR(v2.outputs['Distance'], 0.0, 0.55, 1.0, 0.0)
    if ez is not None: gran = M('MULTIPLY', gran, M('SUBTRACT', 1.0, ez))
    H = M('ADD', M('MULTIPLY', wart, P['wart_strength']), M('MULTIPLY', gran, P['gran_strength']))
    bump = node('ShaderNodeBump'); bump.inputs['Distance'].default_value = P['wart_bump']; link(H, bump.inputs['Height'])
    # --- colour classes from the game's atlas (where the belly/orange is, where old dark marbling is), blotches from the tubercle cells
    if not args.geo:
        sepo = node('ShaderNodeSeparateColor'); link(tex.outputs['Color'], sepo.inputs['Color'])
        ratio = M('DIVIDE', M('SUBTRACT', sepo.outputs['Red'], sepo.outputs['Green']), M('ADD', M('ADD', sepo.outputs['Red'], sepo.outputs['Green']), 0.002))
        orange = MR(ratio, -0.10, 0.25, 0.0, 1.0, smooth=True)
        bw = node('ShaderNodeRGBToBW'); link(tex.outputs['Color'], bw.inputs['Color'])
        olddark = MR(bw.outputs['Val'], 0.05, 0.10, 1.0, 0.0, smooth=True)
    # blotches: low-frequency noise sampled at the CELL CENTRE (so every tubercle is wholly green or black), stretched along the body (y)
    mp = node('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, P['blotch_stretch'], 1.0); link(v1.outputs['Position'], mp.inputs['Vector'])
    nb = node('ShaderNodeTexNoise', noise_dimensions='3D'); nb.inputs['Scale'].default_value = 1.0 / P['blotch_cell']; nb.inputs['Detail'].default_value = 3.0
    nb.inputs['Roughness'].default_value = 0.55; link(mp.outputs['Vector'], nb.inputs['Vector'])
    blotch = MR(nb.outputs['Fac'], P['blotch_thresh'] - P['blotch_soft'], P['blotch_thresh'] + P['blotch_soft'], 0.0, 1.0, smooth=True)
    spk = MR(cs.outputs['Blue'], 1.0 - P['speck'], 1.0, 0.0, 1.0)
    cellblack = M('MAXIMUM', blotch, spk)
    # in the gaps between tubercles the blotch follows a smooth field instead of the cell polygons (organic edges)
    mp2 = node('ShaderNodeMapping'); mp2.inputs['Scale'].default_value = (1.0, P['blotch_stretch'], 1.0); link(Pobj, mp2.inputs['Vector'])
    nb2 = node('ShaderNodeTexNoise', noise_dimensions='3D'); nb2.inputs['Scale'].default_value = 1.0 / P['blotch_cell']; nb2.inputs['Detail'].default_value = 3.0
    nb2.inputs['Roughness'].default_value = 0.55; link(mp2.outputs['Vector'], nb2.inputs['Vector'])
    smoothblack = MR(nb2.outputs['Fac'], P['blotch_thresh'] - P['blotch_soft'], P['blotch_thresh'] + P['blotch_soft'], 0.0, 1.0, smooth=True)
    wcell = MR(dome, 0.25, 0.65, 0.0, 1.0, smooth=True)
    newblack = M('ADD', M('MULTIPLY', wcell, cellblack), M('MULTIPLY', M('SUBTRACT', 1.0, wcell), smoothblack))
    if not args.geo:
        black = M('MAXIMUM', M('MULTIPLY', newblack, M('SUBTRACT', 1.0, orange)), M('MULTIPLY', olddark, orange))
    else:
        def attr(name):
            n_ = node('ShaderNodeAttribute', attribute_name=name); n_.attribute_type = 'GEOMETRY'; return n_.outputs['Fac']
        Lm, S_, TOE = attr('limbness'), attr('limb_s'), attr('toe')
        wn = node('ShaderNodeTexNoise', noise_dimensions='3D'); wn.inputs['Scale'].default_value = 90; wn.inputs['Detail'].default_value = 2; link(Pobj, wn.inputs['Vector'])
        # belly: faces that look down, with a ragged edge; limb undersides too
        vent = MR(M('ADD', nz.outputs['Z'], M('MULTIPLY', M('SUBTRACT', wn.outputs['Fac'], 0.5), 0.5)), P['vent_hi'], P['vent_lo'], 0.0, 1.0, smooth=True)
        # black marbling on the orange
        mpb = node('ShaderNodeMapping'); mpb.inputs['Scale'].default_value = (1.0, 1.0, 1.0); link(Pobj, mpb.inputs['Vector'])
        nbm = node('ShaderNodeTexNoise', noise_dimensions='3D'); nbm.inputs['Scale'].default_value = 1.0 / P['marble_cell']; nbm.inputs['Detail'].default_value = 2.0; link(mpb.outputs['Vector'], nbm.inputs['Vector'])
        marble = MR(nbm.outputs['Fac'], P['marble_thresh'] - 0.04, P['marble_thresh'] + 0.04, 0.0, 1.0, smooth=True)
        # limb bands: periodic in the surface distance from the trunk, wobbling with noise
        nbp = node('ShaderNodeTexNoise', noise_dimensions='3D'); nbp.inputs['Scale'].default_value = 1.0 / 0.010; nbp.inputs['Detail'].default_value = 2.0; link(Pobj, nbp.inputs['Vector'])
        ang = M('ADD', M('MULTIPLY', S_, 6.2832 / P['band']), M('MULTIPLY', M('SUBTRACT', nbp.outputs['Fac'], 0.5), P['band_wobble']))
        bandblack = MR(M('SINE', ang), P['band_thr'] - 0.06, P['band_thr'] + 0.06, 0.0, 1.0, smooth=True)
        dorsal = M('ADD', M('MULTIPLY', bandblack, Lm), M('MULTIPLY', newblack, M('SUBTRACT', 1.0, Lm)))
        black0 = M('ADD', M('MULTIPLY', dorsal, M('SUBTRACT', 1.0, vent)), M('MULTIPLY', marble, vent))
        # toes: black segments, orange tips
        tipo = MR(TOE, 0.80, 0.90, 0.0, 1.0, smooth=True)
        toeblack = MR(TOE, 0.22, 0.36, 0.0, 0.85, smooth=True)
        black = M('MULTIPLY', M('MAXIMUM', black0, toeblack), M('SUBTRACT', 1.0, tipo))
        orange = M('MAXIMUM', vent, tipo)
    # lighter, yellower tops and darker crevices on the green
    top = MR(H, 0.0, 0.9, 0.55, 1.0)
    lowv = MR(nlow.outputs['Fac'], 0.25, 0.7, 0.88, 1.08)
    greenc = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); greenc.inputs['Factor'].default_value = 1.0
    feed(rgba(greenc, 'A'), lin(P['green']))
    shade = node('ShaderNodeCombineColor'); s_ = M('MULTIPLY', top, lowv)
    for ch in ('Red', 'Green', 'Blue'): link(s_, shade.inputs[ch])
    link(shade.outputs['Color'], rgba(greenc, 'B'))
    base = MIXC(orange, rgba(greenc, 'Result', True), lin(P['orange']))
    base = MIXC(black, base, lin(P['black']))
    if EYES: base = eye_colour(Pobj, base, bool(args.bake))
    link(base, bsdf.inputs['Base Color'])
    # wet green, matte rough black, satin orange
    notblack = M('SUBTRACT', 1.0, black)
    rough = M('ADD', M('MULTIPLY', notblack, M('ADD', M('MULTIPLY', M('SUBTRACT', 1.0, orange), P['rough_green']), M('MULTIPLY', orange, P['rough_orange']))), M('MULTIPLY', black, P['rough_black']))
    coat = M('ADD', M('MULTIPLY', notblack, P['coat_green']), M('MULTIPLY', black, P['coat_black']))
    crough = P['coat_rough']
    if ez is not None: rough, coat, crough = eye_finish(rough, coat, P['coat_rough'], ez)
    nb_ = bump.outputs['Normal']
    if EYES and not args.bake: nb_ = eye_normal(Pobj, nb_)
    finish(rough, coat, crough, nb_, nb_)

if args.bake:
    R = args.bakeres
    sc.cycles.samples = 24; sc.cycles.use_denoising = False
    def bake_one(kind, suffix, colorspace, **kw):
        im = bpy.data.images.new('bake_' + suffix, R, R, alpha=False); im.colorspace_settings.name = colorspace
        tn = node('ShaderNodeTexImage'); tn.image = im; nt.nodes.active = tn
        for o in bpy.context.scene.objects: o.select_set(False)
        frog.select_set(True); bpy.context.view_layer.objects.active = frog
        bpy.ops.object.bake(type=kind, margin=10, margin_type='EXTEND', **kw)
        im.filepath_raw = os.path.abspath(args.bake + '_' + suffix + '.png'); im.file_format = 'PNG'; im.save()
        nt.nodes.remove(tn); print('BAKED', kind, im.filepath_raw)
    import numpy as np
    me_ = frog.data; me_.calc_loop_triangles(); uvl = me_.uv_layers[0].data
    tuv = np.zeros((len(me_.loop_triangles), 3, 2), np.float32); tp = np.zeros((len(me_.loop_triangles), 3, 3), np.float32)
    for i_, t_ in enumerate(me_.loop_triangles):
        for k_ in range(3):
            tuv[i_, k_] = uvl[t_.loops[k_]].uv; tp[i_, k_] = frog.matrix_world @ me_.vertices[t_.vertices[k_]].co
    np.savez(os.path.abspath(args.bake + '_uv.npz'), uv=tuv, p=tp)
    bake_one('NORMAL', 'normal', 'Non-Color', normal_space='TANGENT')
    bake_one('DIFFUSE', 'color', 'sRGB', pass_filter={'COLOR'})
    sys.exit(0)

# ---------------------------------------------------------------- stage
def area(name, loc, target, energy, size, color=(1, 1, 1)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l = bpy.context.active_object; l.name = name; l.data.energy = energy; l.data.size = size; l.data.color = color
    l.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=1.5 if PHOTO else 0.6, location=(ctr.x, ctr.y, 0))
gnd = bpy.context.active_object; gnd.name = 'ground'
gm = bpy.data.materials.new('ground'); gm.use_nodes = True
gb = [n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]
gb.inputs['Base Color'].default_value = (0.85, 0.85, 0.85, 1) if PHOTO else (0.045, 0.040, 0.034, 1)
gb.inputs['Roughness'].default_value = 0.5 if PHOTO else 0.35
gnd.data.materials.append(gm)
tgt = (ctr.x, ctr.y, ctr.z)
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = [n for n in w.node_tree.nodes if n.type == 'BACKGROUND'][0]
if PHOTO:
    # white seamless to the camera, but only a dim environment for lighting (a bright white world veils glossy skin)
    lp = w.node_tree.nodes.new('ShaderNodeLightPath'); mxs = w.node_tree.nodes.new('ShaderNodeMath'); mxs.operation = 'MULTIPLY_ADD'
    w.node_tree.links.new(lp.outputs['Is Camera Ray'], mxs.inputs[0]); mxs.inputs[1].default_value = 0.9; mxs.inputs[2].default_value = PHOTO_ENV
    w.node_tree.links.new(mxs.outputs[0], bg.inputs['Strength']); bg.inputs['Color'].default_value = (1, 1, 1, 1)
    area('key', (ctr.x + 0.20, ctr.y - 0.28, 0.30), tgt, KEY_W, 0.20, (1.0, 0.98, 0.95))
    area('fill', (ctr.x - 0.30, ctr.y - 0.10, 0.18), tgt, KEY_W * 0.25, 0.30, (1.0, 1.0, 1.0))
    area('top', (ctr.x, ctr.y, 0.40), tgt, KEY_W * 0.3, 0.25, (1.0, 1.0, 1.0))
else:
    bg.inputs['Color'].default_value = (0.02, 0.024, 0.028, 1)
    area('key', (ctr.x - 0.16, ctr.y - 0.20, 0.22), tgt, 1.6, 0.14, (1.0, 0.93, 0.84))
    area('rim', (ctr.x + 0.18, ctr.y + 0.20, 0.16), tgt, 1.0, 0.10, (0.85, 0.92, 1.0))
    area('fill', (ctr.x + 0.20, ctr.y - 0.18, 0.10), tgt, 0.25, 0.18, (1.0, 0.98, 0.95))

# ---------------------------------------------------------------- camera
bpy.ops.object.camera_add(); cam = bpy.context.active_object; sc.camera = cam
views = {  # target offset in the bbox (x, y, height fraction), distance m, azimuth deg (0 = in front of the head), elevation deg, focal mm
    'macro': ((0.0, -0.005, 0.8), 0.085, 28, 36, 85), 'macro2': ((0.0, 0.0, 0.7), 0.06, -60, 50, 100),
    'play': ((0.0, 0.0, 0.5), 0.27, 30, 28, 85), 'side': ((0.0, 0.0, 0.5), 0.12, 90, 8, 85),
    'photo': ((0.0, 0.0, 0.45), 0.105, 42, 20, 70), 'photo2': ((0.0, 0.0, 0.5), 0.105, -42, 20, 70),
    'dorsal': ((0.0, 0.0, 0.8), 0.11, 0, 62, 85),
    'head': ((0, 0, 0), 0.055, 25, 28, 85), 'headside': ((0, 0, 0), 0.055, 75, 12, 85), 'headtop': ((0, 0, 0), 0.055, 5, 78, 85),
    'swim': ((0.0, 0.0, 0.5), 0.20, 28, 52, 70), 'swimside': ((0.0, 0.0, 0.5), 0.17, 62, 18, 70), 'swimtop': ((0.0, 0.0, 0.5), 0.17, 0, 88, 70),
}
off, dist, az, el, fl = views[args.view]
t = Vector((ctr.x + off[0], ctr.y + off[1], lo.z + (hi.z - lo.z) * off[2]))
if args.view.startswith('head') and EYES:
    t = frog.matrix_world @ ((EYES[0][0] + EYES[1][0]) / 2) if len(EYES) > 1 else frog.matrix_world @ EYES[0][0]
a = math.radians(az); e = math.radians(el)
cp = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
cam.location = cp; cam.rotation_euler = (t - cp).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = fl; cam.data.sensor_width = 36; cam.data.clip_start = 0.002; cam.data.clip_end = 5
cam.data.dof.use_dof = False

if args.save: bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save))
sc.render.filepath = os.path.abspath(args.out)
bpy.ops.render.render(write_still=True)
print('RENDERED', sc.render.filepath)
