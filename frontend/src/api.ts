import type { Catalog, Kind, Session, Telemetry } from "./types";

// "/api" talks to the FastAPI backend (bundles built on demand);
// "./data" reads the prebuilt bundles shipped with the static site.
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? "/api";

const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(path: string): Promise<T> {
  const url = `${DATA_BASE}/${path}`;
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) {
        let detail = `${r.status} ${r.statusText}`;
        try {
          const body = await r.json();
          if (body?.detail) detail = String(body.detail);
        } catch {
          /* not JSON */
        }
        throw new Error(detail);
      }
      // Static hosts answer a missing file with their HTML fallback page.
      if (!(r.headers.get("content-type") ?? "").includes("json")) {
        throw new Error(`no data at ${url}`);
      }
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export const slug = (round: number, kind: Kind) => `${String(round).padStart(2, "0")}-${kind}`;

export const fetchCatalog = () => getJson<Catalog>("index.json");

export const fetchSession = (year: number, round: number, kind: Kind) =>
  getJson<Session>(`${year}/${slug(round, kind)}/session.json`);

export const fetchTelemetry = (year: number, round: number, kind: Kind, code: string) =>
  getJson<Telemetry>(`${year}/${slug(round, kind)}/tel/${code}.json`);
