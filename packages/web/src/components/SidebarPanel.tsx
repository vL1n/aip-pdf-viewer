import React from "react";
import { Alert, Empty, Space, Spin, Tag, Typography } from "antd";
import { Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import type { ChartGroupTag } from "../selectors/sidebar";

export function SidebarPanel(props: {
  borderColor: string;
  activeIcao: string;
  selectedIcaos: string[];
  onActiveIcaoChange: (icao: string) => void;

  viewMode: "全部" | "收藏";
  onViewModeChange: (m: "全部" | "收藏") => void;
  favoritesCount: number;
  chartGroupFilter: string;
  onChartGroupFilterChange: (g: string) => void;
  chartGroupTags: ChartGroupTag[];

  airportsError: string | null;
  treeError: string | null;
  treeLoading: boolean;
  treeHasAny: boolean;
  treeData: DataNode[];
  onOpenFileId: (id: number) => void;

  token: { colorPrimary: string; colorWarning: string };
}) {
  const {
    borderColor,
    activeIcao,
    selectedIcaos,
    onActiveIcaoChange,
    viewMode,
    onViewModeChange,
    favoritesCount,
    chartGroupFilter,
    onChartGroupFilterChange,
    chartGroupTags,
    airportsError,
    treeError,
    treeLoading,
    treeHasAny,
    treeData,
    onOpenFileId,
    token
  } = props;

  return (
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
      {/* 固定区：切换 + Tags（不随目录树滚动） */}
      <div style={{ flex: "0 0 auto" }}>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {/* 双机场模式：起/降快速切换 */}
          {selectedIcaos.length === 2 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                paddingBottom: 8,
                borderBottom: `1px solid ${borderColor}`
              }}
            >
              <Typography.Text type="secondary">起/降机场</Typography.Text>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Tag
                  color={activeIcao === selectedIcaos[0] ? "blue" : "default"}
                  onClick={() => onActiveIcaoChange(selectedIcaos[0])}
                  style={{
                    marginInlineEnd: 0,
                    cursor: "pointer",
                    userSelect: "none",
                    outline: activeIcao === selectedIcaos[0] ? `2px solid ${token.colorPrimary}` : "none",
                    outlineOffset: 1
                  }}
                >
                  起 {selectedIcaos[0]}
                </Tag>
                <Tag
                  color={activeIcao === selectedIcaos[1] ? "blue" : "default"}
                  onClick={() => onActiveIcaoChange(selectedIcaos[1])}
                  style={{
                    marginInlineEnd: 0,
                    cursor: "pointer",
                    userSelect: "none",
                    outline: activeIcao === selectedIcaos[1] ? `2px solid ${token.colorPrimary}` : "none",
                    outlineOffset: 1
                  }}
                >
                  降 {selectedIcaos[1]}
                </Tag>
              </div>
            </div>
          ) : null}

          {/* 收藏筛选 */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              paddingBottom: 8,
              borderBottom: `1px solid ${borderColor}`
            }}
          >
            <Tag
              color={viewMode === "全部" ? "blue" : "default"}
              onClick={() => {
                onViewModeChange("全部");
                onChartGroupFilterChange("全部");
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
                onViewModeChange("收藏");
                onChartGroupFilterChange("全部");
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
                <span style={{ width: 8, height: 8, borderRadius: 999, background: token.colorWarning, display: "inline-block" }} />
                收藏{typeof favoritesCount === "number" ? `(${favoritesCount})` : ""}
              </span>
            </Tag>
          </div>

          {/* 分组 Tag */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              paddingBottom: 8,
              borderBottom: `1px solid ${borderColor}`
            }}
          >
            {chartGroupTags.map((g) => (
              <Tag
                key={g.key}
                color={g.color as any}
                onClick={() => onChartGroupFilterChange(g.key)}
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
                <span style={{ marginLeft: 6, opacity: 0.75 }}>({g.count})</span>
              </Tag>
            ))}
          </div>
        </Space>
      </div>

      {/* 滚动区：错误提示 + 目录树 */}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {airportsError ? <Alert type="error" showIcon message={`机场列表错误：${airportsError}`} /> : null}
          {treeError ? <Alert type="error" showIcon message={`树加载错误：${treeError}`} /> : null}
          <Spin spinning={treeLoading}>
            {!treeHasAny && !treeLoading ? (
              <Empty description="没有找到 PDF" />
            ) : (
              <Tree
                defaultExpandAll
                blockNode
                treeData={treeData}
                onSelect={(keys: React.Key[]) => {
                  const k = String(keys[0] ?? "");
                  if (k.startsWith("f:")) {
                    const id = Number(k.slice(2));
                    if (!Number.isNaN(id)) onOpenFileId(id);
                  }
                }}
              />
            )}
          </Spin>
        </Space>
      </div>
    </div>
  );
}


