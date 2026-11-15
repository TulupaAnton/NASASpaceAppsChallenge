"""Build matching Canadian map imagery and simplified official boundaries.

Build-time dependencies: numpy, pillow, pyproj, shapely.
No Python dependencies are required to run the website.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_URL = "https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0/query?" + urlencode({
    "f": "geojson", "where": "1=1", "outFields": "PRUID,PRNAME,PRENAME", "outSR": "4326",
    "returnGeometry": "true", "maxAllowableOffset": "0.005", "geometryPrecision": "5",
})
IMAGE_URL = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x21600x10800.jpg"
PROJECTION = "+proj=lcc +lat_1=49 +lat_2=77 +lat_0=63 +lon_0=-96 +R=6371000 +units=m"
ISO = {"10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC", "35": "ON", "46": "MB", "47": "SK", "48": "AB", "59": "BC", "60": "YT", "61": "NT", "62": "NU"}


def polygons(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    return [item for item in geometry.geoms if isinstance(item, Polygon)]


def rings(geometry, inverse):
    result = []
    for polygon in polygons(geometry):
        converted = transform(inverse.transform, polygon)
        result.append([[[round(x, 5), round(y, 5)] for x, y in ring.coords]
                       for ring in [converted.exterior, *converted.interiors]])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--geometry", type=Path, required=True, help="Downloaded official GeoJSON")
    parser.add_argument("--image", type=Path, required=True, help="NASA 21600x10800 July Blue Marble JPEG")
    args = parser.parse_args()
    out = ROOT / "public/countries/ca"
    out.mkdir(parents=True, exist_ok=True)
    source = json.loads(args.geometry.read_text())
    forward = Transformer.from_crs("EPSG:4326", PROJECTION, always_xy=True)
    inverse = Transformer.from_crs(PROJECTION, "EPSG:4326", always_xy=True)
    regions, shapes = [], []
    for feature in source["features"]:
        # Remove sub-pixel coastal detail and degenerate rings produced by the
        # source service's coordinate rounding before projecting the geometry.
        simplified = shape(feature["geometry"]).simplify(.008, preserve_topology=False)
        projected = transform(forward.transform, simplified).buffer(0)
        projected = MultiPolygon([p for p in polygons(projected) if p.area >= 2_000_000])
        shapes.append(projected)
        props = feature["properties"]
        regions.append({"name": props["PRENAME"], "code": "CA-" + ISO[props["PRUID"]], "polygons": rings(projected, inverse)})
        print("Prepared", props["PRENAME"], flush=True)
    country = unary_union(shapes)
    x0, y0, x1, y1 = country.bounds
    width, height = 1600, 1000
    scale = min((width - 190) / (x1 - x0), (height - 140) / (y1 - y0))
    translate = [width / 2 - (x0 + x1) / 2 * scale, height / 2 + (y0 + y1) / 2 * scale]
    projection = {"type": "lambert-conformal-conic", "width": width, "height": height,
                  "parallels": [49, 77], "latitude": 63, "longitude": -96,
                  "scale": scale * 6_371_000, "translate": translate}
    data = {"projection": projection, "regionData": regions,
            "rings": [ring for polygon in rings(country, inverse) for ring in polygon]}
    (out / "geometry.json").write_text(json.dumps(data, separators=(",", ":")))

    Image.MAX_IMAGE_PIXELS = None
    with Image.open(args.image) as image:
        image.load()
        source_width, source_height = image.size
        # Keep the western hemisphere plus a wrapped Pacific strip: the upper-left
        # map corner crosses the date line. Clamping there would smear the raster.
        wrap_width = 1200
        cropped = image.crop((-wrap_width, 0, 11000, 6000)).convert("RGB")
        cropped.paste(image.crop((source_width - wrap_width, 0, source_width, 6000)), (0, 0))
        pixels = np.asarray(cropped)
    raster_width, raster_height = 4096, 2560
    result = np.empty((raster_height, raster_width, 3), dtype=np.uint8)
    map_x = ((np.arange(raster_width) + .5) * width / raster_width - translate[0]) / scale
    for start in range(0, raster_height, 96):
        end = min(start + 96, raster_height)
        map_y = (translate[1] - (np.arange(start, end) + .5) * height / raster_height) / scale
        lon, lat = inverse.transform(*np.meshgrid(map_x, map_y))
        u = np.clip((lon + 180) / 360 * source_width + wrap_width - .5, 0, pixels.shape[1] - 1.001)
        v = np.clip((90 - lat) / 180 * source_height - .5, 0, pixels.shape[0] - 1.001)
        ix, iy = u.astype(int), v.astype(int)
        ax, ay = (u - ix)[..., None], (v - iy)[..., None]
        top = pixels[iy, ix] * (1 - ax) + pixels[iy, ix + 1] * ax
        bottom = pixels[iy + 1, ix] * (1 - ax) + pixels[iy + 1, ix + 1] * ax
        result[start:end] = np.clip(top * (1 - ay) + bottom * ay, 0, 255).astype(np.uint8)
    Image.fromarray(result).save(out / "satellite.webp", quality=90, method=6)
    sources = {
        "imagery": {"title": "NASA Blue Marble Next Generation, July 2004", "url": IMAGE_URL,
                    "credit": "NASA Earth Observatory; Reto Stöckli and Robert Simmon",
                    "sha256": hashlib.sha256(args.image.read_bytes()).hexdigest()},
        "boundaries": {"title": "Statistics Canada, 2021 Census cartographic boundaries", "url": BOUNDARY_URL,
                       "licence": "Open Government Licence – Canada", "simplification": "0.008 degrees; islands under 2 square km omitted for display"},
        "projection": projection, "purpose": "Illustrative satellite map and geographic selection; no Canadian analysis datasets included",
    }
    (out / "sources.json").write_text(json.dumps(sources, indent=2) + "\n")
    print("Built", out, "regions:", len(regions), "bytes:", (out / "geometry.json").stat().st_size, flush=True)


if __name__ == "__main__":
    main()
