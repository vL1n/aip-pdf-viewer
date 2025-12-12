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


