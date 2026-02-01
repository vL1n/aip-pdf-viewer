export type AirportRow = {
  icao: string;
  name: string | null;
  bureau: string | null;
  fileCount: number;
};

export type TreeNode =
  | { type: "dir"; name: string; path: string; children: TreeNode[] }
  | {
      type: "file";
      id: number;
      name: string;
      relPath: string;
      chartName: string | null;
      chartType: string | null;
      chartPage: string | null;
      isSup: boolean | null;
      groupKey: string | null;
    };

export type SearchItem = {
  id: number;
  icao: string | null;
  airport_name: string | null;
  rel_path: string;
  filename: string;
  chart_name: string | null;
  chart_type: string | null;
  chart_page: string | null;
  group_key: string | null;
  rank: number;
};

export type IndexStatus = {
  phase: "idle" | "counting" | "scanning" | "writing" | "ready" | "error";
  rootPath: string | null;
  startedAtMs: number | null;
  updatedAtMs: number | null;
  finishedAtMs: number | null;
  totalPdfs: number | null;
  processedPdfs: number;
  insertedFiles: number;
  message: string | null;
  lastError: string | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function apiAirports() {
  return await getJson<{ airports: AirportRow[] }>("/api/airports");
}

export async function apiTree(icao: string) {
  const qs = new URLSearchParams({ icao });
  return await getJson<{ icao: string | null; tree: TreeNode[] }>(`/api/tree?${qs.toString()}`);
}

export async function apiSearch(q: string, icao?: string) {
  const qs = new URLSearchParams({ q });
  if (icao) qs.set("icao", icao);
  // 默认拉取全部结果
  qs.set("limit", "all");
  return await getJson<{ query: string; icao: string | null; total: number; items: SearchItem[] }>(
    `/api/search?${qs.toString()}`
  );
}

export async function apiIndexStatus() {
  return await getJson<{ status: IndexStatus }>("/api/index/status");
}

export async function apiRebuildIndex() {
  const res = await fetch("/api/index/rebuild", { method: "POST" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as { ok: boolean; status: IndexStatus };
}

export function pdfUrl(id: number) {
  return `/api/pdf/${id}`;
}

export type FavoritesExportV1 = {
  version: 1;
  exportedAtMs: number;
  favorites: Array<{ rel_path: string; icao: string | null; created_at_ms: number }>;
};

export async function apiFavoriteRelPaths(icao: string) {
  const qs = new URLSearchParams({ icao });
  return await getJson<{ icao: string; relPaths: string[] }>(`/api/favorites/relpaths?${qs.toString()}`);
}

export async function apiFavoriteAdd(input: { fileId?: number; relPath?: string }) {
  return await postJson<{ ok: true; relPath: string; icao: string | null }>("/api/favorites/add", input);
}

export async function apiFavoriteRemove(input: { fileId?: number; relPath?: string }) {
  return await postJson<{ ok: true; relPath: string }>("/api/favorites/remove", input);
}

export async function apiFavoritesExport() {
  return await getJson<FavoritesExportV1>("/api/favorites/export");
}

export async function apiFavoritesImport(payload: { mode?: "merge" | "replace"; favorites: FavoritesExportV1["favorites"] }) {
  return await postJson<{ ok: true; mode: string; total: number }>("/api/favorites/import", payload);
}

// ---- Route Parsing (航路解析) ----

/** 航路解析状态 */
export interface RouteStatus {
  available: boolean;
  message: string;
}

/** 解析后的航点 */
export interface ParsedRoutePoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  type: "airport" | "waypoint" | "navaid";
  viaAirway: string | null;
  isExplicit: boolean;
  isAirport: boolean;
  remark: string | null;
}

/** 航路解析结果 */
export interface ParsedRoute {
  success: boolean;
  error: string | null;
  departure: { ident: string; lat: number; lon: number } | null;
  arrival: { ident: string; lat: number; lon: number } | null;
  sid: string | null;
  star: string | null;
  points: ParsedRoutePoint[];
  unknownElements: string[];
}

/** 获取航路解析功能状态 */
export async function apiRouteStatus() {
  return await getJson<RouteStatus>("/api/route/status");
}

/** 解析航路 */
export async function apiRouteParse(route: string) {
  return await postJson<ParsedRoute>("/api/route/parse", { route });
}

// ---- VATSIM Tracking (VATSIM 追踪) ----

/** VATSIM 飞行计划 */
export interface VatsimFlightPlan {
  flight_rules: string;
  aircraft: string;
  aircraft_short: string;
  departure: string;
  arrival: string;
  alternate: string;
  cruise_tas: string;
  altitude: string;
  route: string;
}

/** VATSIM 飞行员数据 */
export interface VatsimPilot {
  cid: number;
  name: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  groundspeed: number;
  heading: number;
  transponder: string;
  flight_plan: VatsimFlightPlan | null;
  last_updated: string;
}

/** VATSIM 数据响应 */
export interface VatsimData {
  pilots: VatsimPilot[];
}

/** 获取 VATSIM 数据并根据 CID 筛选飞行员 */
export async function fetchVatsimPilot(cid: number): Promise<VatsimPilot | null> {
  const res = await fetch("https://data.vatsim.net/v3/vatsim-data.json");
  if (!res.ok) throw new Error(`VATSIM API 请求失败: ${res.status}`);
  const data = (await res.json()) as VatsimData;
  return data.pilots.find((p) => p.cid === cid) ?? null;
}


