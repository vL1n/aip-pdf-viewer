/* @refresh reset */
import React, { useEffect, useMemo, useState } from "react";

import {
  apiAirports,
  apiIndexStatus,
  apiRebuildIndex,
  apiSearch,
  apiTree,
  pdfUrl,
  type AirportRow,
  type IndexStatus,
  type SearchItem,
  type TreeNode
} from "./api";
import {
  Alert,
  Button,
  Collapse,
  Divider,
  Empty,
  Input,
  Layout,
  List,
  message,
  Progress,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  theme
} from "antd";
import type { DataNode } from "antd/es/tree";
import { Tree } from "antd";
import { FilePdfOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type Mode = "tree" | "search";

export function App() {
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const ready = indexStatus?.phase === "ready";
  const [apiConnectError, setApiConnectError] = useState<string | null>(null);

  const [airports, setAirports] = useState<AirportRow[]>([]);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [airportsError, setAirportsError] = useState<string | null>(null);

  const [selectedIcao, setSelectedIcao] = useState<string>("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("tree");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchItems, setSearchItems] = useState<SearchItem[]>([]);

  const [openedFileId, setOpenedFileId] = useState<number | null>(null);

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
        const list = (res as any)?.airports ?? [];
        setAirports(Array.isArray(list) ? list : []);
        setAirportsError(null);
        if (!selectedIcao && Array.isArray(list) && list.length) setSelectedIcao(list[0]!.icao);
      } catch (e: any) {
        setAirportsError(e?.message || String(e));
      } finally {
        setAirportsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    if (!selectedIcao) return;
    (async () => {
      try {
        setTreeLoading(true);
        const res = await apiTree(selectedIcao);
        const t = (res as any)?.tree ?? [];
        setTree(Array.isArray(t) ? t : []);
        setTreeError(null);
      } catch (e: any) {
        setTreeError(e?.message || String(e));
      } finally {
        setTreeLoading(false);
      }
    })();
  }, [selectedIcao]);

  const groupedSearch = useMemo(() => {
    const map = new Map<string, SearchItem[]>();
    for (const it of searchItems) {
      const key = it.icao || "UNKNOWN";
      const arr = map.get(key) || [];
      arr.push(it);
      map.set(key, arr);
    }
    const keys = Array.from(map.keys()).sort();
    return keys.map((k) => ({ icao: k, items: map.get(k)! }));
  }, [searchItems]);

  const sidebarTree = useMemo(() => {
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
        const meta = (
          <div className="treeFileTitle">
            <div className="treeFileTitleLine">
              <Typography.Text strong ellipsis={{ tooltip: n.name }}>
                {n.name}
              </Typography.Text>
            </div>
            <div className="treeFileTagLine">
              <Space size={[6, 6]} wrap>
                {n.chartName ? (
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    {n.chartName}
                  </Tag>
                ) : null}
                {n.chartType ? (
                  <Tag style={{ marginInlineEnd: 0, opacity: 0.9 }}>{n.chartType}</Tag>
                ) : null}
                {n.isSup ? (
                  <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                    SUP
                  </Tag>
                ) : null}
                {n.chartPage ? (
                  <Tag style={{ marginInlineEnd: 0, opacity: 0.75 }}>{n.chartPage}</Tag>
                ) : null}
              </Space>
            </div>
          </div>
        );
        return {
          key: `f:${n.id}`,
          icon: <FilePdfOutlined />,
          title: meta,
          isLeaf: true
        };
      });
    }
    return toData(tree);
  }, [tree]);

  const progressPercent = useMemo(() => {
    if (!indexStatus?.totalPdfs || indexStatus.totalPdfs <= 0) return 0;
    return Math.floor((Math.min(indexStatus.processedPdfs, indexStatus.totalPdfs) / indexStatus.totalPdfs) * 100);
  }, [indexStatus]);

  async function doSearch() {
    if (!ready) return;
    const q = query.trim();
    if (!q) {
      setMode("tree");
      setSearchItems([]);
      setSearchError(null);
      return;
    }
    try {
      setMode("search");
      setSearchLoading(true);
      const res = await apiSearch(q, selectedIcao || undefined);
      const items = (res as any)?.items ?? [];
      setSearchItems(Array.isArray(items) ? items : []);
      setSearchError(null);
    } catch (e: any) {
      setSearchError(e?.message || String(e));
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Layout.Header
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            height: 64,
            lineHeight: "normal",
            paddingInline: 12,
            background: token.colorBgElevated,
            borderBottom: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <Space size={12} align="center" style={{ width: "100%", justifyContent: "space-between" }}>
            <Space size={12} align="center" style={{ minWidth: 0 }}>
              <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                NAIP PDF Viewer
              </Typography.Text>
              <Divider type="vertical" style={{ height: 24, marginInline: 4 }} />
            </Space>

            <Space size={12} align="center" style={{ minWidth: 0, justifyContent: "flex-end" }} wrap>
              <Select
                style={{ width: 320 }}
                value={selectedIcao || undefined}
                onChange={(v: string) => setSelectedIcao(v)}
                loading={airportsLoading}
                disabled={!ready || airports.length === 0}
                showSearch
                optionFilterProp="label"
                options={airports.map((a) => ({
                  value: a.icao,
                  label: `${a.icao} ${a.name ? `- ${a.name}` : ""} (${a.fileCount})`
                }))}
                placeholder="选择 ICAO"
              />

              <Input.Search
                style={{ width: 520, maxWidth: "55vw" }}
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                onSearch={() => void doSearch()}
                allowClear
                disabled={!ready}
                placeholder="模糊搜索：文件名 / 航图名 / 类型 / ICAO（支持空格多词）"
                enterButton={<SearchOutlined />}
              />

              <Button
                icon={<ReloadOutlined />}
                disabled={!ready}
                onClick={() => {
                  void (async () => {
                    try {
                      await apiRebuildIndex();
                      message.success("已触发重建索引");
                    } catch (e: any) {
                      message.error(e?.message || "触发失败");
                    }
                  })();
                }}
              >
                重建索引
              </Button>

              {openedFileId ? (
                <Button
                  icon={<FilePdfOutlined />}
                  href={pdfUrl(openedFileId)}
                  target="_blank"
                  type="default"
                >
                  新窗口打开
                </Button>
              ) : null}
            </Space>
          </Space>
        </Layout.Header>

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

        <Layout style={{ flex: "1 1 auto", minHeight: 0 }}>
          <Layout.Sider
            width={420}
            collapsible
            collapsedWidth={0}
            theme="light"
            style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: "hidden", height: "100%" }}
          >
            <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden", padding: 12 }}>
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
                  <Typography.Text strong>{mode === "search" ? "搜索结果" : "目录树"}</Typography.Text>
                  <Space size={8}>
                    <Button
                      size="small"
                      onClick={() => {
                        setMode("tree");
                        setSearchItems([]);
                        setSearchError(null);
                      }}
                      disabled={mode === "tree"}
                    >
                      目录
                    </Button>
                    <Button size="small" onClick={() => setMode("search")} disabled={mode === "search"}>
                      搜索
                    </Button>
                  </Space>
                </Space>

                {airportsError ? <Alert type="error" showIcon message={`机场列表错误：${airportsError}`} /> : null}
                {treeError ? <Alert type="error" showIcon message={`树加载错误：${treeError}`} /> : null}
                {searchError ? <Alert type="error" showIcon message={`搜索错误：${searchError}`} /> : null}

                {mode === "tree" ? (
                  <Spin spinning={treeLoading}>
                    {tree.length === 0 && !treeLoading ? (
                      <Empty description="没有找到 PDF" />
                    ) : (
                      <Tree
                        showIcon
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
                ) : (
                  <div>
                    <Spin spinning={searchLoading}>
                      {groupedSearch.length === 0 && !searchLoading ? (
                        <Empty description="没有结果" />
                      ) : (
                        <Collapse
                          size="small"
                          defaultActiveKey={groupedSearch.map((g) => g.icao)}
                          items={groupedSearch.map((g) => ({
                            key: g.icao,
                            label: `${g.icao}（${g.items[0]?.airport_name || ""}） - ${g.items.length} 条`,
                            children: (
                              <List
                                size="small"
                                dataSource={g.items}
                                renderItem={(it: SearchItem) => (
                                  <List.Item
                                    style={{ cursor: "pointer" }}
                                    onClick={() => setOpenedFileId(it.id)}
                                  >
                                    <List.Item.Meta
                                      title={
                                        <Space wrap>
                                          <Typography.Text strong>
                                            {it.chart_name ? it.chart_name : it.filename}
                                          </Typography.Text>
                                          {it.chart_type ? <Tag>{it.chart_type}</Tag> : null}
                                          {it.group_key ? <Tag color="blue">{it.group_key}</Tag> : null}
                                        </Space>
                                      }
                                      description={
                                        <Typography.Text type="secondary" className="mono">
                                          {it.filename}
                                        </Typography.Text>
                                      }
                                    />
                                  </List.Item>
                                )}
                              />
                            )
                          }))}
                        />
                      )}
                    </Spin>
                  </div>
                )}
              </Space>
            </div>
          </Layout.Sider>

          <Layout.Content style={{ padding: 12, overflow: "hidden" }}>
            <Layout style={{ height: "100%", background: token.colorBgLayout, minHeight: 0 }}>
              <Layout.Content
                style={{
                  height: "100%",
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  overflow: "hidden"
                }}
              >
                <div style={{ height: "100%", overflow: "hidden" }}>
                  {openedFileId ? (
                    <div style={{ height: "100%", overflow: "hidden" }}>
                      <Worker
                        // Vite 下推荐用 pdfjs-dist 的 worker（无需外网 CDN）
                        workerUrl={pdfWorkerUrl}
                      >
                        <Viewer fileUrl={pdfUrl(openedFileId)} plugins={[pdfLayoutPlugin]} />
                      </Worker>
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
    </div>
  );
}


