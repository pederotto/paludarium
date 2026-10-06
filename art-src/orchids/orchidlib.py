"""Orchid modelling kit (Blender 5.x, headless or live). Source of the game's orchid flower heads.

Head space = the game's flower space (src/sim/flowering.js headMatrix): +Y the facing (out of the flower, toward the viewer),
+Z the flower's top (the dorsal sepal), +X = Y x Z.  1 unit = 1 cm at scale 1.  Every part is a grid of vertices:
rows i = s from the base (0) to the tip (1), columns j = u from -1 to +1 across.  The game's leaf coordinates are (u, v) with
v = the row parameter (0 base .. 1 tip, a tailed sepal puts its blade at 0..k and its tail at k..1); the vertex colour is the
palette MASK [main, accent, centre] (r+g+b = 1).  Parts without leaf coordinates (stalks, tubes, columns, hairs) are solid.
Nothing here uses photo pixels: shapes are measured by eye from the owner's reference photos (references only).
"""
import math, json
import numpy as np

# ------------------------------------------------------------------------------------------------------------- curves
def catmull(ctrl, n):
    """A smooth curve through control points (k,3), n samples spaced evenly in arclength."""
    P = np.asarray(ctrl, float)
    if len(P) == 2:
        t = np.linspace(0, 1, n)[:, None]; return P[0] * (1 - t) + P[1] * t
    ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    pts = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for t in np.linspace(0, 1, 24, endpoint=(i == len(ext) - 3)):
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    pts = np.array(pts)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    s = np.linspace(0, seg[-1], n)
    return np.stack([np.interp(s, seg, pts[:, k]) for k in range(3)], axis=1)

def unit(v):
    v = np.asarray(v, float); n = np.linalg.norm(v, axis=-1, keepdims=True); return v / np.maximum(n, 1e-9)

def frames(spine, face):
    """Parallel-transport frames along a spine: tangent T, side S, normal N (upper face toward `face`)."""
    n = len(spine)
    T = unit(np.gradient(spine, axis=0))
    S = np.zeros_like(T); N = np.zeros_like(T)
    f = unit(face)
    s0 = np.cross(f, T[0])
    if np.linalg.norm(s0) < 1e-6: s0 = np.cross([1, 0, 0] if abs(T[0][0]) < .9 else [0, 0, 1], T[0])
    S[0] = unit(s0); N[0] = unit(np.cross(T[0], S[0]))
    for i in range(1, n):
        S[i] = S[i - 1] - T[i] * np.dot(S[i - 1], T[i]); S[i] = unit(S[i]); N[i] = unit(np.cross(T[i], S[i]))
    return T, S, N

# ------------------------------------------------------------------------------------------------------------- sheets
class Part:
    """One part: grid positions P (nr, nc, 3), optional leaf coordinates L (nr, nc, 2), masks M (nr, nc, 3)."""
    def __init__(self, name, P, L=None, M=None, closed=False, flip=False):
        self.name, self.P, self.L, self.M, self.closed, self.flip = name, np.asarray(P, float), L, M, closed, flip
        if M is None: self.M = np.tile([1.0, 0, 0], P.shape[:2] + (1,))
        self.A = None            # atlas coordinates (nr, nc, 2) in a tile: x across 0..1, y along 0..1 (None: no atlas, the old arithmetic patterns)
        self.col = None          # the atlas column (tile) it uses

    def atlas_polar(self, col):
        """A dome: x = round it (phi / 2 pi), y = out from the apex."""
        self.col = col; self.A = self.Apol; return self

    def atlas(self, col, vmax=1.0):
        """Use atlas column `col`: x = (u + 1) / 2 across the part, y = v / vmax along it (the leaf coordinates)."""
        self.col = col
        self.A = np.stack([(self.L[..., 0] + 1) / 2, np.clip(self.L[..., 1] / vmax, 0, 1)], -1)
        return self

def sheet(name, spine, width, outline, rows, nu, face=(0, 1, 0), cup=None, twist=None, ruffle=None, rib=None, vmap=None, mask=None, edge_lift=None):
    """A curved sheet along `spine` (control points). width: full width in cm; outline(s) the half-width as a fraction of `width`
    (0.5 = full); rows: the s of each row; nu columns across; cup(s): margins toward the face (fraction of half-width); twist(s) radians
    about the spine; ruffle(s, u): extra offset along the normal (cm); rib(s, u): midrib ridge (cm); vmap(s) -> the leaf v of the row;
    mask(s, u) -> [r,g,b]."""
    rows = np.asarray(rows, float)
    dense = catmull(spine, 400)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]; seg /= seg[-1]
    sp = np.stack([np.interp(rows, seg, dense[:, k]) for k in range(3)], axis=1)
    Tt, Ss, Nn = frames(dense, face)
    T = np.stack([np.interp(rows, seg, Tt[:, k]) for k in range(3)], 1); S = np.stack([np.interp(rows, seg, Ss[:, k]) for k in range(3)], 1); N = np.stack([np.interp(rows, seg, Nn[:, k]) for k in range(3)], 1)
    S = unit(S); N = unit(np.cross(T, S)); T = unit(T)
    nr, nc = len(rows), nu + 1
    P = np.zeros((nr, nc, 3)); L = np.zeros((nr, nc, 2)); M = np.zeros((nr, nc, 3))
    for i, s in enumerate(rows):
        hw = width * outline(s)
        tw = twist(s) if twist else 0.0
        ct, st = math.cos(tw), math.sin(tw)
        sd = S[i] * ct + N[i] * st; nm = N[i] * ct - S[i] * st
        for j in range(nc):
            u = -1 + 2 * j / nu
            off = (cup(s) * u * u * hw if cup else 0.0)
            if ruffle: off += ruffle(s, u)
            if rib: off += rib(s, u)
            P[i, j] = sp[i] + sd * (u * hw) + nm * off
            L[i, j] = [u, vmap(s) if vmap else s]
            M[i, j] = mask(s, u) if mask else [1, 0, 0]
    return Part(name, P, L, M)

def tube(name, ctrl, radii, sides=3, n=None, mask=(0, 0, 1)):
    """A tapering prism (solid: no leaf coordinates). radii: per control point."""
    n = n or len(ctrl)
    pts = catmull(ctrl, n)
    rr = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(radii)), radii)
    T, S, N = frames(pts, (0, 0, 1))
    P = np.zeros((n, sides + 1, 3))
    for i in range(n):
        for k in range(sides + 1):
            a = 2 * math.pi * (k % sides) / sides
            P[i, k] = pts[i] + (S[i] * math.cos(a) + N[i] * math.sin(a)) * rr[i]
    M = np.tile(np.asarray(mask, float), (n, sides + 1, 1))
    return Part(name, P, None, M, closed=True)

def ruled(name, A, B, rows, nu, bulge=None, vmap=None, mask=None, front=(0, 1, 0)):
    """A surface between two boundary curves A and B (control points, both running base -> tip): any silhouette. bulge(s, u) offsets
    each vertex along the surface normal (cm, + toward `front`): domes, cups, keels, ripples. u runs -1 (curve A) to +1 (curve B)."""
    rows = np.asarray(rows, float)
    def samp(c):
        d = catmull(c, 300); sg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(d, axis=0), axis=1))]; sg /= sg[-1]
        return np.stack([np.interp(rows, sg, d[:, k]) for k in range(3)], axis=1)
    PA, PB = samp(A), samp(B)
    nr, nc = len(rows), nu + 1
    P = np.zeros((nr, nc, 3)); L = np.zeros((nr, nc, 2)); M = np.zeros((nr, nc, 3))
    for i in range(nr):
        for j in range(nc):
            t = j / nu; P[i, j] = PA[i] * (1 - t) + PB[i] * t
    N = grid_normals(P)
    if np.mean(N.reshape(-1, 3) @ np.asarray(front, float)) < 0: N = -N
    for i, s in enumerate(rows):
        for j in range(nc):
            u = -1 + 2 * j / nu
            if bulge: P[i, j] = P[i, j] + N[i, j] * bulge(float(s), u)
            L[i, j] = [u, vmap(float(s)) if vmap else float(s)]
            M[i, j] = mask(float(s), u) if mask else [1, 0, 0]
    part = Part(name, P, L, M)
    if np.mean(grid_normals(P).reshape(-1, 3) @ np.asarray(front, float)) < 0: part.flip = True
    return part

def dome(name, c, a, b, cz, th_max, rings, segs, mask=None, ruffle=None, front=(0, 1, 0)):
    """An ellipsoid cap (semi-axes a across x, b forward y, cz along z), apex toward +Y, rim at polar angle th_max; segs round."""
    P = np.zeros((len(rings), segs + 1, 3)); M = np.zeros((len(rings), segs + 1, 3)); L = np.zeros((len(rings), segs + 1, 2))
    for i, r in enumerate(rings):
        th = r * th_max
        for j in range(segs + 1):
            ph = 2 * math.pi * (j % segs) / segs
            off = ruffle(r, ph) if ruffle else 0.0
            P[i, j] = np.asarray(c) + np.array([(a + off) * math.sin(th) * math.cos(ph), b * math.cos(th), (cz + off) * math.sin(th) * math.sin(ph)])
            M[i, j] = mask(r, ph) if mask else [0, 0, 1]
            L[i, j] = [math.cos(ph), r]
    part = Part(name, P, L, M, closed=True)
    part.Apol = np.array([[[(j % segs) / segs, rings[i]] for j in range(segs + 1)] for i in range(len(rings))])
    return part

def ringsurf(name, rings, sides=6, mask=None, vmap=None):
    """A closed surface through rings: each ring (y, z, rx, rz) an ellipse in the x-z plane at height y along the axis (a sac, a tube)."""
    P = np.zeros((len(rings), sides + 1, 3)); M = np.zeros((len(rings), sides + 1, 3)); L = np.zeros((len(rings), sides + 1, 2))
    for i, (y, z, rx, rz) in enumerate(rings):
        for j in range(sides + 1):
            q = 2 * math.pi * (j % sides) / sides
            P[i, j] = (math.cos(q) * rx, y, z + math.sin(q) * rz); M[i, j] = mask(i, j) if mask else [1, 0, 0]; L[i, j] = [0, 0]
    return Part(name, P, None, M, closed=True)

def tepal(name, th, y0, r0, length, width, a0, a1, base, cup, outline=None, rows=None, nu=4, axis_z=0.0, mask=None, ruffle=None, twist=None, face_in=0.7, front=None):
    """A broad petal/sepal around the head's axis (through (0, y, axis_z), +Y forward): leaves the axis at radius r0, height y0 at angle a0
    (rad from the axis) and flares to a1 at the tip; th 0 = +Z (the dorsal side). cup = (at the base, at the tip) margin lift."""
    R = np.array([math.sin(th), 0.0, math.cos(th)]); Y = np.array([0, 1.0, 0]); Z0 = np.array([0, 0, axis_z])
    rows = np.asarray(rows if rows is not None else [0, 0.14, 0.3, 0.46, 0.62, 0.77, 0.89, 0.97, 1.0], float)
    sst_ = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, (x - a) / (b - a))))
    ds = 1 / 60; pts = [Z0 + Y * y0 + R * r0]
    for k in range(60):
        s = k * ds; al = a0 + (a1 - a0) * s ** 1.4
        pts.append(pts[-1] + length * ds * (math.cos(al) * Y + math.sin(al) * R))
    ctrl = [pts[i] for i in range(0, 61, 10)]
    ow = outline or (lambda s: 0.5 * (base + (1 - base) * sst_(0, 0.68, s)) * (1.0 if s < 0.68 else math.sqrt(max(0.0, 1 - ((s - 0.68) / 0.32) ** 2)) ** 0.9))
    cp = lambda s: cup[0] + (cup[1] - cup[0]) * s
    return sheet(name, ctrl, width, ow, rows, nu, face=(Y * face_in - R * face_in), cup=cp, ruffle=ruffle, twist=twist, mask=mask)

# ------------------------------------------------------------------------------------------------------ normals, export
def grid_normals(P):
    nr, nc, _ = P.shape
    N = np.zeros_like(P)
    for i in range(nr):
        for j in range(nc):
            pu = P[i, min(nc - 1, j + 1)] - P[i, max(0, j - 1)]
            pt = P[min(nr - 1, i + 1), j] - P[max(0, i - 1), j]
            n = np.cross(pt, pu); l = np.linalg.norm(n); N[i, j] = n / l if l > 1e-10 else [0, 1, 0]
    return N

PAD = 0.03     # inside a tile, so mip levels never read the neighbour
def atlas_xy(col, a): return [round((col + PAD + (1 - 2 * PAD) * float(a[0])) / 8, 4), round((PAD + (1 - 2 * PAD) * float(a[1])) / 8, 4)]

def export(parts, nd=3):
    """All parts as one triangle soup: {pos, nor, uv, msk, idx} flat lists (uv v = -1 for solid parts). Same triangle order and
    winding as sheet() / tube() in src/sim/flowering.js (a cell = two triangles)."""
    pos, nor, uv, msk, idx, at = [], [], [], [], [], []
    for pt in parts:
        P, N = pt.P, grid_normals(pt.P)
        nr, nc, _ = P.shape
        base = len(pos) // 3
        for i in range(nr):
            for j in range(nc):
                pos += [round(float(x), nd) for x in P[i, j]]
                nn = -N[i, j] if pt.flip else N[i, j]
                nor += [round(float(x), 2) for x in nn]
                if pt.L is not None: uv += [round(float(pt.L[i, j, 0]), 3), round(float(pt.L[i, j, 1]), 3)]
                else: uv += [0, -1]
                m = pt.M[i, j]; s = max(1e-6, float(m.sum()))
                msk += [round(float(m[0] / s), 3), round(float(m[1] / s), 3), round(float(m[2] / s), 3)]
                if pt.A is not None: at += atlas_xy(pt.col, pt.A[i, j])
                else: at += [-1, -1]
        v = lambda i, j: base + i * nc + (j % nc if pt.closed and j >= nc - 1 else j)
        for i in range(nr - 1):
            for j in range(nc - 1):
                a, b, c, d = v(i, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1)
                idx += ([a, b, c, c, b, d] if not pt.flip else [a, c, b, c, d, b])
    return dict(pos=pos, nor=nor, uv=uv, msk=msk, idx=idx, at=at)

class Tris:
    """Loose single triangles (hairs, bristles): V (k, 3, 3) positions, N (k, 3) face normals, mask (3,). Solid (no leaf coords)."""
    def __init__(self, name, V, mask=(0, 1, 0)):
        self.name, self.V, self.mask = name, np.asarray(V, float), mask
        e1, e2 = self.V[:, 1] - self.V[:, 0], self.V[:, 2] - self.V[:, 0]
        self.N = unit(np.cross(e1, e2))
        self.P = self.V.reshape(-1, 1, 3)   # for bounds only

def bristle(p, direction, length, w, up=(0, 1, 0)):
    """One thin triangle standing out from p along `direction` (the flat side across `up` x direction)."""
    d = unit(direction); s = unit(np.cross(up, d)) if abs(np.dot(unit(up), d)) < .95 else unit(np.cross((1, 0, 0), d))
    p = np.asarray(p, float)
    return [p - s * w, p + s * w, p + d * length]

def export_all(parts, nd=3):
    """export() plus the Tris parts appended."""
    solid = [p for p in parts if not isinstance(p, Tris)]
    out = export(solid, nd)
    base = len(out["pos"]) // 3
    for p in parts:
        if not isinstance(p, Tris): continue
        for k in range(len(p.V)):
            for v in range(3):
                out["pos"] += [round(float(x), nd) for x in p.V[k, v]]
                out["nor"] += [round(float(x), 2) for x in p.N[k]]
                out["uv"] += [0, -1]; out["at"] += [-1, -1]
                m = np.asarray(p.mask, float); m = m / max(1e-6, m.sum())
                out["msk"] += [round(float(x), 3) for x in m]
                out["idx"].append(base); base += 1
    return out

def tri_count(parts):
    n = 0
    for p in parts:
        n += len(p.V) if isinstance(p, Tris) else 2 * (p.P.shape[0] - 1) * (p.P.shape[1] - 1)
    return n
