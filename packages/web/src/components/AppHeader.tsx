import React from "react";
import { Button, Dropdown, Layout, Popconfirm, Select, Space, Tooltip, Typography } from "antd";
import type { AirportRow } from "../api";
import {
  ArrowLeftOutlined,
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
  UndoOutlined,
  UploadOutlined
} from "@ant-design/icons";
import type { ThemeMode } from "../hooks/useThemeMode";
import {
  ANNOTATION_COLORS,
  ANNOTATION_WIDTH_OPTIONS,
  type PdfAnnotationMeta,
  type PdfAnnotationUiState
} from "./PdfViewerPanel";

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
  onUndoLastAnnotation: () => void;
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
    onClearAllAnnotations,
    onUndoLastAnnotation
  } = props;

  const labelMap = new Map<string, string>();
  for (const a of airports) {
    const icao = String(a.icao ?? "").toUpperCase();
    labelMap.set(icao, `${icao}${a.name ? ` - ${a.name}` : ""}`);
  }

  const airportOptions = airports
    .filter((airport) => Number(airport.fileCount ?? 0) > 0)
    .map((airport) => {
      const icao = String(airport.icao ?? "").toUpperCase();
      return {
        value: icao,
        label: labelMap.get(icao) || icao
      };
    });
  const filterAirportOption = (input: string, option?: { label?: React.ReactNode; value?: string }) => {
    const keyword = input.trim().toUpperCase();
    if (!keyword) return true;
    return `${option?.value ?? ""} ${String(option?.label ?? "")}`.toUpperCase().includes(keyword);
  };
  const isRouteMode = selectedIcaos.length === 2;
  const annotationModeOpen = annotationEnabled && annotationUi.toolsOpen;
  const compactAnnotationMode = compact && annotationModeOpen;

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
      mode: annotationUi.mode === "highlighter" ? "highlighter" : "pen"
    });
  };

  const setAnnotationWidthKey = (widthKey: number) => {
    onAnnotationUiChange({
      ...annotationUi,
      widthKey
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
      className="appHeaderAnnotationBar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 10 : 12,
        minWidth: 0,
        flex: compact ? "1 1 100%" : "0 1 auto",
        width: compact ? "100%" : undefined,
        maxWidth: compact ? "100%" : "min(100%, calc(100vw - 260px))",
        boxSizing: "border-box",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        padding: compact ? "0 10px" : "0 12px",
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
      <Tooltip title="撤回上一笔">
        <Button
          type="text"
          shape="circle"
          size="large"
          icon={<UndoOutlined />}
          aria-label="撤回上一笔"
          disabled={annotationMeta.totalAnnotations === 0}
          onClick={onUndoLastAnnotation}
        />
      </Tooltip>

      <div style={{ width: 1, height: 22, background: "rgba(120,120,120,0.25)", flex: "0 0 auto" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        {ANNOTATION_COLORS.map((color) => (
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
              width: compact ? 24 : 22,
              height: compact ? 24 : 22,
              border: annotationUi.penColor === color ? "2px solid #1677ff" : "1px solid rgba(0,0,0,0.15)",
              boxShadow: annotationUi.penColor === color ? "0 0 0 2px rgba(22,119,255,0.18)" : "none",
              cursor: "pointer"
            }}
          />
        ))}
      </div>

      <div style={{ width: 1, height: 22, background: "rgba(120,120,120,0.25)", flex: "0 0 auto" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        {ANNOTATION_WIDTH_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-label={`选择粗细 ${option.key + 1}`}
            onClick={() => setAnnotationWidthKey(option.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: compact ? 34 : 30,
              height: compact ? 34 : 30,
              borderRadius: 999,
              border: annotationUi.widthKey === option.key ? "1px solid #1677ff" : "1px solid rgba(120,120,120,0.18)",
              background: annotationUi.widthKey === option.key ? "rgba(22,119,255,0.1)" : "transparent",
              padding: 0,
              cursor: "pointer"
            }}
          >
            <span
              style={{
                width: 14,
                height: option.preview,
                borderRadius: 999,
                background: annotationUi.penColor
              }}
            />
          </button>
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
  const headerBrand = (
    <Space size={12} align="center" style={{ minWidth: 0, overflow: "hidden", flex: "0 0 auto" }}>
      <Button
        icon={<ArrowLeftOutlined />}
        onClick={onResetToSelection}
      >
        返回
      </Button>
      <div
        aria-hidden="true"
        style={{
          width: 1,
          height: 22,
          background: borderColor,
          flex: "0 0 auto"
        }}
      />
      <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
        Charts Viewer
      </Typography.Text>
    </Space>
  );
  const panelToggleButton = (
    <Button
      icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      onClick={onToggleSider}
      aria-label={siderCollapsed ? "展开目录" : "收起目录"}
    >
      {compact ? "目录" : siderCollapsed ? "显示目录" : "隐藏目录"}
    </Button>
  );
  const annotationToggleButton = annotationEnabled ? (
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
  ) : null;
  const compactMoreMenuItems = [
    ...(openedFileId && pdfHref
      ? [{ key: "open", icon: <FilePdfOutlined />, label: "新窗口打开", onClick: openPdfInNewWindow } as any]
      : []),
    { key: "theme", type: "group" as any, label: "主题", children: themeItems as any },
    { key: "export", icon: <DownloadOutlined />, label: "导出收藏", onClick: onExportFavorites },
    { key: "import", icon: <UploadOutlined />, label: "导入收藏", onClick: onTriggerImport }
  ];
  const renderAirportSwitcher = (style: React.CSSProperties) => (
    isRouteMode ? (
      <Typography.Text type="secondary" ellipsis style={style}>
        当前：{labelMap.get(activeIcao) || activeIcao || "-"}
      </Typography.Text>
    ) : (
      <Select
        style={style}
        value={activeIcao || undefined}
        onChange={(v: string | undefined) => onActiveIcaoChange(v || "")}
        disabled={!ready || airportOptions.length === 0}
        showSearch
        allowClear
        optionFilterProp="label"
        filterOption={filterAirportOption}
        options={airportOptions}
        placeholder="切换机场"
      />
    )
  );

  return (
    <Layout.Header
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: compactAnnotationMode ? "stretch" : "center",
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
      {compactAnnotationMode ? (
        <div className="appHeaderAnnotationMobileLayout">
          <div className="appHeaderAnnotationMobileTop">
            {headerBrand}
            {annotationToggleButton}
          </div>
          {annotationBar}
        </div>
      ) : compact ? (
        <div className="appHeaderMobileLayout">
          <div className="appHeaderMobileTop">
            {headerBrand}
            <Space size={8} align="center">
              {annotationToggleButton}
              <Dropdown trigger={["click"]} menu={{ items: compactMoreMenuItems }}>
                <Button icon={<MoreOutlined />} aria-label="更多" />
              </Dropdown>
            </Space>
          </div>
          <div className="appHeaderMobileSwitcher">
            <div style={{ display: "flex", gap: 8, width: "100%", minWidth: 0 }}>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                {renderAirportSwitcher({ width: "100%", minWidth: 0 })}
              </div>
              <div style={{ flex: "0 0 auto" }}>
                {panelToggleButton}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Space size={12} align="center" style={{ width: "100%", justifyContent: "space-between", minWidth: 0 }}>
          {headerBrand}

          <Space
            size={12}
            align="center"
            style={{
              minWidth: 0,
              justifyContent: "flex-end",
              flexWrap: "nowrap",
              overflowX: annotationModeOpen ? "auto" : "visible"
            }}
          >
            {annotationModeOpen ? (
              annotationBar
            ) : (
              <>
                {/* 航线模式下（双机场）由侧边栏的“起/降机场”Tag 负责切换；顶部不再展示 Select */}
                {renderAirportSwitcher({
                  width: 280,
                  maxWidth: "35vw",
                  flex: "0 1 280px",
                  minWidth: 200
                })}
                {panelToggleButton}

                <Dropdown trigger={["click"]} menu={{ items: [{ key: "theme", type: "group" as any, label: "主题", children: themeItems as any }] }}>
                  <Button>主题</Button>
                </Dropdown>
                <Button icon={<DownloadOutlined />} onClick={onExportFavorites}>
                  导出收藏
                </Button>
                <Button icon={<UploadOutlined />} onClick={onTriggerImport}>
                  导入收藏
                </Button>

                {openedFileId && pdfHref ? (
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

            {annotationToggleButton}
          </Space>
        </Space>
      )}
    </Layout.Header>
  );
}
