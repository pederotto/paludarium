"""Blender-node noise fields baked to float images (Cycles EMIT bake, headless). Used by leaf_bake.py.
fields(W, H, X, Y, specs) -> {name: float32 array (H, W)}, row 0 = the first row of X/Y; X, Y are the leaf-space coordinates of each texel
(width units). Every field is a small node graph on the vector (X * sx, Y * sy, seed): Blender's own Noise / Voronoi / White Noise nodes."""
import bpy, numpy as np

def _scene():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles; cy.device = 'CPU'; cy.samples = 1; cy.use_denoising = False
    try: cy.use_adaptive_sampling = False
    except Exception: pass
    sc.view_settings.view_transform = 'Standard'
    return sc

def _img(name, W, H, data=None):
    im = bpy.data.images.new(name, W, H, alpha=True, float_buffer=True, is_data=True)
    im.colorspace_settings.name = 'Non-Color'
    if data is not None: im.pixels.foreach_set(data.astype(np.float32).ravel())
    return im

def _read(im, W, H):
    a = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(H, W, 4)

def _plane(W, H):
    me = bpy.data.meshes.new("p"); me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)]); me.update()
    uv = me.uv_layers.new(name="UVMap")
    for l, c in zip(me.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]): uv.data[l.index].uv = c
    ob = bpy.data.objects.new("p", me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    return ob

def _set(node, name, val):
    s = node.inputs.get(name)
    if s is not None and hasattr(s, "default_value"): s.default_value = val

def build_field(nt, vec, spec):
    """spec: dict(kind, scale, detail, rough, distortion, randomness, sx, sy, seed ...). Returns a scalar socket."""
    k = spec["kind"]
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (spec.get("sx", 1.0), spec.get("sy", 1.0), 1.0)
    mp.inputs["Location"].default_value = (spec.get("seed", 0.0) * 7.31, spec.get("seed", 0.0) * 3.17, spec.get("seed", 0.0) * 1.9)
    nt.links.new(vec, mp.inputs["Vector"])
    if k == "noise":
        n = nt.nodes.new("ShaderNodeTexNoise"); n.noise_dimensions = '3D'
        _set(n, "Scale", spec.get("scale", 5.0)); _set(n, "Detail", spec.get("detail", 4.0)); _set(n, "Roughness", spec.get("rough", 0.55))
        _set(n, "Distortion", spec.get("distortion", 0.0)); _set(n, "Lacunarity", spec.get("lac", 2.0))
        nt.links.new(mp.outputs[0], n.inputs["Vector"]); return n.outputs["Fac"]
    if k in ("vor_edge", "vor_dist", "vor_cell"):
        v = nt.nodes.new("ShaderNodeTexVoronoi"); v.voronoi_dimensions = '3D'
        v.feature = 'DISTANCE_TO_EDGE' if k == "vor_edge" else 'F1'
        _set(v, "Scale", spec.get("scale", 10.0)); _set(v, "Randomness", spec.get("randomness", 1.0))
        nt.links.new(mp.outputs[0], v.inputs["Vector"])
        if k == "vor_cell":                      # a random value per cell (white noise of the cell's position)
            w = nt.nodes.new("ShaderNodeTexWhiteNoise"); w.noise_dimensions = '3D'
            nt.links.new(v.outputs["Position"], w.inputs["Vector"]); return w.outputs["Value"]
        return v.outputs["Distance"]
    raise ValueError(k)

def fields(W, H, X, Y, specs):
    sc = _scene()
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    coords = np.zeros((H, W, 4), np.float32); coords[..., 0] = X; coords[..., 1] = Y; coords[..., 3] = 1
    cim = _img("coords", W, H, coords)
    out = {}
    ob = _plane(W, H)
    for name, spec in specs.items():
        mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
        tc = nt.nodes.new("ShaderNodeTexImage"); tc.image = cim; tc.interpolation = 'Closest'
        uv = nt.nodes.new("ShaderNodeUVMap"); uv.uv_map = "UVMap"; nt.links.new(uv.outputs[0], tc.inputs["Vector"])
        sp = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(tc.outputs["Color"], sp.inputs[0])
        cb = nt.nodes.new("ShaderNodeCombineXYZ"); nt.links.new(sp.outputs[0], cb.inputs[0]); nt.links.new(sp.outputs[1], cb.inputs[1])
        fac = build_field(nt, cb.outputs[0], spec)
        em = nt.nodes.new("ShaderNodeEmission"); gm = nt.nodes.new("ShaderNodeCombineColor")
        for i in range(3): nt.links.new(fac, gm.inputs[i])
        nt.links.new(gm.outputs[0], em.inputs["Color"]); em.inputs["Strength"].default_value = 1.0
        outn = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], outn.inputs[0])
        tim = _img("bake_" + name, W, H); tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = tim
        nt.nodes.active = tn
        ob.data.materials.clear(); ob.data.materials.append(mat)
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
        out[name] = _read(tim, W, H)[..., 0].copy()
    return out
