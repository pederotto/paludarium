# A skull and mandible scheme (tools/rig/skull.mjs) built and checked in headless Blender (6 Oct 2026, the owner's rule: every mouth sits on a skull and a mandible).
#   Blender -b -P tools/blender/skull.py -- <skull.json> <head-without-mouth.glb> <out_prefix> [--mouth <head-with-mouth.glb>] [--no-render]
# What it does:
#   1. the bones of the JSON as meshes: rods (a curve with a radius at each point, bevelled) and ellipsoids (a sphere with the bone's axes), tooth rows as small cones
#      along the tooth-bearing rods (upper tips down, lower tips up) and a short row on each vomer; the lower jaw (the `mandible` group and its teeth) parented to an empty on the
#      hinge axis, so one rotation opens it
#   2. the checks of the rule, in numbers (written back into the JSON as `verified`): every bone and tooth lies inside the head's skin (closest-point sign test on the closed head
#      mesh) with its smallest margin, the bones keep out of the eyeballs, and (with --mouth) the mouth's cavity, painted pure green by tools/blender/firesal-mouth.py, keeps
#      its distance from the skin (a red patch once came through the neck)
#   3. x-ray renders (Workbench: the skin a pale glass, the bones ivory, the mandible warm, the hyoid grey): side closed and open, top, three-quarter, and the palate from below
import bpy, bmesh, json, math, sys, datetime
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SK, HEAD, OUT = argv[0], argv[1], argv[2]
MOUTH = argv[argv.index('--mouth') + 1] if '--mouth' in argv else None
D = json.load(open(SK))
conv = lambda p: Vector((p[0], -p[2], p[1])) / 100.0                    # baked cm (x lateral, y up, z forward) -> Blender metres (x, -z, y)
dirc = lambda v: Vector((v[0], -v[2], v[1]))

bpy.ops.wm.read_factory_settings(use_empty=True)
def load(path, name):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    ob = [o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH'][0]
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); ob.name = name
    return ob
skin = load(HEAD, 'skin')
mouth = load(MOUTH, 'mouth') if MOUTH else None

def mat(name, rgba):
    m = bpy.data.materials.new(name); m.diffuse_color = rgba; m.use_nodes = False
    return m
M_SKIN, M_BONE, M_JAW, M_HYO, M_TOOTH, M_EYE = (mat('skin', (0.62, 0.68, 0.72, 0.14)), mat('bone', (0.93, 0.88, 0.76, 1)), mat('jaw', (0.86, 0.66, 0.42, 1)),
                                                  mat('hyoid', (0.55, 0.6, 0.66, 1)), mat('tooth', (1, 1, 0.95, 1)), mat('eye', (0.1, 0.1, 0.12, 0.35)))
skin.data.materials.append(M_SKIN); skin.show_transparent = True
pivot_pts = [Vector(h['at']) for h in D['hinge']]
hp = (pivot_pts[0] + pivot_pts[1]) / 2
pivot = bpy.data.objects.new('jaw_pivot', None); pivot.location = conv(hp); bpy.context.scene.collection.objects.link(pivot)
bpy.context.view_layer.update()                                       # the pivot's world matrix must be current before anything is parented to it

samples = {}                                                              # bone name -> points (Blender metres) for the checks
def link(ob, bone, material, jaw=False):
    bpy.context.scene.collection.objects.link(ob); ob.data.materials.append(material)
    if jaw: ob.parent = pivot; ob.matrix_parent_inverse = pivot.matrix_world.inverted()
    return ob
def tube(name, pts, material, jaw):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = 3; cu.use_fill_caps = True
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts): p.co = (*conv(q[:3]), 1); p.radius = q[3] / 100.0
    return link(bpy.data.objects.new(name, cu), name, material, jaw)
def ellipsoid(name, c, r, ax, material, jaw):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=10, radius=1.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    cols = [dirc(ax[i]).normalized() * (r[i] / 100.0) for i in range(3)]
    ob = bpy.data.objects.new(name, me); ob.matrix_world = Matrix(((cols[0].x, cols[1].x, cols[2].x, conv(c).x), (cols[0].y, cols[1].y, cols[2].y, conv(c).y), (cols[0].z, cols[1].z, cols[2].z, conv(c).z), (0, 0, 0, 1)))
    return link(ob, name, material, jaw), cols
def teeth(name, pts, upper, jaw, step=0.085):
    bm = bmesh.new(); total = 0.0; along = []
    for a, b in zip(pts[:-1], pts[1:]):
        A, B = Vector(a[:3]), Vector(b[:3]); n = max(1, int((B - A).length / step))
        for k in range(n): along.append((A.lerp(B, k / n), a[3] + (b[3] - a[3]) * k / n))
    for c, r in along:
        tip = conv((c.x, c.y + (-r if upper else r) + (-0.06 if upper else 0.06), c.z)); base = conv((c.x, c.y + (-r * 0.6 if upper else r * 0.6), c.z))
        d = (tip - base); m = (tip + base) / 2
        ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.00003, radius2=0.00022, depth=d.length) if upper else \
              bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.00022, radius2=0.00003, depth=d.length)
        bmesh.ops.translate(bm, verts=ret['verts'], vec=m)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    return link(bpy.data.objects.new(name, me), name, M_TOOTH, jaw)

n_teeth = 0
for b in D['bones']:
    jaw = b['group'] == 'mandible'; material = M_JAW if jaw else (M_HYO if b['group'] == 'hyoid' else M_BONE); pts_all = []
    for i, p in enumerate(b['parts']):
        nm = f"{b['name']}.{i}"
        if p['k'] == 'rod':
            tube(nm, p['pts'], material, jaw)
            for a, c in zip(p['pts'][:-1], p['pts'][1:]):                  # sample along the rod, with its radius
                for t in (0, 0.25, 0.5, 0.75, 1): q = [a[k] + (c[k] - a[k]) * t for k in range(4)]; pts_all.append((conv(q[:3]), q[3] / 100.0))
            if 'tooth' in p: teeth(nm + '.teeth', p['pts'], p['tooth'] == 'upper', jaw); n_teeth += 1
        else:
            ob, cols = ellipsoid(nm, p['c'], p['r'], p['ax'], material, jaw)
            for sgn in (1, -1):
                for i3 in range(3): pts_all.append((conv(p['c']) + cols[i3] * sgn, 0.0))
            if 'teeth' in p:                                               # a short row of vomerine teeth on the plate's lower face
                a = Vector(p['c']); lon = Vector(p['ax'][1]); lat = Vector(p['ax'][0]); nrm = Vector(p['ax'][2])
                row = [[*(a + lon * (k - 2.5) * 0.07 + lat * 0.35 * p['r'][0] / max(1e-6, lat.length) + nrm * p['r'][2]), 0.012] for k in range(6)]
                teeth(nm + '.vteeth', row, True, False, step=0.06)
    samples[b['name']] = pts_all

# the eyeballs (x-ray reference, not bones)
eyes = []
for i, e in enumerate(D.get('eyes', [])):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=e['r'] / 100.0); me = bpy.data.meshes.new(f'eye{i}'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(f'eye{i}', me); ob.location = conv(e['c']); bpy.context.scene.collection.objects.link(ob); ob.data.materials.append(M_EYE); ob.display_type = 'WIRE'; eyes.append((conv(e['c']), e['r'] / 100.0))

# ---- the checks --------------------------------------------------------------------------------------------------------------------------
dg = bpy.context.evaluated_depsgraph_get()
tree = BVHTree.FromObject(skin, dg)
def margin(p):                                                              # cm: >0 inside the skin by that much, <0 outside by that much
    loc, nor, idx, d = tree.find_nearest(p)
    return (d if (p - loc).dot(nor) < 0 else -d) * 100.0
worst = {}; outside = []
for name, pts in samples.items():
    ms = [margin(p) - r * 100.0 for p, r in pts]                            # the bone's own radius counts: the surface of the bone, not its axis
    worst[name] = min(ms)
    if min(ms) < 0.02: outside.append((name, round(min(ms), 3)))
eye_by = {}
for name, pts in samples.items():
    eye_by[name] = max([(er - (p - c).length + r) * 100.0 for p, r in pts for c, er in eyes] or [0.0])
eye_in = max(eye_by.values()) if eye_by else 0.0
cav = None
if mouth:
    me = mouth.data; col = me.color_attributes.active_color or me.color_attributes[0]; flagged = set()
    for lp in me.loops:
        c = col.data[lp.index].color if col.domain == 'CORNER' else col.data[lp.vertex_index].color
        if c[1] > 0.7 and c[0] < 0.25 and c[2] < 0.25: flagged.add(lp.vertex_index)
    ms = [margin(me.vertices[i].co) for i in flagged]
    cav = {'verts': len(ms), 'minMarginCm': round(min(ms), 3) if ms else None, 'thin': sum(1 for m in ms if m < 0.05), 'outside': sum(1 for m in ms if m < -0.01)}
# the cavity against the bones: the roof must lie just under the palate bones (vomer, pterygoid, parasphenoid), the floor above the mandible's rami and the hyoid, neither inside a bone
def bvh_of(names):
    dg2 = bpy.context.evaluated_depsgraph_get(); verts, polys = [], []
    for o in bpy.context.scene.objects:
        if o.type not in ('MESH', 'CURVE') or o in (skin, mouth) or not o.name.split('.')[0] in names: continue
        eo = o.evaluated_get(dg2); me2 = eo.to_mesh(); mw = eo.matrix_world; base = len(verts)
        verts += [mw @ v.co for v in me2.vertices]; polys += [[base + i for i in p.vertices] for p in me2.polygons]; eo.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys) if verts else None
lipY = lambda z: D['lip']['y0'] + D['lip']['slope'] * (z - D['lip']['zh'])           # baked cm
roofT, floorT = bvh_of(('vomer', 'pterygoid', 'parasphenoid')), bvh_of(('dentary', 'angular-prearticular', 'articular', 'mentomeckelian', 'hyobranchial'))
def cavity_vs_bones():
    me = mouth.data; roof_gap, floor_gap = [], []
    for i in flagged:
        co = me.vertices[i].co; z_b, y_b = -co.y * 100, co.z * 100; dy = y_b - lipY(z_b)
        if abs(dy) < 0.02 or z_b < 5.9: continue                              # the lip rim and the throat's closing rings are not the roof or the floor
        t = roofT if dy > 0 else floorT; loc, nor, idx, d = t.find_nearest(co)
        (roof_gap if dy > 0 else floor_gap).append(-d * 100 if (co - loc).dot(nor) < 0 else d * 100)
    r = lambda g: {'n': len(g), 'minGapCm': round(min(g), 3), 'meanGapCm': round(sum(g) / len(g), 3), 'inside': sum(1 for x in g if x < 0)}
    return {'roof': r(roof_gap), 'floor': r(floor_gap)}
if mouth:
    before = cavity_vs_bones(); cav['bones'] = before
    if '--fit-cavity' in argv:
        # the mouth cut from the skull (the rule): the roof follows the palate bones' underside with 0.04 cm of mucosa, nothing of the cavity inside a bone.
        # Positions only: topology, UVs' charts, weights and bone ids stay as the mouth script made them.
        OUTF = argv[argv.index('--fit-cavity') + 1]
        mdata = mouth.data
        for nm in ('custom_normal', 'sharp_face', 'sharp_edge'):
            if nm in mdata.attributes: mdata.attributes.remove(mdata.attributes[nm])
        sstep = lambda t: 0 if t < 0 else 1 if t > 1 else t * t * (3 - 2 * t)
        moved = 0
        for i in flagged:
            v = mdata.vertices[i]; co = v.co; z_b, y_b = -co.y * 100, co.z * 100; dy = y_b - lipY(z_b)
            if dy < 0.02 or z_b < 5.9: continue
            hit = roofT.ray_cast(Vector((co.x, co.y, lipY(z_b) / 100.0)), Vector((0, 0, 1)), 0.006)
            if hit[0] is None: continue
            target = min(0.40, max(0.03, hit[0].z * 100 - lipY(z_b) - 0.04))
            w = sstep(dy / 0.12) * sstep((z_b - 5.9) / 0.5)
            v.co.z = (lipY(z_b) + dy + (target - dy) * w) / 100.0; moved += 1
        import bmesh as _bm
        bm2 = _bm.new(); bm2.from_mesh(mdata); bm2.verts.ensure_lookup_table()
        inner = [bm2.verts[i] for i in flagged if abs(-bm2.verts[i].co.z * 0 + (bm2.verts[i].co.z * 100 - lipY(-bm2.verts[i].co.y * 100))) > 0.02 and -bm2.verts[i].co.y * 100 > 5.9]
        for _ in range(3): _bm.ops.smooth_vert(bm2, verts=inner, factor=0.3, use_axis_x=False, use_axis_y=False, use_axis_z=True)
        bm2.to_mesh(mdata); bm2.free(); mdata.update()
        for it in range(3):                                                   # whatever is still inside a bone is pushed out to its surface plus a hair
            for i in flagged:
                co = mdata.vertices[i].co; z_b, y_b = -co.y * 100, co.z * 100; dy = y_b - lipY(z_b)
                if abs(dy) < 0.02 or z_b < 5.9: continue
                t = roofT if dy > 0 else floorT; loc, nor, idx, d = t.find_nearest(co)
                if (co - loc).dot(nor) < 0: mdata.vertices[i].co = loc + nor * 0.0003
        mdata.polygons.foreach_set('use_smooth', [True] * len(mdata.polygons)); mdata.update()
        cav['bones'] = cavity_vs_bones(); cav['before'] = before; cav['fitted'] = moved
        for o in bpy.context.selected_objects: o.select_set(False)
        mouth.select_set(True); bpy.context.view_layer.objects.active = mouth
        bpy.ops.export_scene.gltf(filepath=OUTF, export_format='GLB', use_selection=True, export_apply=False, export_attributes=True, export_skins=False, export_animations=False,
            export_morph=False, export_yup=True, export_normals=True, export_texcoords=False, export_all_vertex_colors=False, export_vertex_color='ACTIVE', export_extras=False,
            export_cameras=False, export_lights=False)
        print('fitted cavity written', OUTF)
tooth_n = sum(1 for o in bpy.context.scene.objects if o.name.endswith('teeth'))
ver = {'date': datetime.date.today().isoformat(), 'bones': len(samples), 'toothRows': tooth_n, 'minMarginCm': round(min(worst.values()), 3), 'boneOutside': outside,
       'eyeIntrusionMaxCm': round(eye_in, 3), 'eyeIntrusionBones': {k: round(v, 3) for k, v in eye_by.items() if v > 0.01}, 'cavity': cav, 'worst': dict(sorted(((k, round(v, 3)) for k, v in worst.items()), key=lambda kv: kv[1])[:6])}
D['verified'] = ver; json.dump(D, open(SK, 'w'), indent=1)
print('VERIFIED', json.dumps(ver))

# ---- renders: x-ray = the bones (transparent film) over the skin, composited so the bones show through it --------------------------------------------
if '--no-render' not in argv:
    import numpy as np
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.cavity_ridge_factor = 1.0; sh.cavity_valley_factor = 1.2; sh.show_backface_culling = False
    sc.view_settings.view_transform = 'Standard'; sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.045, 0.05, 0.06)
    sc.render.resolution_x = sc.render.resolution_y = 900
    if mouth: mouth.hide_render = True
    bone_objs = [o for o in bpy.context.scene.objects if o not in (skin, mouth) and o.type in ('MESH', 'CURVE', 'EMPTY')]
    zc, yc = 6.7, 2.4
    cen = Vector(((D['hinge'][0]['at'][0] + D['hinge'][1]['at'][0]) / 200.0, -zc / 100.0, yc / 100.0))
    def snap(path, skin_on, bones_on, film):
        skin.hide_render = not skin_on
        for o in bone_objs: o.hide_render = not bones_on
        sc.render.film_transparent = film; sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    def pix(path):
        im = bpy.data.images.load(path); w, h = im.size; a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4); bpy.data.images.remove(im); return a
    def shot(name, off, rot, w=3.4, look=True):
        cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = w / 100.0; cd.clip_end = 5
        cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam; cam.location = cen + Vector(off)
        cam.rotation_euler = rot if rot else (cen - cam.location).to_track_quat('-Z', 'Y').to_euler()
        pb, ps = f'{OUT}_{name}_b.png', f'{OUT}_{name}_s.png'
        snap(pb, False, True, True)
        if xray:
            snap(ps, True, False, False); B, S = pix(ps), pix(pb); al = S[..., 3:4]
            out = S.copy(); out[..., :3] = B[..., :3] * (1 - 0.92 * al) + S[..., :3] * 0.92 * al; out[..., 3] = 1
        else:
            snap(pb, False, True, False); out = pix(pb)
        img = bpy.data.images.new('o', 900, 900, alpha=True); img.pixels = out.ravel().tolist(); img.filepath_raw = f'{OUT}_{name}.png'; img.file_format = 'PNG'; img.save()
        bpy.data.images.remove(img); bpy.data.objects.remove(cam)
        import os
        for p in (pb, ps):
            if os.path.exists(p): os.remove(p)
    def jaw_open(deg): pivot.rotation_euler = (math.radians(deg), 0, 0); bpy.context.view_layer.update()
    SIDE = ((0.5, 0, 0), (math.pi / 2, 0, math.pi / 2))
    xray = True
    jaw_open(0); shot('side', *SIDE); shot('top', (0, 0, 0.5), (0, 0, math.pi)); shot('three', (0.3, -0.3, 0.2), None)
    jaw_open(34); shot('side_open', *SIDE); shot('three_open', (0.3, -0.3, 0.2), None)
    jaw_open(0)
    for o in bone_objs:                                                        # the roof of the mouth from below: the lower jaw away, no skin
        if o.parent == pivot or o == pivot: o.hide_render = True
    xray = False; jaw_hidden = [o for o in bone_objs if o.parent == pivot]
    def shot_palate():
        cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = 3.4 / 100.0; cd.clip_end = 5
        cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam; cam.location = cen + Vector((0, 0, -0.5)); cam.rotation_euler = (math.pi, 0, math.pi)
        skin.hide_render = True
        for o in bone_objs: o.hide_render = o.parent == pivot or o == pivot or o.name.startswith('hyobranchial')
        sc.render.film_transparent = False; sc.render.filepath = f'{OUT}_palate.png'; bpy.ops.render.render(write_still=True)
    shot_palate()
print('done')
