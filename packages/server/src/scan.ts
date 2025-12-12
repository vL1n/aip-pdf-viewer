import fs from "node:fs/promises";
import path from "node:path";

import { readCsvPossiblyGbk } from "./csv.js";
import type { Airport, ChartMeta, IndexedFile } from "./types.js";

function isIcao(s: string) {
  return /^[A-Z]{4}$/.test(s);
}

function normalizeRel(p: string) {
  return p.split(path.sep).join("/");
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full);
    } else if (ent.isFile()) {
      yield full;
    }
  }
}

export async function countPdfFiles(
  rootPath: string,
  onProgress?: (count: number) => void
): Promise<number> {
  let count = 0;
  for await (const absPath of walk(rootPath)) {
    if (!absPath.toLowerCase().endsWith(".pdf")) continue;
    count += 1;
    if (onProgress && count % 500 === 0) onProgress(count);
  }
  onProgress?.(count);
  return count;
}

export async function loadAirports(rootPath: string): Promise<Map<string, Airport>> {
  const airports = new Map<string, Airport>();
  const airportsCsv = path.join(rootPath, "Terminal", "Airports.csv");

  try {
    const rows = await readCsvPossiblyGbk(airportsCsv);
    for (const r of rows) {
      const icao = (r["CODE_ID"] || "").trim().toUpperCase();
      if (!icao || !isIcao(icao)) continue;
      const name = (r["TXT_NAME"] || "").trim() || null;
      const bureau = (r["BUREAU_NAME"] || "").trim() || null;
      airports.set(icao, { icao, name, bureau });
    }
  } catch {
    // ignore if missing
  }

  return airports;
}

export async function loadCharts(rootPath: string, icao: string): Promise<Map<string, ChartMeta>> {
  const charts = new Map<string, ChartMeta>();
  const chartsCsv = path.join(rootPath, "Terminal", icao, "Charts.csv");

  try {
    const rows = await readCsvPossiblyGbk(chartsCsv);
    for (const r of rows) {
      const pageNumber = (r["PAGE_NUMBER"] || "").trim();
      if (!pageNumber) continue;
      charts.set(pageNumber, {
        chartName: (r["ChartName"] || "").trim() || null,
        pageNumber,
        chartType: (r["ChartTypeEx_CH"] || "").trim() || null,
        isSup: String(r["IS_SUP"] || "").trim().toLowerCase() === "true",
        isModify: String(r["IsModify"] || "").trim().toLowerCase() === "true"
      });
    }
  } catch {
    // ignore if missing
  }

  return charts;
}

function deriveChartPageFromFilename(filename: string, icao: string | null): string | null {
  const base = filename.replace(/\.pdf$/i, "");
  if (icao) {
    const prefix = `${icao}-`;
    if (base.toUpperCase().startsWith(prefix)) {
      return base.slice(prefix.length);
    }
  }
  return null;
}

function deriveGroupKey(chartType: string | null, chartPage: string | null): string | null {
  if (chartType) return chartType;
  if (!chartPage) return null;

  // 常见：0C-1 / 3P-2 / 4Z01 / AD2.26A ...
  const m1 = chartPage.match(/^(\d+[A-Z])(?:[-_].*)?$/i);
  if (m1) return m1[1].toUpperCase();
  const m2 = chartPage.match(/^(AD\d+(?:\.\d+)?[A-Z]?)$/i);
  if (m2) return m2[1].toUpperCase();
  return "其他";
}

export type ScanResult = {
  airports: Map<string, Airport>;
  files: IndexedFile[];
};

export type ScanOptions = {
  onPdf?: (info: { processed: number; relPath: string; icao: string | null }) => void;
};

export async function scanRootWithProgress(rootPath: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const airports = await loadAirports(rootPath);

  // 预加载每个 ICAO 的 Charts.csv（按需加载）
  const chartsCache = new Map<string, Map<string, ChartMeta>>();
  async function getCharts(icao: string) {
    const cached = chartsCache.get(icao);
    if (cached) return cached;
    const charts = await loadCharts(rootPath, icao);
    chartsCache.set(icao, charts);
    return charts;
  }

  const files: IndexedFile[] = [];
  let processed = 0;

  for await (const absPath of walk(rootPath)) {
    if (!absPath.toLowerCase().endsWith(".pdf")) continue;

    const st = await fs.stat(absPath);
    const relPath = normalizeRel(path.relative(rootPath, absPath));
    const filename = path.basename(absPath);
    const dirname = normalizeRel(path.dirname(relPath));

    // 识别 ICAO：优先匹配 Terminal/<ICAO>/...
    let icao: string | null = null;
    const segs = relPath.split("/");
    if (segs.length >= 2 && segs[0].toLowerCase() === "terminal" && isIcao(segs[1].toUpperCase())) {
      icao = segs[1].toUpperCase();
    }

    const chartPage = deriveChartPageFromFilename(filename, icao);
    let chartName: string | null = null;
    let chartType: string | null = null;
    let isSup: boolean | null = null;
    let isModify: boolean | null = null;

    if (icao && chartPage) {
      const charts = await getCharts(icao);
      const meta = charts.get(chartPage);
      if (meta) {
        chartName = meta.chartName;
        chartType = meta.chartType;
        isSup = meta.isSup;
        isModify = meta.isModify;
      }
    }

    const airportName = icao ? airports.get(icao)?.name ?? null : null;
    const groupKey = deriveGroupKey(chartType, chartPage);

    processed += 1;
    opts.onPdf?.({ processed, relPath, icao });

    files.push({
      absPath,
      relPath,
      filename,
      dirname,
      size: st.size,
      mtimeMs: st.mtimeMs,
      icao,
      airportName,
      chartPage,
      chartName,
      chartType,
      isSup,
      isModify,
      groupKey
    });
  }

  return { airports, files };
}

export async function scanRoot(rootPath: string): Promise<ScanResult> {
  return await scanRootWithProgress(rootPath);
}


