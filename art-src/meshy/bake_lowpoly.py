"""Low-poly version of a generated (Meshy) model with a freshly baked colour map (and optionally normal map).

    blender -b --factory-startup -P art-src/meshy/bake_lowpoly.py -- <hi.glb> <out.glb> [--tris 7000] [--tex 1024] [--normal 0]
                                                                      [--ray 0.03] [--angle 66] [--sat 1.0] [--bright 1.0]

Why: simplifying a 1 M triangle Meshy scan to a few thousand triangles keeps its original UVs, and the atlas is a mosaic of tiny
patches (one per scanned face), so a big low-poly triangle spans several patches and the colour comes out as stripes (tools/meshy-decor.mjs
and meshy-piece.mjs are fine down to about 25 k triangles, no further). Here the low mesh gets its own unwrap and the colour is BAKED onto
it from the full model, whatever the triangle count.

<hi.glb> is the model with its textures at full size and not too many triangles to load (about 250 k: tools/meshy-decor.mjs --tris=250000
--tex=4096; that step keeps the texture mapping, which this one needs). Steps: weld the copy (the file's vertices are split along the
texture seams, which would stop a collapse), decimate it, smart-UV-project it, bake the base colour from the hi mesh with Cycles ("selected
to active", a ray distance relative to the model's size), export the low mesh with that one texture as GLB. Foliage is two-sided: the
bake finds the nearest hi surface either side. --normal 1 also bakes a tangent-space normal map (rocks and wood; leaves do without).
Run one at a time (see "Hardware constraint" in CLAUDE.md).
"""
import bpy, bmesh, sys, math, time, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src, dst = argv[0], argv[1]
def opt(name, default):
    return type(default)(argv[argv.index('--' + name) + 1]) if ('--' + name) in argv else default
TRIS, TEX, NORMAL, RAY, ANGLE = opt('tris', 7000), opt('tex', 1024), opt('normal', 0), opt('ray', 0.03), opt('angle', 66.0)
SAT, BRIGHT = opt('sat', 1.0), opt('bright', 1.0)   # tone of the baked colour: the generated textures are brighter, more saturated or (a very dark scan) darker than the game's light wants
t0 = time.time()
def log(*a):
    print('[bake_lowpoly %5.1fs]' % (time.time() - t0), *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active
hi.name = 'hi'
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
hi_tris = sum(len(p.vertices) - 2 for p in hi.data.polygons)
dims = hi.dimensions
size = max(dims)
log('imported', hi_tris, 'triangles, size', tuple(round(d, 3) for d in dims))

# The scan's material may be metallic (Meshy writes a metal/roughness map): a diffuse bake of a metal comes out black (a lotus pad did). The game's
# stone, wood and plant materials read only the colour, so the colour is what is baked: metallic off, its texture unlinked.
for mat in hi.data.materials:
    if not mat or not mat.use_nodes:
        continue
    for node in mat.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            for link in list(node.inputs['Metallic'].links):
                mat.node_tree.links.remove(link)
            node.inputs['Metallic'].default_value = 0.0

# the low mesh: a welded copy, decimated
bpy.ops.object.select_all(action='DESELECT')
hi.select_set(True)
bpy.context.view_layer.objects.active = hi
bpy.ops.object.duplicate()
lo = bpy.context.view_layer.objects.active
lo.name = 'lo'
lo.data.materials.clear()
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=size * 1e-5)
bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
bpy.ops.object.mode_set(mode='OBJECT')
while len(lo.data.uv_layers):
    lo.data.uv_layers.remove(lo.data.uv_layers[0])
tris_now = sum(len(p.vertices) - 2 for p in lo.data.polygons)
if tris_now > TRIS:
    mod = lo.modifiers.new('decimate', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = TRIS / tris_now
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
log('low mesh', sum(len(p.vertices) - 2 for p in lo.data.polygons), 'triangles (welded from', tris_now, ')')

# its own unwrap
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(ANGLE), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.object.mode_set(mode='OBJECT')
log('unwrapped, uv layers', len(lo.data.uv_layers))

# the material the bake paints into (an image texture node, active)
def make_material(image, normal_image=None):
    mat = bpy.data.materials.new('lo_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.9
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    if normal_image is not None:
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = normal_image
        ntex.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(ntex.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return mat, tex

color = bpy.data.images.new('lo_color', TEX, TEX, alpha=False)
normal_img = bpy.data.images.new('lo_normal', TEX, TEX, alpha=False, float_buffer=False) if NORMAL else None
mat, tex_node = make_material(color, normal_img)
lo.data.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 4
sc.render.bake.margin = 8
sc.render.bake.margin_type = 'EXTEND'
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = size * RAY * 0.6
sc.render.bake.max_ray_distance = size * RAY * 1.5

def bake(kind, image, **kw):
    mat.node_tree.nodes.active = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image == image)
    bpy.ops.object.select_all(action='DESELECT')
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, margin=8, margin_type='EXTEND', **kw)

bake('DIFFUSE', color, pass_filter={'COLOR'})
log('colour baked')
if SAT != 1.0 or BRIGHT != 1.0:
    import numpy as np
    px = np.empty(TEX * TEX * 4, dtype=np.float32)
    color.pixels.foreach_get(px)
    a = px.reshape(-1, 4)
    lum = (a[:, 0] * 0.2126 + a[:, 1] * 0.7152 + a[:, 2] * 0.0722)[:, None]
    a[:, :3] = np.clip((lum + (a[:, :3] - lum) * SAT) * BRIGHT, 0.0, 1.0)
    color.pixels.foreach_set(a.reshape(-1))
    color.update()
    log('toned: sat', SAT, 'bright', BRIGHT)
if normal_img is not None:
    bake('NORMAL', normal_img, normal_space='TANGENT')
    log('normal baked')

# export the low mesh only
for im in (color, normal_img):
    if im is not None:
        im.pack()
bpy.ops.object.select_all(action='DESELECT')
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
bpy.ops.export_scene.gltf(filepath=os.path.abspath(dst), export_format='GLB', use_selection=True, export_image_format='AUTO', export_yup=True, export_apply=True)
log('wrote', dst)
