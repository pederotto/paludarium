"""Prepare the owner's guppy model (a GLB from art-src/raw/) for the game, without changing its shape or its texture:
  - turn it to the game's frame (head toward -Y in Blender = +z in the game, back up) and scale it to its real size (standard length);
  - decimate a near (hi) and a far (lo) copy, keeping its UVs;
  - mark the fins (the thin parts: a ray through the mesh along the inward normal meets the other side within `thin` of the length) with
    a second material named 'guppy_fin' (the game shades those faces as membranes: see-through, rippling) and sort them into parts;
  - bake a coordinate map in the model's own UVs: per texel, where on the fish it is (body: s along the body, v from back to belly;
    fins: x across the rays, t out along them) and which part, so the strain painter (src/render/creatures/guppypaint.js) can colour
    any strain onto this model's texture detail;
  - write <out>/<name>.glb, <name>.lo.glb, <name>-coords.png, <name>-parts.png, <name>-base.png (its own colour texture) and
    <name>.json (eye centre and radius in game cm, standard length, the tail root).

  blender -b --factory-startup -P art-src/guppy/prep_glb.py -- <src.glb> <out dir> <name> --sl=2.2 --headAxis=-x [--tris=12000,4000]

headAxis: where the head points in the file as Blender imports it (+x, -x, +y, -y). sl: real standard length in cm.
"""
import sys, os, math, json
import bpy, bmesh, numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

a = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, NAME = a[0], a[1], a[2]
OPT = dict(x[2:].split('=', 1) for x in a[3:] if x.startswith('--') and '=' in x)
SL_CM = float(OPT.get('sl', 2.2)); HEAD = OPT.get('headAxis', '-x'); TRIS = [int(t) for t in OPT.get('tris', '12000,4000').split(',')]
THIN = float(OPT.get('thin', 0.012))          # fin = thinner than this share of the total length
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
src_mat = ob.data.materials[0]

# ---- orient: head toward -Y, back up (+Z) ----------------------------------------------------------------------------------------
rot = {'-x': Matrix.Rotation(math.radians(90), 4, 'Z'), '+x': Matrix.Rotation(math.radians(-90), 4, 'Z'),
       '+y': Matrix.Rotation(math.radians(180), 4, 'Z'), '-y': Matrix.Identity(4)}[HEAD]
ob.data.transform(rot)
me = ob.data; n = len(me.vertices)
P = np.empty(n * 3); me.vertices.foreach_get('co', P); P = P.reshape(-1, 3)
lo, hi = P.min(0), P.max(0); LEN = hi[1] - lo[1]
# side profile: body top/bottom per slice from the thick part of each slice (fins are thin sideways)
NS = 80
s_all = (P[:, 1] - lo[1]) / LEN                                  # 0 snout … 1 tail tip
prof = []
for i in range(NS):
    m = (s_all >= i / NS) & (s_all < (i + 1) / NS); q = P[m]
    if not len(q): prof.append(None); continue
    w = np.abs(q[:, 0]); th = q[w > 0.45 * w.max()]
    prof.append((th[:, 2].min(), th[:, 2].max(), w.max()))
half = np.array([p[2] if p else 0 for p in prof])
# the tail root: where the body has thinned to a stalk and the slices behind are thin (the tail fin)
peak = half.max(); root_i = next(i for i in range(int(NS * 0.4), NS) if half[i] < 0.28 * peak)
S_ROOT = root_i / NS                                              # share of the total length at the tail root
SL_UNITS = S_ROOT * LEN
k = SL_CM / SL_UNITS                                              # file units -> cm
# body axis height near the middle of the trunk (front of the dorsal fin)
mids = [0.5 * (p[0] + p[1]) for p in prof[int(NS * 0.15):int(NS * 0.3)] if p]
zc = float(np.mean(mids))
# centre: the middle of the whole length along the axis, the body axis at height 0; then cm
T = Matrix.Translation(Vector((0, -(lo[1] + hi[1]) / 2, -zc)))
ob.data.transform(Matrix.Scale(k, 4) @ T)
P = np.empty(n * 3); me.vertices.foreach_get('co', P); P = P.reshape(-1, 3)
lo, hi = P.min(0), P.max(0); LEN = hi[1] - lo[1]
print(f'SCALE file->cm {k:.3f}  total {LEN:.2f} cm  SL {SL_CM} cm  tail root at {S_ROOT:.2f} of the length')

# ---- clean: weld, drop loose debris, take the eyeballs out (the game draws the eyes in its shader, at their centre) -----------------
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.verts.ensure_lookup_table()
seen = set(); comps = []
for v in bm.verts:
    if v in seen: continue
    st = [v]; comp = [v]; seen.add(v)
    while st:
        a_ = st.pop()
        for e in a_.link_edges:
            b_ = e.other_vert(a_)
            if b_ not in seen: seen.add(b_); st.append(b_); comp.append(b_)
    comps.append(comp)
comps.sort(key=len, reverse=True)
EYES = []
kill = []
for c in comps[1:]:
    co_ = np.array([v.co[:] for v in c]); ctr = co_.mean(0); r_ = (co_.max(0) - co_.min(0)).max() / 2
    s_ = (ctr[1] - lo[1]) / LEN
    if len(c) > 60 and s_ < 0.2: EYES.append((Vector(ctr), r_)); continue      # eyeballs stay (the shader paints the eye on them)
    kill += c
bmesh.ops.delete(bm, geom=list(set(kill)), context='VERTS')
bm.to_mesh(ob.data); bm.free(); ob.data.update()
# the file is a double shell: a second skin lies about 0.03 mm under the first. Faces with another surface just outside them are
# buried (never seen) and break decimation: remove them.
bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update(); tb = BVHTree.FromBMesh(bm)
BURY = 0.0045 * SL_CM
buried = [f for f in bm.faces if (lambda h: h[0] is not None and h[3] < BURY)(tb.ray_cast(f.calc_center_median() + f.normal * 1e-5, f.normal, BURY))]
print('BURIED faces', len(buried), 'of', len(bm.faces))
bmesh.ops.delete(bm, geom=buried, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(ob.data); bm.free(); ob.data.update()
n = len(ob.data.vertices); P = np.empty(n * 3); ob.data.vertices.foreach_get('co', P); P = P.reshape(-1, 3)
print('CLEAN components', len(comps), 'eyes', [(tuple(round(x, 3) for x in c), round(r, 3)) for c, r in EYES], 'verts now', n)

# smoothed body profile in cm, by s (0 snout … 1 tail tip)
def body_profile():
    top = np.full(NS, np.nan); bot = np.full(NS, np.nan); wid = np.zeros(NS)
    s_all = (P[:, 1] - lo[1]) / LEN
    for i in range(NS):
        m = (s_all >= i / NS) & (s_all < (i + 1) / NS); q = P[m]
        if not len(q): continue
        w = np.abs(q[:, 0]); th = q[w > 0.45 * w.max()]
        top[i], bot[i], wid[i] = th[:, 2].max(), th[:, 2].min(), w.max()
    return top, bot, wid
TOP, BOT, WID = body_profile()
# smooth the profile (a running median over 7 slices) and keep the pectorals' sideways spike out of the width
def runmed(a_, k_=7):
    out = a_.copy()
    for i in range(len(a_)):
        w_ = a_[max(0, i - k_ // 2):i + k_ // 2 + 1]; w_ = w_[~np.isnan(w_)]
        if len(w_): out[i] = np.median(w_)
    return out
TOP, BOT, WID = runmed(TOP), runmed(BOT), runmed(np.where(WID > 0, WID, np.nan))
def prof_at(arr, s):
    i = min(NS - 1, max(0, int(s * NS))); j = i
    while np.isnan(arr[j]) and j > 0: j -= 1
    return float(arr[j])

# ---- parts: fins are the thin parts --------------------------------------------------------------------------------------------
def bvh_of(o):
    bm = bmesh.new(); bm.from_mesh(o.data); t = BVHTree.FromBMesh(bm); bm.free(); return t
FULL = bvh_of(ob)
def thickness(p, nrm):
    h = FULL.ray_cast(Vector(p) - Vector(nrm) * 1e-4, -Vector(nrm))
    return h[3] if h[0] is not None else 1e9
PARTS = dict(body=255, caudal=200, dorsal=160, pectoral=120, ventral=80)
def inside_body(p, margin=1.1):
    """Inside the body's cross-section ellipse at its slice (fins are outside it; behind the tail root everything is tail)."""
    s = (p[1] - lo[1]) / LEN
    if s >= S_ROOT: return False
    top, bot, w = prof_at(TOP, s), prof_at(BOT, s), prof_at(WID, s)
    zc, h = (top + bot) / 2, max((top - bot) / 2, 1e-6)
    return (p[0] / max(w, 1e-6)) ** 2 + ((p[2] - zc) / h) ** 2 <= margin ** 2
def _unused_part_of(p, thin):
    s = (p[1] - lo[1]) / LEN; x, z = p[0], p[2]
    if not thin: return 'body'
    if s >= S_ROOT - 0.01: return 'caudal'
    top, bot = prof_at(TOP, s), prof_at(BOT, s)
    if z > (top + bot) / 2 and abs(x) < 0.5 * prof_at(WID, s): return 'dorsal'
    if abs(x) >= 0.5 * prof_at(WID, s): return 'pectoral'
    return 'ventral'

def fin_coords(part, p):
    """(x across the rays, t out along them) for a fin point, from the fin's own geometry."""
    s = (p[1] - lo[1]) / LEN; z = p[2]
    if part == 'caudal':
        r0 = Vector((0, lo[1] + (S_ROOT - 0.03) * LEN, 0)); d = Vector((0, p[1], z)) - r0
        ang = math.atan2(d.z, d.y)                                       # 0 straight back, + up
        return ang, d.length
    if part == 'dorsal':
        return s, z - prof_at(TOP, s)
    if part == 'ventral':
        return s, prof_at(BOT, s) - z
    return s, abs(p[0])
lerp = lambda a_, b_, t_: a_ + (b_ - a_) * t_

def lateral_hits(t, y, z, x0, x1):
    """x of every crossing of the line along x at (y, z)."""
    hits = []; o = Vector((x0, y, z)); d = Vector((1, 0, 0))
    for _ in range(64):
        h = t.ray_cast(o, d, x1 - o.x)
        if h[0] is None: break
        hits.append(h[0].x); o = h[0] + d * 1e-4
    return hits
SPAN_FIN = 0.03 * SL_CM                                   # a midline fin is thinner than this all the way across (cm)
GAP = 0.012 * SL_CM                                       # a paired fin stands off the body by at least this much water
def classify(o):
    """Per vertex: is it fin (thin), and which part. Midline fins: the line across the fish through the point meets only a thin
    sheet. Paired fins: the point is the outermost crossing and water separates it from the body."""
    me = o.data; n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    t = bvh_of(o); x0, x1 = co[:, 0].min() - 1, co[:, 0].max() + 1
    thin = np.zeros(n, bool); part = []
    for i in range(n):
        p = co[i]; s = (p[1] - lo[1]) / LEN
        if s >= S_ROOT: thin[i] = True; part.append('caudal'); continue
        if s < 0.3 * S_ROOT: part.append('body'); continue                 # the head: the snout ridge and eye sockets are not fins
        h = sorted(lateral_hits(t, p[1], p[2], x0, x1))
        if not h or (h[-1] - h[0]) < SPAN_FIN:
            thin[i] = True
            mid = (prof_at(TOP, s) + prof_at(BOT, s)) / 2
            part.append('dorsal' if p[2] > mid else 'ventral'); continue
        # paired fin: this point is on the outermost crossings and a gap of water lies between it and the next crossing inward
        side = 1 if p[0] > 0 else -1
        hs = [x for x in h if x * side > 0]; hs.sort(key=lambda x: -abs(x))
        k_ = next((j for j, x in enumerate(hs) if abs(x - p[0]) < 2e-3), None)
        flap = False
        if k_ is not None:
            for j in range(k_, len(hs) - 1):
                if abs(hs[j] - hs[j + 1]) > GAP: flap = True; break
                if abs(hs[j] - hs[j + 1]) > 4e-3: break
        thin[i] = flap; part.append('pectoral' if flap and s < 0.42 * S_ROOT / 0.66 else 'ventral' if flap else 'body')
    # Fins are sheets: group the thin vertices into connected sheets and name each sheet as a whole (a big tail reaches forward under
    # and over the stalk, where a test by position would call its lobes belly and back fins).
    adj = [[] for _ in range(n)]
    for e in me.edges:
        a_, b_ = e.vertices
        if thin[a_] and thin[b_]: adj[a_].append(b_); adj[b_].append(a_)
    comp = [-1] * n; sheets = []
    for i in range(n):
        if not thin[i] or comp[i] >= 0: continue
        st = [i]; comp[i] = len(sheets); mem = [i]
        while st:
            a_ = st.pop()
            for b_ in adj[a_]:
                if comp[b_] < 0: comp[b_] = comp[i]; st.append(b_); mem.append(b_)
        sheets.append(mem)
    for mem in sheets:
        q = co[mem]; s_ = (q[:, 1] - lo[1]) / LEN
        if (s_ >= S_ROOT).mean() > 0.3: name = 'caudal'
        else:
            cz = q[:, 2].mean(); cs = s_.mean(); mid = (prof_at(TOP, cs) + prof_at(BOT, cs)) / 2
            name = 'pectoral' if np.abs(q[:, 0]).mean() > 0.35 * prof_at(WID, cs) else 'dorsal' if cz > mid else 'ventral'
        for i in mem: part[i] = name
    print('SHEETS', sorted(((len(m), part[m[0]]) for m in sheets), reverse=True)[:8])
    return co, thin, part

def fin_material():
    m = src_mat.copy(); m.name = 'guppy_fin'; return m
def assign(o, thin):
    if len(o.data.materials) < 2: o.data.materials[0].name = 'guppy'; o.data.materials.append(FINMAT)
    for f in o.data.polygons:
        f.material_index = 1 if sum(thin[v] for v in f.vertices) * 2 > len(f.vertices) else 0
src_mat.name = 'guppy'; FINMAT = fin_material()

# ---- coordinate map: bake per-vertex (s, v | x, t, part) into the model's UVs (emission bake, Cycles) -----------------------------
def coords_colors(o):
    co, thin, part = classify(o)
    n = len(co); col = np.zeros((n, 4)); pc = np.zeros((n, 4))
    raw = {}
    for i in range(n):
        p = co[i]; s = (p[1] - lo[1]) / LEN
        if part[i] == 'body':
            top, bot = prof_at(TOP, s), prof_at(BOT, s)
            v = (top - p[2]) / max(top - bot, 1e-6)
            col[i] = (min(s / S_ROOT, 1.0), min(max(v, 0), 1), 0.5, 1)  # body: s as a share of SL, v back->belly
        else:
            raw.setdefault(part[i], []).append((i, *fin_coords(part[i], p)))
        pc[i] = (PARTS[part[i]] / 255, 0, 0, 1)
    for k_, rows in raw.items():                                      # normalise each fin's (x, t) to 0..1 over the fin
        xs = np.array([r[1] for r in rows]); ts = np.array([r[2] for r in rows])
        x0, x1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5)
        # t relative to the farthest point at the same x (the fin's outline), so the rim is t = 1 all round
        nb = 24; edges = np.linspace(x0, x1, nb + 1); tmax = np.zeros(nb)
        bi = np.clip(((xs - x0) / max(x1 - x0, 1e-9) * nb).astype(int), 0, nb - 1)
        for b in range(nb):
            sel = ts[bi == b]; tmax[b] = np.percentile(sel, 98) if len(sel) else ts.max()
        for (i, x, t), b in zip(rows, bi):
            col[i] = (min(max((x - x0) / max(x1 - x0, 1e-9), 0), 1), min(max(t / max(tmax[b], 1e-6), 0), 1), 0.0, 1)
    return col, pc, thin

def bake_vertex_color(o, cols, path, size=1024):
    me = o.data
    attr = me.color_attributes.new('bake', 'FLOAT_COLOR', 'POINT'); attr.data.foreach_set('color', cols.reshape(-1))
    img = bpy.data.images.new('bake', size, size, alpha=False, float_buffer=True); img.colorspace_settings.name = 'Non-Color'
    mats = []
    for slot in o.material_slots:
        m = bpy.data.materials.new('bk'); m.use_nodes = True; nt = m.node_tree
        for nd in list(nt.nodes): nt.nodes.remove(nd)
        out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission'); ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'bake'
        ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = img; nt.nodes.active = ti
        nt.links.new(ca.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs[0])
        mats.append((slot, slot.material)); slot.material = m
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
    sc.render.bake.margin = 6; sc.render.bake.use_selected_to_active = False
    for o2 in bpy.context.scene.objects: o2.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='EMIT')
    img.filepath_raw = path; img.file_format = 'PNG'
    img.save_render(path) if hasattr(img, 'save_render') else img.save()
    for slot, m in mats: slot.material = m
    me.color_attributes.remove(me.color_attributes['bake'])

# ---- run ---------------------------------------------------------------------------------------------------------------------------
cols, pcols, thin = coords_colors(ob)
bake_vertex_color(ob, cols, os.path.join(OUT, NAME + '-coords.png'))
bake_vertex_color(ob, pcols, os.path.join(OUT, NAME + '-parts.png'))
print('PARTS', {k_: int(sum(1 for i in range(len(thin)) if (pcols[i][0] * 255 + 0.5) // 1 == v)) for k_, v in PARTS.items()}, 'thin', int(thin.sum()), 'of', len(thin))
# the owner's colour texture as a file of its own
img = next((n_.image for n_ in src_mat.node_tree.nodes if n_.type == 'TEX_IMAGE' and n_.image), None)
if img:
    img.filepath_raw = os.path.join(OUT, NAME + '-base.png'); img.file_format = 'PNG'; img.save()

# eye: the darkest texels of the head, sampled at the head's vertices
def eye_of():
    if not img: return None
    px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)
    uv = ob.data.uv_layers.active.data
    best = []
    for lp in ob.data.loops:
        v = ob.data.vertices[lp.vertex_index].co
        s = (v.y - lo[1]) / LEN
        if s > 0.18 * S_ROOT or v.x <= 0: continue
        u_, w_ = uv[lp.index].uv
        c = px[min(img.size[1] - 1, int(w_ * img.size[1])), min(img.size[0] - 1, int(u_ * img.size[0]))]
        if 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.035: best.append(v.copy())
    if len(best) < 4: return None
    c = sum(best, Vector()) / len(best); r = max((b - c).length for b in best)
    return c, r
eye = None
if EYES:
    c, r = max(EYES, key=lambda e: e[0].x)                         # the left eye (+x); the game mirrors it
    eye = (c, r)
# decimated copies, fins marked, exported (metres: the game multiplies by 100)
meta = dict(slCm=SL_CM, totalCm=round(LEN, 3), tailRoot=round(S_ROOT, 4), scale=0.01)
if eye:
    c, r = eye
    meta['eye'] = dict(c=[round(c.x, 4), round(c.z, 4), round(-c.y, 4)], r=round(r * 0.9, 4))       # game frame: (x, z, -y)
for lod, tris in zip(('', '.lo'), TRIS):
    cp = ob.copy(); cp.data = ob.data.copy(); bpy.context.scene.collection.objects.link(cp)
    # mark fins on the full-detail copy first, then decimate fins and body apart (planar fins merge flat; the body collapses)
    _, th2, _ = classify(cp); assign(cp, th2)
    for o2 in bpy.context.scene.objects: o2.select_set(o2 is cp)
    bpy.context.view_layer.objects.active = cp
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
    pieces = [o2 for o2 in bpy.context.selected_objects]
    finp = [o2 for o2 in pieces if o2.data.materials and o2.data.materials[0].name.startswith('guppy_fin')]
    bodyp = [o2 for o2 in pieces if o2 not in finp]
    nf = sum(len(o2.data.polygons) for o2 in finp); nb = sum(len(o2.data.polygons) for o2 in bodyp)
    share_f = 0.45                                                  # of the triangle budget for the fins (a big tail)
    for o2, target in [(x, tris * share_f * len(x.data.polygons) / max(nf, 1)) for x in finp] + [(x, tris * (1 - share_f) * len(x.data.polygons) / max(nb, 1)) for x in bodyp]:
        for o3 in bpy.context.scene.objects: o3.select_set(o3 is o2)
        bpy.context.view_layer.objects.active = o2
        if o2 in finp:
            md = o2.modifiers.new('flat', 'DECIMATE'); md.decimate_type = 'DISSOLVE'; md.angle_limit = math.radians(4); md.delimit = {'UV'}
            bpy.ops.object.modifier_apply(modifier='flat')
            md = o2.modifiers.new('tri', 'TRIANGULATE'); bpy.ops.object.modifier_apply(modifier='tri')
        cur = len(o2.data.polygons)
        if cur > target:
            md = o2.modifiers.new('dec', 'DECIMATE'); md.ratio = max(0.02, target / cur); bpy.ops.object.modifier_apply(modifier='dec')
    for o3 in bpy.context.scene.objects: o3.select_set(o3 in pieces)
    bpy.context.view_layer.objects.active = pieces[0]; bpy.ops.object.join(); cp = bpy.context.view_layer.objects.active
    for o2 in bpy.context.scene.objects: o2.select_set(o2 is cp)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, NAME + lod + '.glb'), use_selection=True, export_format='GLB', export_yup=True,
                              export_apply=True)
    meta['tris' + (lod or '.hi')] = len(cp.data.polygons)
    bpy.data.objects.remove(cp)
json.dump(meta, open(os.path.join(OUT, NAME + '.json'), 'w'), indent=1)
print('META', json.dumps(meta))
