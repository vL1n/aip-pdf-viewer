import React from "react";
import { Button, Dropdown, Layout, Popconfirm, Select, Space, Tooltip, Typography } from "antd";
import type { AirportRow } from "../api";
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FormOutlined,
  HighlightOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  UploadOutlined
} from "@ant-design/icons";
import type { ThemeMode } from "../hooks/useThemeMode";
import { PEN_COLORS, type PdfAnnotationMeta, type PdfAnnotationUiState } from "./PdfViewerPanel";

export function AppHeader(props: {
  compact: boolean;
  siderCollapsed: boolean;
  onToggleSider: () => void;

  ready: boolean;
  airports: AirportRow[];
  selectedIcaos: string[];
  activeIcao: string;
  onActiveIcaoChange: (icao: string) => void;
  onResetToSelection: () => void;

  openedFileId: number | null;
  pdfHref: string | null;

  onExportFavorites: () => void;
  onTriggerImport: () => void;

  background: string;
  borderColor: string;

  themeMode: ThemeMode;
  onThemeModeChange: (m: ThemeMode) => void;

  annotationEnabled: boolean;
  annotationUi: PdfAnnotationUiState;
  annotationMeta: PdfAnnotationMeta;
  onAnnotationUiChange: (next: PdfAnnotationUiState) => void;
  onClearCurrentPageAnnotations: () => void;
  onClearAllAnnotations: () => void;
}) {
  const {
    compact,
    siderCollapsed,
    onToggleSider,
    ready,
    airports,
    selectedIcaos,
    activeIcao,
    onActiveIcaoChange,
    onResetToSelection,
    openedFileId,
    pdfHref,
    onExportFavorites,
    onTriggerImport,
    background,
    borderColor,
    themeMode,
    onThemeModeChange,
    annotationEnabled,
    annotationUi,
    annotationMeta,
    onAnnotationUiChange,
    onClearCurrentPageAnnotations,
    onClearAllAnnotations
  } = props;

  const labelMap = new Map<string, string>();
  for (const a of airports) labelMap.set(a.icao, `${a.icao}${a.name ? ` - ${a.name}` : ""}`);

  const airportOptions = selectedIcaos.map((icao) => ({
    value: icao,
    label: labelMap.get(icao) || icao
  }));
  const isRouteMode = selectedIcaos.length === 2;
  const annotationModeOpen = annotationEnabled && annotationUi.toolsOpen;

  const openPdfInNewWindow = () => {
    if (!pdfHref) return;
    window.open(pdfHref, "_blank", "noopener,noreferrer");
  };

  const toggleAnnotationTools = () => {
    const nextToolsOpen = !annotationUi.toolsOpen;
    onAnnotationUiChange({
      ...annotationUi,
      toolsOpen: nextToolsOpen,
      mode: nextToolsOpen ? (annotationUi.mode === "browse" ? "pen" : annotationUi.mode) : "browse"
    });
  };

  const setAnnotationMode = (mode: PdfAnnotationUiState["mode"]) => {
    onAnnotationUiChange({
      ...annotationUi,
      mode
    });
  };

  const setAnnotationPenColor = (color: string) => {
    onAnnotationUiChange({
      ...annotationUi,
      penColor: color,
      mode: "pen"
    });
  };

  const themeItems = [
    {
      key: "theme-system",
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {themeMode === "system" ? <CheckOutlined /> : <span style={{ width: 14 }} />}
          跟随系统
        </span>
      ),
      onClick: () => onThemeModeChange("system")
    },
    {
      key: "theme-light",
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {themeMode === "light" ? <CheckOutlined /> : <span style={{ width: 14 }} />}
          浅色
        </span>
      ),
      onClick: () => onThemeModeChange("light")
    },
    {
      key: "theme-dark",
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {themeMode === "dark" ? <CheckOutlined /> : <span style={{ width: 14 }} />}
          深色
        </span>
      ),
      onClick: () => onThemeModeChange("dark")
    }
  ];

  const annotationBar = annotationEnabled ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 0,
        flex: "0 1 auto",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        padding: "0 12px",
        height: 44,
        borderRadius: 999,
        border: "1px solid rgba(15,23,42,0.08)",
        background: "rgba(15,23,42,0.04)",
        scrollbarWidth: "none"
      }}
    >
      <Tooltip title="浏览">
        <Button
          type={annotationUi.mode === "browse" ? "primary" : "text"}
          shape="circle"
          size="large"
          icon={<EyeOutlined />}
          aria-label="浏览"
          onClick={() => setAnnotationMode("browse")}
        />
      </Tooltip>
      <Tooltip title="画笔">
        <Button
          type={annotationUi.mode === "pen" ? "primary" : "text"}
          shape="circle"
          size="large"
          icon={<EditOutlined />}
          aria-label="画笔"
          onClick={() => setAnnotationMode("pen")}
        />
      </Tooltip>
      <Tooltip title="荧光笔">
        <Button
          type={annotationUi.mode === "highlighter" ? "primary" : "text"}
          shape="circle"
          size="large"
          icon={<HighlightOutlined />}
          aria-label="荧光笔"
          onClick={() => setAnnotationMode("highlighter")}
        />
      </Tooltip>
      <Tooltip title="删除标注">
        <Button
          type={annotationUi.mode === "erase" ? "primary" : "text"}
          danger={annotationUi.mode === "erase"}
          shape="circle"
          size="large"
          icon={<DeleteOutlined />}
          aria-label="删除标注"
          onClick={() => setAnnotationMode("erase")}
        />
      </Tooltip>

      <div style={{ width: 1, height: 22, background: "rgba(120,120,120,0.25)", flex: "0 0 auto" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        {PEN_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`选择颜色 ${color}`}
            onClick={() => setAnnotationPenColor(color)}
            style={{
              appearance: "none",
              padding: 0,
              background: color,
              borderRadius: 999,
              width: 22,
              height: 22,
              border: annotationUi.penColor === color ? "2px solid #1677ff" : "1px solid rgba(0,0,0,0.15)",
              boxShadow: annotationUi.penColor === color ? "0 0 0 2px rgba(22,119,255,0.18)" : "none",
              cursor: "pointer"
            }}
          />
        ))}
      </div>

      <div style={{ width: 1, height: 22, background: "rgba(120,120,120,0.25)", flex: "0 0 auto" }} />

      <Typography.Text type="secondary" style={{ margin: 0 }}>
        第 {annotationMeta.currentPageIndex + 1} 页
      </Typography.Text>
      <Typography.Text type="secondary" style={{ margin: 0 }}>
        {annotationMeta.currentPageAnnotations} 条标注
      </Typography.Text>

      <div style={{ width: 1, height: 22, background: "rgba(120,120,120,0.25)", flex: "0 0 auto" }} />

      <Popconfirm
        title="清空当前页标注？"
        okText="清空"
        cancelText="取消"
        disabled={annotationMeta.currentPageAnnotations === 0}
        onConfirm={onClearCurrentPageAnnotations}
      >
        <Button type="text" danger disabled={annotationMeta.currentPageAnnotations === 0}>
          清空本页
        </Button>
      </Popconfirm>
      <Popconfirm
        title="清空当前 PDF 的全部标注？"
        okText="清空"
        cancelText="取消"
        disabled={annotationMeta.totalAnnotations === 0}
        onConfirm={onClearAllAnnotations}
      >
        <Button type="text" danger disabled={annotationMeta.totalAnnotations === 0}>
          清空全文
        </Button>
      </Popconfirm>
    </div>
  ) : null;

  return (
    <Layout.Header
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        flexWrap: compact ? "wrap" : "nowrap",
        rowGap: compact ? 8 : 0,
        whiteSpace: "nowrap",
        height: compact ? "auto" : 64,
        lineHeight: "normal",
        paddingInline: 12,
        paddingBlock: compact ? 8 : 0,
        background,
        borderBottom: `1px solid ${borderColor}`
      }}
    >
      <Space size={compact ? 8 : 12} align="center" style={{ width: "100%", justifyContent: "space-between", minWidth: 0 }}>
        <Space size={12} align="center" style={{ minWidth: 0, overflow: "hidden" }}>
          <Button
            type="text"
            aria-label={siderCollapsed ? "展开侧边栏" : "收起侧边栏"}
            icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggleSider}
          />
          <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
            Charts Viewer
          </Typography.Text>
        </Space>

        <Space
          size={compact ? 8 : 12}
          align="center"
          style={{
            minWidth: 0,
            justifyContent: "flex-end",
            flexWrap: annotationModeOpen ? "nowrap" : compact ? "wrap" : "nowrap",
            overflowX: annotationModeOpen ? "auto" : "visible"
          }}
        >
          {annotationModeOpen ? (
            annotationBar
          ) : (
            <>
              {/* 航线模式下（双机场）由侧边栏的“起/降机场”Tag 负责切换；顶部不再展示 Select */}
              {isRouteMode ? (
                <Typography.Text type="secondary" ellipsis style={{ maxWidth: compact ? "70vw" : 320 }}>
                  当前：{labelMap.get(activeIcao) || activeIcao || "-"}
                </Typography.Text>
              ) : (
                <Select
                  style={{
                    width: compact ? 180 : 280,
                    maxWidth: compact ? "60vw" : "35vw",
                    flex: compact ? "1 1 180px" : "0 1 280px",
                    minWidth: compact ? 140 : 200
                  }}
                  value={activeIcao || undefined}
                  onChange={(v: string | undefined) => onActiveIcaoChange(v || "")}
                  disabled={!ready || selectedIcaos.length === 0}
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  options={airportOptions}
                  placeholder="切换机场"
                />
              )}

              {compact ? (
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      ...(openedFileId && pdfHref
                        ? [{ key: "open", icon: <FilePdfOutlined />, label: "新窗口打开", onClick: openPdfInNewWindow } as any]
                        : []),
                      { key: "theme", type: "group" as any, label: "主题", children: themeItems as any },
                      { key: "reset", label: "重新选择", onClick: onResetToSelection },
                      { key: "export", icon: <DownloadOutlined />, label: "导出收藏", onClick: onExportFavorites },
                      { key: "import", icon: <UploadOutlined />, label: "导入收藏", onClick: onTriggerImport }
                    ]
                  }}
                >
                  <Button icon={<MoreOutlined />} aria-label="更多" />
                </Dropdown>
              ) : (
                <>
                  <Button onClick={onResetToSelection}>重新选择</Button>
                  <Dropdown trigger={["click"]} menu={{ items: [{ key: "theme", type: "group" as any, label: "主题", children: themeItems as any }] }}>
                    <Button>主题</Button>
                  </Dropdown>
                  <Button icon={<DownloadOutlined />} onClick={onExportFavorites}>
                    导出收藏
                  </Button>
                  <Button icon={<UploadOutlined />} onClick={onTriggerImport}>
                    导入收藏
                  </Button>
                </>
              )}

              {!compact && openedFileId && pdfHref ? (
                <Tooltip title="新窗口打开">
                  <Button
                    icon={<FilePdfOutlined />}
                    href={pdfHref}
                    target="_blank"
                    type="default"
                    aria-label="新窗口打开"
                  >
                    新窗口打开
                  </Button>
                </Tooltip>
              ) : null}
            </>
          )}

          {annotationEnabled ? (
            <Tooltip title={annotationModeOpen ? "退出标注" : "进入标注"}>
              <Button
                type={annotationModeOpen ? "primary" : "default"}
                shape="circle"
                size="large"
                icon={annotationModeOpen ? <CloseOutlined /> : <FormOutlined />}
                aria-label={annotationModeOpen ? "退出标注" : "进入标注"}
                onClick={toggleAnnotationTools}
              />
            </Tooltip>
          ) : null}
        </Space>
      </Space>
    </Layout.Header>
  );
}
