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
