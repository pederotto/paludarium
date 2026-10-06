"""Headless preview of a species' flower head (shape check against the owner's photos).
   blender -b --factory-startup -P art-src/orchids/view.py -- <species> <outdir> [form] [size] [views]
The species module (art-src/orchids/<species>.py) defines build(form) -> [Part] and FORMS (palettes as hex main/accent/centre)."""
import sys, os, math, importlib.util, json
import bpy, numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import orchidlib as ol

def hex_lin(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c] + [1]

def mesh_tris(part, mat):
    verts = [tuple(x) for t in part.V for x in t]; faces = [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(part.V))]
    me = bpy.data.meshes.new(part.name); me.from_pydata(verts, [], faces); me.update()
    ca = me.color_attributes.new("mask", 'FLOAT_COLOR', 'POINT')
    for k in range(len(verts)): ca.data[k].color = (float(part.mask[0]), float(part.mask[1]), float(part.mask[2]), 1)
    ob = bpy.data.objects.new(part.name, me); bpy.context.scene.collection.objects.link(ob); ob.data.materials.append(mat); return ob

def mesh_of(part, mat):
    if isinstance(part, ol.Tris): return mesh_tris(part, mat)
    P = part.P; nr, nc, _ = P.shape
    verts = [tuple(P[i, j]) for i in range(nr) for j in range(nc)]
    faces = []
    for i in range(nr - 1):
        for j in range(nc - 1):
            a, b, c, d = i * nc + j, (i + 1) * nc + j, (i + 1) * nc + j + 1, i * nc + j + 1
            if part.closed and j == nc - 2: c, d = (i + 1) * nc + 0, i * nc + 0
            faces.append((a, d, c, b) if not part.flip else (a, b, c, d))
    me = bpy.data.meshes.new(part.name); me.from_pydata(verts, [], faces); me.update()
    ca = me.color_attributes.new("mask", 'FLOAT_COLOR', 'POINT')
    for i in range(nr):
        for j in range(nc):
            m = part.M[i, j]; ca.data[i * nc + j].color = (float(m[0]), float(m[1]), float(m[2]), 1)
    ob = bpy.data.objects.new(part.name, me); bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    ob.data.materials.append(mat); return ob

def material(form):
    mat = bpy.data.materials.new("petal"); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    at = nt.nodes.new("ShaderNodeVertexColor"); at.layer_name = "mask"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(at.outputs["Color"], sep.inputs["Color"])
    def rgb(h):
        n = nt.nodes.new("ShaderNodeRGB"); n.outputs[0].default_value = hex_lin(h); return n
    cm, ca, cc = rgb(form[0]), rgb(form[1]), rgb(form[2])
    mix1 = nt.nodes.new("ShaderNodeMix"); mix1.data_type = 'RGBA'
    mix2 = nt.nodes.new("ShaderNodeMix"); mix2.data_type = 'RGBA'
    # colour = main*r + accent*g + centre*b  (r+g+b = 1): mix(main, accent, g/(r+g)) then centre by b
    div = nt.nodes.new("ShaderNodeMath"); div.operation = 'DIVIDE'
    add = nt.nodes.new("ShaderNodeMath"); add.operation = 'ADD'
    nt.links.new(sep.outputs[0], add.inputs[0]); nt.links.new(sep.outputs[1], add.inputs[1])
    add2 = nt.nodes.new("ShaderNodeMath"); add2.operation = 'MAXIMUM'; add2.inputs[1].default_value = 1e-4
    nt.links.new(add.outputs[0], add2.inputs[0])
    nt.links.new(sep.outputs[1], div.inputs[0]); nt.links.new(add2.outputs[0], div.inputs[1])
    nt.links.new(div.outputs[0], mix1.inputs[0]); mix1.inputs[6].default_value = (0, 0, 0, 1)
    nt.links.new(cm.outputs[0], mix1.inputs[6]); nt.links.new(ca.outputs[0], mix1.inputs[7])
    nt.links.new(sep.outputs[2], mix2.inputs[0]); nt.links.new(mix1.outputs[2], mix2.inputs[6]); nt.links.new(cc.outputs[0], mix2.inputs[7])
    nt.links.new(mix2.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.42
    for k, v in (("Subsurface Weight", 0.15), ("Subsurface Radius", (0.3, 0.15, 0.1))):
        if k in bs.inputs: bs.inputs[k].default_value = v
    nt.links.new(bs.outputs[0], out.inputs[0]); mat.use_backface_culling = False
    return mat

def setup_scene(size):
    sc = bpy.context.scene
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    sc.render.resolution_x = sc.render.resolution_y = size; sc.render.film_transparent = False
    for e in ("BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try: sc.render.engine = e; break
        except TypeError: pass
    w = bpy.data.worlds.new("w"); w.use_nodes = True; sc.world = w
    bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.045, 0.05, 0.05, 1); bg.inputs[1].default_value = 1.0
    def light(name, loc, energy, size=3):
        l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size
        o = bpy.data.objects.new(name, l); sc.collection.objects.link(o); o.location = loc
        d = Vector((0, 1.0, 0.5)) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    light("key", (6, 9, 8), 1800, 5); light("fill", (-8, 6, 2), 500, 6); light("rim", (0, -6, 6), 700, 4)
    cam = bpy.data.cameras.new("cam"); cam.lens = 70
    co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
    return sc, co

VIEWS = {"front": (0, 1, 0.12), "side": (1, 0.15, 0.1), "tq": (0.75, 0.75, 0.45), "top": (0, 0.25, 1), "back": (0, -1, 0.2)}

def render_views(parts, form, outdir, tag, size=520, views=("front", "side", "tq")):
    sc, co = setup_scene(size); mat = material(form)
    obs = [mesh_of(p, mat) for p in parts]
    allp = np.vstack([p.P.reshape(-1, 3) for p in parts]); lo, hi = allp.min(0), allp.max(0)
    ctr = (lo + hi) / 2; rad = np.linalg.norm(hi - lo) / 2
    files = []
    for v in views:
        d = Vector(VIEWS[v]).normalized()
        co.location = Vector(ctr) + d * rad * 3.0 * (70 / 70)
        co.rotation_euler = (Vector(ctr) - co.location).to_track_quat('-Z', 'Y').to_euler()
        co.data.lens = 70; co.data.sensor_width = 36
        f = os.path.join(outdir, f"{tag}-{v}.png"); sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
    return files

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:]
    sp, outdir = a[0], a[1]; form_i = int(a[2]) if len(a) > 2 else 0; size = int(a[3]) if len(a) > 3 else 520
    views = a[4].split(",") if len(a) > 4 else ("front", "side", "tq")
    os.makedirs(outdir, exist_ok=True)
    spec = importlib.util.spec_from_file_location(sp, os.path.join(HERE, sp + ".py")); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    parts = m.build(form_i)
    print("TRIS", ol.tri_count(parts), "PARTS", len(parts))
    fs = render_views(parts, m.FORMS[form_i], outdir, f"{sp}-f{form_i}", size, views)
    print("RENDERED", fs)
