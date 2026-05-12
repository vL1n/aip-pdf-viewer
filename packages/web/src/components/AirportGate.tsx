import React from "react";
import { Alert, Button, Divider, Segmented, Select, Space, Typography } from "antd";
import { CompassOutlined, FileTextOutlined } from "@ant-design/icons";
import type { AirportRow } from "../api";
import type { ThemeMode } from "../hooks/useThemeMode";

export function AirportGate(props: {
  airports: AirportRow[];
  routeAirports: AirportRow[];
  airportsLoading: boolean;
  airportsError: string | null;

  themeMode: ThemeMode;
  onThemeModeChange: (m: ThemeMode) => void;

  draftViewIcao: string;
  onDraftViewIcaoChange: (icao: string) => void;

  canConfirm: boolean;
  onConfirm: () => void;
  onClear: () => void;

  /** 航线规划起飞机场 */
  routeDepartureIcao: string;
  onRouteDepartureChange: (icao: string) => void;

  /** 航线规划降落机场 */
  routeArrivalIcao: string;
  onRouteArrivalChange: (icao: string) => void;

  /** 进入航线规划页面 */
  onEnterRoutePlanning?: () => void;
}) {
  const {
    airports,
    routeAirports,
    airportsLoading,
    airportsError,
    themeMode,
    onThemeModeChange,
    draftViewIcao,
    onDraftViewIcaoChange,
    canConfirm,
    onConfirm,
    onClear,
    routeDepartureIcao,
    onRouteDepartureChange,
    routeArrivalIcao,
    onRouteArrivalChange,
    onEnterRoutePlanning
  } = props;

  const options = airports.map((a) => ({
    value: a.icao,
    label: `${a.icao} ${a.name ? `- ${a.name}` : ""} (${a.fileCount})`
  }));
  const chartOptions = options.filter((option) => {
    const airport = airports.find((item) => item.icao === option.value);
    return Number(airport?.fileCount ?? 0) > 0;
  });
  const routeOptions = (routeAirports.length > 0 ? routeAirports : airports).map((a) => ({
    value: a.icao,
    label: `${a.icao} ${a.name ? `- ${a.name}` : ""}${Number(a.fileCount ?? 0) > 0 ? ` (${a.fileCount}图)` : " (无航图)"}`
  }));
  const filterAirportOption = (input: string, option?: { label?: React.ReactNode; value?: string }) => {
    const keyword = input.trim().toUpperCase();
    if (!keyword) return true;
    return `${option?.value ?? ""} ${String(option?.label ?? "")}`.toUpperCase().includes(keyword);
  };

  // 航线规划按钮只有在起/降机场都选择后才可点击
  const canEnterRoutePlanning = !!routeDepartureIcao && !!routeArrivalIcao && routeDepartureIcao !== routeArrivalIcao;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      {/* 主题设置 */}
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

      {airportsError ? <Alert type="error" showIcon message={`机场列表错误：${airportsError}`} /> : null}

      <Divider style={{ margin: "4px 0" }} />

      {/* 查看机场航图 */}
      <Typography.Title level={5} style={{ margin: 0 }}>
        查看机场航图
      </Typography.Title>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        选择机场后点击确认进入航图浏览
      </Typography.Text>

      <Select
        style={{ width: "100%" }}
        value={draftViewIcao || undefined}
        onChange={(v: string | undefined) => onDraftViewIcaoChange(v || "")}
        loading={airportsLoading}
        disabled={airportsLoading || chartOptions.length === 0}
        showSearch
        allowClear
        optionFilterProp="label"
        filterOption={filterAirportOption}
        options={chartOptions}
        placeholder={airportsLoading ? "正在加载机场列表…" : "选择有航图的 ICAO"}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={onClear} disabled={!draftViewIcao}>
          清空
        </Button>
        <Button type="primary" icon={<FileTextOutlined />} onClick={onConfirm} disabled={!canConfirm}>
          进入航图查看
        </Button>
      </div>

      {/* 航线规划入口 */}
      {onEnterRoutePlanning && (
        <>
          <Divider style={{ margin: "16px 0 12px 0" }} />
          <Typography.Title level={5} style={{ margin: 0 }}>
            航线规划
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            选择起飞和降落机场后进入航线规划页面
          </Typography.Text>

          {/* 起/降机场选择 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>起飞机场</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 4 }}
                value={routeDepartureIcao || undefined}
                onChange={(v: string | undefined) => {
                  const newVal = v || "";
                  onRouteDepartureChange(newVal);
                  // 避免起降相同
                  if (newVal && routeArrivalIcao === newVal) {
                    onRouteArrivalChange("");
                  }
                }}
                loading={airportsLoading}
                disabled={airportsLoading || routeOptions.length === 0}
                showSearch
                allowClear
                optionFilterProp="label"
                filterOption={filterAirportOption}
                options={routeOptions}
                placeholder="搜索 nd.db3 全量起飞机场"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>降落机场</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 4 }}
                value={routeArrivalIcao || undefined}
                onChange={(v: string | undefined) => {
                  const newVal = v || "";
                  onRouteArrivalChange(newVal);
                  // 避免起降相同
                  if (newVal && routeDepartureIcao === newVal) {
                    onRouteDepartureChange("");
                  }
                }}
                loading={airportsLoading}
                disabled={airportsLoading || routeOptions.length === 0}
                showSearch
                allowClear
                optionFilterProp="label"
                filterOption={filterAirportOption}
                options={routeOptions.filter((o) => !routeDepartureIcao || o.value !== routeDepartureIcao)}
                placeholder="搜索 nd.db3 全量降落机场"
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              onClick={() => {
                onRouteDepartureChange("");
                onRouteArrivalChange("");
              }}
              disabled={!routeDepartureIcao && !routeArrivalIcao}
            >
              清空
            </Button>
            <Button
              type="primary"
              icon={<CompassOutlined />}
              onClick={onEnterRoutePlanning}
              disabled={!canEnterRoutePlanning}
            >
              进入航线规划
            </Button>
          </div>
        </>
      )}
    </Space>
  );
}
