export type Airport = {
  icao: string;
  name: string | null;
  bureau: string | null;
};

export type ChartMeta = {
  chartName: string | null;
  pageNumber: string | null;
  chartType: string | null;
  isSup: boolean;
  isModify: boolean;
};

export type IndexedFile = {
  absPath: string;
  relPath: string;
  filename: string;
  dirname: string;
  size: number;
  mtimeMs: number;
  icao: string | null;
  airportName: string | null;
  chartPage: string | null;
  chartName: string | null;
  chartType: string | null;
  isSup: boolean | null;
  isModify: boolean | null;
  groupKey: string | null;
};


