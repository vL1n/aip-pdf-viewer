import React from "react";
import { Alert, Button, Segmented, Select, Space, Typography } from "antd";
import type { AirportRow } from "../api";
import type { ThemeMode } from "../hooks/useThemeMode";

export function AirportGate(props: {
  airports: AirportRow[];
  airportsLoading: boolean;
  airportsError: string | null;

  mode: "view" | "route";
  onModeChange: (m: "view" | "route") => void;

  themeMode: ThemeMode;
  onThemeModeChange: (m: ThemeMode) => void;

  draftViewIcao: string;
  onDraftViewIcaoChange: (icao: string) => void;

  draftRouteFromIcao: string;
  onDraftRouteFromIcaoChange: (icao: string) => void;

  draftRouteToIcao: string;
  onDraftRouteToIcaoChange: (icao: string) => void;

  canConfirm: boolean;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const {
    airports,
    airportsLoading,
    airportsError,
    mode,
    onModeChange,
    themeMode,
    onThemeModeChange,
    draftViewIcao,
    onDraftViewIcaoChange,
    draftRouteFromIcao,
    onDraftRouteFromIcaoChange,
    draftRouteToIcao,
    onDraftRouteToIcaoChange,
    canConfirm,
    onConfirm,
    onClear
  } = props;

  const options = airports.map((a) => ({
    value: a.icao,
    label: `${a.icao} ${a.name ? `- ${a.name}` : ""} (${a.fileCount})`
  }));

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        请选择机场
      </Typography.Title>
      <Typography.Text type="secondary">先选择模式，再选择机场；点击确认后进入详情。</Typography.Text>

      {airportsError ? <Alert type="error" showIcon message={`机场列表错误：${airportsError}`} /> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Typography.Text type="secondary">模式</Typography.Text>
        <Segmented
          value={mode}
          onChange={(v) => onModeChange(v as any)}
          options={[
            { label: "查看模式（单机场）", value: "view" },
            { label: "航线模式（起/降）", value: "route" }
          ]}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Typography.Text type="secondary">主题</Typography.Text>
        <Segmented
          value={themeMode}
          onChange={(v) => onThemeModeChange(v as any)}
          options={[
            { label: "跟随系统", value: "system" },
            { label: "浅色", value: "light" },
            { label: "深色", value: "dark" }
          ]}
        />
      </div>

      {mode === "view" ? (
        <Select
          style={{ width: "100%" }}
          value={draftViewIcao || undefined}
          onChange={(v: string | undefined) => onDraftViewIcaoChange(v || "")}
          loading={airportsLoading}
          disabled={airportsLoading || airports.length === 0}
          showSearch
          allowClear
          optionFilterProp="label"
          options={options}
          placeholder={airportsLoading ? "正在加载机场列表…" : "选择 ICAO"}
        />
      ) : null}

      {mode === "route" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">起飞</Typography.Text>
            <Select
              style={{ width: "100%", marginTop: 6 }}
              value={draftRouteFromIcao || undefined}
              onChange={(v: string | undefined) => onDraftRouteFromIcaoChange(v || "")}
              loading={airportsLoading}
              disabled={airportsLoading || airports.length === 0}
              showSearch
              allowClear
              optionFilterProp="label"
              options={options}
              placeholder="选择起飞机场"
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <Typography.Text type="secondary">降落</Typography.Text>
            <Select
              style={{ width: "100%", marginTop: 6 }}
              value={draftRouteToIcao || undefined}
              onChange={(v: string | undefined) => onDraftRouteToIcaoChange(v || "")}
              loading={airportsLoading}
              disabled={airportsLoading || airports.length === 0}
              showSearch
              allowClear
              optionFilterProp="label"
              options={options.filter((o) => !draftRouteFromIcao || o.value !== draftRouteFromIcao)}
              placeholder="选择降落机场"
            />
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={onClear} disabled={!draftViewIcao && !draftRouteFromIcao && !draftRouteToIcao}>
          清空
        </Button>
        <Button type="primary" onClick={onConfirm} disabled={!canConfirm}>
          确认进入
        </Button>
      </div>
    </Space>
  );
}


