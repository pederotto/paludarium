"""Guppy (Poecilia reticulata) anatomy for the Blender build (build.py): the measured targets as data, and pure functions that turn
them into points. No bpy here, so the numbers can be checked and printed on their own:  python3 art-src/guppy/anatomy.py

Frame: centimetres; the fish lies along +Y with the snout at y = 0 and the end of the tail stalk (the hypural joint) at y = SL;
+Z is up, X is to the fish's left. (glTF export turns this into the game's frame: head toward +z, y up.)

Targets (sources in docs/GENETICS_SPEC.md "guppy", the run log in .agents/guppy/STATE.md):
  body depth 23-29 % SL, head 24-30 % SL                         plazi, Poecilia reticulata Peters 1859 (depth 3.4-4.4, head 3.3-4.1 in SL)
  dorsal 7-8 (8-9) soft rays, anal 8-10, pectoral 13-14, pelvic 6  FishBase; Fishes of Texas
  26-28 scales along the side, 8-9 rows across                    Fishes of Texas
  males about half the size of females; the female's dark "gravid" triangle between the pelvic and anal fins   FishBase
  male anal fin = gonopodium (rays 3-5 lengthened into a rod)      FishBase
  delta tail spread 70 deg, ~3/4 SL long; veil 45 deg ~1 SL       IFGA standard as quoted by breeders
  GUESSES (marked): 30 vertebrae (13 abdominal + 17 caudal), 16 principal caudal rays, eye 10.5 % SL, show male SL 2.2 cm,
  female SL 3.2 cm, positions of fin origins read off the owner's reference sheets.
"""
import math

def lerp(a, b, t): return a + (b - a) * t
def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

def hermite(pts):
    """Cubic Hermite through [(s, v), ...] with Catmull-Rom tangents; flat beyond the ends."""
    n = len(pts)
    m = []
    for i in range(n):
        a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
        m.append(0.0 if b[0] == a[0] else (b[1] - a[1]) / (b[0] - a[0]))
    def f(s):
        if s <= pts[0][0]: return pts[0][1]
        if s >= pts[-1][0]: return pts[-1][1]
        i = 0
        while s > pts[i + 1][0]: i += 1
        h = pts[i + 1][0] - pts[i][0]; t = (s - pts[i][0]) / h; t2 = t * t; t3 = t2 * t
        return (2*t3 - 3*t2 + 1) * pts[i][1] + (t3 - 2*t2 + t) * h * m[i] + (-2*t3 + 3*t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1]
    return f

# ---- Body profiles (fractions of SL): s, top, bottom, half width, cross-section exponent (1 = oval; > 1 keeled edges) ----------
# Male: a straight back, the deepest point (25.8 % SL) over the pelvic fins, a long deep stalk (14 % SL) as in fancy males, the
# mouth at the top of the snout (guppies feed at the surface).
MALE = [
    (0.000, 0.022, 0.006, 0.012, 0.9),
    (0.020, 0.040, -0.018, 0.028, 0.9),
    (0.050, 0.066, -0.044, 0.044, 0.9),
    (0.100, 0.088, -0.072, 0.057, 0.95),
    (0.170, 0.104, -0.098, 0.064, 1.0),
    (0.240, 0.113, -0.117, 0.067, 1.0),
    (0.320, 0.118, -0.132, 0.067, 1.0),
    (0.400, 0.120, -0.138, 0.065, 1.05),
    (0.480, 0.117, -0.129, 0.060, 1.1),
    (0.560, 0.110, -0.111, 0.053, 1.15),
    (0.640, 0.100, -0.093, 0.045, 1.25),
    (0.720, 0.090, -0.080, 0.037, 1.35),
    (0.800, 0.082, -0.072, 0.030, 1.45),
    (0.880, 0.076, -0.067, 0.025, 1.5),
    (0.950, 0.076, -0.067, 0.021, 1.5),
    (1.000, 0.079, -0.070, 0.017, 1.5),
]
# Female: the same head, a deeper rounder belly (30 % SL) and a shorter stalk; `gravid` adds a brood (35 % SL).
FEMALE = [
    (0.000, 0.022, 0.006, 0.012, 0.9),
    (0.020, 0.040, -0.018, 0.028, 0.9),
    (0.050, 0.066, -0.046, 0.045, 0.9),
    (0.100, 0.090, -0.078, 0.059, 0.95),
    (0.170, 0.108, -0.108, 0.067, 1.0),
    (0.240, 0.119, -0.132, 0.071, 1.0),
    (0.320, 0.126, -0.152, 0.073, 1.0),
    (0.400, 0.130, -0.165, 0.073, 1.0),
    (0.480, 0.129, -0.166, 0.071, 1.0),
    (0.560, 0.122, -0.150, 0.065, 1.05),
    (0.640, 0.110, -0.120, 0.055, 1.15),
    (0.720, 0.097, -0.096, 0.045, 1.3),
    (0.800, 0.086, -0.080, 0.036, 1.4),
    (0.880, 0.078, -0.070, 0.028, 1.5),
    (0.950, 0.075, -0.066, 0.022, 1.5),
    (1.000, 0.077, -0.068, 0.018, 1.5),
]
GRAVID_BELLY = [(0.22, 0.0), (0.32, 0.018), (0.42, 0.034), (0.52, 0.036), (0.60, 0.022), (0.68, 0.006), (0.74, 0.0)]

SL = {'male': 2.2, 'female': 3.2}
EYE = dict(s=0.105, up=0.30, r=0.0525, sink=0.86)      # centre at s, `up` of the half depth above the midline, radius (all × SL)

class Body:
    """Profiles of one body: top(s), bot(s), wid(s), exp(s), each in cm."""
    def __init__(self, sex='male', gravid=False):
        self.sex = sex; self.L = SL['female' if sex != 'male' else 'male']
        P = MALE if sex == 'male' else FEMALE
        g = hermite(GRAVID_BELLY) if gravid else (lambda s: 0.0)
        self._t = hermite([(p[0], p[1]) for p in P]); self._b = hermite([(p[0], p[2]) for p in P])
        self._w = hermite([(p[0], p[3]) for p in P]); self._e = hermite([(p[0], p[4]) for p in P]); self._g = g
    def top(self, s): return self._t(s) * self.L
    def bot(self, s): return (self._b(s) - self._g(s)) * self.L
    def wid(self, s): return (self._w(s) + 0.25 * self._g(s)) * self.L
    def exp(self, s): return self._e(s)
    def mid(self, s): return 0.5 * (self.top(s) + self.bot(s))
    # The widest line of a section sits a little above the middle in front (the gut below), at the middle on the stalk.
    def zw(self, s): return lerp(self.bot(s), self.top(s), lerp(0.56, 0.5, smooth(0.3, 0.9, s)))
    def ring(self, s, th):
        """The skin point at station s and angle th (0 dorsal midline, pi ventral; positive x side). Returns (x, y, z)."""
        zt, zb, zw, w, e = self.top(s), self.bot(s), self.zw(s), self.wid(s), self.exp(s)
        c = math.cos(th); sn = math.sin(th)
        z = zw + (zt - zw) * c if c >= 0 else zw + (zw - zb) * c
        # a slightly fuller upper flank in front of the dorsal fin, a keel at the edges on the stalk
        x = w * (abs(sn) ** e) * (1 if sn >= 0 else -1)
        return (x, s * self.L, z)
    def col(self, s):
        """Height of the vertebral column (cm): about 60 % up the section in the trunk, at the middle on the stalk (guess)."""
        return lerp(self.bot(s), self.top(s), lerp(0.62, 0.52, smooth(0.35, 0.95, s)))

# ---- Skeleton ------------------------------------------------------------------------------------------------------------------
N_VERT, N_ABD = 30, 13              # GUESS: poeciliids carry about 28-32 vertebrae
COL_FROM, COL_TO = 0.235, 0.965     # first centrum behind the skull … last before the hypural plate (s)

def vertebrae(b):
    """[(s0, s1, radius cm, abdominal?)] for each centrum."""
    out = []
    for i in range(N_VERT):
        s0 = lerp(COL_FROM, COL_TO, i / N_VERT); s1 = lerp(COL_FROM, COL_TO, (i + 1) / N_VERT)
        r = lerp(0.019, 0.012, i / (N_VERT - 1)) * b.L
        out.append((s0, s1, r, i < N_ABD))
    return out

# ---- Fins: rays from their bases, in the fin's own plane -------------------------------------------------------------------------
# Every fin is a list of rays; a ray is a base point (s along the body, at the body's edge) and a 2D polyline in the fin plane
# (u: back along the body for a median fin, w: up for the dorsal, down for the anal, along the spread for the tail). The membrane is
# stretched between neighbouring rays; its edge between two tips is pulled in by `notch` (a feathered edge).

def ray_curve(ang, length, bend=0.0, n=9):
    """A ray leaving its base at angle `ang` (radians, from the fin's u axis), `length` long, curving by `bend` (radians over its length)."""
    pts = [(0.0, 0.0)]; a = ang; d = length / (n - 1); x = y = 0.0
    for i in range(1, n):
        x += math.cos(a) * d; y += math.sin(a) * d; a += bend / (n - 1); pts.append((x, y))
    return pts

TAILS = ('delta', 'fan', 'round', 'doublesword', 'lyre')

def caudal(b, tail, female=False, juv=False):
    """The tail fin: 16 principal rays (GUESS) and 3 procurrent rays above and below. Returns dict(rays=[(base_z, pts2d)], notch).
    base_z: height of the ray's base on the hypural plate (cm); pts2d: (u back along the axis, w up) from that base."""
    L = b.L; h = 0.5 * (b.top(0.99) - b.bot(0.99)) * 0.82
    n = 16
    rays = []
    def principal(spread_deg, length_of, bend=0.0):
        for i in range(n):
            t = i / (n - 1) * 2 - 1                                       # -1 lowest … +1 highest
            ang = math.radians(spread_deg / 2) * t
            rays.append((t * h * 0.9, ray_curve(ang, length_of(t, ang), bend * t)))
    if female or juv:
        k = 0.30 if juv else {'delta': 0.45, 'fan': 0.38}.get(tail, 0.33)
        spread = 56 if tail == 'delta' and not juv else 50
        principal(spread, lambda t, a: k * L * (1 + 0.1 * (1 - t * t)) / max(math.cos(a), 0.6), 0.05)
        notch = 0.035
    elif tail == 'delta':
        # a straight trailing edge square to the axis, bulging a little in the middle (show standard: 70 deg, ~3/4 SL)
        principal(70, lambda t, a: 0.78 * L * (1 + 0.035 * (1 - t * t)) / math.cos(a), 0.0)
        notch = 0.007
    elif tail == 'fan':
        principal(48, lambda t, a: 0.66 * L * (1 + 0.14 * (1 - t * t)) / math.cos(a), 0.02)
        notch = 0.008
    elif tail == 'round':
        principal(110, lambda t, a: 0.34 * L * (1 - 0.18 * t * t), 0.0)
        notch = 0.04
    elif tail == 'lyre':
        # the outer rays drawn out into points, the middle ones short: a concave edge
        principal(56, lambda t, a: L * (0.42 + 0.46 * abs(t) ** 2.2), -0.12)
        notch = 0.03
    else:  # doublesword: a short rounded fan with the top and bottom three rays drawn out into blades
        for i in range(n):
            t = i / (n - 1) * 2 - 1
            if abs(t) > 0.72:                                             # sword rays: near the axis, very long
                ang = math.radians(9 + 7 * (abs(t) - 0.72) / 0.28) * (1 if t > 0 else -1)
                ln = L * (0.86 - 0.14 * (1 - abs(t)) / 0.28)
            else:
                ang = math.radians(48) * (t / 0.72); ln = 0.27 * L * (1 - 0.2 * (t / 0.72) ** 2)
            rays.append((t * h * 0.9, ray_curve(ang, ln, -0.05 * t)))
        rays.sort(key=lambda r: r[0])
        notch = 0.04
    # procurrent rays: short, close against the stalk above and below
    for sd in (1, -1):
        for j in range(3):
            rays.append((sd * (h * 0.95 + 0.012 * L * (j + 1)), ray_curve(math.radians(-sd * (12 + 8 * j)) * -1, (0.07 - 0.018 * j) * L)))
    rays.sort(key=lambda r: r[0])
    return dict(rays=rays, notch=notch)

def dorsal(b, sex, tail='delta', juv=False):
    """Dorsal fin: 8 rays on the back. A male's is a flag laid back over the stalk (longest in delta lines); a female's small and round.
    Returns dict(rays=[(s, pts2d)], notch) with u back along the body, w up."""
    L = b.L; rays = []
    if sex == 'male' and not juv:
        k = {'delta': 1.0, 'fan': 0.85, 'lyre': 0.9, 'round': 0.62, 'doublesword': 0.7}[tail]
        for i in range(8):
            t = i / 7
            s = lerp(0.53, 0.665, t)
            ang = math.radians(lerp(62, 22, t ** 0.8))
            ln = L * lerp(0.17, 0.45 * k + 0.05, t ** 1.4)
            rays.append((s, ray_curve(ang, ln, -0.18)))
        notch = 0.02
    else:
        for i in range(8):
            t = i / 7
            s = lerp(0.57, 0.67, t)
            rays.append((s, ray_curve(math.radians(lerp(72, 38, t)), L * lerp(0.12, 0.085, t) * (1 + 0.25 * math.sin(t * math.pi)), -0.25)))
        notch = 0.05
    return dict(rays=rays, notch=notch)

def anal(b):
    """A female's anal fin: 9 rays under the belly behind the gravid spot, pointing down and back (u back, w down)."""
    L = b.L; rays = []
    for i in range(9):
        t = i / 8
        rays.append((lerp(0.605, 0.70, t), ray_curve(math.radians(lerp(70, 32, t)), L * lerp(0.125, 0.07, t) * (1 + 0.3 * math.sin(t * math.pi)), -0.2)))
    return dict(rays=rays, notch=0.05)

def gonopodium(b):
    """The male's gonopodium: anal-fin rays 3-5 lengthened into a rod 30 % SL long, held back along the belly, a hook at the tip.
    Returns (base s, polyline of (u back, w down), radius at base, radius at tip) and the short rays around its base."""
    L = b.L
    rod = [(0, 0), (0.06 * L, 0.025 * L), (0.14 * L, 0.045 * L), (0.22 * L, 0.055 * L), (0.29 * L, 0.06 * L), (0.30 * L, 0.052 * L)]
    short = [(lerp(0.415, 0.47, i / 5), ray_curve(math.radians(lerp(60, 30, i / 5)), L * 0.05, -0.1)) for i in range(6)]
    return dict(s=0.42, rod=rod, r0=0.012 * L, r1=0.005 * L, short=short)

def pectoral(b, dumbo=False):
    """13 rays fanned from the base behind the gill cover; a big-ear fish's fan is twice as long and wider (u back, w down the fan)."""
    L = b.L; rays = []
    big = 2.1 if dumbo else 1.0
    spread = 95 if dumbo else 55
    for i in range(13):
        t = i / 12
        ang = math.radians(-spread / 2 + spread * t)
        rays.append((t, ray_curve(ang, L * 0.165 * big * (1 - 0.35 * (2 * t - 1) ** 2 if not dumbo else 1 - 0.22 * (2 * t - 1) ** 2), 0.05)))
    return dict(s=0.255, rays=rays, notch=0.02, base=0.03 * L)

def pelvic(b, sex):
    L = b.L; s = 0.395 if sex == 'male' else 0.44
    rays = [(i / 5, ray_curve(math.radians(lerp(-18, 12, i / 5)), L * 0.10 * (1 - 0.3 * abs(i / 5 - 0.35)), 0.0)) for i in range(6)]
    return dict(s=s, rays=rays, notch=0.05, base=0.02 * L)

if __name__ == '__main__':
    for sex, gv in (('male', False), ('female', False), ('female', True)):
        b = Body(sex, gv)
        depth = max(b.top(s / 100) - b.bot(s / 100) for s in range(20, 60))
        stalk = min(b.top(s / 100) - b.bot(s / 100) for s in range(85, 98))
        print(f"{sex}{' gravid' if gv else ''}: SL {b.L} cm, depth {100 * depth / b.L:.1f} % SL, stalk {100 * stalk / b.L:.1f} % SL, "
              f"width {100 * 2 * max(b.wid(s / 100) for s in range(0, 100)) / b.L:.1f} % SL, eye {100 * 2 * EYE['r']:.1f} % SL")
    m = Body('male')
    for t in TAILS:
        c = caudal(m, t)
        tips = [r[1][-1] for r in c['rays']]
        print(f"male {t}: {len(c['rays'])} rays, length {max(p[0] for p in tips) / m.L:.2f} SL, height {(max(p[1] + r[0] for p, r in zip(tips, c['rays'])) - min(p[1] + r[0] for p, r in zip(tips, c['rays']))) / m.L:.2f} SL")
