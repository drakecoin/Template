/**
 * Dataset discovery for Socrata-based open-data portals, with fallbacks:
 *  1. the portal's own catalogue API ({domain}/api/catalog/v1)
 *  2. the global discovery API (api.us.socrata.com)
 *  3. the legacy views listing ({domain}/api/views.json), filtered client-side
 * Each strategy is logged so failures in the field are diagnosable.
 */
export interface DiscoveredDataset {
  id: string;
  name: string;
}

interface CatalogResult {
  results?: { resource?: { id?: string; name?: string } }[];
}

interface LegacyView {
  id?: string;
  name?: string;
  viewType?: string;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "kerbside-etl/0.1 (open-data import; contact via repo)" },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}

export async function discoverDatasets(
  domain: string,
  query: string,
  label: string,
): Promise<DiscoveredDataset[]> {
  const q = encodeURIComponent(query);

  // 1. domain-local catalogue
  try {
    const j = await fetchJson<CatalogResult>(
      "https://" + domain + "/api/catalog/v1?q=" + q + "&limit=30",
      20000,
    );
    const found = (j.results ?? [])
      .map((r) => r.resource)
      .filter((r): r is DiscoveredDataset => Boolean(r?.id && r.name));
    if (found.length) {
      console.log("[" + label + "] catalogue (domain): " + found.length + " candidates");
      return found;
    }
  } catch (e) {
    console.log("[" + label + "] domain catalogue failed: " + String(e));
  }

  // 2. global discovery API
  try {
    const j = await fetchJson<CatalogResult>(
      "https://api.us.socrata.com/api/catalog/v1?domains=" + domain +
        "&search_context=" + domain + "&q=" + q + "&limit=30",
      20000,
    );
    const found = (j.results ?? [])
      .map((r) => r.resource)
      .filter((r): r is DiscoveredDataset => Boolean(r?.id && r.name));
    if (found.length) {
      console.log("[" + label + "] catalogue (global): " + found.length + " candidates");
      return found;
    }
  } catch (e) {
    console.log("[" + label + "] global catalogue failed: " + String(e));
  }

  // 3. legacy views listing, filtered by the query terms
  try {
    const views = await fetchJson<LegacyView[]>(
      "https://" + domain + "/api/views.json?limit=2000",
      30000,
    );
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = views
      .filter((v): v is Required<Pick<LegacyView, "id" | "name">> & LegacyView =>
        Boolean(v.id && v.name),
      )
      .filter((v) => terms.every((t) => v.name.toLowerCase().includes(t)))
      .map((v) => ({ id: v.id, name: v.name }));
    console.log("[" + label + "] views listing: " + found.length + " candidates");
    return found;
  } catch (e) {
    console.log("[" + label + "] views listing failed: " + String(e));
  }

  return [];
}
