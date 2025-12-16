import React from "react";
import { Button, Dropdown, Layout, Select, Space, Tooltip, Typography } from "antd";
import type { AirportRow } from "../api";
import { CheckOutlined, DownloadOutlined, FilePdfOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MoreOutlined, UploadOutlined } from "@ant-design/icons";
import type { ThemeMode } from "../hooks/useThemeMode";

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
    onThemeModeChange
  } = props;

  const labelMap = new Map<string, string>();
  for (const a of airports) labelMap.set(a.icao, `${a.icao}${a.name ? ` - ${a.name}` : ""}`);

  const airportOptions = selectedIcaos.map((icao) => ({
    value: icao,
    label: labelMap.get(icao) || icao
  }));

  const openPdfInNewWindow = () => {
    if (!pdfHref) return;
    window.open(pdfHref, "_blank", "noopener,noreferrer");
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
          style={{ minWidth: 0, justifyContent: "flex-end", flexWrap: compact ? "wrap" : "nowrap" }}
        >
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
        </Space>
      </Space>
    </Layout.Header>
  );
}


