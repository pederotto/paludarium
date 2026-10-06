"""Dendrobium cuthbertsonii flower head. Head space: +Y facing, +Z top. The origin is the back of the chin (a bud folds forward along +Y).
References (owner's photos): .agents/refs/orchids/cuthbertsonii/1-red-warty-leaves (front: broad flat star), 2-pink-clump (flaring funnel, orange lip
tongue), 3-white-pink-mounted. Anatomy: five broad rounded tepals flaring from a short throat (dorsal sepal up, two petals out and a little up,
two lateral sepals down), a chin (mentum) at the back, a small rolled tongue lip with an orange-red tip; margins slightly wavy, glossy."""
import math
import numpy as np
import orchidlib as ol

FORMS = [(0xe0221a, 0xf0581c, 0xf5901c), (0xe878b8, 0xf6e8d2, 0xf08a2a), (0xfaf6f4, 0xf088b0, 0xf05a1e)]
sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
ZA = 0.45

def tint(a0):
    def f(s, u):
        a = a0 * sst(0.7, 1, s); thr = 0.45 * (1 - sst(0.05, 0.4, s))
        return [(1 - a) * (1 - thr), a, thr]
    return f

def build(form=0):
    parts = []
    wav = lambda amp, n: (lambda s, u: amp * math.sin(n * math.pi * u + 3 * s) * sst(0.55, 1, s) * abs(u))      # a slightly wavy margin
    # five tepals round the axis: dorsal sepal, two broad petals (a little above the horizontal), two lateral sepals
    parts.append(ol.tepal("dorsal", 0.0, 0.8, 0.2, 1.9, 1.25, 0.20, 1.40, 0.5, (0.55, 0.05), axis_z=ZA, mask=tint(0.8), ruffle=wav(0.05, 5)).atlas(4))
    for sd in (-1, 1):
        parts.append(ol.tepal("petal%+d" % sd, sd * 1.30, 0.84, 0.2, 1.85, 1.45, 0.25, 1.50, 0.45, (0.50, 0.04), axis_z=ZA, mask=tint(0.8), ruffle=wav(0.06, 4)).atlas(4))
        parts.append(ol.tepal("lsep%+d" % sd, sd * 2.55, 0.55, 0.3, 2.0, 1.35, 0.30, 1.38, 0.5, (0.55, 0.10), axis_z=ZA, mask=tint(0.6), ruffle=wav(0.05, 5)).atlas(4))
    # the chin: a rounded sac from the origin up into the tube
    rings = [(0.02, 0.02, 0.05, 0.05), (0.25, 0.10, 0.20, 0.18), (0.55, 0.25, 0.30, 0.27), (0.88, 0.40, 0.33, 0.30)]
    parts.append(ol.ringsurf("chin", rings, 5, mask=lambda i, j: [1, 0, 0]))
    # the tongue lip along the lower throat and out of the mouth, tip orange-red
    parts.append(ol.tepal("lip", math.pi, 0.85, 0.1, 1.75, 0.46, 0.10, 0.62, 0.65, (0.9, 0.5), axis_z=ZA, nu=2, rows=[0, 0.4, 0.75, 0.97],
                          mask=lambda s, u: (lambda c: [0.25 * (1 - c), 0.75 * (1 - c), c])(sst(0.55, 0.92, s))).atlas(5))
    return parts
