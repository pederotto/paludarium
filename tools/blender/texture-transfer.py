# Bakes a textured source model's colour onto a game body's atlas (the common frog, 7 Oct 2026: the owner's drop texture, colours corrected to the reference images,
# onto commonfrog.swim's atlas after the mouth was cut). The source must already be in the target's frame (metres, baked frame). The inside of the mouth, which the
# source does not have, is told apart by the target's vertex colours (frogmouth-finish.mjs --plain: the lining and the tongue marked) and painted as mucosa.
#   Blender -b -P texture-transfer.py -- <source.glb> <source_color.png> <target_plain.glb> <out.png> [--size 1024] [--k 0.47]
# --no-mouth: the target has no mouth marks in its vertex colours (a body without a cut mouth): every texel is skin
# --k: the body's size against the 7 cm common frog the ray settings below were made for (the harlequin, 3.3 cm: 0.47)
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
SRC, SRCIMG, TGT, OUT = a[:4]; SIZE = int(a[a.index('--size') + 1]) if '--size' in a else 1024; KB = float(a[a.index('--k') + 1]) if '--k' in a else 1.0; NOMOUTH = '--no-mouth' in a
bpy.ops.wm.read_factory_settings(use_empty=True)
def imp(p):
    before = set(bpy.context.scene.objects); bpy.ops.import_scene.gltf(filepath=p)
    return [o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH'][0]
src = imp(SRC); tgt = imp(TGT)
# the source's base colour: the corrected image
img = bpy.data.images.load(SRCIMG)
for m in src.data.materials:
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and any(l.to_socket.name == 'Base Color' for l in n.outputs[0].links): n.image = img
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs['Metallic'].default_value = 0.0
            for l in list(n.inputs['Metallic'].links): m.node_tree.links.remove(l)
# the target: one material with the image to bake into, and its vertex colour as an emission for the mouth mask
out = bpy.data.images.new('baked', SIZE, SIZE, alpha=False); mask = bpy.data.images.new('mask', SIZE, SIZE, alpha=False)
# (a sentinel colour where nothing is baked: a texel whose ray found no source surface (the armpit the scan hides with its arms spread, 7 Oct) stays magenta and is
# filled from its baked neighbours below, instead of staying black and showing as a dark blotch once the arm is tucked in)
out.pixels = np.tile(np.array([1.0, 0.0, 1.0, 1.0]), SIZE * SIZE).tolist()
mt = bpy.data.materials.new('tgt'); mt.use_nodes = True; nt = mt.node_tree
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = out
vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = tgt.data.color_attributes[0].name if tgt.data.color_attributes else ''
em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(vc.outputs['Color'], em.inputs['Color'])
tgt.data.materials.clear(); tgt.data.materials.append(mt)
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'; sc.render.threads_mode = 'FIXED'; sc.render.threads = 1
bk = sc.render.bake; bk.margin = 8
# 1. the colour from the source, selected to active
for o in sc.objects: o.select_set(False)
src.select_set(True); tgt.select_set(True); bpy.context.view_layer.objects.active = tgt; nt.nodes.active = tex
bk.use_selected_to_active = True; bk.cage_extrusion = 0.003 * KB; bk.max_ray_distance = 0.008 * KB; bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
# 2. the mouth mask from the target's own vertex colours
src.select_set(False); bk.use_selected_to_active = False
o_ = nt.nodes.get('Material Output') or nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs['Emission'], o_.inputs['Surface'])
tex.image = mask; nt.nodes.active = tex
bpy.ops.object.bake(type='EMIT')
# 3. composite: skin from the source, the lining and the tongue as mucosa (pale pink, a little mottled), in display (sRGB) values
C = np.array(out.pixels[:]).reshape(SIZE, SIZE, 4)[..., :3]; M = np.array(mask.pixels[:]).reshape(SIZE, SIZE, 4)[..., :3]
miss = (C[..., 0] > 0.98) & (C[..., 1] < 0.02) & (C[..., 2] > 0.98); print('texels with no source hit: %d' % miss.sum())
for it in range(96):                                   # (each pass: a missing texel takes the mean of its baked 4-neighbours)
    if not miss.any(): break
    acc = np.zeros_like(C); cnt = np.zeros(miss.shape)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ok = np.roll(~miss, (dy, dx), (0, 1)); acc += np.roll(C, (dy, dx), (0, 1)) * ok[..., None]; cnt += ok
    fill = miss & (cnt > 0); C[fill] = acc[fill] / cnt[fill][:, None]; miss &= ~fill
# (byte images hold display (sRGB) values: the mask's emission is the linear vertex colour encoded, so it is decoded before it is compared)
lin = lambda v: np.where(np.array(v) <= 0.04045, np.array(v) / 12.92, ((np.array(v) + 0.055) / 1.055) ** 2.4)
marks = {'skin': [0.16, 0.13, 0.06], 'lining': [0.45, 0.10, 0.12], 'tongue': [0.62, 0.20, 0.22]}      # frogmouth-finish.mjs stand-in colours (linear)
d = np.stack([np.linalg.norm(lin(M) - np.array(v), axis=-1) for v in marks.values()], -1); cls = d.argmin(-1)
if NOMOUTH: cls = np.zeros_like(cls)
rng = np.random.default_rng(7); noise = rng.normal(0, 1, (SIZE // 8, SIZE // 8)); noise = np.kron(noise, np.ones((8, 8)))[:SIZE, :SIZE] * 0.03
lining = np.array([0.58, 0.32, 0.33]); tongue = np.array([0.92, 0.62, 0.64])      # display values
for k, col in ((1, lining), (2, tongue)):
    m_ = cls == k
    C[m_] = np.clip(col[None, :] * (1 + noise[m_][:, None]), 0, 1)
print('texels: skin %d, lining %d, tongue %d' % tuple((cls == k).sum() for k in range(3)))
pix = np.ones((SIZE, SIZE, 4)); pix[..., :3] = C; out.pixels = pix.ravel().tolist()
out.filepath_raw = OUT; out.file_format = 'PNG'; out.save()
print('wrote', OUT)
