"""Download OSM roads / rails / small waterways (and building footprints near the two capitals).

  python3 tools/fetch_roads.py WORKDIR [--overpass]   # -> WORKDIR/osm.json (+ cached downloads)
  python3 tools/bake_roads.py src/data/roads.ts WORKDIR

Source: OpenStreetMap (ODbL, (c) OpenStreetMap contributors).

Default path (what worked in Nov 2026): the Chechen Republic extract from OpenStreetMap France,
https://download.openstreetmap.fr/extracts/russia/north_caucasian_federal_district/chechen_republic.osm.pbf
(about 11 MB, md5-checked), read with pyosmium (`pip install osmium==4.0.2`, a tool-only dependency:
use a scratch venv). overpass-api.de and download.geofabrik.de reset connections from here, and the
maps.mail.ru Overpass mirror answered one test query and then returned 504 for everything.

--overpass: the same data through Overpass instead, in 0.05 deg tiles with [timeout:25], every
response cached on disk and failures retried with exponential backoff (stdlib only).
"""
import hashlib, json, os, sys, time, urllib.parse, urllib.request

W = next((a for a in sys.argv[1:] if not a.startswith('--')), 'roads-work')
os.makedirs(W, exist_ok=True)
UA = 'VysotkaGameDev/1.0 (reference research)'
# play crop + a small margin so ribbons run off the map edge cleanly (v4: north to z = -36, central Grozny)
LON0, LON1, LAT0, LAT1 = 45.660, 46.160, 43.050, 43.338
HW = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
      'service', 'track', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road'}
RAIL = {'rail', 'abandoned', 'disused'}
WATER = {'river', 'stream', 'canal'}
# building footprints only around the two capitals (orientation reference for house placement)
BLD = {'atagi': (43.095, 45.705, 43.140, 45.765), 'kurchaloy': (43.190, 46.055, 43.225, 46.110)}
PBF = 'https://download.openstreetmap.fr/extracts/russia/north_caucasian_federal_district/chechen_republic.osm.pbf'


def get(url, fn):
    if not os.path.exists(fn):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=300) as r, open(fn + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(fn + '.part', fn)
    return fn


def keep(tags):
    return tags.get('highway') in HW or tags.get('railway') in RAIL or tags.get('waterway') in WATER


def in_box(g, s, w, n, e):
    return any(w <= lon <= e and s <= lat <= n for lon, lat in g)


def from_pbf():
    import osmium  # tool-only dependency
    fn = get(PBF, os.path.join(W, 'chechen_republic.osm.pbf'))
    md5 = os.path.join(W, 'chechen_republic.osm.pbf.md5')
    try:
        want = open(get(PBF + '.md5', md5)).read().split()[0]
        have = hashlib.md5(open(fn, 'rb').read()).hexdigest()
        if want != have:
            raise SystemExit(f'md5 mismatch {have} != {want}: delete {fn} and retry')
    except OSError:
        pass
    ways, blds = [], []
    flt = osmium.filter.KeyFilter('highway', 'railway', 'waterway', 'building')
    for o in osmium.FileProcessor(fn).with_locations().with_filter(flt):
        if not o.is_way():
            continue
        tags = {t.k: t.v for t in o.tags}
        try:
            g = [[n.location.lon, n.location.lat] for n in o.nodes]
        except osmium.InvalidLocationError:
            continue
        rec = {'id': o.id, 'tags': tags, 'nodes': [n.ref for n in o.nodes], 'g': g}
        if keep(tags) and in_box(g, LAT0, LON0, LAT1, LON1):
            ways.append(rec)
        elif 'building' in tags and any(in_box(g, *bb) for bb in BLD.values()):
            blds.append(rec)
    return ways, blds


def overpass(q, fn):
    if os.path.exists(fn):
        with open(fn) as f:
            return json.load(f)
    data = urllib.parse.urlencode({'data': q}).encode()
    delay = 4.0
    for attempt in range(8):
        try:
            req = urllib.request.Request('https://maps.mail.ru/osm/tools/overpass/api/interpreter', data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            js = json.loads(body)
            if 'runtime error' in js.get('remark', ''):
                raise RuntimeError(js['remark'][:120])
            with open(fn, 'wb') as f:
                f.write(body)
            time.sleep(1.0)
            return js
        except Exception as e:  # 429 / 504 / reset: back off and retry
            print('  retry', os.path.basename(fn), attempt, str(e)[:100], flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 90)
    raise SystemExit('giving up on ' + fn)


def tiles(lon0, lat0, lon1, lat1, step):
    y = lat0
    while y < lat1 - 1e-9:
        x = lon0
        while x < lon1 - 1e-9:
            yield (round(y, 4), round(x, 4), round(min(y + step, lat1), 4), round(min(x + step, lon1), 4))
            x += step
        y += step


def from_overpass():
    td = os.path.join(W, 'tiles')
    os.makedirs(td, exist_ok=True)
    slim = lambda el: {'id': el['id'], 'tags': el.get('tags', {}), 'nodes': el.get('nodes', []), 'g': [[p['lon'], p['lat']] for p in el['geometry']]}
    ways, blds = {}, {}
    for (s, w, n, e) in tiles(LON0, LAT0, LON1, LAT1, 0.05):
        bb = f'{s},{w},{n},{e}'
        q = f'[out:json][timeout:25];(way["highway"]({bb});way["railway"]({bb});way["waterway"]({bb}););out geom;'
        for el in overpass(q, os.path.join(td, f'r_{s}_{w}.json')).get('elements', []):
            if el.get('type') == 'way' and 'geometry' in el and keep(el.get('tags', {})):
                ways[el['id']] = slim(el)
    for (s0, w0, n0, e0) in BLD.values():
        for (s, w, n, e) in tiles(w0, s0, e0, n0, 0.02):
            q = f'[out:json][timeout:25];way["building"]({s},{w},{n},{e});out geom;'
            for el in overpass(q, os.path.join(td, f'b_{s}_{w}.json')).get('elements', []):
                if el.get('type') == 'way' and 'geometry' in el:
                    blds[el['id']] = slim(el)
    return list(ways.values()), list(blds.values())


ways, blds = from_overpass() if '--overpass' in sys.argv else from_pbf()
with open(os.path.join(W, 'osm.json'), 'w') as f:
    json.dump({'ways': ways, 'buildings': blds}, f)
print('ok', len(ways), 'ways', len(blds), 'buildings')
