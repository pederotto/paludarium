"""Split a GLB holding several fish in one mesh (the owner's 'Guppies Galore', 8 Oct 2026) into one GLB per fish, each turned so its
length runs along Y with the head toward -Y and its back up (+Z), as art-src/guppy/prep_glb.py expects (--headAxis=-y).
Loose parts are grouped into fish by overlapping bounds; a fish's length is the longest principal axis of its points, its side is the
thinnest; the head is the thicker end, the back the side away from the belly fins (the belly hangs lower than the back is high only
by its fins, so the back is the side with the tall dorsal ... decided as the side the fish stands on in the file: +Z of the file).

  blender -b --factory-startup -P art-src/guppy/split_group.py -- <group.glb> <out dir> <name>
"""
import sys, os, bpy, bmesh, numpy as np
from mathutils import Matrix, Vector
a = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, NAME = a[0], a[1], a[2]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
def bb(o):
    P = np.array([v.co[:] for v in o.data.vertices]); return P.min(0), P.max(0), len(P)
info = [(o, *bb(o)) for o in parts]
info.sort(key=lambda r: -r[3])
# group: the fragments into fish by touching space: voxels of every vertex (CELL of the scene), joined across neighbours, give one blob
# per fish (they float apart in the file); each fragment goes to the blob of its first vertex
allP = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in parts]); lo0 = allP.min(0)
CELL = 0.012 * np.ptp(allP, 0).max()
key = lambda p: tuple(((np.asarray(p) - lo0) // CELL).astype(int))
cells = set(key(p) for p in allP)
lab = {}; nl = 0
for c0 in cells:
    if c0 in lab: continue
    st = [c0]; lab[c0] = nl
    while st:
        c = st.pop()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    q = (c[0] + dx, c[1] + dy, c[2] + dz)
                    if q in cells and q not in lab: lab[q] = nl; st.append(q)
    nl += 1
groups = {}
for o in parts:
    groups.setdefault(lab[key(o.data.vertices[0].co)], []).append(o)
fish = [dict(parts=g) for g in sorted(groups.values(), key=lambda g: -sum(len(o.data.vertices) for o in g)) if sum(len(o.data.vertices) for o in g) > 3000]
print('FISH', len(fish), [len(f['parts']) for f in fish], 'parts', len(parts))
for k, f in enumerate(fish):
    for o2 in bpy.context.scene.objects: o2.select_set(o2 in f['parts'])
    bpy.context.view_layer.objects.active = f['parts'][0]
    if len(f['parts']) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    P = np.array([v.co[:] for v in o.data.vertices]); c = P.mean(0); Q = P - c
    w, V = np.linalg.eigh(np.cov(Q.T)); L, S = V[:, 2], V[:, 0]                         # longest, thinnest
    U = np.cross(S, L)
    if U[2] < 0: U = -U                                                                 # back up as it stands in the file
    S = np.cross(L, U)
    R = np.array([S, L, U])                                                             # rows: new x, y, z
    Pn = Q @ R.T
    # head toward -y: the head end is thick, the tail end thin and tall
    def th(end):
        sel = Pn[np.abs(Pn[:, 1] - end) < 0.12 * (Pn[:, 1].max() - Pn[:, 1].min())]; return np.ptp(sel[:, 0]) / max(np.ptp(sel[:, 2]), 1e-6)
    if th(Pn[:, 1].min()) < th(Pn[:, 1].max()): R = np.array([-R[0], -R[1], R[2]])
    M = Matrix([[*R[0], 0], [*R[1], 0], [*R[2], 0], [0, 0, 0, 1]]) @ Matrix.Translation(Vector(-c))
    o.data.transform(M); o.matrix_world = Matrix.Identity(4)
    for o2 in bpy.context.scene.objects: o2.select_set(o2 is o)
    p = os.path.join(OUT, f'{NAME}_{k}.glb')
    bpy.ops.export_scene.gltf(filepath=p, use_selection=True, export_format='GLB', export_yup=True, export_apply=True)
    P2 = np.array([v.co[:] for v in o.data.vertices])
    print('OUT', p, 'verts', len(P2), 'ext', np.ptp(P2, 0).round(3))
