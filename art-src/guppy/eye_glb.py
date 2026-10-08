"""Record the eye of a prepared guppy whose mesh has no separate eyeballs (the owner's female): the game draws the eye in its shader
(render/creatures/material.js analyticEyes) at a ball centre and radius, read from <name>.json (tools/guppy-import.mjs).
The eye's centre on the side view (y along the body, z up, prepared cm, read off a close-up of the head: the iris ring) is given; a ray
from the side finds the head's surface there, and the ball centre is set 0.7 r inside it.

  blender -b --factory-startup -P art-src/guppy/eye_glb.py -- <prepared.glb> <name>.json --at=<y>,<z> --r=<cm>
"""
import sys, json
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index('--') + 1:]
GLB, JS = a[0], a[1]
OPT = dict(x[2:].split('=', 1) for x in a[2:] if x.startswith('--') and '=' in x)
y, z = map(float, OPT['at'].split(',')); r = float(OPT['r'])
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=GLB)
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
dg = bpy.context.evaluated_depsgraph_get(); t = BVHTree.FromObject(ob, dg)
h = t.ray_cast(ob.matrix_world.inverted() @ Vector((5, y, z)), Vector((-1, 0, 0)))
assert h[0] is not None, 'no surface at the eye'
xs = (ob.matrix_world @ h[0]).x
c = Vector((xs - 0.7 * r, y, z))
m = json.load(open(JS))
m['eye'] = dict(c=[round(c.x, 4), round(c.z, 4), round(-c.y, 4)], r=round(r, 4))      # game frame: (x, z, -y)
json.dump(m, open(JS, 'w'), indent=1)
print('EYE surface x', round(xs, 4), 'meta', m['eye'])
