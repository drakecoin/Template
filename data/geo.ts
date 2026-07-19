/** Shared geometry helpers for ETL sources. */

/** Ramer–Douglas–Peucker simplification on [lng, lat] pairs (planar, fine at city scale). */
export function simplify(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 4) return ring;
  const sqTol = tolerance * tolerance;
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxSq = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(ring[i], ring[first], ring[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (maxSq > sqTol) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function sqSegDist(p: number[], a: number[], b: number[]): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

export interface GeoFeature {
  type: string;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

export interface GeoFeatureCollection {
  type: string;
  features: GeoFeature[];
}

/** Outer rings of a Polygon or MultiPolygon feature, as [lng, lat] pairs. */
export function outerRings(f: GeoFeature): number[][][] {
  if (f.geometry.type === "Polygon") return [(f.geometry.coordinates as number[][][])[0]];
  if (f.geometry.type === "MultiPolygon")
    return (f.geometry.coordinates as number[][][][]).map((poly) => poly[0]);
  return [];
}

/** Simplify a [lng, lat] ring and convert to rounded [lat, lng]. */
export function toLatLngRing(ring: number[][], tolerance: number): number[][] {
  return simplify(ring, tolerance).map(([lng, lat]) => [
    Math.round(lat * 1e5) / 1e5,
    Math.round(lng * 1e5) / 1e5,
  ]);
}

/**
 * Convert an Ordnance Survey National Grid easting/northing (EPSG:27700,
 * OSGB36 / Airy 1830) to WGS84 [lng, lat]. Inverse Transverse Mercator followed
 * by a 7-parameter Helmert datum shift — accurate to a few metres (no OSTN15
 * grid), which is well within our ~20 m polygon-simplification tolerance.
 * Needed for iShare/MapServer WFS layers that only serve their native BNG SRS.
 */
export function osgb36ToWgs84(easting: number, northing: number): [number, number] {
  // Airy 1830 ellipsoid + National Grid projection constants
  const a = 6377563.396;
  const b = 6356256.909;
  const f0 = 0.9996012717;
  const lat0 = (49 * Math.PI) / 180;
  const lon0 = (-2 * Math.PI) / 180;
  const n0 = -100000;
  const e0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;

  let lat = lat0;
  let m = 0;
  do {
    lat = (northing - n0 - m) / (a * f0) + lat;
    const dm = lat - lat0;
    const sm = lat + lat0;
    m =
      b *
      f0 *
      ((1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dm -
        (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dm) * Math.cos(sm) +
        ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dm) * Math.cos(2 * sm) -
        (35 / 24) * n3 * Math.sin(3 * dm) * Math.cos(3 * sm));
  } while (Math.abs(northing - n0 - m) >= 0.00001);

  const sinLat = Math.sin(lat);
  const nu = (a * f0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * f0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const t = Math.tan(lat);
  const t2 = t * t;
  const t4 = t2 * t2;
  const t6 = t4 * t2;
  const sec = 1 / Math.cos(lat);
  const vii = t / (2 * rho * nu);
  const viii = (t / (24 * rho * Math.pow(nu, 3))) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const ix = (t / (720 * rho * Math.pow(nu, 5))) * (61 + 90 * t2 + 45 * t4);
  const x = sec / nu;
  const xi = (sec / (6 * Math.pow(nu, 3))) * (nu / rho + 2 * t2);
  const xii = (sec / (120 * Math.pow(nu, 5))) * (5 + 28 * t2 + 24 * t4);
  const xiia = (sec / (5040 * Math.pow(nu, 7))) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
  const de = easting - e0;
  const de2 = de * de;

  let latA = lat - vii * de2 + viii * de2 * de2 - ix * de2 * de2 * de2;
  let lonA = lon0 + x * de - xi * de2 * de + xii * de2 * de2 * de - xiia * de2 * de2 * de2 * de;

  // OSGB36 (Airy) geodetic -> cartesian
  const sinA = Math.sin(latA);
  const cosA = Math.cos(latA);
  const nuA = a / Math.sqrt(1 - e2 * sinA * sinA);
  const xA = nuA * cosA * Math.cos(lonA);
  const yA = nuA * cosA * Math.sin(lonA);
  const zA = (1 - e2) * nuA * sinA;

  // Helmert OSGB36 -> WGS84
  const tx = 446.448;
  const ty = -125.157;
  const tz = 542.06;
  const s = -20.4894e-6;
  const rx = (0.1502 / 3600) * (Math.PI / 180);
  const ry = (0.247 / 3600) * (Math.PI / 180);
  const rz = (0.8421 / 3600) * (Math.PI / 180);
  const xW = tx + (1 + s) * (xA - rz * yA + ry * zA);
  const yW = ty + (1 + s) * (rz * xA + yA - rx * zA);
  const zW = tz + (1 + s) * (-ry * xA + rx * yA + zA);

  // WGS84 cartesian -> geodetic
  const aW = 6378137.0;
  const bW = 6356752.3142;
  const e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.sqrt(xW * xW + yW * yW);
  let latW = Math.atan2(zW, p * (1 - e2W));
  for (let i = 0; i < 8; i++) {
    const sinW = Math.sin(latW);
    const nuW = aW / Math.sqrt(1 - e2W * sinW * sinW);
    latW = Math.atan2(zW + e2W * nuW * sinW, p);
  }
  const lonW = Math.atan2(yW, xW);
  const deg = 180 / Math.PI;
  return [lonW * deg, latW * deg];
}

/** Centroid of any GeoJSON geometry (mean of its coordinates), as {lat, lng}. */
export function centroid(geometry: { type: string; coordinates: unknown }): {
  lat: number;
  lng: number;
} | null {
  const points: number[][] = [];
  const collect = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      points.push(c as number[]);
    } else {
      for (const child of c) collect(child);
    }
  };
  collect(geometry.coordinates);
  if (!points.length) return null;
  const lng = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}
