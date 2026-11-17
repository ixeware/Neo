"""Download + crop the real terrain data used by the game.

  python3 tools/fetch_terrain.py WORKDIR      # tiles + WorldCover -> WORKDIR/*.npy
  python3 tools/bake_terrain.py src/data/terrain.ts WORKDIR --south src/data/terrain.ts

Sources: AWS Terrain Tiles (terrarium, z12) and ESA WorldCover 2021 v200 (10 m).
Needs: numpy, pillow, scipy, tifffile, imagecodecs.

v4 (Грозный): the box reaches north to 43.36 so the map can grow to z = −36 (central Grozny). The
elevation grid keeps the old pitch (0.3° / 360 rows), so its bottom 360 rows are exactly the pre-v4
grid (LAT1 = 43.32) and only 48 rows are new on top. The WorldCover crop is aligned to the tile's
own 1/12000° pixels, so extending LAT1 only adds rows above the old crop.
"""
import math, os, sys, urllib.request, glob, re
import numpy as np
from PIL import Image
from scipy import ndimage
import tifffile

W = sys.argv[1] if len(sys.argv) > 1 else 'terrain-work'
os.makedirs(os.path.join(W, 'raw'), exist_ok=True)
LON0, LON1, LAT0, LAT1 = 45.60, 46.20, 43.02, 43.36
Z = 12
# rows / columns of the equirectangular elevation grid (same pitch as before v4: 0.3° / 360, 0.6° / 720)
EH, EW = 408, 720

def tile(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

x0, y0 = tile(LON0, LAT1, Z); x1, y1 = tile(LON1, LAT0, Z)
for x in range(int(x0), int(x1) + 1):
    for y in range(int(y0), int(y1) + 1):
        fn = os.path.join(W, 'raw', f't_{Z}_{x}_{y}.png')
        if not os.path.exists(fn):
            urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', fn)

wc_path = os.path.join(W, 'raw', 'wc.tif')
if not os.path.exists(wc_path):
    urllib.request.urlretrieve('https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42E045_Map.tif', wc_path)

# elevation mosaic -> EW x EH equirectangular grid
n = 2 ** Z
tiles = {}
for f in glob.glob(os.path.join(W, 'raw', f't_{Z}_*.png')):
    x, y = map(int, re.findall(r't_\d+_(\d+)_(\d+)', f)[0])
    tiles[(x, y)] = np.asarray(Image.open(f).convert('RGB')).astype(np.float64)
xs = sorted({k[0] for k in tiles}); ys = sorted({k[1] for k in tiles})
mos = np.zeros((len(ys) * 256, len(xs) * 256))
for (x, y), a in tiles.items():
    mos[(y - ys[0]) * 256:(y - ys[0] + 1) * 256, (x - xs[0]) * 256:(x - xs[0] + 1) * 256] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
lats = LAT1 - (np.arange(EH) + 0.5) / EH * (LAT1 - LAT0)
lons = LON0 + (np.arange(EW) + 0.5) / EW * (LON1 - LON0)
px = ((lons + 180) / 360 * n - xs[0]) * 256
py = ((1 - np.arcsinh(np.tan(np.radians(lats))) / math.pi) / 2 * n - ys[0]) * 256
PX, PY = np.meshgrid(px, py)
np.save(os.path.join(W, 'elev.npy'), ndimage.map_coordinates(mos, [PY - 0.5, PX - 0.5], order=1).astype(np.float32))

# WorldCover crop (tile covers 42..45N, 45..48E at 1/12000 deg)
tf = tifffile.TiffFile(wc_path); p = tf.pages[0]; T = p.tilewidth; ntx = (p.imagewidth + T - 1) // T
r0 = int(round((45 - LAT1) * 12000)); r1 = int(round((45 - LAT0) * 12000)); c0 = int(round((LON0 - 45) * 12000)); c1 = int(round((LON1 - 45) * 12000))
out = np.zeros((r1 - r0, c1 - c0), np.uint8)
for ty in range(r0 // T, (r1 - 1) // T + 1):
    for tx in range(c0 // T, (c1 - 1) // T + 1):
        i = ty * ntx + tx
        tf.filehandle.seek(p.dataoffsets[i]); seg = p.decode(tf.filehandle.read(p.databytecounts[i]), i)[0].reshape(T, T)
        a0 = max(r0, ty * T); a1 = min(r1, ty * T + T); b0 = max(c0, tx * T); b1 = min(c1, tx * T + T)
        out[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = seg[a0 - ty * T:a1 - ty * T, b0 - tx * T:b1 - tx * T]
np.save(os.path.join(W, 'wc_crop.npy'), out)
print('ok', W)
