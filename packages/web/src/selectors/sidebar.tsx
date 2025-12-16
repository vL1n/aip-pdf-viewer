import React from "react";
import type { DataNode } from "antd/es/tree";
import { Space, Tag, Tooltip, Typography } from "antd";
import { StarFilled, StarOutlined } from "@ant-design/icons";
import type { TreeNode } from "../api";

export type ChartGroupTag = { key: string; count: number; color: string };

function getDigitGroup(n: Extract<TreeNode, { type: "file" }>): string {
  // 优先用 chartPage（例如 0C-01），否则退化用文件名
  const raw = String(n.chartPage || n.name || "").trim();
  const first = raw[0] || "";
  if (first >= "0" && first <= "9") return first;
  return "其他";
}

function getGroupColor(g: string): string {
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
  if (g === "全部") return "default";
  if (g === "其他") return "#8c8c8c";
  const n = Number(g);
  if (!Number.isNaN(n) && n >= 0 && n <= 9) return groupColors[n];
  return "#8c8c8c";
}

export function buildSidebarTreeData(input: {
  tree: TreeNode[];
  chartGroupFilter: string;
  viewMode: "全部" | "收藏";
  favoriteRelPaths: Set<string>;
  token: { colorText: string; colorTextSecondary: string; colorWarning: string };
  onToggleFavorite: (n: Extract<TreeNode, { type: "file" }>) => void;
}): DataNode[] {
  const { tree, chartGroupFilter, viewMode, favoriteRelPaths, token, onToggleFavorite } = input;
  const isAll = chartGroupFilter === "全部";

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

  const toData = (nodes: TreeNode[]): DataNode[] => {
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
                  onToggleFavorite(n);
                }}
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                {isFav ? (
                  <StarFilled style={{ color: token.colorWarning }} />
                ) : (
                  <StarOutlined style={{ color: token.colorTextSecondary }} />
                )}
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
  };

  return toData(filtered);
}

export function buildChartGroupTags(input: {
  tree: TreeNode[];
  viewMode: "全部" | "收藏";
  favoriteRelPaths: Set<string>;
}): ChartGroupTag[] {
  const { tree, viewMode, favoriteRelPaths } = input;
  const counts = new Map<string, number>();

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

  const total = Array.from(counts.values()).reduce((s, c) => s + c, 0);
  return [
    { key: "全部", count: total, color: getGroupColor("全部") },
    ...keys.map((k) => ({ key: k, count: counts.get(k)!, color: getGroupColor(k) }))
  ];
}


