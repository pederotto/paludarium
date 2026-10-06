"""Dracula flower head (D. simia / vampira / hirtzii family) for the game. Head space: +Y facing, +Z top (dorsal sepal), 1 unit = 1 cm.
Reference photos (owner's, references only): .agents/refs/orchids/dracula/1-vampira-net, 2-hirtzii-moss, 3-simia-spotted-hairy.
Anatomy: a bulbous hood (the dorsal sepal) over a pair of broad shield-shaped lateral sepals, each blade drawn out into a long thin
tail; two tiny dark petals ('eyes') flank the column; a pale rounded lip ('mouth') protrudes in the middle."""
import math
import numpy as np
import orchidlib as ol

FORMS = [(0xf0e6d8, 0x6a1020, 0xfaf4f0), (0xc07a3c, 0x24101a, 0xf0e8ec), (0x4a0e1c, 0x2a0810, 0xf4ece8)]
sst = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
K = 0.30    # leaf v of the blade's tip: the blade is v 0..K, the tail K..1 (the pattern shader's contract)

def blade_mask(s, u):
    pale = 0.75 * (1 - sst(0.02, 0.16, s))
    return [1 - pale, 0.0, pale]

def tail(name, ctrl, tw, twist=0.8):
    return ol.sheet(name, ctrl, 2 * tw, lambda s: 0.5 * (1 - 0.7 * s), [0, 0.16, 0.36, 0.58, 0.8, 1.0], 2, face=(0, 1, 0), twist=lambda s: twist * s,
                    vmap=lambda s: K + (1 - K) * s, mask=lambda s, u: [0, 1, 0])

def mir(c): return [(-x, y, z) for x, y, z in c]

def build(form=0):
    parts, hairs = [], []
    rng = np.random.RandomState(11)
    rows = [0, 0.1, 0.22, 0.36, 0.52, 0.68, 0.82, 0.93, 1.0]
    # --- lateral sepals: broad shields, wing tips at lip level, apex low and outward, tail hanging
    for sd in (1, -1):
        A = [(0.15, 0.30, 0.50), (1.2, 0.62, 0.66), (2.6, 0.80, 0.48), (3.15, 0.62, -0.15), (2.75, 0.30, -1.4), (2.1, 0.10, -2.5), (1.75, 0.0, -3.1)]
        B = [(0.12, 0.18, -0.35), (0.15, 0.12, -1.0), (0.7, 0.06, -1.9), (1.35, 0.02, -2.6), (1.75, 0.0, -3.1)]
        if sd < 0: A, B = mir(A), mir(B)
        p = ol.ruled("lat%+d" % sd, A, B, rows, 5, bulge=lambda s, u: -0.09 * (1 - abs(u)) ** 2 * sst(0, .2, s) + 0.05 * math.sin(10 * s + 3 * u) * sst(.3, .9, s) * abs(u),
                     vmap=lambda s: s * K, mask=blade_mask)
        p.atlas(0, K); parts.append(p); hairs += [(p.P[i, 0], p.P[i, 1]) for i in range(2, len(rows) - 1)] + [(p.P[i, -1], p.P[i, -2]) for i in range(2, len(rows) - 1)]
        tc = [(1.75, 0.0, -3.1), (1.9, 0.0, -4.4), (1.95, 0.0, -5.8), (1.8, -0.05, -7.2), (1.55, -0.1, -8.6), (1.2, -0.15, -9.7)]
        parts.append(tail("lat-tail%+d" % sd, mir(tc) if sd < 0 else tc, 0.07))
    # --- the hood: the dorsal sepal, narrow at the neck, bulging forward, closing into a tail that arches up and over
    A = [(0.75, 0.50, 0.50), (1.45, 0.85, 1.15), (1.55, 0.95, 1.75), (1.0, 0.92, 2.35), (0.0, 0.78, 2.75)]
    p = ol.ruled("hood", A, mir(A), [0, 0.1, 0.24, 0.4, 0.56, 0.72, 0.86, 1.0], 5, bulge=lambda s, u: 0.5 * (1 - u * u) * math.sin(math.pi * min(1, 0.1 + s * 0.85)),
                 vmap=lambda s: s * K, mask=blade_mask)
    p.atlas(3, K); parts.append(p)
    hairs += [(p.P[i, 0], p.P[i, 1]) for i in range(1, 7)] + [(p.P[i, -1], p.P[i, -2]) for i in range(1, 7)] + [(p.P[i, 2], p.P[i, 2] + np.array([0, 1, 0.3])) for i in range(2, 7)]
    parts.append(tail("hood-tail", [(0, 0.78, 2.75), (0.1, 0.75, 4.2), (0.7, 0.55, 5.5), (1.9, 0.25, 6.3), (3.2, -0.05, 6.2), (4.3, -0.25, 5.3)], 0.08, 0.3))
    # --- the lip: a pale rounded dome in the middle of the face, a pink ribbed rim
    parts.append(ol.dome("lip", (0, 0.55, -0.35), 0.74, 1.0, 0.64, 1.5, [0, 0.28, 0.55, 0.8, 1.0], 12,
                         mask=lambda r, ph: [0.0, 0.2 * sst(0.55, 0.9, r), 0.8],
                         ruffle=lambda r, ph: 0.05 * math.cos(8 * ph) * sst(0.6, 1, r)).atlas_polar(1))
    for sd in (-1, 1):   # the 'eyes'
        parts.append(ol.dome("eye%+d" % sd, (sd * 0.7, 0.7, 0.38), 0.2, 0.26, 0.17, 1.5, [0, 0.5, 1.0], 6, mask=lambda r, ph: [0.0, 0.95, 0.05]))
    parts.append(ol.tube("column", [(0, 0.05, 0.05), (0, 0.4, 0.2), (0, 0.6, 0.25)], [0.16, 0.13, 0.1], sides=4, mask=(0.2, 0.1, 0.7)))
    # --- bristles on the margins and the hood
    tris = []
    for a, b in hairs[::2][:36]:
        d = ol.unit((np.asarray(a) - np.asarray(b)) + np.array([0, 0.45, 0]) + rng.normal(0, 0.12, 3))
        tris.append(ol.bristle(a, d, 0.32 + 0.14 * rng.rand(), 0.045))
    parts.append(ol.Tris("bristles", tris, (0.1, 0.9, 0.0)))
    return parts
