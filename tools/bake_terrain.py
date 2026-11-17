"""Bake the terrain grids into src/data/terrain.ts.

  python3 tools/fetch_terrain.py WORKDIR
  python3 tools/bake_terrain.py src/data/terrain.ts WORKDIR --south src/data/terrain.ts

World frame: 1 unit = 100 m, x east, z south. The origin (x = 0, z = 0) is lon 45.665, lat 43.300 and
stays there for good: every point, place, road and save is in this frame. The grids run from
z = Z0 (v4: −36, the Grozny band north of the old map edge) to z = GH (272), x from 0 to GW (398).
All arrays are stored north row first, so row r of the height grid is z = Z0 + r.

--south FILE: take every row with z >= 0 (heights, land cover, built-up) and the village list from an
already baked terrain.ts instead of recomputing them. The sim's nav grid (and with it every flow field,
replay and save) is built from those rows, so they stay bit-identical to the pre-v4 bake (from the
pre-v4 grids: the elevation spline and the smoothing would otherwise shift them by a few cm at the
seam). Only the band z < 0 is computed here. Without --south the whole grid is computed.
"""
import numpy as np, math, zlib, base64, json, sys, re
from scipy import ndimage
from PIL import Image
args = sys.argv[1:]
SOUTH = None
if '--south' in args:
    k = args.index('--south'); SOUTH = args[k + 1]; del args[k:k + 2]
OUT = args[0]
G = (args[1] if len(args) > 1 else 'terrain-work').rstrip('/') + '/'
LON0, LON1, LAT0, LAT1 = 45.60, 46.20, 43.02, 43.36  # fetch box (fetch_terrain.py)
# play crop: the origin is (CLON0, CLAT1); CLAT0..CLAT1 fixes the metres per degree for good
CLON0, CLON1, CLAT0, CLAT1 = 45.665, 46.155, 43.055, 43.300
LATC = (CLAT0 + CLAT1) / 2
MLON = 111320 * math.cos(math.radians(LATC)); MLAT = 110950
WM = (CLON1 - CLON0) * MLON; HM = (CLAT1 - CLAT0) * MLAT
CELL = 100.0
GW = int(round(WM / CELL)); GH = int(round(HM / CELL))
Z0 = -36  # v4: the map reaches 3.6 km north of the old edge (central Grozny)
NZ = GH - Z0  # height cells north to south
print('grid', GW, NZ, 'z0', Z0, 'meters', WM, HM)
elev = np.load(G + 'elev.npy').astype(np.float64); EH, EW = elev.shape
wc = np.load(G + 'wc_crop.npy'); WH, WW = wc.shape


def sample_coords(nx, ny, cell, y0):
    xs = (np.arange(nx) + 0.5) * cell; ys = y0 + (np.arange(ny) + 0.5) * cell
    lon = CLON0 + xs / MLON; lat = CLAT1 - ys / MLAT
    return np.meshgrid(lon, lat)


# heights at vertex grid (GW+1 x NZ+1) on cell corners
vx = np.arange(GW + 1) * CELL; vy = (Z0 + np.arange(NZ + 1)) * CELL
LON, LAT = np.meshgrid(CLON0 + vx / MLON, CLAT1 - vy / MLAT)
ec = (LON - LON0) / (LON1 - LON0) * EW - 0.5; er = (LAT1 - LAT) / (LAT1 - LAT0) * EH - 0.5
H = ndimage.map_coordinates(elev, [er, ec], order=3, mode='nearest')
H = ndimage.gaussian_filter(H, 0.6)
print('h', H.min(), H.max())
# landcover at 50m
LC_CELL = 50.0; LW = int(round(WM / LC_CELL)); LH = int(round(HM / LC_CELL)); LN = int(round(-Z0 * CELL / LC_CELL))
LON2, LAT2 = sample_coords(LW, LN + LH, LC_CELL, Z0 * CELL)
# mode filter: sample 10m wc in 5x7 window around each center
cls = [10, 30, 40, 50, 60, 80, 90]
r = ((LAT1 - LAT2) / (LAT1 - LAT0) * WH).astype(int); c = ((LON2 - LON0) / (LON1 - LON0) * WW).astype(int)
counts = np.zeros((LN + LH, LW, len(cls)), np.int32)
for dy in range(-2, 3):
    for dx in range(-3, 4):
        v = wc[np.clip(r + dy, 0, WH - 1), np.clip(c + dx, 0, WW - 1)]
        for k, cl in enumerate(cls): counts[:, :, k] += (v == cl)
lc = np.array(cls)[counts.argmax(-1)]
water = counts[:, :, cls.index(80)]
lc[water >= 9] = 80
built = counts[:, :, cls.index(50)] / 35.0
# remap to small ids: 0 tree 1 grass 2 crop 3 built 4 bare 5 water 6 wetland
idmap = {10: 0, 30: 1, 40: 2, 50: 3, 60: 4, 80: 5, 90: 6}
lid = np.vectorize(idmap.get)(lc).astype(np.uint8)
# built density 0..255
bd = (np.clip(built, 0, 1) * 255).astype(np.uint8)
hq = np.round((H + 0.0) * 4).astype(np.uint16)  # quarter-meter precision


def unpack(s, dtype):
    return np.frombuffer(zlib.decompress(base64.b64decode(s)), dtype)


villages = None
if SOUTH:
    src = open(SOUTH, encoding='utf-8').read()
    meta0 = json.loads(re.search(r'TERRAIN_META = (\{.*?\}) as const', src).group(1))
    z00 = int(meta0.get('z0', 0))
    assert meta0['gw'] == GW and meta0['gh'] - z00 >= GH and meta0['lcw'] == LW, 'south file has another frame'
    h0 = unpack(re.search(r'HEIGHTS_B64 = "([^"]*)"', src).group(1), np.uint16).reshape(meta0['gh'] - z00 + 1, GW + 1)
    l0 = unpack(re.search(r'LANDCOVER_B64 = "([^"]*)"', src).group(1), np.uint8).reshape(-1, LW)
    b0 = unpack(re.search(r'BUILT_B64 = "([^"]*)"', src).group(1), np.uint8).reshape(-1, LW)
    ls0 = int(round(-z00 * CELL / LC_CELL))
    d = np.abs(hq[-Z0].astype(int) - h0[-z00].astype(int))
    print('seam row z=0: computed vs frozen, quarter-metres: max', d.max(), 'mean', round(float(d.mean()), 2))
    # ease the computed band into the frozen z = 0 row over 4 rows (no step at the old map edge)
    delta = h0[-z00].astype(np.float64) - hq[-Z0].astype(np.float64)
    for k in range(1, 5):
        if -Z0 - k >= 0:
            hq[-Z0 - k] = np.round(hq[-Z0 - k] + delta * (1 - k / 5)).astype(np.uint16)
    hq[-Z0:] = h0[-z00:-z00 + GH + 1]
    lid[LN:] = l0[ls0:ls0 + LH]
    bd[LN:] = b0[ls0:ls0 + LH]
    villages = meta0['villages']


def pack(a):
    return base64.b64encode(zlib.compress(np.ascontiguousarray(a).tobytes(), 9)).decode()


def to_world(lat, lon):
    return ((lon - CLON0) * MLON / CELL, (CLAT1 - lat) * MLAT / CELL)


Hm = hq / 4.0
meta = dict(gw=GW, gh=GH, z0=Z0, cell=CELL, lcw=LW, lch=LH, lcCell=LC_CELL,
            lon0=CLON0, lon1=CLON1, lat0=CLAT0, lat1=CLAT1, latN=round(CLAT1 - Z0 * CELL / MLAT, 5),
            hMin=float(Hm.min()), hMax=float(Hm.max()))
if villages is None:
    # villages: find built cluster nearest to given seeds, return centroid & radius (south of z = 0 only)
    bS = built[LN:] > 0.3
    lab, n = ndimage.label(ndimage.binary_closing(bS, iterations=2))
    seeds = [('atagi', 'Старые Атаги', 43.122, 45.740), ('kurchaloy', 'Курчалой', 43.206, 46.084),
             ('novatagi', 'Новые Атаги', 43.131, 45.776), ('shali', 'Шали', 43.156, 45.904),
             ('avtury', 'Автуры', 43.162, 46.004), ('tsotsi', 'Цоцин-Юрт', 43.239, 46.001),
             ('chechenaul', 'Чечен-Аул', 43.199, 45.786), ('argun', 'Аргун', 43.284, 45.872)]
    villages = []
    for key, name, la, lo in seeds:
        x, y = to_world(la, lo)
        lx, ly = int(x * CELL / LC_CELL), int(y * CELL / LC_CELL)
        L = lab[min(max(ly, 0), LH - 1), min(max(lx, 0), LW - 1)]
        if L == 0:
            d = ndimage.distance_transform_edt(lab == 0, return_indices=True)[1]
            L = lab[d[0][ly, lx], d[1][ly, lx]]
        ys, xs = np.nonzero(lab == L)
        cx, cy = (xs.mean() + 0.5) * LC_CELL / CELL, (ys.mean() + 0.5) * LC_CELL / CELL
        rad = math.sqrt(len(ys) / math.pi) * LC_CELL / CELL
        villages.append(dict(key=key, name=name, x=round(float(cx), 2), z=round(float(cy), 2), r=round(min(rad, 30), 2), cells=int(len(ys))))
for v in villages:
    print(v['key'], v['name'], v['x'], v['z'], 'r', v['r'])
meta['villages'] = villages
with open(OUT, 'w') as f:
    f.write('// Baked from AWS Terrain Tiles (elevation) and ESA WorldCover 2021 (10 m land cover).\n')
    f.write('// Area: Starye Atagi .. Kurchaloy and central Grozny (v4: z0 = -36), Chechnya. Generated by tools/bake_terrain.py — do not edit by hand.\n')
    f.write('// Grids run north to south from z = z0; rows with z >= 0 are the pre-v4 bake, unchanged (see the tool).\n')
    f.write('export const TERRAIN_META = ' + json.dumps(meta, ensure_ascii=False) + ' as const;\n')
    f.write('export const HEIGHTS_B64 = "' + pack(hq) + '";\n')
    f.write('export const LANDCOVER_B64 = "' + pack(lid) + '";\n')
    f.write('export const BUILT_B64 = "' + pack(bd) + '";\n')
# preview
pal = np.array([(52, 92, 48), (150, 160, 90), (196, 182, 120), (170, 70, 60), (160, 150, 140), (50, 110, 190), (80, 140, 150)], np.uint8)
img = pal[lid]
for v in villages:
    x, y = int(v['x'] * 2), int((v['z'] - Z0) * 2); img[max(y - 3, 0):y + 4, max(x - 3, 0):x + 4] = (255, 255, 0)
Image.fromarray(img).save(G + 'bake_preview.png')  # sanity check image
