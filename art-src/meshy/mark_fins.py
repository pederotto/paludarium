"""Marks the fins of a generated fish model as membranes: splits the faces into two materials, "skin" (the body) and "fin" (the fins),
sharing the same texture, so the game shades the fins see-through and lets them flutter (render/creatures/glb.js: a material named
"fin" gets the membrane shading, finish.finOpacity says how dense).

A face is a fin when it has no body behind it: a ray from its centre along the normal and one against it; on a body one of them goes
through the inside and meets the far side farther than `thin` (a share of the length); on a fin sheet (a single surface, or two layers
closer than `thin`) neither does. Patches of one kind smaller than `--patch` faces inside the other kind are turned over (specks).

  blender -b --factory-startup -P art-src/meshy/mark_fins.py -- <in.glb> <out.glb> [--thin=0.012] [--patch=40] [--debug=1]

--debug=1 tints the fin material magenta so the split can be looked at. Textures, UVs and normals are kept as they are.
"""
import sys, os
import bpy, bmesh, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

a = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = a[0], a[1]
OPT = dict(x[2:].split('=', 1) for x in a[2:] if x.startswith('--') and '=' in x)
THIN = float(OPT.get('thin', 0.012)); PATCH = int(OPT.get('patch', 40)); DEBUG = OPT.get('debug', '0') == '1'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
me = ob.data
if not me.materials: raise SystemExit('the model has no material: texture it first (project_texture.py)')

bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
bvh = BVHTree.FromBMesh(bm)
co = np.array([v.co[:] for v in bm.verts]); L = (co.max(0) - co.min(0)).max()
thin = THIN * L
eps = 1e-4 * L
nf = len(bm.faces)
fin = np.zeros(nf, dtype=bool)
for i, f in enumerate(bm.faces):
    c = f.calc_center_median(); n = f.normal
    best = None
    for sgn in (1.0, -1.0):
        d = n * sgn; o = c + d * eps; run = 0.0
        for _ in range(8):                                          # follow the ray through every layer (some bodies carry an inner shell)
            hit = bvh.ray_cast(o, d, L - run)
            if hit[0] is None: break
            if hit[2] != i:
                run += hit[3] + eps
                best = run if best is None else max(best, run)      # the farthest hit: a body has its far side in one direction
            o = hit[0] + d * eps
    fin[i] = (best is None) or (best < thin)

# patches: connected groups (by shared vertices) of one kind that are small are turned over
adj = [[] for _ in range(nf)]
vf = {}
q = 1e-4 * L                                                        # (texture seams split vertices: weld by position)
for f in bm.faces:
    for v in f.verts: vf.setdefault((round(v.co.x / q), round(v.co.y / q), round(v.co.z / q)), []).append(f.index)
for fl in vf.values():
    for x in fl:
        adj[x].extend(y for y in fl if y != x)
seen = np.zeros(nf, dtype=bool); flipped = 0
for s in range(nf):
    if seen[s]: continue
    kind = fin[s]; stack = [s]; seen[s] = True; comp = []
    while stack:
        x = stack.pop(); comp.append(x)
        for y in adj[x]:
            if not seen[y] and fin[y] == kind: seen[y] = True; stack.append(y)
    if len(comp) < PATCH:
        for x in comp: fin[x] = not kind
        flipped += len(comp)
print(f'faces {nf}: fin {int(fin.sum())} ({100 * fin.mean():.1f} %), body {int((~fin).sum())}; thin {thin:.5f} of length {L:.3f}; {flipped} faces in small patches turned over')

# two materials with the same texture
body = me.materials[0]; body.name = 'skin'
finm = body.copy(); finm.name = 'fin'
finm.use_backface_culling = False; body.use_backface_culling = False
for nn in finm.node_tree.nodes:
    if nn.type == 'BSDF_PRINCIPLED':
        nn.inputs['Roughness'].default_value = min(1.0, nn.inputs['Roughness'].default_value * 0.7 + 0.1)   # (the two must differ or the importer's dedup merges them)
        if DEBUG:
            for l in list(finm.node_tree.links):
                if l.to_socket == nn.inputs['Base Color']: finm.node_tree.links.remove(l)
            nn.inputs['Base Color'].default_value = (1.0, 0.0, 1.0, 1.0)
me.materials.clear(); me.materials.append(body); me.materials.append(finm)
bm.free()
for p in me.polygons: p.material_index = 1 if fin[p.index] else 0

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=92, export_normals=True,
                          export_texcoords=True, export_apply=True, export_yup=True)
print('wrote', OUT)
