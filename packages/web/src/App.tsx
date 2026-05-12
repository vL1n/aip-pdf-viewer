/* @refresh reset */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowHeight } from "./hooks/useWindowHeight";

import {
  apiAirports,
  apiFavoriteAdd,
  apiFavoriteRelPaths,
  apiFavoriteRemove,
  apiFavoritesExport,
  apiFavoritesImport,
  apiIndexStatus,
  apiRouteAirports,
  apiTree,
  pdfUrl,
  type AirportRow,
  type IndexStatus,
  type TreeNode
} from "./api";
import {
  Grid,
  Drawer,
  Layout,
  message,
  theme
} from "antd";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AirportGate } from "./components/AirportGate";
import { AppHeader } from "./components/AppHeader";
import { IndexStatusBar } from "./components/IndexStatusBar";
import { SidebarPanel } from "./components/SidebarPanel";
import {
  ANNOTATION_COLORS,
  DEFAULT_ANNOTATION_WIDTH_KEY,
  PdfViewerPanel,
  type PdfAnnotationMeta,
  type PdfAnnotationUiState
} from "./components/PdfViewerPanel";
import { RouteIntegratedPage } from "./components/RouteIntegratedPage";
import { buildChartGroupTags, buildSidebarTreeData } from "./selectors/sidebar";
import type { ThemeMode } from "./hooks/useThemeMode";

type AppRoute =
  | { mode: "home" }
  | { mode: "charts"; icao: string; fileId: number | null }
  | { mode: "route"; departure: string; arrival: string };

function normalizeIcao(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function parseAppRoute(): AppRoute {
  const url = new URL(window.location.href);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "charts") {
    const icao = normalizeIcao(parts[1] || url.searchParams.get("icao"));
    const fileId = Number(url.searchParams.get("file") || url.searchParams.get("fileId") || "");
    return icao ? { mode: "charts", icao, fileId: Number.isFinite(fileId) && fileId > 0 ? fileId : null } : { mode: "home" };
  }

  if (parts[0] === "route") {
    const departure = normalizeIcao(parts[1] || url.searchParams.get("dep") || url.searchParams.get("departure"));
    const arrival = normalizeIcao(parts[2] || url.searchParams.get("arr") || url.searchParams.get("arrival"));
    return departure && arrival ? { mode: "route", departure, arrival } : { mode: "home" };
  }

  const queryIcao = normalizeIcao(url.searchParams.get("icao"));
  if (queryIcao) {
    const fileId = Number(url.searchParams.get("file") || url.searchParams.get("fileId") || "");
    return { mode: "charts", icao: queryIcao, fileId: Number.isFinite(fileId) && fileId > 0 ? fileId : null };
  }

  const departure = normalizeIcao(url.searchParams.get("dep") || url.searchParams.get("departure"));
  const arrival = normalizeIcao(url.searchParams.get("arr") || url.searchParams.get("arrival"));
  if (departure && arrival) return { mode: "route", departure, arrival };

  return { mode: "home" };
}

function chartPath(icao: string, fileId?: number | null) {
  const normalized = normalizeIcao(icao);
  const qs = fileId ? `?file=${encodeURIComponent(String(fileId))}` : "";
  return normalized ? `/charts/${encodeURIComponent(normalized)}${qs}` : "/";
}

function routePath(departure: string, arrival: string) {
  const dep = normalizeIcao(departure);
  const arr = normalizeIcao(arrival);
  return dep && arr ? `/route/${encodeURIComponent(dep)}/${encodeURIComponent(arr)}` : "/";
}

export function App(props: { themeMode: ThemeMode; onThemeModeChange: (m: ThemeMode) => void; isDark: boolean }) {
  const { themeMode, onThemeModeChange, isDark } = props;
  const screens = Grid.useBreakpoint();
  const compactHeader = !screens.md;
  const isMobile = !screens.md;
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  // 移动端 Drawer：等抽屉完全展开后再渲染目录树，避免"拉出时卡顿"
  const [mobileDrawerFullyOpen, setMobileDrawerFullyOpen] = useState(false);

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const ready = indexStatus?.phase === "ready";
  const [apiConnectError, setApiConnectError] = useState<string | null>(null);

  const [airports, setAirports] = useState<AirportRow[]>([]);
  const [routeAirports, setRouteAirports] = useState<AirportRow[]>([]);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [airportsError, setAirportsError] = useState<string | null>(null);

  // 航线规划页面状态（整合后的页面）
  const [showRoutePlanning, setShowRoutePlanning] = useState(false);

  // 航线规划起降机场
  const [routeDepartureIcao, setRouteDepartureIcao] = useState<string>("");
  const [routeArrivalIcao, setRouteArrivalIcao] = useState<string>("");

  // 首屏机场选择
  const [draftViewIcao, setDraftViewIcao] = useState<string>("");

  // 已确认的机场（进入主界面后）
  const [selectedIcaos, setSelectedIcaos] = useState<string[]>([]);
  const [activeIcao, setActiveIcao] = useState<string>("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [openedFileId, setOpenedFileId] = useState<number | null>(null);
  const [annotationUi, setAnnotationUi] = useState<PdfAnnotationUiState>({
    toolsOpen: false,
    mode: "browse",
    penColor: ANNOTATION_COLORS[2],
    widthKey: DEFAULT_ANNOTATION_WIDTH_KEY
  });
  const [annotationMeta, setAnnotationMeta] = useState<PdfAnnotationMeta>({
    hasPdf: false,
    currentPageIndex: 0,
    currentPageAnnotations: 0,
    totalAnnotations: 0
  });
  const [clearPageRequestKey, setClearPageRequestKey] = useState(0);
  const [clearDocumentRequestKey, setClearDocumentRequestKey] = useState(0);
  const [undoLastRequestKey, setUndoLastRequestKey] = useState(0);
  const [chartGroupFilter, setChartGroupFilter] = useState<string>("全部");
  const [viewMode, setViewMode] = useState<"全部" | "收藏">("全部");
  const [favoriteRelPaths, setFavoriteRelPaths] = useState<Set<string>>(new Set());
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const applyingBrowserRouteRef = useRef(false);

  const windowHeight = useWindowHeight();
  const { token } = theme.useToken();
  const pdfHref = openedFileId ? pdfUrl(openedFileId) : null;

  const applyRouteState = useCallback((route: AppRoute) => {
    applyingBrowserRouteRef.current = true;
    if (route.mode === "charts") {
      setShowRoutePlanning(false);
      setRouteDepartureIcao("");
      setRouteArrivalIcao("");
      setDraftViewIcao(route.icao);
      setSelectedIcaos([route.icao]);
      setActiveIcao(route.icao);
      setOpenedFileId(route.fileId);
    } else if (route.mode === "route") {
      setShowRoutePlanning(true);
      setRouteDepartureIcao(route.departure);
      setRouteArrivalIcao(route.arrival);
      setSelectedIcaos([]);
      setActiveIcao("");
      setOpenedFileId(null);
    } else {
      setShowRoutePlanning(false);
      setDraftViewIcao("");
      setSelectedIcaos([]);
      setActiveIcao("");
      setOpenedFileId(null);
    }
    window.setTimeout(() => {
      applyingBrowserRouteRef.current = false;
    }, 0);
  }, []);

  const pushUrl = useCallback((path: string) => {
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState(null, "", path);
    }
  }, []);

  const navigateHome = useCallback(() => {
    pushUrl("/");
    applyRouteState({ mode: "home" });
  }, [applyRouteState, pushUrl]);

  const navigateToCharts = useCallback((icao: string, fileId?: number | null) => {
    const normalized = normalizeIcao(icao);
    if (!normalized) return;
    pushUrl(chartPath(normalized, fileId));
    applyRouteState({ mode: "charts", icao: normalized, fileId: fileId ?? null });
  }, [applyRouteState, pushUrl]);

  const navigateToRoutePlanning = useCallback((departure: string, arrival: string) => {
    const dep = normalizeIcao(departure);
    const arr = normalizeIcao(arrival);
    if (!dep || !arr) return;
    pushUrl(routePath(dep, arr));
    applyRouteState({ mode: "route", departure: dep, arrival: arr });
  }, [applyRouteState, pushUrl]);

  useEffect(() => {
    applyRouteState(parseAppRoute());
    const onPopState = () => applyRouteState(parseAppRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyRouteState]);

  useEffect(() => {
    if (openedFileId && pdfHref) return;
    setAnnotationUi((prev) => ({
      ...prev,
      toolsOpen: false,
      mode: "browse"
    }));
    setAnnotationMeta({
      hasPdf: false,
      currentPageIndex: 0,
      currentPageAnnotations: 0,
      totalAnnotations: 0
    });
  }, [openedFileId, pdfHref]);

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
        const [chartAirportsResult, routeAirportsResult] = await Promise.allSettled([
          apiAirports(),
          apiRouteAirports()
        ]);
        const sortChartAirports = (list: AirportRow[]) => [...list].sort((a, b) => {
          const ac = Number((a as any)?.fileCount ?? 0);
          const bc = Number((b as any)?.fileCount ?? 0);
          const az = ac <= 0;
          const bz = bc <= 0;
          if (az !== bz) return az ? 1 : -1; // 没有图的机场放到最后
          return String((a as any)?.icao ?? "").localeCompare(String((b as any)?.icao ?? ""), "en");
        });
        const sortRouteAirports = (list: AirportRow[]) => [...list].sort((a, b) => String(a.icao ?? "").localeCompare(String(b.icao ?? ""), "en"));

        let chartList: AirportRow[] = [];
        if (chartAirportsResult.status === "fulfilled") {
          const raw = chartAirportsResult.value?.airports ?? [];
          chartList = Array.isArray(raw) ? raw : [];
          setAirports(sortChartAirports(chartList));
        } else {
          setAirports([]);
        }

        if (routeAirportsResult.status === "fulfilled") {
          const routeRaw = routeAirportsResult.value?.airports ?? [];
          const routeList = Array.isArray(routeRaw) ? routeRaw : [];
          setRouteAirports(sortRouteAirports(routeList));
        } else {
          setRouteAirports(sortRouteAirports(chartList));
        }

        if (chartAirportsResult.status === "rejected" && routeAirportsResult.status === "rejected") {
          throw chartAirportsResult.reason;
        }
        setAirportsError(chartAirportsResult.status === "rejected" ? (chartAirportsResult.reason as any)?.message || String(chartAirportsResult.reason) : null);
      } catch (e: any) {
        setAirportsError(e?.message || String(e));
      } finally {
        setAirportsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 切换机场时：清空筛选（收藏/分组）
  useEffect(() => {
    if (!activeIcao) return;
    setViewMode("全部");
    setChartGroupFilter("全部");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIcao]);

  useEffect(() => {
    if (!ready) return;
    if (!activeIcao) {
      setTree([]);
      setTreeError(null);
      setTreeLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setTreeLoading(true);
        const res = await apiTree(activeIcao);
        const t = (res as any)?.tree ?? [];
        if (cancelled) return;
        setTree(Array.isArray(t) ? t : []);
        setTreeError(null);
      } catch (e: any) {
        if (cancelled) return;
        setTreeError(e?.message || String(e));
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, activeIcao]);

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

  const canConfirmSelection = useMemo(() => {
    return !!draftViewIcao;
  }, [draftViewIcao]);

  const confirmSelection = () => {
    if (!canConfirmSelection) return;
    navigateToCharts(draftViewIcao);
  };

  const resetToSelection = () => {
    navigateHome();
  };

  const openFileFromSidebar = (id: number) => {
    setOpenedFileId(id);
    if (activeIcao) pushUrl(chartPath(activeIcao, id));
    if (isMobile) setSiderCollapsed(true);
  };

  // 航线规划页面（整合后）
  if (showRoutePlanning) {
    return (
      <RouteIntegratedPage
        onBack={navigateHome}
        isDark={isDark}
        initialDepartureIcao={routeDepartureIcao}
        initialArrivalIcao={routeArrivalIcao}
        onRouteAirportsChange={navigateToRoutePlanning}
      />
    );
  }

  return (
    <div style={{ height: windowHeight, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
              paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
              background: token.colorBgLayout,
              overflowY: "auto"
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
                routeAirports={routeAirports}
                airportsLoading={airportsLoading}
                airportsError={airportsError}
                themeMode={themeMode}
                onThemeModeChange={onThemeModeChange}
                draftViewIcao={draftViewIcao}
                onDraftViewIcaoChange={setDraftViewIcao}
                canConfirm={canConfirmSelection}
                onConfirm={confirmSelection}
                onClear={() => setDraftViewIcao("")}
                routeDepartureIcao={routeDepartureIcao}
                onRouteDepartureChange={setRouteDepartureIcao}
                routeArrivalIcao={routeArrivalIcao}
                onRouteArrivalChange={setRouteArrivalIcao}
                onEnterRoutePlanning={() => navigateToRoutePlanning(routeDepartureIcao, routeArrivalIcao)}
              />
            </div>
          </div>
        ) : null}

        {/* 未选择机场时不展示 Header */}
        {activeIcao ? (
          <AppHeader
            compact={compactHeader}
            siderCollapsed={siderCollapsed}
            onToggleSider={() => {
              setSiderCollapsed((v) => {
                const next = !v;
                // 开始拉出 Drawer 时先不渲染目录树
                if (isMobile && next === false) setMobileDrawerFullyOpen(false);
                return next;
              });
            }}
            ready={ready}
            airports={airports as any}
            selectedIcaos={selectedIcaos}
            activeIcao={activeIcao}
            onActiveIcaoChange={(icao) => navigateToCharts(icao)}
            onResetToSelection={resetToSelection}
            openedFileId={openedFileId}
            pdfHref={pdfHref}
            onExportFavorites={() => void exportFavorites()}
            onTriggerImport={() => importInputRef.current?.click()}
            background={token.colorBgElevated}
            borderColor={token.colorBorderSecondary}
            themeMode={themeMode}
            onThemeModeChange={onThemeModeChange}
            annotationEnabled={Boolean(openedFileId && pdfHref)}
            annotationUi={annotationUi}
            annotationMeta={annotationMeta}
            onAnnotationUiChange={setAnnotationUi}
            onClearCurrentPageAnnotations={() => setClearPageRequestKey((v) => v + 1)}
            onClearAllAnnotations={() => setClearDocumentRequestKey((v) => v + 1)}
            onUndoLastAnnotation={() => setUndoLastRequestKey((v) => v + 1)}
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
          {/* 桌面：左侧 Sider；移动端：底部 Drawer */}
          {isMobile ? null : (
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
                onActiveIcaoChange={(icao) => navigateToCharts(icao)}
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
                onOpenFileId={openFileFromSidebar}
                token={{ colorPrimary: token.colorPrimary, colorWarning: token.colorWarning }}
              />
            </Layout.Sider>
          )}

          <Layout.Content style={{ padding: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)", overflow: "hidden", minHeight: 0 }}>
            <div style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
              <PdfViewerPanel
                openedFileId={openedFileId}
                pdfHref={pdfHref}
                workerUrl={pdfWorkerUrl}
                isDark={isDark}
                borderRadius={token.borderRadiusLG}
                backgroundLayout={token.colorBgLayout}
                backgroundContainer={token.colorBgContainer}
                annotationControlsPlacement="external"
                annotationUi={annotationUi}
                onAnnotationUiChange={setAnnotationUi}
                onAnnotationMetaChange={setAnnotationMeta}
                clearPageRequestKey={clearPageRequestKey}
                clearDocumentRequestKey={clearDocumentRequestKey}
                undoLastRequestKey={undoLastRequestKey}
              />
            </div>
          </Layout.Content>

          {isMobile ? (
            <Drawer
              title="目录"
              placement="bottom"
              height="75vh"
              open={!siderCollapsed}
              onClose={() => {
                setMobileDrawerFullyOpen(false);
                setSiderCollapsed(true);
              }}
              afterOpenChange={(open) => {
                // 只有在 Drawer 动画完成后才标记 fullyOpen
                setMobileDrawerFullyOpen(open);
              }}
              maskClosable
              destroyOnClose={false}
              styles={{
                body: { padding: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)" },
                header: { borderBottom: `1px solid ${token.colorBorderSecondary}` },
                content: { background: token.colorBgContainer }
              }}
            >
              <div style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
                {!mobileDrawerFullyOpen ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ padding: 16, opacity: 0.85 }}>正在展开…</div>
                  </div>
                ) : (
                  <SidebarPanel
                    borderColor={token.colorBorderSecondary}
                    activeIcao={activeIcao}
                    selectedIcaos={selectedIcaos}
                    onActiveIcaoChange={(icao) => navigateToCharts(icao)}
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
                    onOpenFileId={openFileFromSidebar}
                    token={{ colorPrimary: token.colorPrimary, colorWarning: token.colorWarning }}
                  />
                )}
              </div>
            </Drawer>
          ) : null}
        </Layout>
        )}
    </div>
  );
}
