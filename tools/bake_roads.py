"""Bake OSM roads, rails, small rivers and the capitals' building footprints into src/data/roads.ts.

  python3 tools/fetch_roads.py WORKDIR
  python3 tools/bake_roads.py src/data/roads.ts WORKDIR

World frame (same as src/data/places.ts): 1 unit = 100 m, x east, z south, crop 398 x 272,
  x = (lon - 45.665) / 0.49 * 398,  z = (43.300 - lat) / 0.245 * 272
v4: the map reaches north to z = Z0 = -36 (central Grozny); the clip box is [0, 398] x [Z0, 272] and
every stored z is z - Z0 (ROADS_META.z0), so the stream stays unsigned.

Pipeline: classify OSM ways -> split at junctions (nodes shared by 3+ way ends) -> merge chains of the
same class through plain 2-way nodes -> clip to the map -> Douglas-Peucker (junction ends kept) ->
drop crumbs -> quantise to 1/64 unit (1.6 m) -> zigzag varint deltas -> base64. Stdlib only.

Stream format (ROADS_B64): repeated [class u8][n varint][x0 (z0 - Z0) varint][dx dz zigzag varint x (n-1)].
Houses (HOUSES_B64): repeated [x u16le][(z - Z0) u16le][yaw u8 (0..pi)][w u8][d u8] (cm of a unit... /100).
"""
import base64, json, math, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/data/roads.ts'
WD = (sys.argv[2] if len(sys.argv) > 2 else 'roads-work').rstrip('/')
MW, MH = 398.0, 272.0
Z0 = -36.0  # north edge (v4)
Q = 64  # quantisation steps per unit

wx = lambda lon: (lon - 45.665) / 0.49 * 398
wz = lambda lat: (43.300 - lat) / 0.245 * 272

# class ids (keep in step with src/render/roads.ts)
MAIN, ROAD, STREET, TRACK, RAIL, RIVER, STREAM = range(7)
NAMES = ['main', 'road', 'street', 'track', 'rail', 'river', 'stream']
# ramps and roundabouts are drawn as plain (no centre line) roads: their dashes only clutter the junctions
HW = {'motorway': MAIN, 'motorway_link': ROAD, 'trunk': MAIN, 'trunk_link': ROAD, 'primary': MAIN, 'primary_link': ROAD,
      'secondary': MAIN, 'secondary_link': ROAD, 'tertiary': ROAD, 'tertiary_link': ROAD,
      'residential': STREET, 'living_street': STREET, 'unclassified': STREET, 'road': STREET, 'track': TRACK}
GROUP = [0, 0, 0, 0, 1, 2, 2]  # junctions are counted inside a group: roads, rails, water
TOL = [0.06, 0.08, 0.1, 0.14, 0.08, 0.14, 0.14]  # Douglas-Peucker tolerance, units
MINLEN = [0.0, 0.3, 0.45, 0.8, 0.5, 0.6, 0.8]  # isolated crumbs shorter than this are dropped


def cls_of(tags):
    if tags.get('area') == 'yes':
        return None
    if 'highway' in tags:
        c = HW.get(tags['highway'])
        return ROAD if c == MAIN and tags.get('junction') in ('roundabout', 'circular') else c
    if tags.get('railway') == 'rail' and tags.get('service') not in ('yard', 'siding', 'crossover'):
        return RAIL
    w = tags.get('waterway')
    if w == 'river':
        return RIVER
    if w in ('stream', 'canal'):
        return STREAM
    return None


data = json.load(open(WD + '/osm.json'))
ways = []
for w in data['ways']:
    c = cls_of(w['tags'])
    if c is None or len(w['g']) < 2:
        continue
    ways.append((c, w['nodes'], [(wx(lon), wz(lat)) for lon, lat in w['g']]))

# ---- junctions: node usage per group (way ends count 1, interior nodes 2) ----
deg = {}
for c, nodes, _ in ways:
    g = GROUP[c]
    for k, n in enumerate(nodes):
        key = (g, n)
        deg[key] = deg.get(key, 0) + (1 if k in (0, len(nodes) - 1) else 2)

# split at interior junctions
edges = []  # [cls, nodes, pts]
for c, nodes, pts in ways:
    g = GROUP[c]
    s = 0
    for k in range(1, len(nodes)):
        if k == len(nodes) - 1 or deg[(g, nodes[k])] >= 3:
            edges.append([c, nodes[s:k + 1], pts[s:k + 1]])
            s = k

# merge chains of one class through nodes where exactly two edge ends meet
ends = {}
for i, (c, nodes, _) in enumerate(edges):
    for n in (nodes[0], nodes[-1]):
        ends.setdefault((GROUP[c], n), []).append(i)
alive = [True] * len(edges)
for key, lst in ends.items():
    if len(lst) != 2 or deg[key] != 2:
        continue
    a, b = lst
    if a == b or not alive[a] or not alive[b] or edges[a][0] != edges[b][0]:
        continue
    ea, eb = edges[a], edges[b]
    n = key[1]
    if ea[1][-1] != n:
        ea[1].reverse(); ea[2].reverse()
    if eb[1][0] != n:
        eb[1].reverse(); eb[2].reverse()
    if ea[1][-1] != n or eb[1][0] != n:
        continue
    ea[1] = ea[1] + eb[1][1:]
    ea[2] = ea[2] + eb[2][1:]
    alive[b] = False
    # b's far end now belongs to a
    far = (key[0], ea[1][-1])
    ends[far] = [a if i == b else i for i in ends[far]]
chains = [(e[0], e[2]) for i, e in enumerate(edges) if alive[i]]


# ---- clip to the map ----
def clip_seg(p, q):
    """Liang-Barsky against [0,MW] x [Z0,MH]; returns (t0, t1) or None."""
    t0, t1 = 0.0, 1.0
    dx, dz = q[0] - p[0], q[1] - p[1]
    for pp, qq in ((-dx, p[0]), (dx, MW - p[0]), (-dz, p[1] - Z0), (dz, MH - p[1])):
        if pp == 0:
            if qq < 0:
                return None
            continue
        r = qq / pp
        if pp < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    return (t0, t1)


def clip(pts):
    out, cur = [], []
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        r = clip_seg(p, q)
        if r is None:
            if len(cur) > 1:
                out.append(cur)
            cur = []
            continue
        a = (p[0] + (q[0] - p[0]) * r[0], p[1] + (q[1] - p[1]) * r[0])
        b = (p[0] + (q[0] - p[0]) * r[1], p[1] + (q[1] - p[1]) * r[1])
        if not cur:
            cur = [a]
        cur.append(b)
        if r[1] < 1.0:
            out.append(cur)
            cur = []
    if len(cur) > 1:
        out.append(cur)
    return out


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, az = pts[i]; bx, bz = pts[j]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz) or 1e-9
        best, bk = -1.0, -1
        for k in range(i + 1, j):
            px, pz = pts[k]
            d = abs((px - ax) * dz - (pz - az) * dx) / L
            if d > best:
                best, bk = d, k
        if best > tol:
            keep[bk] = True
            stack.append((i, bk)); stack.append((bk, j))
    return [p for p, k in zip(pts, keep) if k]


def length(p):
    return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))


polys = []
for c, pts in chains:
    for piece in clip(pts):
        s = dp(piece, TOL[c])
        if length(s) < MINLEN[c]:
            continue
        polys.append((c, s))
polys.sort(key=lambda a: a[0])


# ---- encode ----
def varint(v, out):
    while True:
        b = v & 0x7f
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            return


def zz(v):
    return (v << 1) if v >= 0 else ((-v) << 1) - 1


buf = bytearray()
nv = 0
stats = {}
for c, pts in polys:
    qp = [(max(0, min(int(MW * Q), round(x * Q))), max(0, min(int((MH - Z0) * Q), round((z - Z0) * Q)))) for x, z in pts]
    # drop repeated points after quantisation
    qq = [qp[0]] + [p for i, p in enumerate(qp[1:], 1) if p != qp[i - 1]]
    if len(qq) < 2:
        continue
    buf.append(c)
    varint(len(qq), buf)
    varint(qq[0][0], buf); varint(qq[0][1], buf)
    for i in range(1, len(qq)):
        varint(zz(qq[i][0] - qq[i - 1][0]), buf); varint(zz(qq[i][1] - qq[i - 1][1]), buf)
    nv += len(qq)
    s = stats.setdefault(NAMES[c], [0, 0, 0.0])
    s[0] += 1; s[1] += len(qq); s[2] += length(pts)


# ---- building footprints (Старые Атаги, Курчалой): centre, heading, size ----
def min_rect(pts):
    """Smallest-area bounding rectangle over the hull edges: (cx, cz, yaw, w, d) with w >= d."""
    best = None
    n = len(pts)
    for i in range(n):
        ax, az = pts[i]; bx, bz = pts[(i + 1) % n]
        a = math.atan2(bz - az, bx - ax)
        ca, sa = math.cos(a), math.sin(a)
        us = [x * ca + z * sa for x, z in pts]; vs = [-x * sa + z * ca for x, z in pts]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * d < best[0]:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (w * d, cu * ca - cv * sa, cu * sa + cv * ca, a, w, d)
    _, cx, cz, a, w, d = best
    if d > w:
        w, d, a = d, w, a + math.pi / 2
    # heading of the long side as a three.js rotation.y: local +x maps to (cos ry, -sin ry)
    ry = (-a) % math.pi
    return cx, cz, ry, w, d


hb = bytearray()
nh = 0
for b in data['buildings']:
    g = [(wx(lon), wz(lat)) for lon, lat in b['g']]
    if len(g) < 4:
        continue
    if g[0] == g[-1]:
        g = g[:-1]
    cx, cz, ry, w, d = min_rect(g)
    area = w * d
    if area < 0.004 or area > 0.25 or not (0 < cx < MW and Z0 < cz < MH):
        continue  # sheds and big public buildings stay out: houses only
    hb += int(round(cx * Q)).to_bytes(2, 'little') + int(round((cz - Z0) * Q)).to_bytes(2, 'little')
    hb += bytes([int(round(ry / math.pi * 255)) % 256, min(255, int(round(w * 100))), min(255, int(round(d * 100)))])
    nh += 1

r64 = base64.b64encode(bytes(buf)).decode()
h64 = base64.b64encode(bytes(hb)).decode()
meta = {'q': Q, 'z0': int(Z0), 'classes': NAMES, 'polylines': len(polys), 'vertices': nv, 'houses': nh}
with open(OUT, 'w') as f:
    f.write('// Baked from OpenStreetMap (ODbL, (c) OpenStreetMap contributors): roads, rails, small rivers and\n'
            '// house footprints of Старые Атаги and Курчалой; v4: central Grozny up to z = -36. Generated by tools/bake_roads.py — do not edit by hand.\n'
            '// Format: see tools/bake_roads.py (zigzag varint deltas at 1/64 unit, decoded by src/render/roads.ts).\n')
    f.write('export const ROADS_META = ' + json.dumps(meta, ensure_ascii=False) + ' as const;\n')
    f.write('export const ROADS_B64 = "' + r64 + '";\n')
    f.write('export const HOUSES_B64 = "' + h64 + '";\n')
for k, v in stats.items():
    print(f'{k:7s} {v[0]:5d} lines {v[1]:6d} verts {v[2]:8.1f} units')
print('polylines', len(polys), 'vertices', nv, 'bytes', len(buf), 'b64', len(r64), 'houses', nh, 'b64', len(h64))
