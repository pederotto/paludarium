"""Measure a supplied guppy GLB: its long axis, which end is the head, and a side profile (top, bottom, body width per slice), so it can
be compared with the targets (anatomy.py) and turned into game units.   blender -b --factory-startup -P measure_glb.py -- <file.glb>"""
import sys, bpy, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
me = ob.data; n = len(me.vertices)
P = np.empty(n * 3); me.vertices.foreach_get('co', P); P = P.reshape(-1, 3) @ np.array(ob.matrix_world)[:3, :3].T
ext = P.max(0) - P.min(0); ax = int(np.argmax(ext)); up = 2 if ax != 2 else 1
rest = [i for i in range(3) if i not in (ax, up)]; side = rest[0]
if ext[side] > ext[up]: up, side = side, up                     # up = the taller of the two short axes (fins make a fish tall)
print('extent', ext.round(4), 'long axis', 'xyz'[ax], 'up', 'xyz'[up], 'side', 'xyz'[side])
L = P[:, ax]; lo, hi = L.min(), L.max(); N = 60
rows = []
for i in range(N):
    m = (L >= lo + (hi - lo) * i / N) & (L < lo + (hi - lo) * (i + 1) / N)
    q = P[m]
    if not len(q): rows.append(None); continue
    w = np.abs(q[:, side]); thick = q[w > 0.35 * w.max()] if w.max() > 0 else q   # body = the part that is thick sideways (fins are thin)
    rows.append((q[:, up].min(), q[:, up].max(), w.max(), thick[:, up].min(), thick[:, up].max()))
for i, r in enumerate(rows):
    if r: print(f"{i:2d} t={i / N:.2f}  all {r[0]:+.3f}..{r[1]:+.3f}  body {r[3]:+.3f}..{r[4]:+.3f}  halfwidth {r[2]:.3f}")
