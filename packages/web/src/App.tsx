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
  type AirportRow,
  type IndexStatus,
  type TreeNode
} from "./api";
import {
  Alert,
  Button,
  Divider,
  Dropdown,
  Empty,
  Grid,
  Layout,
  message,
  Progress,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme
} from "antd";
import type { DataNode } from "antd/es/tree";
import { Tree } from "antd";
import {
  DownloadOutlined,
  FilePdfOutlined,
  MoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  StarFilled,
  StarOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { SpecialZoomLevel, Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export function App() {
  const screens = Grid.useBreakpoint();
  const compactHeader = !screens.md;
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const ready = indexStatus?.phase === "ready";
  const [apiConnectError, setApiConnectError] = useState<string | null>(null);

  const [airports, setAirports] = useState<AirportRow[]>([]);
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
        const list: AirportRow[] = Array.isArray(raw) ? (raw as AirportRow[]) : [];
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
    const isAll = chartGroupFilter === "全部";

    const getDigitGroup = (n: Extract<TreeNode, { type: "file" }>): string => {
      // 优先用 chartPage（例如 0C-01），否则退化用文件名
      const raw = String(n.chartPage || n.name || "").trim();
      const first = raw[0] || "";
      if (first >= "0" && first <= "9") return first;
      return "其他";
    };

    const applyFilterOnly = (nodes: TreeNode[]): TreeNode[] => {
      const out: TreeNode[] = [];
      for (const n of nodes) {
        if (n.type === "dir") {
          const nextChildren = applyFilterOnly(n.children);
          if (nextChildren.length) out.push({ ...n, children: nextChildren });
        } else {
          const g = getDigitGroup(n);
          const matchGroup = isAll || g === chartGroupFilter;
          const matchFav = viewMode === "全部" || favoriteRelPaths.has(n.relPath);
          if (matchGroup && matchFav) out.push(n);
        }
      }
      return out;
    };

    const filtered = applyFilterOnly(tree);

    const groupColors = [
      "magenta",
      "red",
      "volcano",
      "orange",
      "gold",
      "lime",
      "green",
      "cyan",
      "blue",
      "geekblue"
    ] as const;
    const getGroupColor = (g: string) => {
      if (g === "其他") return "#8c8c8c";
      const n = Number(g);
      if (!Number.isNaN(n) && n >= 0 && n <= 9) return groupColors[n];
      return "#8c8c8c";
    };

    function toData(nodes: TreeNode[]): DataNode[] {
      return nodes.map((n) => {
        if (n.type === "dir") {
          return {
            key: `d:${n.path}`,
            title: (
              <Typography.Text strong style={{ color: token.colorText }}>
                {n.name}
              </Typography.Text>
            ),
            children: toData(n.children)
          };
        }
        const g = getDigitGroup(n);
        const gColor = getGroupColor(g);
        const isFav = favoriteRelPaths.has(n.relPath);
        const title = (() => {
          const parts: string[] = [];
          if (n.chartName) parts.push(n.chartName);
          if (n.chartType) parts.push(n.chartType);
          if (n.isSup) parts.push("SUP");
          if (n.chartPage) parts.push(n.chartPage);
          if (g) parts.push(`分组:${g}`);
          return parts.join(" · ");
        })();
        const meta = (
          <div style={{ width: "100%", minWidth: 0 }}>
            {/* 第一行：标题 + 星标 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
              <Typography.Text strong ellipsis={{ tooltip: n.name }} style={{ minWidth: 0, flex: "1 1 auto" }}>
                {n.name}
              </Typography.Text>
              <Tooltip title={isFav ? "取消收藏" : "收藏"}>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void toggleFavoriteByNode(n);
                  }}
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  {isFav ? <StarFilled style={{ color: token.colorWarning }} /> : <StarOutlined style={{ color: token.colorTextSecondary }} />}
                </span>
              </Tooltip>
            </div>
            {/* 第二行：tags（可换行，不与标题同一行） */}
            <div style={{ marginTop: 6 }}>
              <Space size={[6, 6]} wrap>
                <Tag color={gColor as any} style={{ marginInlineEnd: 0 }}>
                  {g}
                </Tag>
                {n.chartName ? (
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    {n.chartName}
                  </Tag>
                ) : null}
                {n.chartType ? <Tag style={{ marginInlineEnd: 0, opacity: 0.9 }}>{n.chartType}</Tag> : null}
                {n.isSup ? (
                  <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                    SUP
                  </Tag>
                ) : null}
                {n.chartPage ? <Tag style={{ marginInlineEnd: 0, opacity: 0.75 }}>{n.chartPage}</Tag> : null}
              </Space>
            </div>
          </div>
        );
        return {
          key: `f:${n.id}`,
          title: meta,
          isLeaf: true
        };
      });
    }
    return toData(filtered);
  }, [tree, chartGroupFilter, viewMode, favoriteRelPaths, token.colorText, token.colorTextSecondary, token.colorWarning]);

  const chartGroupTags = useMemo(() => {
    const counts = new Map<string, number>();
    const getDigitGroup = (n: Extract<TreeNode, { type: "file" }>): string => {
      const raw = String(n.chartPage || n.name || "").trim();
      const first = raw[0] || "";
      if (first >= "0" && first <= "9") return first;
      return "其他";
    };
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "file") {
          if (viewMode === "收藏" && !favoriteRelPaths.has(n.relPath)) continue;
          const g = getDigitGroup(n);
          counts.set(g, (counts.get(g) || 0) + 1);
        } else walk(n.children);
      }
    };
    walk(tree);
    const keys = Array.from(counts.keys()).sort((a, b) => {
      if (a === "其他") return 1;
      if (b === "其他") return -1;
      return a.localeCompare(b, "en", { numeric: true });
    });
    const groupColors = [
      "magenta",
      "red",
      "volcano",
      "orange",
      "gold",
      "lime",
      "green",
      "cyan",
      "blue",
      "geekblue"
    ] as const;
    const getGroupColor = (g: string) => {
      if (g === "全部") return "default";
      if (g === "其他") return "#8c8c8c";
      const n = Number(g);
      if (!Number.isNaN(n) && n >= 0 && n <= 9) return groupColors[n];
      return "#8c8c8c";
    };
    const total = Array.from(counts.values()).reduce((s, c) => s + c, 0);
    return [
      { key: "全部", count: total, color: getGroupColor("全部") },
      ...keys.map((k) => ({ key: k, count: counts.get(k)!, color: getGroupColor(k) }))
    ];
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

  const airportLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of airports) {
      m.set(a.icao, `${a.icao}${a.name ? ` - ${a.name}` : ""}`);
    }
    return m;
  }, [airports]);

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
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  请选择机场
                </Typography.Title>
                <Typography.Text type="secondary">
                  先选择模式，再选择机场；点击确认后进入详情。
                </Typography.Text>

                {airportsError ? <Alert type="error" showIcon message={`机场列表错误：${airportsError}`} /> : null}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                  <Typography.Text type="secondary">模式</Typography.Text>
                  <Segmented
                    value={selectModeDraft}
                    onChange={(v) => setSelectModeDraft(v as any)}
                    options={[
                      { label: "查看模式（单机场）", value: "view" },
                      { label: "航线模式（起/降）", value: "route" }
                    ]}
                  />
                </div>

                <Select
                  style={{ width: "100%" }}
                  value={selectModeDraft === "view" ? (draftViewIcao || undefined) : undefined}
                  onChange={(v: string | undefined) => setDraftViewIcao(v || "")}
                  loading={airportsLoading}
                  disabled={airportsLoading || airports.length === 0 || selectModeDraft !== "view"}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={airports.map((a) => ({
                    value: a.icao,
                    label: `${a.icao} ${a.name ? `- ${a.name}` : ""} (${a.fileCount})`
                  }))}
                  placeholder={airportsLoading ? "正在加载机场列表…" : "选择 ICAO"}
                />

                {selectModeDraft === "route" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <Typography.Text type="secondary">起飞</Typography.Text>
                      <Select
                        style={{ width: "100%", marginTop: 6 }}
                        value={draftRouteFromIcao || undefined}
                        onChange={(v: string | undefined) => {
                          const next = v || "";
                          setDraftRouteFromIcao(next);
                          if (next && draftRouteToIcao === next) setDraftRouteToIcao("");
                        }}
                        loading={airportsLoading}
                        disabled={airportsLoading || airports.length === 0}
                        showSearch
                        allowClear
                        optionFilterProp="label"
                        options={airports.map((a) => ({
                          value: a.icao,
                          label: `${a.icao} ${a.name ? `- ${a.name}` : ""} (${a.fileCount})`
                        }))}
                        placeholder="选择起飞机场"
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <Typography.Text type="secondary">降落</Typography.Text>
                      <Select
                        style={{ width: "100%", marginTop: 6 }}
                        value={draftRouteToIcao || undefined}
                        onChange={(v: string | undefined) => {
                          const next = v || "";
                          setDraftRouteToIcao(next);
                          if (next && draftRouteFromIcao === next) setDraftRouteFromIcao("");
                        }}
                        loading={airportsLoading}
                        disabled={airportsLoading || airports.length === 0}
                        showSearch
                        allowClear
                        optionFilterProp="label"
                        options={airports
                          .filter((a) => !draftRouteFromIcao || a.icao !== draftRouteFromIcao)
                          .map((a) => ({
                            value: a.icao,
                            label: `${a.icao} ${a.name ? `- ${a.name}` : ""} (${a.fileCount})`
                          }))}
                        placeholder="选择降落机场"
                      />
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <Button
                    onClick={() => {
                      setDraftViewIcao("");
                      setDraftRouteFromIcao("");
                      setDraftRouteToIcao("");
                    }}
                    disabled={!draftViewIcao && !draftRouteFromIcao && !draftRouteToIcao}
                  >
                    清空
                  </Button>
                  <Button type="primary" onClick={confirmSelection} disabled={!canConfirmSelection}>
                    确认进入
                  </Button>
                </div>
              </Space>
            </div>
          </div>
        ) : null}

        {/* 未选择机场时不展示 Header */}
        {activeIcao ? (
          <Layout.Header
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              flexWrap: "nowrap",
              whiteSpace: "nowrap",
              height: 64,
              lineHeight: "normal",
              paddingInline: 12,
              background: token.colorBgElevated,
              borderBottom: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            <Space size={12} align="center" style={{ width: "100%", justifyContent: "space-between", minWidth: 0 }}>
              <Space size={12} align="center" style={{ minWidth: 0, overflow: "hidden" }}>
                <Button
                  type="text"
                  aria-label={siderCollapsed ? "展开侧边栏" : "收起侧边栏"}
                  icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setSiderCollapsed((v) => !v)}
                />
                <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
                  Charts Viewer
                </Typography.Text>
              </Space>

              <Space
                size={12}
                align="center"
                style={{ minWidth: 0, justifyContent: "flex-end", flexWrap: "nowrap" }}
              >
                <Select
                  style={{ width: 280, maxWidth: "35vw", flex: "0 1 280px" }}
                  value={activeIcao || undefined}
                  onChange={(v: string | undefined) => setActiveIcao(v || "")}
                  loading={airportsLoading}
                  disabled={!ready || selectedIcaos.length === 0}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={selectedIcaos.map((icao) => ({
                    value: icao,
                    label: airportLabelMap.get(icao) || icao
                  }))}
                  placeholder="切换机场"
                />

                <Button onClick={resetToSelection}>重新选择</Button>

                {compactHeader ? (
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "export",
                          icon: <DownloadOutlined />,
                          label: "导出收藏",
                          onClick: () => void exportFavorites()
                        },
                        {
                          key: "import",
                          icon: <UploadOutlined />,
                          label: "导入收藏",
                          onClick: () => importInputRef.current?.click()
                        }
                      ]
                    }}
                  >
                    <Button icon={<MoreOutlined />} aria-label="更多" />
                  </Dropdown>
                ) : (
                  <>
                    <Button icon={<DownloadOutlined />} onClick={() => void exportFavorites()}>
                      导出收藏
                    </Button>
                    <Button
                      icon={<UploadOutlined />}
                      onClick={() => {
                        importInputRef.current?.click();
                      }}
                    >
                      导入收藏
                    </Button>
                  </>
                )}

              {openedFileId ? (
                <Tooltip title="新窗口打开">
                  <Button
                    icon={<FilePdfOutlined />}
                    href={pdfUrl(openedFileId)}
                    target="_blank"
                    type="default"
                    aria-label="新窗口打开"
                  >
                    {compactHeader ? null : "新窗口打开"}
                  </Button>
                </Tooltip>
              ) : null}
            </Space>
          </Space>
          </Layout.Header>
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
          <div
            style={{
              flex: "0 0 auto",
              padding: 12,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgLayout
            }}
          >
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {apiConnectError ? <Alert type="error" showIcon message={apiConnectError} /> : null}
              <Alert
                type={indexStatus?.phase === "error" ? "error" : "info"}
                message={indexStatus?.phase === "error" ? "索引失败" : "正在构建索引…"}
                description={
                  <Space wrap>
                    <Typography.Text>{indexStatus?.message || "请稍候"}</Typography.Text>
                    {indexStatus?.totalPdfs != null ? (
                      <Typography.Text className="mono">
                        {Math.min(indexStatus.processedPdfs, indexStatus.totalPdfs)}/{indexStatus.totalPdfs}
                      </Typography.Text>
                    ) : null}
                  </Space>
                }
                showIcon
              />
              <Progress percent={progressPercent} status={indexStatus?.phase === "error" ? "exception" : "active"} />
              {indexStatus?.phase === "error" && indexStatus.lastError ? (
                <Typography.Paragraph style={{ margin: 0 }} type="danger">
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{indexStatus.lastError}</pre>
                </Typography.Paragraph>
              ) : null}
            </Space>
          </div>
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
            <div
              style={{
                height: "100%",
                minHeight: 0,
                overflow: "hidden",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 12
              }}
            >
              {/* 固定区：标题 + Tags（不随目录树滚动） */}
              <div style={{ flex: "0 0 auto" }}>
                <Space direction="vertical" style={{ width: "100%" }} size={12}>
                  {/* 双机场模式：起/降快速切换（在筛选区固定显示） */}
                  {selectedIcaos.length === 2 ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                        paddingBottom: 8,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`
                      }}
                    >
                      <Typography.Text type="secondary">起/降机场</Typography.Text>
                      <Segmented
                        value={activeIcao}
                        onChange={(v) => setActiveIcao(String(v))}
                        options={[
                          { label: `起 ${selectedIcaos[0]}`, value: selectedIcaos[0] },
                          { label: `降 ${selectedIcaos[1]}`, value: selectedIcaos[1] }
                        ]}
                      />
                    </div>
                  ) : null}
                  {/* 收藏筛选（固定区，与你反馈的“分组 Tag 区域”在同一块） */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      paddingBottom: 8,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`
                    }}
                  >
                    <Tag
                      color={viewMode === "全部" ? "blue" : "default"}
                      onClick={() => {
                        setViewMode("全部");
                        setChartGroupFilter("全部");
                      }}
                      style={{
                        marginInlineEnd: 0,
                        cursor: "pointer",
                        userSelect: "none",
                        opacity: viewMode === "全部" ? 1 : 0.85,
                        outline: viewMode === "全部" ? `2px solid ${token.colorPrimary}` : "none",
                        outlineOffset: 1
                      }}
                    >
                      全部
                    </Tag>
                    <Tag
                      color={viewMode === "收藏" ? "gold" : "default"}
                      onClick={() => {
                        setViewMode("收藏");
                        setChartGroupFilter("全部");
                      }}
                      style={{
                        marginInlineEnd: 0,
                        cursor: "pointer",
                        userSelect: "none",
                        opacity: viewMode === "收藏" ? 1 : 0.85,
                        outline: viewMode === "收藏" ? `2px solid ${token.colorPrimary}` : "none",
                        outlineOffset: 1
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <StarFilled style={{ color: token.colorWarning }} />
                        收藏{typeof favoritesCount === "number" ? `(${favoritesCount})` : ""}
                      </span>
                    </Tag>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      paddingBottom: 8,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`
                    }}
                  >
                    {chartGroupTags.map((g) => (
                      <Tag
                        key={g.key}
                        color={g.color as any}
                        onClick={() => setChartGroupFilter(g.key)}
                        style={{
                          marginInlineEnd: 0,
                          cursor: "pointer",
                          userSelect: "none",
                          opacity: chartGroupFilter === g.key ? 1 : 0.85,
                          outline: chartGroupFilter === g.key ? `2px solid ${token.colorPrimary}` : "none",
                          outlineOffset: 1
                        }}
                      >
                        {g.key}
                        {typeof g.count === "number" ? (
                          <span style={{ marginLeft: 6, opacity: 0.75 }}>({g.count})</span>
                        ) : null}
                      </Tag>
                    ))}
                  </div>
                </Space>
              </div>

              {/* 滚动区：错误提示 + 目录树（非虚拟滚动） */}
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
                <Space direction="vertical" style={{ width: "100%" }} size={12}>
                  {airportsError ? <Alert type="error" showIcon message={`机场列表错误：${airportsError}`} /> : null}
                  {treeError ? <Alert type="error" showIcon message={`树加载错误：${treeError}`} /> : null}
                  <Spin spinning={treeLoading}>
                    {tree.length === 0 && !treeLoading ? (
                      <Empty description="没有找到 PDF" />
                    ) : (
                      <Tree
                        defaultExpandAll
                        blockNode
                        treeData={sidebarTree}
                        onSelect={(keys: React.Key[]) => {
                          const k = String(keys[0] ?? "");
                          if (k.startsWith("f:")) {
                            const id = Number(k.slice(2));
                            if (!Number.isNaN(id)) setOpenedFileId(id);
                          }
                        }}
                      />
                    )}
                  </Spin>
                </Space>
              </div>
            </div>
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
                    // 让圆角“看得见”：加一层内边距/底色，避免 PDF 内容与滚动条贴边把圆角视觉上“顶没”
                    padding: 8,
                    background: token.colorBgLayout,
                    boxSizing: "border-box"
                  }}
                >
                  {openedFileId ? (
                    <div
                      style={{
                        height: "100%",
                        minHeight: 0,
                        overflow: "hidden",
                        borderRadius: token.borderRadiusLG - 2,
                        background: token.colorBgContainer
                      }}
                    >
                      {/* 让 @react-pdf-viewer 自己管理内部滚动；外层不要再包一层 overflow:auto，
                          否则在 flex 里可能导致后续页一直处于 loading（视口/虚拟渲染判断异常）。 */}
                      <div style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
                        <Worker
                          // Vite 下推荐用 pdfjs-dist 的 worker（无需外网 CDN）
                          workerUrl={pdfWorkerUrl}
                        >
                          <Viewer
                            fileUrl={pdfUrl(openedFileId)}
                            defaultScale={SpecialZoomLevel.PageFit}
                            plugins={[pdfLayoutPlugin]}
                          />
                        </Worker>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: 24 }}>
                      <Empty description="点击左侧文件即可打开" />
                    </div>
                  )}
                </div>
              </Layout.Content>
            </Layout>
          </Layout.Content>
        </Layout>
        )}
    </div>
  );
}


