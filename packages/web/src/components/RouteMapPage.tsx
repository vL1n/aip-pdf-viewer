/**
 * 航路地图页面
 * 整合功能：航路解析、航路拟合、KML 导入、VATSIM 追踪
 * 
 * 页面结构：
 * - 顶部：标题栏
 * - 顶部工具栏：VATSIM 追踪 + KML 导入（独立的叠加功能）
 * - 左右分栏：
 *   - 左侧 40%：Tabs（航路解析 / 航路拟合）
 *   - 右侧 60%：地图
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Alert,
  Space,
  Typography,
  Spin,
  Card,
  Tabs,
  theme,
  Tooltip as AntTooltip
} from "antd";
import {
  ArrowLeftOutlined,
  QuestionCircleOutlined,
  UnorderedListOutlined,
  CloseOutlined,
  FullscreenOutlined,
  AimOutlined,
  EnvironmentOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  apiRouteStatus,
  type ParsedRoute,
  type ParsedRoutePoint,
  type RouteStatus,
  type VatsimPilot,
  type KmlParseResult,
  type FitRouteResult,
  type FittedWaypoint
} from "../api";

import { RouteParsePanel } from "./RouteParsePanel";
import { RouteFitPanel } from "./RouteFitPanel";
import { VatsimTrackBar } from "./VatsimTrackBar";
import { KmlUploadBar } from "./KmlUploadBar";

// 修复 Leaflet 默认图标问题
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl
});

// 自定义图标
const createIcon = (color: string, size: number = 24) => {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
};

const airportIcon = createIcon("#e74c3c", 14); // 红色 - 机场
const waypointIcon = createIcon("#3498db", 8); // 蓝色 - 航点
const navaidIcon = createIcon("#9b59b6", 10); // 紫色 - 导航台
const explicitWaypointIcon = createIcon("#2ecc71", 10); // 绿色 - 用户指定航点
const fittedWaypointIcon = createIcon("#27ae60", 10); // 深绿色 - 拟合航点

// 创建飞机图标（带朝向）
const createAircraftIcon = (heading: number) => {
  return L.divIcon({
    className: "aircraft-marker",
    html: `<div style="
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: rotate(${heading}deg);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    ">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="#f39c12" stroke="#fff" stroke-width="0.5">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
};

/** 根据航点类型获取图标 */
function getMarkerIcon(point: ParsedRoutePoint) {
  if (point.isAirport) return airportIcon;
  if (point.type === "navaid") return navaidIcon;
  if (point.isExplicit) return explicitWaypointIcon;
  return waypointIcon;
}

/** 根据拟合航点类型获取图标 */
function getFittedMarkerIcon(wp: FittedWaypoint) {
  if (wp.isAirport) return airportIcon;
  if (wp.type === "navaid") return navaidIcon;
  return fittedWaypointIcon;
}

/** 自动调整地图视野的组件 - 只在 trigger 变化时调整，不随 points 变化 */
function FitBounds({ points, trigger }: { points: Array<{ lat: number; lon: number }>; trigger: number }) {
  const map = useMap();
  const [lastTrigger, setLastTrigger] = useState(0);

  useEffect(() => {
    // 只有当 trigger 真正变化时才调整视野
    if (trigger > lastTrigger && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });
      setLastTrigger(trigger);
    }
  }, [map, points, trigger, lastTrigger]);

  return null;
}

/** 跟随 VATSIM 飞机位置的组件 */
function FollowAircraft({ pilot, enabled, centerTrigger }: { pilot: VatsimPilot | null; enabled: boolean; centerTrigger: number }) {
  const map = useMap();
  const [hasInitialCenter, setHasInitialCenter] = useState(false);
  const [lastTrigger, setLastTrigger] = useState(0);

  useEffect(() => {
    if (!enabled || !pilot) {
      setHasInitialCenter(false);
      return;
    }

    // 首次追踪时居中并设置缩放级别
    if (!hasInitialCenter) {
      map.setView([pilot.latitude, pilot.longitude], 8);
      setHasInitialCenter(true);
    }
  }, [map, pilot, enabled, hasInitialCenter]);

  // 手动触发居中
  useEffect(() => {
    if (centerTrigger > lastTrigger && pilot) {
      map.setView([pilot.latitude, pilot.longitude], 8);
      setLastTrigger(centerTrigger);
    }
  }, [map, pilot, centerTrigger, lastTrigger]);

  return null;
}

export interface RouteMapPageProps {
  onBack: () => void;
}

type TabKey = "route" | "fit";

export function RouteMapPage({ onBack }: RouteMapPageProps) {
  const { token } = theme.useToken();

  // 导航数据库状态
  const [routeStatus, setRouteStatus] = useState<RouteStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // 当前激活的 Tab
  const [activeTab, setActiveTab] = useState<TabKey>("route");

  // 航路解析状态
  const [parseResult, setParseResult] = useState<ParsedRoute | null>(null);

  // KML 导入状态
  const [kmlResult, setKmlResult] = useState<KmlParseResult | null>(null);
  const [fitResult, setFitResult] = useState<FitRouteResult | null>(null);

  // VATSIM 追踪状态
  const [vatsimPilot, setVatsimPilot] = useState<VatsimPilot | null>(null);

  // 地图控制
  const [showHelp, setShowHelp] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [vatsimCenterTrigger, setVatsimCenterTrigger] = useState(0);

  // 外部航路输入（用于 VATSIM 导入）
  const [externalRouteInput, setExternalRouteInput] = useState<string | undefined>(undefined);

  // 检查航路解析功能是否可用
  useEffect(() => {
    (async () => {
      try {
        setStatusLoading(true);
        const status = await apiRouteStatus();
        setRouteStatus(status);
      } catch (e: any) {
        setRouteStatus({ available: false, message: e?.message || "无法连接服务器" });
      } finally {
        setStatusLoading(false);
      }
    })();
  }, []);

  // 处理航路解析成功
  const handleParseSuccess = useCallback((result: ParsedRoute) => {
    setParseResult(result);
    // 自动调整地图视野
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  // 清除航路解析
  const handleParseClear = useCallback(() => {
    setParseResult(null);
  }, []);

  // 处理 KML 解析成功
  const handleKmlParsed = useCallback((result: KmlParseResult) => {
    setKmlResult(result);
    setFitResult(null);
    // 自动调整地图视野
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  // 处理航路拟合成功
  const handleRouteFitted = useCallback((result: FitRouteResult) => {
    setFitResult(result);
    // 自动调整地图视野
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  // 清除 KML（但保留拟合结果，因为用户可能还需要）
  const handleKmlClear = useCallback(() => {
    setKmlResult(null);
    // 清除 KML 时也清除拟合结果，因为拟合是基于 KML 的
    setFitResult(null);
  }, []);

  // 清除拟合结果
  const handleFitClear = useCallback(() => {
    setFitResult(null);
  }, []);

  // 处理 VATSIM 导入航路
  const handleImportVatsimRoute = useCallback((route: string) => {
    setActiveTab("route");
    setExternalRouteInput(route);
  }, []);

  // 处理定位到 VATSIM 飞机
  const handleLocateAircraft = useCallback(() => {
    setVatsimCenterTrigger((v) => v + 1);
  }, []);

  // 收集所有需要显示的地图数据点用于自动调整视野
  const getAllMapPoints = useCallback((): Array<{ lat: number; lon: number }> => {
    const points: Array<{ lat: number; lon: number }> = [];

    // 航路解析的点（始终显示）
    if (parseResult) {
      points.push(...parseResult.points.map((p) => ({ lat: p.lat, lon: p.lon })));
    }

    // KML 航迹点（始终显示）
    if (kmlResult) {
      points.push(...kmlResult.points.map((p) => ({ lat: p.lat, lon: p.lon })));
    }

    // 拟合航点（始终显示）
    if (fitResult) {
      points.push(...fitResult.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon })));
    }

    return points;
  }, [parseResult, kmlResult, fitResult]);

  // 示例航路
  const exampleRoute = "ZSPD SHA3P PIMOL G471 VMB A593 BTO A470 LAMEN STAR2A ZGGG";

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: token.colorBgLayout
      }}
    >
      {/* 顶部栏 */}
      <div
        style={{
          padding: "12px 16px",
          background: token.colorBgElevated,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          航路规划
        </Typography.Title>

        <div style={{ flex: 1 }} />

        <Button
          type="text"
          icon={<QuestionCircleOutlined />}
          onClick={() => setShowHelp((v) => !v)}
        >
          帮助
        </Button>
      </div>

      {/* 帮助说明 */}
      {showHelp && (
        <div
          style={{
            padding: "12px 16px",
            background: token.colorInfoBg,
            borderBottom: `1px solid ${token.colorInfoBorder}`
          }}
        >
          <Typography.Title level={5} style={{ margin: "0 0 8px 0" }}>
            使用说明
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            <strong>航路解析：</strong>输入标准航路字符串，系统会解析并在地图上显示航线。<br />
            格式：<code style={{ background: token.colorFillSecondary, padding: "2px 6px", borderRadius: 4 }}>
              起飞机场ICAO SID名称 核心航路段 STAR名称 落地机场ICAO
            </code>
            <br />
            示例：
            <code
              style={{
                background: token.colorFillSecondary,
                padding: "2px 6px",
                borderRadius: 4,
                cursor: "pointer"
              }}
              onClick={() => {
                setActiveTab("route");
                setExternalRouteInput(exampleRoute);
                setShowHelp(false);
              }}
            >
              {exampleRoute}
            </code>
            <span style={{ marginLeft: 8, color: token.colorTextSecondary }}>(点击填充)</span>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ margin: "8px 0 0 0" }}>
            <strong>KML 导入：</strong>上传 FlightRadar24 等导出的 KML 文件，系统会解析航迹并在地图上显示。
            点击"拟合航路"可自动匹配最近的航点并生成航路。
          </Typography.Paragraph>
          <Typography.Paragraph style={{ margin: "8px 0 0 0" }}>
            <strong>VATSIM 追踪：</strong>输入 VATSIM CID，开启追踪后会在地图上实时显示飞机位置。
            可以导入飞行员的飞行计划到航路解析面板。
          </Typography.Paragraph>
        </div>
      )}

      {/* 工具栏：VATSIM 追踪 + KML 导入（独立的叠加功能，始终可用） */}
      <VatsimTrackBar
        pilot={vatsimPilot}
        onPilotUpdate={setVatsimPilot}
        onImportRoute={handleImportVatsimRoute}
        onLocateAircraft={handleLocateAircraft}
      />
      <KmlUploadBar
        kmlResult={kmlResult}
        onKmlParsed={handleKmlParsed}
        onClear={handleKmlClear}
      />

      {/* 状态检查 */}
      {statusLoading ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin tip="检查导航数据库..." />
        </div>
      ) : routeStatus && !routeStatus.available ? (
        <div style={{ padding: 24 }}>
          <Alert
            type="warning"
            showIcon
            message="航路解析功能不可用"
            description={routeStatus.message}
          />
        </div>
      ) : (
        /* 左右分栏布局：左侧控制面板(40%)，右侧地图(60%) */
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* 左侧：功能 Tabs 和控制面板 */}
          <div
            style={{
              width: "40%",
              minWidth: 320,
              maxWidth: 600,
              padding: "12px 16px",
              background: token.colorBgContainer,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              overflowY: "auto",
              flexShrink: 0
            }}
          >
            <Tabs
              activeKey={activeTab}
              onChange={(key) => setActiveTab(key as TabKey)}
              items={[
                {
                  key: "route",
                  label: (
                    <Space>
                      <EnvironmentOutlined />
                      航路解析
                    </Space>
                  ),
                  children: (
                    <RouteParsePanel
                      parseResult={parseResult}
                      onParseSuccess={handleParseSuccess}
                      onClear={handleParseClear}
                      externalRouteInput={externalRouteInput}
                      onExternalInputUsed={() => setExternalRouteInput(undefined)}
                    />
                  )
                },
                {
                  key: "fit",
                  label: (
                    <Space>
                      <ThunderboltOutlined />
                      航路拟合
                    </Space>
                  ),
                  children: (
                    <RouteFitPanel
                      kmlResult={kmlResult}
                      fitResult={fitResult}
                      onRouteFitted={handleRouteFitted}
                      onClear={handleFitClear}
                    />
                  )
                }
              ]}
            />
          </div>

          {/* 右侧：地图区域 */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <MapContainer
              center={[35, 105]} // 中国中心
              zoom={5}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* 自动调整视野 */}
              <FitBounds points={getAllMapPoints()} trigger={fitBoundsTrigger} />

              {/* 跟随 VATSIM 飞机 */}
              <FollowAircraft pilot={vatsimPilot} enabled={!!vatsimPilot} centerTrigger={vatsimCenterTrigger} />

              {/* VATSIM 飞机标记 */}
              {vatsimPilot && (
                <Marker
                  position={[vatsimPilot.latitude, vatsimPilot.longitude]}
                  icon={createAircraftIcon(vatsimPilot.heading)}
                  zIndexOffset={1000}
                >
                  <Tooltip permanent direction="top" offset={[0, -16]}>
                    <strong>{vatsimPilot.callsign}</strong>
                  </Tooltip>
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                        {vatsimPilot.callsign}
                      </div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        <div>CID: {vatsimPilot.cid}</div>
                        <div>高度: {vatsimPilot.altitude} ft</div>
                        <div>地速: {vatsimPilot.groundspeed} kts</div>
                        <div>航向: {vatsimPilot.heading}°</div>
                        {vatsimPilot.flight_plan && (
                          <>
                            <div style={{ marginTop: 4, borderTop: "1px solid #eee", paddingTop: 4 }}>
                              <div>{vatsimPilot.flight_plan.departure} → {vatsimPilot.flight_plan.arrival}</div>
                              <div>机型: {vatsimPilot.flight_plan.aircraft_short}</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* KML 航迹（始终显示，不依赖于激活的 Tab） */}
              {kmlResult && kmlResult.points.length > 0 && (
                <>
                  {/* KML 航迹 - 橙色虚线 */}
                  <Polyline
                    positions={kmlResult.points.map((p) => [p.lat, p.lon])}
                    pathOptions={{
                      color: "#e67e22",
                      weight: 2,
                      opacity: 0.7,
                      dashArray: "8, 6"
                    }}
                  />
                </>
              )}

              {/* 拟合航路（始终显示，不依赖于激活的 Tab） */}
              {fitResult && fitResult.waypoints.length > 0 && (
                <>
                  {/* 拟合航线 - 绿色实线 */}
                  <Polyline
                    positions={fitResult.waypoints.map((wp) => [wp.lat, wp.lon])}
                    pathOptions={{
                      color: "#27ae60",
                      weight: 3,
                      opacity: 0.8
                    }}
                  />

                  {/* 拟合航点标记 */}
                  {fitResult.waypoints.map((wp, idx) => (
                    <Marker
                      key={`fit-${wp.ident}-${idx}`}
                      position={[wp.lat, wp.lon]}
                      icon={getFittedMarkerIcon(wp)}
                    >
                      <Tooltip permanent={wp.isAirport} direction="top" offset={[0, -10]}>
                        <strong>{wp.ident}</strong>
                        {wp.viaAirway && <span style={{ marginLeft: 4, opacity: 0.7 }}>via {wp.viaAirway}</span>}
                      </Tooltip>
                      <Popup>
                        <div>
                          <strong>{wp.ident}</strong>
                          {wp.name && <div style={{ color: "#666" }}>{wp.name}</div>}
                          <div style={{ fontSize: 12, color: "#999" }}>
                            {wp.lat.toFixed(4)}°N, {wp.lon.toFixed(4)}°E
                          </div>
                          <div style={{ fontSize: 12, color: "#999" }}>
                            距航迹: {wp.distanceFromTrack.toFixed(1)} km
                          </div>
                          {wp.viaAirway && <div style={{ color: "#52c41a" }}>经由航路: {wp.viaAirway}</div>}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </>
              )}

              {/* 航路解析的航线和航点（始终显示，不依赖于激活的 Tab） */}
              {parseResult && parseResult.points.length > 0 && (
                <>
                  {/* 航线 - 蓝色实线 */}
                  <Polyline
                    positions={parseResult.points.map((p) => [p.lat, p.lon])}
                    pathOptions={{
                      color: "#3498db",
                      weight: 3,
                      opacity: 0.8
                    }}
                  />

                  {/* 航点标记 */}
                  {parseResult.points.map((point, idx) => (
                    <Marker
                      key={`route-${point.ident}-${idx}`}
                      position={[point.lat, point.lon]}
                      icon={getMarkerIcon(point)}
                    >
                      <Tooltip permanent={point.isAirport} direction="top" offset={[0, -10]}>
                        <strong>{point.ident}</strong>
                        {point.viaAirway && <span style={{ marginLeft: 4, opacity: 0.7 }}>via {point.viaAirway}</span>}
                      </Tooltip>
                      <Popup>
                        <div>
                          <strong>{point.ident}</strong>
                          {point.name && <div style={{ color: "#666" }}>{point.name}</div>}
                          <div style={{ fontSize: 12, color: "#999" }}>
                            {point.lat.toFixed(4)}°N, {point.lon.toFixed(4)}°E
                          </div>
                          {point.remark && <div style={{ marginTop: 4, color: "#1890ff" }}>{point.remark}</div>}
                          {point.viaAirway && <div style={{ color: "#52c41a" }}>经由航路: {point.viaAirway}</div>}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </>
              )}

            </MapContainer>

            {/* 地图控制按钮 */}
            <div
              style={{
                position: "absolute",
                bottom: 20,
                right: 20,
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 8
              }}
            >
              {/* 定位到 VATSIM 位置按钮 */}
              {vatsimPilot && (
                <AntTooltip title="定位到 VATSIM 位置" placement="left">
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<AimOutlined />}
                    onClick={handleLocateAircraft}
                    style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                  />
                </AntTooltip>
              )}

              {/* 航路/航迹居中按钮 */}
              {getAllMapPoints().length > 0 && (
                <AntTooltip title="航路居中" placement="left">
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<FullscreenOutlined />}
                    onClick={() => setFitBoundsTrigger((v) => v + 1)}
                    style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                  />
                </AntTooltip>
              )}

              {/* 图例 */}
              {showLegend ? (
                <Card
                  size="small"
                  style={{ opacity: 0.95 }}
                  title={
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12 }}>图例</span>
                      <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setShowLegend(false)} style={{ marginRight: -8 }} />
                    </div>
                  }
                  styles={{ header: { minHeight: 32, padding: "0 12px" }, body: { padding: "8px 12px" } }}
                >
                  <Space direction="vertical" size={4}>
                    <Space>
                      <div style={{ width: 14, height: 14, background: "#e74c3c", borderRadius: "50%" }} />
                      <span>机场</span>
                    </Space>
                    <Space>
                      <div style={{ width: 14, height: 14, background: "#2ecc71", borderRadius: "50%" }} />
                      <span>指定航点</span>
                    </Space>
                    <Space>
                      <div style={{ width: 14, height: 14, background: "#3498db", borderRadius: "50%" }} />
                      <span>中间航点</span>
                    </Space>
                    <Space>
                      <div style={{ width: 14, height: 14, background: "#9b59b6", borderRadius: "50%" }} />
                      <span>VOR/NDB</span>
                    </Space>
                    <Space>
                      <div style={{ width: 30, height: 3, background: "#3498db" }} />
                      <span>解析航路</span>
                    </Space>
                    <Space>
                      <div style={{ width: 30, height: 2, background: "#e67e22", borderTop: "2px dashed #e67e22" }} />
                      <span>KML 航迹</span>
                    </Space>
                    <Space>
                      <div style={{ width: 30, height: 3, background: "#27ae60" }} />
                      <span>拟合航路</span>
                    </Space>
                    {vatsimPilot && (
                      <Space>
                        <div style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="#f39c12">
                            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                          </svg>
                        </div>
                        <span>VATSIM</span>
                      </Space>
                    )}
                  </Space>
                </Card>
              ) : (
                <Button
                  type="primary"
                  shape="circle"
                  icon={<UnorderedListOutlined />}
                  onClick={() => setShowLegend(true)}
                  style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
