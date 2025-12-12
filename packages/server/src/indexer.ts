import type Database from "better-sqlite3";

import { initSchema, resetData } from "./sqlite.js";
import type { Airport, IndexedFile } from "./types.js";

export type IndexerOptions = {
  db: Database.Database;
  airports: Map<string, Airport>;
  files: IndexedFile[];
  onInsert?: (info: { insertedAirports: number; insertedFiles: number; totalFiles: number }) => void;
};

export function writeIndex({ db, airports, files, onInsert }: IndexerOptions) {
  initSchema(db);

  const tx = db.transaction(() => {
    resetData(db);

    const insAirport = db.prepare(
      `INSERT INTO airports(icao, name, bureau) VALUES (@icao, @name, @bureau)`
    );
    let insertedAirports = 0;
    for (const a of airports.values()) {
      insAirport.run(a);
      insertedAirports += 1;
    }

    const insFile = db.prepare(`
      INSERT INTO files(
        icao, airport_name, rel_path, abs_path, filename, dirname,
        size, mtime_ms, chart_page, chart_name, chart_type, is_sup, is_modify, group_key
      ) VALUES (
        @icao, @airportName, @relPath, @absPath, @filename, @dirname,
        @size, @mtimeMs, @chartPage, @chartName, @chartType, @isSup, @isModify, @groupKey
      )
    `);

    let insertedFiles = 0;
    for (const f of files) {
      insFile.run({
        ...f,
        isSup: f.isSup == null ? null : f.isSup ? 1 : 0,
        isModify: f.isModify == null ? null : f.isModify ? 1 : 0
      });
      insertedFiles += 1;
      if (onInsert && insertedFiles % 500 === 0) {
        onInsert({ insertedAirports, insertedFiles, totalFiles: files.length });
      }
    }
    onInsert?.({ insertedAirports, insertedFiles, totalFiles: files.length });
  });

  tx();
}


