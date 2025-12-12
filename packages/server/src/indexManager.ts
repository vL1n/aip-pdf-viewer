import { EventEmitter } from "node:events";

import type Database from "better-sqlite3";

import { countPdfFiles, scanRootWithProgress } from "./scan.js";
import { writeIndex } from "./indexer.js";

export type IndexPhase = "idle" | "counting" | "scanning" | "writing" | "ready" | "error";

export type IndexStatus = {
  phase: IndexPhase;
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

export class IndexManager {
  private db: Database.Database;
  private emitter = new EventEmitter();
  private running: Promise<void> | null = null;

  private status: IndexStatus = {
    phase: "idle",
    rootPath: null,
    startedAtMs: null,
    updatedAtMs: null,
    finishedAtMs: null,
    totalPdfs: null,
    processedPdfs: 0,
    insertedFiles: 0,
    message: null,
    lastError: null
  };

  constructor(db: Database.Database) {
    this.db = db;
  }

  getStatus(): IndexStatus {
    return this.status;
  }

  onStatus(fn: (s: IndexStatus) => void) {
    this.emitter.on("status", fn);
    return () => this.emitter.off("status", fn);
  }

  private setStatus(patch: Partial<IndexStatus>) {
    this.status = {
      ...this.status,
      ...patch,
      updatedAtMs: Date.now()
    };
    this.emitter.emit("status", this.status);
  }

  isReady() {
    return this.status.phase === "ready";
  }

  isIndexing() {
    return this.status.phase === "counting" || this.status.phase === "scanning" || this.status.phase === "writing";
  }

  async start(rootPath: string) {
    if (this.running) return this.running;

    this.running = (async () => {
      const startedAtMs = Date.now();
      this.setStatus({
        phase: "counting",
        rootPath,
        startedAtMs,
        finishedAtMs: null,
        totalPdfs: null,
        processedPdfs: 0,
        insertedFiles: 0,
        message: "正在统计 PDF 总数...",
        lastError: null
      });

      try {
        const totalPdfs = await countPdfFiles(rootPath, (count) => {
          this.setStatus({ message: `已发现 ${count} 个 PDF...` });
        });
        this.setStatus({
          totalPdfs,
          phase: "scanning",
          message: "正在扫描并解析 PDF 元数据..."
        });

        const { airports, files } = await scanRootWithProgress(rootPath, {
          onPdf: ({ processed, relPath, icao }) => {
            this.setStatus({
              processedPdfs: processed,
              message: `扫描中：${icao || ""} ${relPath}`
            });
          }
        });

        this.setStatus({ phase: "writing", message: "正在写入 SQLite 索引..." });
        writeIndex({
          db: this.db,
          airports,
          files,
          onInsert: ({ insertedFiles }) => {
            this.setStatus({ insertedFiles, message: `写入中：${insertedFiles}/${files.length}` });
          }
        });

        this.setStatus({
          phase: "ready",
          finishedAtMs: Date.now(),
          message: `索引完成：${files.length} 个 PDF`
        });
      } catch (e: any) {
        this.setStatus({
          phase: "error",
          finishedAtMs: Date.now(),
          message: "索引失败",
          lastError: e?.stack || e?.message || String(e)
        });
      } finally {
        this.running = null;
        const costMs = Date.now() - startedAtMs;
        this.setStatus({ message: `${this.status.message || ""}（耗时 ${costMs}ms）` });
      }
    })();

    return this.running;
  }
}


