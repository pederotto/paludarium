"""Masdevallia flower head. Head space: +Y facing, +Z top; the origin is the base of the short sepal tube.
References (owner's photos): .agents/refs/orchids/masdevallia/1-decumana-spotted, 2-cream-red-throat, 3-white-yellow-tails.
Anatomy: three sepals fused into a short tube; the dorsal sepal a narrow cupped triangle drawn into a long tail straight up; the two
laterals fused along the midline into one broad kite-shaped blade (the synsepal) whose free lobes end in two long tails sweeping out
and down; two tiny petals and a small lip inside the mouth. Blade main colour (the pattern), a throat blotch in the accent, tails and hood
in the centre colour."""
import math
import numpy as np
import orchidlib as ol

FORMS = [(0xc2185b, 0x6a0a30, 0x7a0a3a), (0xe89ab0, 0x6a0f2a, 0xf0c030), (0xfaf8f2, 0xf0a020, 0xf2c418)]
sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
VK = 0.4      # leaf v of the blade's tip (blade 0..VK, tail VK..1)

def mir(c): return [(-x, y, z) for x, y, z in c]

def blade_mask(hood):
    def f(s, u):                     # s = 0..1 over the blade
        thr = 0.85 * (1 - sst(0.06, 0.32, s)); h = hood * sst(0.4, 0.95, s)
        m = (1 - thr) * (1 - h)
        return [m, thr, max(0.0, 1 - m - thr)]
    return f

def tail(name, ctrl, tw):
    return ol.sheet(name, ctrl, 2 * tw, lambda s: 0.5 * (1 - 0.65 * s), [0, 0.15, 0.35, 0.58, 0.8, 1.0], 2, face=(0, 1, 0), twist=lambda s: 0.9 * s,
                    vmap=lambda s: VK + (1 - VK) * s, mask=lambda s, u: [0, 0, 1])

def build(form=0):
    parts = []
    rows = [0, 0.12, 0.26, 0.42, 0.58, 0.74, 0.88, 1.0]
    parts.append(ol.tube("tube", [(0, 0, 0), (0, 0.25, 0.0), (0, 0.5, 0.0)], [0.15, 0.2, 0.27], sides=6, n=3, mask=(0.85, 0.15, 0)))
    # the dorsal sepal: a narrow triangle, cupped over the throat, closing into a tail that rises (and a little forward)
    A = [(0.20, 0.52, 0.06), (0.42, 0.68, 0.42), (0.32, 0.84, 0.88), (0.0, 0.96, 1.20)]
    parts.append(ol.ruled("dorsal", A, mir(A), rows, 3, bulge=lambda s, u: -0.16 * (1 - u * u) * (1 - sst(0, 0.8, s)) + 0.05 * (1 - u * u),
                          vmap=lambda s: s * VK, mask=blade_mask(0.35)).atlas(2, VK))
    parts.append(tail("dorsal-tail", [(0, 0.96, 1.20), (0, 1.03, 2.0), (0, 1.15, 2.8), (0, 1.28, 3.7)], 0.04))
    # the lateral sepals: one broad kite-shaped blade fused along the midline (each half from the midline to its outer edge)
    for sd in (-1, 1):
        Cc = [(0, 0.46, -0.10), (0, 0.56, -0.60), (0, 0.74, -1.1), (0, 0.92, -1.62)]
        E = [(sd * 0.22, 0.50, -0.06), (sd * 0.66, 0.66, -0.20), (sd * 1.06, 0.90, -0.62), (sd * 1.20, 1.0, -1.15), (sd * 0.9, 1.04, -1.75)]
        p = ol.ruled("lat%+d" % sd, Cc, E, rows, 3, bulge=lambda s, u: 0.34 * ((u + 1) / 2) ** 1.6 * sst(0.0, 0.5, s),
                     vmap=lambda s: s * VK, mask=blade_mask(0.0))
        p.atlas(2, VK); parts.append(p)
        parts.append(tail("lat-tail%+d" % sd, [(sd * 0.9, 1.04, -1.75), (sd * 1.25, 1.04, -2.4), (sd * 1.9, 0.98, -3.0), (sd * 2.6, 0.88, -3.45), (sd * 3.5, 0.72, -3.7)], 0.04))
    # two tiny petals and the lip inside the mouth
    for sd in (-1, 1):
        parts.append(ol.sheet("petal%+d" % sd, [(sd * 0.07, 0.38, 0.04), (sd * 0.2, 0.55, 0.16), (sd * 0.3, 0.64, 0.2)], 0.1, lambda s: 0.5 * math.sin(math.pi * min(1, .1 + .9 * s)),
                              [0, 0.5, 1.0], 1, face=(0, 1, 0.3), mask=lambda s, u: [0.3, 0.7, 0.0]))
    parts.append(ol.sheet("lip", [(0, 0.38, -0.07), (0, 0.55, -0.2), (0, 0.7, -0.3)], 0.17, lambda s: 0.5 * math.sin(math.pi * min(1, .1 + .9 * s)), [0, 0.5, 1.0], 1,
                          face=(0, 0.6, 1), mask=lambda s, u: [0, 1, 0]))
    return parts
