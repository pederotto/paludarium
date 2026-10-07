# The fire salamander's mouth in Blender (6 Oct, the owner: "use blender and its tools"). Built first by hand in the live Blender (the FIRESAL collection),
# this is the same work as one script that runs headless, so a re-bake (tools/bake-lizard.mjs firesal --no-mouth) can be given its mouth again:
#   Blender -b -P tools/blender/firesal-mouth.py -- <head-without-mouth.glb> <out.glb> [--preview renders_prefix]
#   then: node tools/bake-lizard.mjs firesal ; node tools/rig/firesal-finish.mjs <out.glb> ; npm run import-creatures -- --baked=firesal
# What it does, with Blender's own mesh operators (bmesh):
#   1. the baked head cut by the lip plane (bisect_plane) from the snout back to the mouth angle (the jaw hinge), the cut edges split open (split_edges)
#   2. three rings extruded inward from each lip (extrude_edge_only) shrinking toward the middle of the opening: a palate above, a floor below
#   3. the two hinge ends capped, the back closed with a fan (poke), the cavity rounded (smooth_vert), normals recalculated, the inside painted red
#   4. a `jaw` vertex group: everything below the lip plane in front of the hinge, eased in over 0.3 cm either side of it, kept out of the limb roots
#   5. the jaw folded into the game's four-bone skin (_SKIN, _SKINX: the strongest four bones a vertex), bone ids repaired where the fan averaged them
#   6. exported in metres in the baked frame (x lateral, y up, z forward) with the game's custom attributes
# The lip plane comes from tools/rig/firesal-mouth.mjs fitMouth on the bake (hinge 5.8 cm behind the middle of the length, 2.178 cm up; slope 0.0595).
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
IN, OUT = argv[0], argv[1]
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
JAW = 21                                   # the jaw's index in the game's bone list (21 base bones, the jaw last)
ZH = 5.8                                   # the mouth angle, cm behind the middle of the length (baked z)
LIP0, SLOPE = 2.178, 0.0595                # the lip surface: height above the soles at the hinge, rise per cm toward the snout
BL = 0.3                                   # the jaw's weight eases in over this far either side of the hinge
lipz = lambda y: LIP0 + SLOPE * (-y - ZH)  # local frame: x lateral, y = -z_baked (head toward -y), z up; cm
smooth = lambda t: (0 if t < 0 else 1 if t > 1 else t * t * (3 - 2 * t))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
body = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = body; body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = body.data
me.transform(Matrix.Scale(100, 4)); me.update()                                   # metres -> cm
zs = [v.co.z for v in me.vertices]; ys = [v.co.y for v in me.vertices]
# (the soles are at z = 0 and the tail tip hangs a little below them, so the lowest point is about -0.24 cm: the bake's own frame, kept as it is)
assert -0.4 < min(zs) < 0.05 and abs(max(ys) + min(ys)) < 0.1, ('the mesh is not in the baked frame', min(zs), min(ys), max(ys))
for nm in ('custom_normal', 'sharp_face', 'sharp_edge'):
    if nm in me.attributes: me.attributes.remove(me.attributes[nm])
me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))

# the head's own middle and half width at the lip plane (the scan's head is not centred on x = 0)
band = [v.co.x for v in me.vertices if -7.2 < v.co.y < -6.2 and abs(v.co.z - lipz(v.co.y)) < 0.35]
XC, HW = (min(band) + max(band)) / 2, (max(band) - min(band)) / 2 + 0.12
print('head at the lip plane: centre x', round(XC, 3), 'half width', round(HW, 3))

# 1-3. the cut, the rings, the caps, the back wall
bm = bmesh.new(); bm.from_mesh(me)
P0 = Vector((0, -ZH, LIP0)); N = Vector((0, SLOPE, 1)).normalized()
inreg = lambda v: v.co.y < -5.4 and abs(v.co.x - XC) < HW + 0.1
faces = [f for f in bm.faces if all(inreg(v) for v in f.verts)]
gv = list({v for f in faces for v in f.verts}); ge = list({e for f in faces for e in f.edges})
res = bmesh.ops.bisect_plane(bm, geom=gv + ge + faces, dist=1e-6, plane_co=P0, plane_no=N, clear_inner=False, clear_outer=False)
cut = [g for g in res['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
slit = [e for e in cut if (e.verts[0].co.y + e.verts[1].co.y) / 2 <= -ZH and abs(e.verts[0].co.x - XC) < HW + 0.1 and abs(e.verts[1].co.x - XC) < HW + 0.1]
bmesh.ops.split_edges(bm, edges=slit)
bnd = [e for e in bm.edges if e.is_boundary]
is_upper = lambda e: e.link_faces[0].calc_center_median().z > lipz(e.link_faces[0].calc_center_median().y)
up = [e for e in bnd if is_upper(e)]; lo = [e for e in bnd if not is_upper(e)]
assert len(up) == len(lo) and len(up) > 40, ('the lip cut is wrong', len(up), len(lo))
C = Vector((XC, -5.2, lipz(-5.2)))      # the rings shrink toward the throat (just behind the mouth angle), where palate and floor meet and are welded
# six rings inward from each lip, shrinking toward the middle of the opening (cumulative shares of the lip outline) and rising to a dome (+0.04 ... +0.20 cm)
# then back to the lip plane (0.0): the palate above, the mirrored floor below. The last rings of the two sheets coincide and are welded: a closed bag.
CUM = [0.78, 0.58, 0.38, 0.20, 0.08, 0.02]; DZ = [0.04, 0.07, 0.06, 0.03, -0.07, -0.13]
ringv = []
def rings(edges, sign):
    cur, last, prev = edges, [], 1.0
    for cs, dz in zip(CUM, DZ):
        s = cs / prev; prev = cs
        ret = bmesh.ops.extrude_edge_only(bm, edges=cur)
        nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            p = v.co; v.co = Vector((C.x + (p.x - C.x) * s, C.y + (p.y - C.y) * s, p.z + sign * dz))
        nvs = set(nv); cur = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMEdge) and g.verts[0] in nvs and g.verts[1] in nvs]
        last = nv; ringv.extend(nv)
    return last
last_u = rings(up, +1); last_l = rings(lo, -1)
key = lambda v: (round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4))
ckeys = {key(v) for v in last_u}
bmesh.ops.remove_doubles(bm, verts=last_u + last_l, dist=1e-5)
closing = {v for v in bm.verts if v.is_valid and key(v) in ckeys}
bnd = [e for e in bm.edges if e.is_boundary]
filled = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)['faces']
assert 2 <= len(filled) <= 4, ('the two hinge ends should be the only holes', len(filled), len(bnd))
inner = {v for v in ringv if v.is_valid}
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
lay = bm.loops.layers.color.get('Color')
for f in set(filled) | set(f for v in inner for f in v.link_faces):
    for l in f.loops: l[lay] = (0.0, 1.0, 0.0, 1.0)          # the inside of the mouth: pure green, a marker the skin bake turns into dark red (the old painter has red warts)
for _ in range(8): bmesh.ops.smooth_vert(bm, verts=list(inner), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.verts.index_update(); closing_idx = {v.index for v in closing}
# 4. the jaw's weights (by the side of the lip plane a vertex's faces lie on, since the lip copies sit on the plane)
bm.verts.ensure_lookup_table()
jaw = {}
for v in bm.verts:
    p = v.co
    if -p.y < ZH - BL - 0.01 or abs(p.x - XC) > HW + 0.3 or p.z < 1.4: continue
    d = p.z - lipz(p.y)
    if abs(d) < 1e-3:
        if v.index in closing_idx or abs(p.y + ZH) < 0.12: side = 0.5
        else: side = 0.0 if sum(f.calc_center_median().z - lipz(f.calc_center_median().y) for f in v.link_faces) > 0 else 1.0
    else: side = 0.0 if d > 0 else 1.0
    w = side * smooth((-p.y - (ZH - BL)) / (2 * BL))
    if w > 0.002: jaw[v.index] = w
bm.to_mesh(me); bm.free(); me.update()

# 5. fold the jaw into the four-bone skin; repair the bone ids the fan averaged
S, X, R = me.attributes['_SKIN'].data, me.attributes['_SKINX'].data, me.attributes['_RIG'].data
bones_of = lambda i: [(S[i].color[0] * 32, S[i].color[2]), (S[i].color[1] * 32, S[i].color[3]), (X[i].color[0] * 32, X[i].color[2]), (X[i].color[1] * 32, X[i].color[3])]
bad = [i for i in range(len(me.vertices)) if any(w > 1e-4 and abs(b - round(b)) > 0.02 for b, w in bones_of(i))]
badset = set(bad); pool = [v.index for v in me.vertices if v.index not in badset and v.co.y < -5.5 and abs(v.co.x - XC) < HW and v.co.z > 1.4]
for i in bad:
    j = min(pool, key=lambda k: (me.vertices[k].co - me.vertices[i].co).length_squared)
    S[i].color = tuple(S[j].color); X[i].color = tuple(X[j].color); R[i].color = tuple(R[j].color)
for i, w in jaw.items():
    bw = {}
    for b, q in bones_of(i):
        if q > 0: bw[int(round(b))] = bw.get(int(round(b)), 0) + q * (1 - w)
    bw[JAW] = bw.get(JAW, 0) + w
    top = sorted(bw.items(), key=lambda kv: (-kv[1], kv[0]))[:4]; s = sum(q for _, q in top) or 1
    while len(top) < 4: top.append((top[0][0], 0.0))
    S[i].color = (top[0][0] / 32, top[1][0] / 32, top[0][1] / s, top[1][1] / s); X[i].color = (top[2][0] / 32, top[3][0] / 32, top[2][1] / s, top[3][1] / s)
print('mouth built: verts', len(me.vertices), 'jaw-weighted', len(jaw), 'repaired', len(bad))

# optional preview: the jaw's vertex group and a jaw bone on the working object, rendered at 0 / 22 / 38 degrees
if PREVIEW:
    vg = body.vertex_groups.new(name='jaw')
    for i, w in jaw.items(): vg.add([i], w, 'REPLACE')
    ad = bpy.data.armatures.new('jawrig'); arm = bpy.data.objects.new('jawrig', ad); bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
    b = ad.edit_bones.new('jaw'); b.head = Vector((0, -ZH, LIP0)); b.tail = Vector((0, -7.8, lipz(-7.8))); bpy.ops.object.mode_set(mode='OBJECT')
    body.modifiers.new('jaw', 'ARMATURE').object = arm; arm.pose.bones['jaw'].rotation_mode = 'XYZ'
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'VERTEX'; sc.view_settings.view_transform = 'Standard'
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.05, 0.05, 0.06)
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = 5.2; cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (30, -7.0, 2.2); cam.rotation_euler = (math.pi / 2, 0, math.pi / 2); sc.render.resolution_x = sc.render.resolution_y = 700
    for deg in (0, 22, 38):
        arm.pose.bones['jaw'].rotation_euler = (math.radians(deg), 0, 0); bpy.context.view_layer.update()
        sc.render.filepath = f'{PREVIEW}jaw{deg}.png'; bpy.ops.render.render(write_still=True)
    body.modifiers.remove(body.modifiers['jaw']); body.vertex_groups.remove(vg)

# 5b. UVs, with Blender's own Smart UV Project (--uv): the scan has none. The colour and normal maps are baked from a 3D procedural skin (tools/skin/firesal-skin.py), so
# the pattern does not depend on where the islands are cut: many islands of low stretch beat a few big ones (a conformal unwrap of the whole body crushed the head, the tail tip
# and the fingers: 4 texels a cm at the 10th percentile). Equal texel density across islands, packed. One layout covers every level of detail.
if '--uv' in argv:
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=0.004, area_weight=0.8, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale(); bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    uvl = me.uv_layers.active; us = [d.uv for d in uvl.data]
    dens = []
    for p in list(me.polygons)[::5]:
        a = p.area; ls = [uvl.data[p.loop_start + k].uv for k in range(p.loop_total)]
        ua = abs(sum(ls[k].x * ls[(k + 1) % len(ls)].y - ls[(k + 1) % len(ls)].x * ls[k].y for k in range(len(ls)))) / 2
        if ua > 1e-9 and a > 1e-9: dens.append(math.sqrt(ua / a))
    dens.sort()
    cover = sum(1 for _ in set((int(u.x * 256), int(u.y * 256)) for u in us)) / 65536
    print('uv: range', (round(min(u.x for u in us), 3), round(max(u.x for u in us), 3)), (round(min(u.y for u in us), 3), round(max(u.y for u in us), 3)),
          'texels per cm at 1024 (p10 / p50 / p90):', [round(dens[int(len(dens) * q)] * 1024) for q in (0.1, 0.5, 0.9)], 'cells touched', round(cover, 2))
    import json
    json.dump({'uv': [[round(d.uv.x, 5), round(d.uv.y, 5)] for d in uvl.data], 'polys': [[p.loop_start, p.loop_total] for p in me.polygons]}, open(OUT + '.uv.json', 'w'))

# 6. out, in metres
me.transform(Matrix.Scale(0.01, 4)); me.update()
for o in bpy.context.selected_objects: o.select_set(False)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False, export_attributes=True, export_skins=False, export_animations=False,
    export_morph=False, export_yup=True, export_normals=True, export_texcoords=('--uv' in argv), export_all_vertex_colors=False, export_vertex_color='ACTIVE', export_extras=False,
    export_cameras=False, export_lights=False)
print('exported', OUT)
