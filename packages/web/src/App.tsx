/* @refresh reset */
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  apiAirports,
  apiFavoriteAdd,
  apiFavoriteRelPaths,
  apiFavoriteRemove,
  apiFavoritesExport,
  apiFavoritesImport,
  apiIndexStatus,
  apiTree,
  pdfUrl,
  type IndexStatus,
  type TreeNode
} from "./api";
import {
  Grid,
  Layout,
  message,
  theme
} from "antd";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AirportGate } from "./components/AirportGate";
import { AppHeader } from "./components/AppHeader";
import { IndexStatusBar } from "./components/IndexStatusBar";
import { SidebarPanel } from "./components/SidebarPanel";
import { PdfViewerPanel } from "./components/PdfViewerPanel";
import { buildChartGroupTags, buildSidebarTreeData } from "./selectors/sidebar";
import type { ThemeMode } from "./hooks/useThemeMode";

export function App(props: { themeMode: ThemeMode; onThemeModeChange: (m: ThemeMode) => void }) {
  const { themeMode, onThemeModeChange } = props;
  const screens = Grid.useBreakpoint();
  const compactHeader = !screens.md;
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const ready = indexStatus?.phase === "ready";
  const [apiConnectError, setApiConnectError] = useState<string | null>(null);

  const [airports, setAirports] = useState<any[]>([]);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [airportsError, setAirportsError] = useState<string | null>(null);

  // 首屏“选择区域”支持：
  // - 查看模式：仅允许选择 1 个机场
  // - 航线模式：允许选择 2 个机场（按选择顺序：起/降）
  const [selectModeDraft, setSelectModeDraft] = useState<"view" | "route">("view");
  const [draftViewIcao, setDraftViewIcao] = useState<string>("");
  const [draftRouteFromIcao, setDraftRouteFromIcao] = useState<string>("");
  const [draftRouteToIcao, setDraftRouteToIcao] = useState<string>("");

  // 已确认的机场集合（进入主界面后不允许在其它区域多选修改）
  const [selectedIcaos, setSelectedIcaos] = useState<string[]>([]);
  const [activeIcao, setActiveIcao] = useState<string>("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [openedFileId, setOpenedFileId] = useState<number | null>(null);
  const [chartGroupFilter, setChartGroupFilter] = useState<string>("全部");
  const [viewMode, setViewMode] = useState<"全部" | "收藏">("全部");
  const [favoriteRelPaths, setFavoriteRelPaths] = useState<Set<string>>(new Set());
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const { token } = theme.useToken();
  // 注意：defaultLayoutPlugin 内部会用到 React Hooks，因此不能放在 useMemo 回调里；
  // 必须在组件顶层直接调用（满足 rules-of-hooks）。
  const pdfLayoutPlugin = defaultLayoutPlugin({
    // 默认隐藏左侧栏（缩略图/书签/目录树等）
    sidebarTabs: () => []
  });

  useEffect(() => {
    // 1) 优先拿到索引状态（用于启动进度条）
    // 2) ready 后再加载 airports/tree
    let stop = false;
    let es: EventSource | null = null;
    let pollTimer: any = null;

    const apply = (s: IndexStatus) => {
      if (stop) return;
      setIndexStatus(s);
      if (s.phase === "ready") {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        es?.close();
        es = null;
      }
    };

    const startPollFallback = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        if (stop) return;
        try {
          const res = await apiIndexStatus();
          apply(res.status);
        } catch {
          // ignore
        }
      }, 1500);
    };

    const startSse = () => {
      try {
        es = new EventSource("/api/index/stream");
        es.addEventListener("status", (ev: MessageEvent) => {
          try {
            apply(JSON.parse(String(ev.data)) as IndexStatus);
          } catch {
            // ignore
          }
        });
        es.onerror = () => {
          es?.close();
          es = null;
          // SSE 不可用时再启用轮询兜底；ready 后会自动停止
          startPollFallback();
        };
      } catch {
        startPollFallback();
      }
    };

    startSse();
    // 先拉一次，避免 SSE 首包延迟导致空白
    void (async () => {
      try {
        const res = await apiIndexStatus();
        apply(res.status);
        setApiConnectError(null);
      } catch {
        setApiConnectError("无法连接后端 /api（请确认后端端口=13001，或 Vite 代理 VITE_API_TARGET 配置）");
      }
    })();

    return () => {
      stop = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        setAirportsLoading(true);
        const res = await apiAirports();
        const raw = (res as any)?.airports ?? [];
        const list: any[] = Array.isArray(raw) ? (raw as any[]) : [];
        const sorted = [...list].sort((a, b) => {
          const ac = Number((a as any)?.fileCount ?? 0);
          const bc = Number((b as any)?.fileCount ?? 0);
          const az = ac <= 0;
          const bz = bc <= 0;
          if (az !== bz) return az ? 1 : -1; // 没有图的机场放到最后
          return String((a as any)?.icao ?? "").localeCompare(String((b as any)?.icao ?? ""), "en");
        });
        setAirports(sorted);
        setAirportsError(null);
      } catch (e: any) {
        setAirportsError(e?.message || String(e));
      } finally {
        setAirportsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 切换机场时：清空筛选（收藏/分组）并关闭已打开文件
  useEffect(() => {
    if (!activeIcao) return;
    setOpenedFileId(null);
    setViewMode("全部");
    setChartGroupFilter("全部");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIcao]);

  useEffect(() => {
    if (!ready) return;
    if (!activeIcao) return;
    (async () => {
      try {
        setTreeLoading(true);
        const res = await apiTree(activeIcao);
        const t = (res as any)?.tree ?? [];
        setTree(Array.isArray(t) ? t : []);
        setTreeError(null);
      } catch (e: any) {
        setTreeError(e?.message || String(e));
      } finally {
        setTreeLoading(false);
      }
    })();
  }, [activeIcao]);

  useEffect(() => {
    if (!ready) return;
    if (!activeIcao) return;
    (async () => {
      try {
        setFavoritesLoading(true);
        const res = await apiFavoriteRelPaths(activeIcao);
        const list = Array.isArray((res as any)?.relPaths) ? ((res as any).relPaths as string[]) : [];
        setFavoriteRelPaths(new Set(list));
      } catch {
        // 收藏不是核心功能，失败时不阻塞 UI
        setFavoriteRelPaths(new Set());
      } finally {
        setFavoritesLoading(false);
      }
    })();
  }, [ready, activeIcao]);

  const toggleFavoriteByNode = async (n: Extract<TreeNode, { type: "file" }>) => {
    const relPath = n.relPath;
    const isFav = favoriteRelPaths.has(relPath);
    try {
      if (isFav) {
        await apiFavoriteRemove({ relPath });
        setFavoriteRelPaths((prev) => {
          const next = new Set(prev);
          next.delete(relPath);
          return next;
        });
      } else {
        await apiFavoriteAdd({ fileId: n.id });
        setFavoriteRelPaths((prev) => new Set(prev).add(relPath));
      }
    } catch (e: any) {
      void message.error(`收藏操作失败：${e?.message || String(e)}`);
    }
  };

  const exportFavorites = async () => {
    try {
      const data = await apiFavoritesExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").slice(0, 15);
      a.download = `favorites-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      void message.success("已导出收藏");
    } catch (e: any) {
      void message.error(`导出失败：${e?.message || String(e)}`);
    }
  };

  const importFavoritesFromFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as any;
      const favorites = Array.isArray(parsed?.favorites) ? parsed.favorites : null;
      if (!favorites) throw new Error("文件格式不正确：缺少 favorites 数组");
      await apiFavoritesImport({ mode: "merge", favorites });
      // 仅刷新当前机场收藏标记
      if (activeIcao) {
        const res = await apiFavoriteRelPaths(activeIcao);
        const list = Array.isArray((res as any)?.relPaths) ? ((res as any).relPaths as string[]) : [];
        setFavoriteRelPaths(new Set(list));
      }
      void message.success("已导入收藏（合并模式）");
    } catch (e: any) {
      void message.error(`导入失败：${e?.message || String(e)}`);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const sidebarTree = useMemo(() => {
    return buildSidebarTreeData({
      tree,
      chartGroupFilter,
      viewMode,
      favoriteRelPaths,
      token: { colorText: token.colorText, colorTextSecondary: token.colorTextSecondary, colorWarning: token.colorWarning },
      onToggleFavorite: (n) => void toggleFavoriteByNode(n)
    });
  }, [tree, chartGroupFilter, viewMode, favoriteRelPaths, token.colorText, token.colorTextSecondary, token.colorWarning]);

  const chartGroupTags = useMemo(() => {
    return buildChartGroupTags({ tree, viewMode, favoriteRelPaths });
  }, [tree, viewMode, favoriteRelPaths]);

  const favoritesCount = useMemo(() => {
    return favoriteRelPaths.size;
  }, [favoriteRelPaths]);

  const progressPercent = useMemo(() => {
    if (!indexStatus?.totalPdfs || indexStatus.totalPdfs <= 0) return 0;
    return Math.floor((Math.min(indexStatus.processedPdfs, indexStatus.totalPdfs) / indexStatus.totalPdfs) * 100);
  }, [indexStatus]);

  // 模式切换时：保持草稿尽量合理，并清理无效状态
  useEffect(() => {
    if (selectModeDraft === "view") {
      // 从航线切回查看：尽量用起飞机场作为默认
      if (!draftViewIcao) setDraftViewIcao(draftRouteFromIcao || draftRouteToIcao || "");
    } else {
      // 从查看切到航线：尽量用查看机场作为起飞默认
      if (!draftRouteFromIcao && draftViewIcao) setDraftRouteFromIcao(draftViewIcao);
      // 避免起降相同
      if (draftRouteFromIcao && draftRouteToIcao && draftRouteFromIcao === draftRouteToIcao) setDraftRouteToIcao("");
    }
  }, [selectModeDraft]);

  const canConfirmSelection = useMemo(() => {
    if (selectModeDraft === "view") return !!draftViewIcao;
    if (!draftRouteFromIcao || !draftRouteToIcao) return false;
    return draftRouteFromIcao !== draftRouteToIcao;
  }, [selectModeDraft, draftViewIcao, draftRouteFromIcao, draftRouteToIcao]);

  const confirmSelection = () => {
    if (!canConfirmSelection) return;
    const next =
      selectModeDraft === "view"
        ? [draftViewIcao].filter(Boolean)
        : [draftRouteFromIcao, draftRouteToIcao].filter(Boolean);
    setSelectedIcaos(next);
    // 默认进入后 active 指向“起”（或单机场）
    setActiveIcao(next[0] || "");
  };

  const resetToSelection = () => {
    const nextMode: "view" | "route" = selectedIcaos.length === 2 ? "route" : "view";
    setSelectModeDraft(nextMode);
    if (selectedIcaos.length === 2) {
      setDraftRouteFromIcao(selectedIcaos[0] || "");
      setDraftRouteToIcao(selectedIcaos[1] || "");
      setDraftViewIcao(selectedIcaos[0] || "");
    } else {
      setDraftViewIcao(selectedIcaos[0] || "");
      setDraftRouteFromIcao(selectedIcaos[0] || "");
      setDraftRouteToIcao("");
    }
    setSelectedIcaos([]);
    setActiveIcao("");
  };

  const pdfHref = openedFileId ? pdfUrl(openedFileId) : null;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* 首次进入：先选择机场，再展示主界面 */}
        {ready && selectedIcaos.length === 0 ? (
          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: token.colorBgLayout
            }}
          >
            <div
              style={{
                width: "min(720px, 92vw)",
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                padding: 20
              }}
            >
              <AirportGate
                airports={airports as any}
                airportsLoading={airportsLoading}
                airportsError={airportsError}
                mode={selectModeDraft}
                onModeChange={setSelectModeDraft}
                themeMode={themeMode}
                onThemeModeChange={onThemeModeChange}
                draftViewIcao={draftViewIcao}
                onDraftViewIcaoChange={setDraftViewIcao}
                draftRouteFromIcao={draftRouteFromIcao}
                onDraftRouteFromIcaoChange={(icao) => {
                  setDraftRouteFromIcao(icao);
                  if (icao && draftRouteToIcao === icao) setDraftRouteToIcao("");
                }}
                draftRouteToIcao={draftRouteToIcao}
                onDraftRouteToIcaoChange={(icao) => {
                  setDraftRouteToIcao(icao);
                  if (icao && draftRouteFromIcao === icao) setDraftRouteFromIcao("");
                }}
                canConfirm={canConfirmSelection}
                onConfirm={confirmSelection}
                onClear={() => {
                  setDraftViewIcao("");
                  setDraftRouteFromIcao("");
                  setDraftRouteToIcao("");
                }}
              />
            </div>
          </div>
        ) : null}

        {/* 未选择机场时不展示 Header */}
        {activeIcao ? (
          <AppHeader
            compact={compactHeader}
            siderCollapsed={siderCollapsed}
            onToggleSider={() => setSiderCollapsed((v) => !v)}
            ready={ready}
            airports={airports as any}
            selectedIcaos={selectedIcaos}
            activeIcao={activeIcao}
            onActiveIcaoChange={setActiveIcao}
            onResetToSelection={resetToSelection}
            openedFileId={openedFileId}
            pdfHref={pdfHref}
            onExportFavorites={() => void exportFavorites()}
            onTriggerImport={() => importInputRef.current?.click()}
            background={token.colorBgElevated}
            borderColor={token.colorBorderSecondary}
            themeMode={themeMode}
            onThemeModeChange={onThemeModeChange}
          />
        ) : null}

        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void importFavoritesFromFile(f);
          }}
        />

        {!ready ? (
          <IndexStatusBar
            indexStatus={indexStatus}
            apiConnectError={apiConnectError}
            progressPercent={progressPercent}
            borderColor={token.colorBorderSecondary}
            background={token.colorBgLayout}
          />
        ) : null}

        {/* 未选中机场时不展示主界面 */}
        {ready && selectedIcaos.length === 0 ? null : (
        <Layout style={{ flex: "1 1 auto", minHeight: 0, height: "100%" }}>
          <Layout.Sider
            width={420}
            collapsible
            collapsedWidth={0}
            collapsed={siderCollapsed}
            onCollapse={(v: boolean) => setSiderCollapsed(v)}
            trigger={null}
            theme="light"
            style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: "hidden", height: "100%" }}
          >
            <SidebarPanel
              borderColor={token.colorBorderSecondary}
              activeIcao={activeIcao}
              selectedIcaos={selectedIcaos}
              onActiveIcaoChange={setActiveIcao}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              favoritesCount={favoritesCount}
              chartGroupFilter={chartGroupFilter}
              onChartGroupFilterChange={setChartGroupFilter}
              chartGroupTags={chartGroupTags}
              airportsError={airportsError}
              treeError={treeError}
              treeLoading={treeLoading}
              treeHasAny={tree.length > 0}
              treeData={sidebarTree}
              onOpenFileId={setOpenedFileId}
              token={{ colorPrimary: token.colorPrimary, colorWarning: token.colorWarning }}
            />
          </Layout.Sider>

          <Layout.Content style={{ padding: 12, overflow: "hidden", minHeight: 0 }}>
            <Layout style={{ height: "100%", background: token.colorBgLayout, minHeight: 0 }}>
              <Layout.Content
                style={{
                  height: "100%",
                  minHeight: 0,
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  overflow: "hidden"
                }}
              >
                <div
                  style={{
                    height: "100%",
                    minHeight: 0,
                    overflow: "hidden",
                    padding: 0
                  }}
                >
                  <PdfViewerPanel
                    openedFileId={openedFileId}
                    pdfHref={pdfHref}
                    workerUrl={pdfWorkerUrl}
                    plugins={[pdfLayoutPlugin]}
                    borderRadius={token.borderRadiusLG}
                    backgroundLayout={token.colorBgLayout}
                    backgroundContainer={token.colorBgContainer}
                  />
                </div>
              </Layout.Content>
            </Layout>
          </Layout.Content>
        </Layout>
        )}
    </div>
  );
}


