# The colour source for a body made by tools/rig/leg-graft-scan.mjs (the harlequin, 8 Oct 2026): the owner's TEXTURED scan, rebuilt the way the graft built the body's geometry, so
# tools/blender/texture-transfer.py finds the scan's colour at every place of the baked body, the mirrored half included: the scan put in the graft's frame (the trunk's x to 0,
# levelled, the head sheared onto the midline), cut at x = 0, the left half kept and its mirror image joined to it (bmesh mirror: the copies keep the source's texture coordinates,
# so both sides read the same texels), then moved into the baked body's frame (the bake's own levelling, belly on y = 0, scaled to metres: tools/bake-frogpose.mjs FRAME_OUT).
#   Blender -b -P mirror-source.py -- <scan.glb> <graft.json> <frame.json> <out.glb>
# <graft.json>: art-src/raw/<sym>.glb.json (written by leg-graft-scan.mjs), <frame.json>: FRAME_OUT of the bake. The scan's own material (its colour map) is kept.
import bpy, bmesh, sys, json, math
import numpy as np
from mathutils import Matrix
a = sys.argv[sys.argv.index('--') + 1:]
SCAN, GJ, FJ, OUT = a[:4]
g = json.load(open(GJ)); f = json.load(open(FJ))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SCAN)
obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
me = obj.data
n = len(me.vertices)
V = np.empty(n * 3, dtype=np.float64); me.vertices.foreach_get('co', V); V = V.reshape(n, 3)
M = np.array(obj.matrix_world)
W = V @ M[:3, :3].T + M[:3, 3]                       # Blender world frame (z up, -y forward of glTF's +z)
G = np.stack([W[:, 0], W[:, 2], -W[:, 1]], 1)        # glTF frame: x, y up, z forward
rotx = lambda P, th: np.stack([P[:, 0], P[:, 1] * math.cos(th) - P[:, 2] * math.sin(th), P[:, 1] * math.sin(th) + P[:, 2] * math.cos(th)], 1)
# the graft's frame: rotY, the trunk's x to 0, levelled, the head's shear
r = math.radians(g.get('rot', 0))
F = np.stack([G[:, 0] * math.cos(r) + G[:, 2] * math.sin(r) - g['center'], G[:, 1], -G[:, 0] * math.sin(r) + G[:, 2] * math.cos(r)], 1)
if g.get('level', True): F = rotx(F, g['th'])
if g.get('shear'):
    z0, z1, dx = [float(v) for v in g['shear'].split(',')]
    t = np.clip((F[:, 2] - z0) / (z1 - z0), 0, 1); F[:, 0] -= dx * t * t * (3 - 2 * t)
B = np.stack([F[:, 0], -F[:, 2], F[:, 1]], 1)        # back to Blender's frame, the mesh now sits in the graft's frame with an identity object matrix
obj.parent = None; obj.matrix_world = Matrix.Identity(4)
me.vertices.foreach_set('co', B.ravel()); me.update()
# the left half (x < 0), and its mirror image
bm = bmesh.new(); bm.from_mesh(me)
geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_outer=True, clear_inner=False)
xs = [v.co.x for v in bm.verts]; print('left half: x from %.3f to %.3f, %d faces' % (min(xs), max(xs), len(bm.faces)))
if max(xs) > 1e-4: raise SystemExit('the cut kept the wrong side')
bmesh.ops.mirror(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), matrix=Matrix.Identity(4), merge_dist=1e-4, axis='X')
bm.normal_update(); bm.to_mesh(me); bm.free(); me.update()
print('joined: %d vertices, %d faces' % (len(me.vertices), len(me.polygons)))
# into the baked body's frame: the bake's own levelling (relative to the graft's), belly on y = 0, scaled to metres
n2 = len(me.vertices); V2 = np.empty(n2 * 3, dtype=np.float64); me.vertices.foreach_get('co', V2); V2 = V2.reshape(n2, 3)
Fg = np.stack([V2[:, 0], V2[:, 2], -V2[:, 1]], 1)
Bk = rotx(Fg, f['th'] - g['th'] if g.get('level', True) else f['th'])
Bk = (Bk - np.array([0.0, f['yb'], f['zc']])) * f['k']
Bb = np.stack([Bk[:, 0], -Bk[:, 2], Bk[:, 1]], 1)
me.vertices.foreach_set('co', Bb.ravel()); me.update()
print('baked frame: x %.4f..%.4f, y %.4f..%.4f, z %.4f..%.4f m' % (Bk[:, 0].min(), Bk[:, 0].max(), Bk[:, 1].min(), Bk[:, 1].max(), Bk[:, 2].min(), Bk[:, 2].max()))
bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False)
print('wrote', OUT)
