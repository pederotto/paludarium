"""Render a GLB from six sides with its own material (lit, EEVEE), for checking a supplied model.
   blender -b --factory-startup -P art-src/guppy/look_glb.py -- <file.glb> <out prefix>"""
import sys, math, bpy
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, out = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
tex = next((x[6:] for x in sys.argv if x.startswith('--tex=')), None)
if tex:
    # a painted look (tools/guppy-maps.mjs): its colour on the body, colour and opacity on the fins (as the game draws them)
    im = bpy.data.images.load(tex); im.alpha_mode = 'STRAIGHT'
    for m in bpy.data.materials:
        if not m.use_nodes: continue
        nt = m.node_tree; b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not b: continue
        ti = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and any(l.to_socket == b.inputs['Base Color'] for l in n.outputs['Color'].links)), None)
        if not ti: continue
        ti.image = im
        b.inputs['Metallic'].default_value = 0.0
        for l in list(b.inputs['Metallic'].links) + list(b.inputs['Roughness'].links): nt.links.remove(l)
        b.inputs['Roughness'].default_value = 0.4
        if 'fin' in m.name:
            nt.links.new(ti.outputs['Alpha'], b.inputs['Alpha'])
            try: m.surface_render_method = 'BLENDED'
            except Exception: pass
if '--tintfins' in sys.argv:
    for m in bpy.data.materials:
        if 'fin' in m.name and m.use_nodes:
            b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
            b.inputs['Base Color'].default_value = (1, 0.1, 0.6, 1)
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in obs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
ctr = (lo + hi) / 2; size = max(hi - lo)
print('BBOX', tuple(round(v, 4) for v in lo), tuple(round(v, 4) for v in hi))
sc = bpy.context.scene
try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError: sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1000, 700
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (0.5, 0.52, 0.55, 1); bg.inputs[1].default_value = 1.0
for loc, e in (((1, -1, 2), 6), ((-1.5, 1, 1), 3), ((0, 0, -2), 1.5)):
    ld = bpy.data.lights.new('l', 'SUN'); ld.energy = e; lo_ = bpy.data.objects.new('l', ld); sc.collection.objects.link(lo_)
    lo_.rotation_euler = (-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.15
views = {'px': (1, 0, 0), 'nx': (-1, 0, 0), 'py': (0, 1, 0), 'ny': (0, -1, 0), 'pz': (0, 0, 1), 'nz': (0, 0, -1), 'three': (1, -0.8, 0.6)}
for k, d in views.items():
    d = Vector(d); cam.location = ctr + d * size * 3
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y' if abs(d.z) < 0.9 else 'X').to_euler()
    sc.render.filepath = f'{out}-{k}.png'; bpy.ops.render.render(write_still=True)
