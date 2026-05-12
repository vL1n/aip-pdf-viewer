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

export type PdfAnnotationKind = "pen" | "highlighter";

export type PdfAnnotationPoint = {
  x: number;
  y: number;
};

export type PdfAnnotation = {
  id: number;
  relPath: string;
  pageIndex: number;
  kind: PdfAnnotationKind;
  color: string;
  opacity: number;
  strokeWidth: number;
  points: PdfAnnotationPoint[];
  createdAtMs: number;
  updatedAtMs: number;
};

export async function apiAnnotations(fileId: number) {
  const qs = new URLSearchParams({ fileId: String(fileId) });
  return await getJson<{ relPath: string; annotations: PdfAnnotation[] }>(`/api/annotations?${qs.toString()}`);
}

export async function apiAddAnnotation(input: {
  fileId: number;
  pageIndex: number;
  kind: PdfAnnotationKind;
  color: string;
  opacity: number;
  strokeWidth: number;
  points: PdfAnnotationPoint[];
}) {
  return await postJson<{ ok: true; annotation: PdfAnnotation }>("/api/annotations/add", input);
}

export async function apiDeleteAnnotation(id: number) {
  return await postJson<{ ok: true; id: number }>("/api/annotations/delete", { id });
}

export async function apiClearAnnotations(input: { fileId: number; pageIndex?: number }) {
  return await postJson<{ ok: true; cleared: number }>("/api/annotations/clear", input);
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

// ---- Shortest Route (最短航路) ----

export interface ShortestRouteOptions {
  maxConnectorDistanceKm?: number;
  connectorCandidateLimit?: number;
}

export interface ShortestRouteNavPoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  type: "airport" | "waypoint" | "navaid";
}

export interface ShortestRouteLeg {
  from: string;
  to: string;
  distanceKm: number;
  airwayUsed: boolean;
  fallbackUsed: boolean;
  airways: string[];
  points: ParsedRoutePoint[];
  reason: string | null;
}

export interface ShortestRouteResult {
  success: boolean;
  error: string | null;
  routeString: string;
  departure: ShortestRouteNavPoint | null;
  arrival: ShortestRouteNavPoint | null;
  points: ParsedRoutePoint[];
  legs: ShortestRouteLeg[];
  distanceKm: number;
  fallbackUsed: boolean;
  unknownElements: string[];
  manuallyEdited?: boolean;
}

export async function apiRouteShortest(input: {
  departure: string;
  arrival: string;
  via?: string[];
  options?: ShortestRouteOptions;
}) {
  return await postJson<ShortestRouteResult>("/api/route/shortest", input);
}

export interface HighAirwayWaypoint {
  id: number;
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  type: "waypoint";
  distanceNm: number;
  airways: string[];
  levels: string[];
}

export async function apiRouteHighWaypoints(input: { lat: number; lon: number; radiusNm: number; limit?: number }) {
  const qs = new URLSearchParams({
    lat: String(input.lat),
    lon: String(input.lon),
    radiusNm: String(input.radiusNm),
    limit: String(input.limit ?? 200)
  });
  return await getJson<{
    success: boolean;
    error: string | null;
    center: { lat: number; lon: number };
    radiusNm: number;
    waypoints: HighAirwayWaypoint[];
  }>(`/api/route/high-waypoints?${qs.toString()}`);
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

// ---- KML Parsing (KML 解析) ----

/** KML 航迹点 */
export interface KmlTrackPoint {
  lon: number;
  lat: number;
  altitude: number;
  timestamp?: string;
  heading?: number;
  speed?: number;
}

/** KML 解析结果 */
export interface KmlParseResult {
  success: boolean;
  error: string | null;
  name: string | null;
  points: KmlTrackPoint[];
  totalPoints: number;
}

/** 解析 KML 文件内容 */
export async function apiKmlParse(content: string) {
  return await postJson<KmlParseResult>("/api/kml/parse", { content });
}

// ---- Route Fitting (航路拟合) ----

/** 拟合后的航点 */
export interface FittedWaypoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  type: "airport" | "waypoint" | "navaid";
  distanceFromTrack: number;
  viaAirway: string | null;
  isAirport: boolean;
}

/** 航段匹配结果 */
export interface SegmentMatch {
  segmentIndex: number;
  airway: string | null;
  entryPoint: { ident: string; lat: number; lon: number } | null;
  exitPoint: { ident: string; lat: number; lon: number } | null;
  directionScore: number;
  distanceScore: number;
  totalScore: number;
}

/** 单个拟合候选结果 */
export interface FitCandidate {
  /** 拟合度分数 (0-100) */
  score: number;
  /** 拟合后的航点序列 */
  waypoints: FittedWaypoint[];
  /** 生成的航路字符串 */
  routeString: string;
  /** 各航段匹配详情 */
  segments: SegmentMatch[];
}

/** 拟合选项 */
export interface FitOptions {
  /** 最大匹配距离（公里） */
  maxDistanceKm?: number;
  /** 转折点检测阈值（度） */
  turnAngleThreshold?: number;
  /** 最小航段距离（公里） */
  minSegmentDistanceKm?: number;
  /** 候选结果数量 */
  maxCandidates?: number;
  /** 方向匹配权重 (0-100) */
  directionWeight?: number;
  /** 距离匹配权重 (0-100) */
  distanceWeight?: number;
  /** 航路加分 */
  airwayBonus?: number;
  /** 采样间隔（公里），0=不采样 */
  sampleIntervalKm?: number;
  /** 是否强制使用航路 */
  preferAirways?: boolean;
}

/** 拟合结果 */
export interface FitRouteResult {
  success: boolean;
  error: string | null;
  waypoints: FittedWaypoint[];
  routeString: string;
  sampledPointsCount: number;
  matchedWaypointsCount: number;
  /** 多个候选结果（按分数降序） */
  candidates: FitCandidate[];
}

/** 根据航迹拟合航路 */
export async function apiRouteFit(
  points: Array<{ lat: number; lon: number; altitude?: number }>,
  options?: FitOptions
) {
  return await postJson<FitRouteResult>("/api/route/fit", { points, options });
}
