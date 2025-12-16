import React from "react";
import { Button, Dropdown, Layout, Select, Space, Tooltip, Typography } from "antd";
import type { AirportRow } from "../api";
import { DownloadOutlined, FilePdfOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MoreOutlined, UploadOutlined } from "@ant-design/icons";

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
    onTriggerImport
  } = props;

  const labelMap = new Map<string, string>();
  for (const a of airports) labelMap.set(a.icao, `${a.icao}${a.name ? ` - ${a.name}` : ""}`);

  const airportOptions = selectedIcaos.map((icao) => ({
    value: icao,
    label: labelMap.get(icao) || icao
  }));

  return (
    <Layout.Header
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        flexWrap: "nowrap",
        whiteSpace: "nowrap",
        height: 64,
        lineHeight: "normal",
        paddingInline: 12
      }}
    >
      <Space size={12} align="center" style={{ width: "100%", justifyContent: "space-between", minWidth: 0 }}>
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

        <Space size={12} align="center" style={{ minWidth: 0, justifyContent: "flex-end", flexWrap: "nowrap" }}>
          <Select
            style={{ width: 280, maxWidth: "35vw", flex: "0 1 280px" }}
            value={activeIcao || undefined}
            onChange={(v: string | undefined) => onActiveIcaoChange(v || "")}
            disabled={!ready || selectedIcaos.length === 0}
            showSearch
            allowClear
            optionFilterProp="label"
            options={airportOptions}
            placeholder="切换机场"
          />

          <Button onClick={onResetToSelection}>重新选择</Button>

          {compact ? (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "export", icon: <DownloadOutlined />, label: "导出收藏", onClick: onExportFavorites },
                  { key: "import", icon: <UploadOutlined />, label: "导入收藏", onClick: onTriggerImport }
                ]
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="更多" />
            </Dropdown>
          ) : (
            <>
              <Button icon={<DownloadOutlined />} onClick={onExportFavorites}>
                导出收藏
              </Button>
              <Button icon={<UploadOutlined />} onClick={onTriggerImport}>
                导入收藏
              </Button>
            </>
          )}

          {openedFileId && pdfHref ? (
            <Tooltip title="新窗口打开">
              <Button
                icon={<FilePdfOutlined />}
                href={pdfHref}
                target="_blank"
                type="default"
                aria-label="新窗口打开"
              >
                {compact ? null : "新窗口打开"}
              </Button>
            </Tooltip>
          ) : null}
        </Space>
      </Space>
    </Layout.Header>
  );
}


