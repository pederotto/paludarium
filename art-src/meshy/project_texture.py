"""Textures a generated animal model that has no UVs (a Meshy `..._generate.glb`: geometry only) from the owner's reference photo.

The photo is a single side view, head to the left, prepared by art-src/meshy/photo_prep.py (<base>.png, <base>-normal.png, <base>.json).
Every vertex looks up the photo from the side: along the body it keeps its share of the length (head 0, tail 1), across the height it
keeps its share of the body's height *at that place*, so the model's outline lands on the animal's outline in the photo (the model was
generated from the same picture, so the two are close). Both flanks read the same side (the animal is mirrored), the back and belly
read the photo's edge rows, fins read the fins. The result is a real photographic skin (scales, spots, fin rays), not an
approximation by colour. Which end is the head is found by comparing the model's height profile with the photo's, both ways.

  blender -b --factory-startup -P art-src/meshy/project_texture.py -- <in.glb> <prep base> <out.glb> [--axis=x|y] [--head=auto|min|max]
          [--rough=0.5] [--normal=1.0]

--axis: the horizontal axis the animal's length runs along in the file (as Blender imports it; see the printed extents).
Writes <out.glb> with the head toward -X, up +Z, material with colour and normal maps; then tools/meshy-prep.mjs --head=-x.
"""
import sys, os, json, math
import bpy, bmesh, numpy as np
from mathutils import Matrix

a = sys.argv[sys.argv.index('--') + 1:]
SRC, BASE, OUT = a[0], a[1], a[2]
OPT = dict(x[2:].split('=', 1) for x in a[3:] if x.startswith('--') and '=' in x)
AXIS = OPT.get('axis', ''); HEAD = OPT.get('head', 'auto'); ROUGH = float(OPT.get('rough', 0.5)); NSTR = float(OPT.get('normal', 1.0))

prof = json.load(open(BASE + '.json'))
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
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
n = len(me.vertices)
P = np.empty(n * 3); me.vertices.foreach_get('co', P); P = P.reshape(-1, 3)
ext = P.max(0) - P.min(0)
print('extents x y z', np.round(ext, 3))
ai = {'x': 0, 'y': 1}.get(AXIS, int(np.argmax(ext[:2])))
bi = 1 - ai

# photo outline: top/bottom row per column across the mask
Wc, Hc = prof['crop']; mx0, mx1 = prof['maskX']; NC = prof['cols']
top = np.array(prof['top'], float); bot = np.array(prof['bottom'], float)
ph = (bot - top)

def mesh_profile(s, z, nb=64):
    """height range (zmin, zmax) of the model per slice of its length s in 0..1"""
    lo = np.full(nb, np.nan); hi = np.full(nb, np.nan)
    k = np.minimum((s * nb).astype(int), nb - 1)
    for i in range(nb):
        m = k == i
        if m.any(): lo[i] = z[m].min(); hi[i] = z[m].max()
    idx = np.arange(nb); ok = ~np.isnan(lo)
    lo = np.interp(idx, idx[ok], lo[ok]); hi = np.interp(idx, idx[ok], hi[ok])
    return lo, hi

# which end is the head: compare the height profile of the model with the photo's, in both directions
t = P[:, ai]; s_min = (t - t.min()) / (t.max() - t.min())
lo, hi = mesh_profile(s_min, P[:, 2]); mh = hi - lo
phs = np.interp(np.linspace(0, NC - 1, 64), np.arange(NC), ph)
norm = lambda v: (v - v.mean()) / (v.std() + 1e-9)
c_min = float(np.mean(norm(mh) * norm(phs))); c_max = float(np.mean(norm(mh[::-1]) * norm(phs)))
print(f'profile correlation: head at min {c_min:.3f}, head at max {c_max:.3f}')
head_at_min = (c_min >= c_max) if HEAD == 'auto' else (HEAD == 'min')
d = np.zeros(2); d[ai] = -1.0 if head_at_min else 1.0
th = math.pi - math.atan2(d[1], d[0])                               # rotate about Z so the head points to -X
c, sn = math.cos(th), math.sin(th)
R = np.array([[c, -sn], [sn, c]])
xy = P[:, :2] @ R.T
P2 = np.column_stack([xy, P[:, 2]])
me.vertices.foreach_set('co', P2.ravel()); me.update()
print('head at', 'min' if head_at_min else 'max', 'of axis', 'xy'[ai], '-> -X')

# the lateral projection
x = P2[:, 0]; z = P2[:, 2]
s = (x - x.min()) / (x.max() - x.min())                              # 0 head ... 1 tail
NB = 128
lo, hi = mesh_profile(s, z, NB)
def smooth(v, k=3):
    w = np.ones(2 * k + 1) / (2 * k + 1); vp = np.pad(v, k, mode='edge'); return np.convolve(vp, w, mode='valid')
lo = smooth(lo); hi = smooth(hi)
si = np.clip(s * (NB - 1), 0, NB - 1)
zlo = np.interp(si, np.arange(NB), lo); zhi = np.interp(si, np.arange(NB), hi)
tt = np.clip((zhi - z) / np.maximum(zhi - zlo, 1e-6), 0, 1)           # 0 at the top of the body at that place, 1 at the bottom
col = np.clip(s * (NC - 1), 0, NC - 1)
ytop = np.interp(col, np.arange(NC), top); ybot = np.interp(col, np.arange(NC), bot)
px = mx0 + s * (mx1 - mx0); py = ytop + tt * (ybot - ytop)
U = np.clip(px / Wc, 0, 1); V = np.clip(1 - py / Hc, 0, 1)

uv = me.uv_layers.new(name='UVMap')
loop_v = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get('vertex_index', loop_v)
uvs = np.column_stack([U[loop_v], V[loop_v]]).ravel()
uv.data.foreach_set('uv', uvs)
for p in me.polygons: p.use_smooth = True

# material: the photo's colour, its relief as a normal map
mat = bpy.data.materials.new(os.path.basename(OUT).replace('.glb', ''))
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(nn for nn in nt.nodes if nn.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(BASE + '.png'); tex.image.colorspace_settings.name = 'sRGB'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
nim = nt.nodes.new('ShaderNodeTexImage'); nim.image = bpy.data.images.load(BASE + '-normal.png'); nim.image.colorspace_settings.name = 'Non-Color'
nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = NSTR
nt.links.new(nim.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = ROUGH; bsdf.inputs['Metallic'].default_value = 0.0
mat.use_backface_culling = False
me.materials.clear(); me.materials.append(mat)
ob.name = os.path.basename(OUT).replace('.glb', '')

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=92, export_normals=True,
                          export_texcoords=True, export_apply=True, export_yup=True)
print('wrote', OUT, 'verts', n, 'uv range', U.min().round(3), U.max().round(3), V.min().round(3), V.max().round(3))
