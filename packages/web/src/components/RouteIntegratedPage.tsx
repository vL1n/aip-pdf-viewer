/**
 * 航线规划整合页面
 * 整合功能：航路解析、航路拟合、KML 导入、VATSIM 追踪、航图浏览
 *
 * 页面结构：
 * - 顶栏：返回按钮 + VATSIM 追踪 + KML 导入
 * - 左侧 Tabs：总览（航路解析+航路拟合）、航图（机场选择+目录树）
 * - 右侧预览：默认显示地图，选中航图时显示 PDF
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useWindowHeight } from "../hooks/useWindowHeight";
import {
  Button,
  Alert,
  Space,
  Spin,
  Tabs,
  Drawer,
  Layout,
  Grid,
  Tree,
  Tag,
  Empty,
  Typography,
  Divider,
  theme
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  ArrowLeftOutlined,
  FullscreenOutlined,
  AimOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  MenuOutlined,
  UnorderedListOutlined,
  CloseOutlined
} from "@ant-design/icons";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  apiRouteStatus,
  apiAirports,
  apiTree,
  apiFavoriteRelPaths,
  apiFavoriteAdd,
  apiFavoriteRemove,
  pdfUrl,
  type ParsedRoute,
  type ParsedRoutePoint,
  type RouteStatus,
  type VatsimPilot,
  type KmlParseResult,
  type FitRouteResult,
  type FittedWaypoint,
  type AirportRow,
  type TreeNode
} from "../api";

import { RouteParsePanel } from "./RouteParsePanel";
import { RouteFitPanel } from "./RouteFitPanel";
import { VatsimTrackBar } from "./VatsimTrackBar";
import { KmlUploadBar } from "./KmlUploadBar";
import { PdfViewerPanel } from "./PdfViewerPanel";
import { buildChartGroupTags, buildSidebarTreeData, type ChartGroupTag } from "../selectors/sidebar";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

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

const airportIcon = createIcon("#e74c3c", 14);
const waypointIcon = createIcon("#3498db", 8);
const navaidIcon = createIcon("#9b59b6", 10);
const explicitWaypointIcon = createIcon("#2ecc71", 10);
const fittedWaypointIcon = createIcon("#27ae60", 10);

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

function getMarkerIcon(point: ParsedRoutePoint) {
  if (point.isAirport) return airportIcon;
  if (point.type === "navaid") return navaidIcon;
  if (point.isExplicit) return explicitWaypointIcon;
  return waypointIcon;
}

function getFittedMarkerIcon(wp: FittedWaypoint) {
  if (wp.isAirport) return airportIcon;
  if (wp.type === "navaid") return navaidIcon;
  return fittedWaypointIcon;
}

/** 自动调整地图视野的组件 */
function FitBounds({ points, trigger }: { points: Array<{ lat: number; lon: number }>; trigger: number }) {
  const map = useMap();
  const [lastTrigger, setLastTrigger] = useState(0);

  useEffect(() => {
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
    if (!hasInitialCenter) {
      map.setView([pilot.latitude, pilot.longitude], 8);
      setHasInitialCenter(true);
    }
  }, [map, pilot, enabled, hasInitialCenter]);

  useEffect(() => {
    if (centerTrigger > lastTrigger && pilot) {
      map.setView([pilot.latitude, pilot.longitude], 8);
      setLastTrigger(centerTrigger);
    }
  }, [map, pilot, centerTrigger, lastTrigger]);

  return null;
}

export interface RouteIntegratedPageProps {
  onBack: () => void;
  isDark: boolean;
  /** 初始起飞机场 ICAO */
  initialDepartureIcao: string;
  /** 初始降落机场 ICAO */
  initialArrivalIcao: string;
}

type TabKey = "overview" | "chart";

export function RouteIntegratedPage({
  onBack,
  isDark,
  initialDepartureIcao,
  initialArrivalIcao
}: RouteIntegratedPageProps) {
  const windowHeight = useWindowHeight();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  // 侧边栏状态
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [mobileDrawerFullyOpen, setMobileDrawerFullyOpen] = useState(false);

  // 导航数据库状态
  const [routeStatus, setRouteStatus] = useState<RouteStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // 当前激活的 Tab
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // 航路解析状态
  const [parseResult, setParseResult] = useState<ParsedRoute | null>(null);

  // KML 导入状态
  const [kmlResult, setKmlResult] = useState<KmlParseResult | null>(null);
  const [fitResult, setFitResult] = useState<FitRouteResult | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);

  // VATSIM 追踪状态
  const [vatsimPilot, setVatsimPilot] = useState<VatsimPilot | null>(null);

  // 地图控制
  const [showLegend, setShowLegend] = useState(false);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [vatsimCenterTrigger, setVatsimCenterTrigger] = useState(0);

  // 外部航路输入（用于 VATSIM 导入）
  const [externalRouteInput, setExternalRouteInput] = useState<string | undefined>(undefined);

  // 航图相关状态
  const [airports, setAirports] = useState<AirportRow[]>([]);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [airportsError, setAirportsError] = useState<string | null>(null);

  const [departureIcao, setDepartureIcao] = useState<string>(initialDepartureIcao);
  const [arrivalIcao, setArrivalIcao] = useState<string>(initialArrivalIcao);
  const [activeIcao, setActiveIcao] = useState<string>(initialDepartureIcao);

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [openedFileId, setOpenedFileId] = useState<number | null>(null);
  const [chartGroupFilter, setChartGroupFilter] = useState<string>("全部");
  const [viewMode, setViewMode] = useState<"全部" | "收藏">("全部");
  const [favoriteRelPaths, setFavoriteRelPaths] = useState<Set<string>>(new Set());

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

  // 加载机场列表
  useEffect(() => {
    (async () => {
      try {
        setAirportsLoading(true);
        const res = await apiAirports();
        const raw = res?.airports ?? [];
        const list: AirportRow[] = Array.isArray(raw) ? raw : [];
        const sorted = [...list].sort((a, b) => {
          const ac = Number(a?.fileCount ?? 0);
          const bc = Number(b?.fileCount ?? 0);
          const az = ac <= 0;
          const bz = bc <= 0;
          if (az !== bz) return az ? 1 : -1;
          return String(a?.icao ?? "").localeCompare(String(b?.icao ?? ""), "en");
        });
        setAirports(sorted);
        setAirportsError(null);
      } catch (e: any) {
        setAirportsError(e?.message || String(e));
      } finally {
        setAirportsLoading(false);
      }
    })();
  }, []);

  // 加载目录树
  useEffect(() => {
    if (!activeIcao) {
      setTree([]);
      return;
    }
    (async () => {
      try {
        setTreeLoading(true);
        const res = await apiTree(activeIcao);
        const t = res?.tree ?? [];
        setTree(Array.isArray(t) ? t : []);
        setTreeError(null);
      } catch (e: any) {
        setTreeError(e?.message || String(e));
      } finally {
        setTreeLoading(false);
      }
    })();
  }, [activeIcao]);

  // 加载收藏
  useEffect(() => {
    if (!activeIcao) return;
    (async () => {
      try {
        const res = await apiFavoriteRelPaths(activeIcao);
        const list = Array.isArray(res?.relPaths) ? res.relPaths : [];
        setFavoriteRelPaths(new Set(list));
      } catch {
        setFavoriteRelPaths(new Set());
      }
    })();
  }, [activeIcao]);

  // 切换机场时重置状态
  useEffect(() => {
    if (!activeIcao) return;
    setOpenedFileId(null);
    setViewMode("全部");
    setChartGroupFilter("全部");
  }, [activeIcao]);

  // 收藏切换
  const toggleFavoriteByNode = async (n: Extract<TreeNode, { type: "file" }>) => {
    const relPath = n.relPath;
    const isFav = favoriteRelPaths.has(relPath);
    try {
      if (isFav) {
        await apiFavoriteRemove({ relPath });
        setFavoriteRelPaths((prev) => {
          const next = new Set(prev);
          next.delete(relPath);
          return next;
        });
      } else {
        await apiFavoriteAdd({ fileId: n.id });
        setFavoriteRelPaths((prev) => new Set(prev).add(relPath));
      }
    } catch {
      // ignore
    }
  };

  // 构建侧边栏树
  const sidebarTree = useMemo(() => {
    return buildSidebarTreeData({
      tree,
      chartGroupFilter,
      viewMode,
      favoriteRelPaths,
      token: { colorText: token.colorText, colorTextSecondary: token.colorTextSecondary, colorWarning: token.colorWarning },
      onToggleFavorite: (n) => void toggleFavoriteByNode(n)
    });
  }, [tree, chartGroupFilter, viewMode, favoriteRelPaths, token.colorText, token.colorTextSecondary, token.colorWarning]);

  const chartGroupTags = useMemo(() => {
    return buildChartGroupTags({ tree, viewMode, favoriteRelPaths });
  }, [tree, viewMode, favoriteRelPaths]);

  const favoritesCount = useMemo(() => favoriteRelPaths.size, [favoriteRelPaths]);

  // 处理航路解析成功
  const handleParseSuccess = useCallback((result: ParsedRoute) => {
    setParseResult(result);
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleParseClear = useCallback(() => {
    setParseResult(null);
  }, []);

  // 处理 KML 解析成功
  const handleKmlParsed = useCallback((result: KmlParseResult) => {
    setKmlResult(result);
    setFitResult(null);
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleRouteFitted = useCallback((result: FitRouteResult) => {
    setFitResult(result);
    setSelectedCandidateIndex(0);
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleKmlClear = useCallback(() => {
    setKmlResult(null);
    setFitResult(null);
    setSelectedCandidateIndex(0);
  }, []);

  const handleFitClear = useCallback(() => {
    setFitResult(null);
    setSelectedCandidateIndex(0);
  }, []);

  // 处理 VATSIM 导入航路
  const handleImportVatsimRoute = useCallback((route: string) => {
    setActiveTab("overview");
    setExternalRouteInput(route);
  }, []);

  const handleLocateAircraft = useCallback(() => {
    setVatsimCenterTrigger((v) => v + 1);
  }, []);

  // 获取当前选中的候选结果
  const selectedCandidate = useMemo(() => {
    if (!fitResult?.candidates || fitResult.candidates.length === 0) {
      // 向后兼容：如果没有 candidates 但有 waypoints，使用 waypoints
      if (fitResult?.waypoints && fitResult.waypoints.length > 0) {
        return {
          score: 0,
          waypoints: fitResult.waypoints,
          routeString: fitResult.routeString,
          segments: []
        };
      }
      return null;
    }
    return fitResult.candidates[selectedCandidateIndex] || fitResult.candidates[0];
  }, [fitResult, selectedCandidateIndex]);

  // 收集所有地图数据点
  const getAllMapPoints = useCallback((): Array<{ lat: number; lon: number }> => {
    const points: Array<{ lat: number; lon: number }> = [];
    if (parseResult) {
      points.push(...parseResult.points.map((p) => ({ lat: p.lat, lon: p.lon })));
    }
    if (kmlResult) {
      points.push(...kmlResult.points.map((p) => ({ lat: p.lat, lon: p.lon })));
    }
    if (selectedCandidate) {
      points.push(...selectedCandidate.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon })));
    }
    return points;
  }, [parseResult, kmlResult, selectedCandidate]);

  // PDF 链接
  const pdfHref = openedFileId ? pdfUrl(openedFileId) : null;

  // 打开文件
  const openFileFromSidebar = (id: number) => {
    setOpenedFileId(id);
    if (isMobile) setSiderCollapsed(true);
  };

  // 返回地图
  const backToMap = () => {
    setOpenedFileId(null);
  };

  // 渲染总览 Tab 内容
  const renderOverviewTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%", overflowY: "auto" }}>
      <RouteParsePanel
        parseResult={parseResult}
        onParseSuccess={handleParseSuccess}
        onClear={handleParseClear}
        externalRouteInput={externalRouteInput}
        onExternalInputUsed={() => setExternalRouteInput(undefined)}
        departureIcao={departureIcao}
        arrivalIcao={arrivalIcao}
      />
      <Divider style={{ margin: "8px 0" }} />
      <RouteFitPanel
        kmlResult={kmlResult}
        fitResult={fitResult}
        onRouteFitted={handleRouteFitted}
        onClear={handleFitClear}
        selectedCandidateIndex={selectedCandidateIndex}
        onCandidateIndexChange={setSelectedCandidateIndex}
      />
    </div>
  );

  // 渲染航图 Tab 内容
  const renderChartTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* 起降机场切换 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Tag
          color={activeIcao === departureIcao ? "blue" : "default"}
          onClick={() => setActiveIcao(departureIcao)}
          style={{ cursor: "pointer", userSelect: "none", margin: 0 }}
        >
          起 {departureIcao}
        </Tag>
        <span style={{ color: token.colorTextSecondary }}>→</span>
        <Tag
          color={activeIcao === arrivalIcao ? "blue" : "default"}
          onClick={() => setActiveIcao(arrivalIcao)}
          style={{ cursor: "pointer", userSelect: "none", margin: 0 }}
        >
          降 {arrivalIcao}
        </Tag>
      </div>

      {/* 分组筛选 */}
      {activeIcao && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Tag
              color={viewMode === "全部" ? "blue" : "default"}
              onClick={() => { setViewMode("全部"); setChartGroupFilter("全部"); }}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              全部
            </Tag>
            <Tag
              color={viewMode === "收藏" ? "gold" : "default"}
              onClick={() => { setViewMode("收藏"); setChartGroupFilter("全部"); }}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              收藏({favoritesCount})
            </Tag>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {chartGroupTags.map((g: ChartGroupTag) => (
              <Tag
                key={g.key}
                color={chartGroupFilter === g.key ? "blue" : "default"}
                onClick={() => setChartGroupFilter(g.key)}
                style={{ cursor: "pointer", userSelect: "none", opacity: chartGroupFilter === g.key ? 1 : 0.85 }}
              >
                {g.key}({g.count})
              </Tag>
            ))}
          </div>
        </>
      )}

      {/* 目录树 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {airportsError && <Alert type="error" showIcon message={airportsError} />}
        {treeError && <Alert type="error" showIcon message={treeError} />}

        {!activeIcao ? (
          <Empty description="请先选择机场" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Spin spinning={treeLoading}>
            {!tree.length && !treeLoading ? (
              <Empty description="没有找到航图" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Tree
                defaultExpandAll
                blockNode
                treeData={sidebarTree}
                onSelect={(keys: React.Key[]) => {
                  const k = String(keys[0] ?? "");
                  if (k.startsWith("f:")) {
                    const id = Number(k.slice(2));
                    if (!Number.isNaN(id)) openFileFromSidebar(id);
                  }
                }}
              />
            )}
          </Spin>
        )}
      </div>
    </div>
  );

  // 渲染侧边栏内容
  const renderSidebarContent = () => (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 12, paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        items={[
          {
            key: "overview",
            label: (
              <Space>
                <EnvironmentOutlined />
                总览
              </Space>
            ),
            children: renderOverviewTab()
          },
          {
            key: "chart",
            label: (
              <Space>
                <FileTextOutlined />
                航图
              </Space>
            ),
            children: renderChartTab()
          }
        ]}
        style={{ flex: 1 }}
      />
    </div>
  );

  // 渲染地图
  const renderMap = () => (
    <MapContainer
      center={[35, 105]}
      zoom={5}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={getAllMapPoints()} trigger={fitBoundsTrigger} />
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
                  <div style={{ marginTop: 4, borderTop: "1px solid #eee", paddingTop: 4 }}>
                    <div>{vatsimPilot.flight_plan.departure} → {vatsimPilot.flight_plan.arrival}</div>
                    <div>机型: {vatsimPilot.flight_plan.aircraft_short}</div>
                  </div>
                )}
              </div>
            </div>
          </Popup>
        </Marker>
      )}

      {/* KML 航迹 */}
      {kmlResult && kmlResult.points.length > 0 && (
        <Polyline
          positions={kmlResult.points.map((p) => [p.lat, p.lon])}
          pathOptions={{ color: "#8e44ad", weight: 2, opacity: 0.8, dashArray: "8, 6" }}
        />
      )}

      {/* 拟合航路（使用选中的候选结果） */}
      {selectedCandidate && selectedCandidate.waypoints.length > 0 && (
        <>
          <Polyline
            positions={selectedCandidate.waypoints.map((wp) => [wp.lat, wp.lon])}
            pathOptions={{ color: "#16a085", weight: 3, opacity: 0.8 }}
          />
          {selectedCandidate.waypoints.map((wp, idx) => (
            <Marker key={`fit-${wp.ident}-${idx}`} position={[wp.lat, wp.lon]} icon={getFittedMarkerIcon(wp)}>
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

      {/* 航路解析结果 */}
      {parseResult && parseResult.points.length > 0 && (
        <>
          <Polyline
            positions={parseResult.points.map((p) => [p.lat, p.lon])}
            pathOptions={{ color: "#3498db", weight: 3, opacity: 0.8 }}
          />
          {parseResult.points.map((point, idx) => (
            <Marker key={`route-${point.ident}-${idx}`} position={[point.lat, point.lon]} icon={getMarkerIcon(point)}>
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
  );

  return (
    <div style={{ height: windowHeight, display: "flex", flexDirection: "column", background: token.colorBgLayout }}>
      {/* 顶栏：工具区 */}
      <div
        style={{
          padding: "8px 16px",
          background: token.colorBgElevated,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          flexShrink: 0
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>

        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* VATSIM 追踪 - 内联 */}
          <VatsimTrackBar
            pilot={vatsimPilot}
            onPilotUpdate={setVatsimPilot}
            onImportRoute={handleImportVatsimRoute}
            onLocateAircraft={handleLocateAircraft}
            inline
          />
        </div>

        {/* KML 上传 - 内联 */}
        <KmlUploadBar
          kmlResult={kmlResult}
          onKmlParsed={handleKmlParsed}
          onClear={handleKmlClear}
          inline
        />
      </div>

      {/* 状态检查 */}
      {statusLoading ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin tip="检查导航数据库..." />
        </div>
      ) : routeStatus && !routeStatus.available ? (
        <div style={{ padding: 24 }}>
          <Alert type="warning" showIcon message="航路解析功能不可用" description={routeStatus.message} />
        </div>
      ) : (
        <Layout style={{ flex: 1, minHeight: 0 }}>
          {/* 桌面端：左侧 Sider */}
          {!isMobile && (
            <Layout.Sider
              width={420}
              collapsible
              collapsedWidth={0}
              collapsed={siderCollapsed}
              onCollapse={(v) => setSiderCollapsed(v)}
              trigger={null}
              theme="light"
              style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: "hidden" }}
            >
              {renderSidebarContent()}
            </Layout.Sider>
          )}

          {/* 主内容区 */}
          <Layout.Content style={{ position: "relative", minHeight: 0 }}>
            {/* 移动端：打开抽屉的按钮 */}
            {isMobile && (
              <Button
                type="primary"
                icon={<MenuOutlined />}
                onClick={() => {
                  setMobileDrawerFullyOpen(false);
                  setSiderCollapsed(false);
                }}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  zIndex: 1000,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
                }}
              >
                面板
              </Button>
            )}

            {/* 桌面端：折叠按钮 */}
            {!isMobile && siderCollapsed && (
              <Button
                type="primary"
                icon={<MenuOutlined />}
                onClick={() => setSiderCollapsed(false)}
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  zIndex: 1000,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
                }}
              />
            )}

            {/* 右侧预览区：地图或 PDF */}
            {openedFileId === null ? (
              <>
                {renderMap()}

                {/* 地图控制按钮 */}
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
                    right: 20,
                    zIndex: 1000,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 8
                  }}
                >
                  {vatsimPilot && (
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<AimOutlined />}
                      onClick={handleLocateAircraft}
                      style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                    />
                  )}

                  {getAllMapPoints().length > 0 && (
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<FullscreenOutlined />}
                      onClick={() => setFitBoundsTrigger((v) => v + 1)}
                      style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                    />
                  )}

                  {showLegend ? (
                    <div
                      style={{
                        background: token.colorBgElevated,
                        borderRadius: token.borderRadius,
                        padding: 12,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontWeight: 500, fontSize: 12 }}>图例</span>
                        <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setShowLegend(false)} />
                      </div>
                      <Space direction="vertical" size={4}>
                        <Space><div style={{ width: 14, height: 14, background: "#e74c3c", borderRadius: "50%" }} /><span>机场</span></Space>
                        <Space><div style={{ width: 14, height: 14, background: "#2ecc71", borderRadius: "50%" }} /><span>指定航点</span></Space>
                        <Space><div style={{ width: 14, height: 14, background: "#3498db", borderRadius: "50%" }} /><span>中间航点</span></Space>
                        <Space><div style={{ width: 14, height: 14, background: "#9b59b6", borderRadius: "50%" }} /><span>VOR/NDB</span></Space>
                        <Space><div style={{ width: 30, height: 3, background: "#3498db" }} /><span>解析航路</span></Space>
                        <Space><div style={{ width: 30, height: 2, background: "#8e44ad", borderTop: "2px dashed #8e44ad" }} /><span>KML 航迹</span></Space>
                        <Space><div style={{ width: 30, height: 3, background: "#16a085" }} /><span>拟合航路</span></Space>
                      </Space>
                    </div>
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
              </>
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                {/* 返回地图按钮 */}
                <div
                  style={{
                    padding: "8px 12px",
                    background: token.colorBgElevated,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                >
                  <Button size="small" icon={<ArrowLeftOutlined />} onClick={backToMap}>
                    返回地图
                  </Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    当前查看: {activeIcao} 航图
                  </Typography.Text>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <PdfViewerPanel
                    openedFileId={openedFileId}
                    pdfHref={pdfHref}
                    workerUrl={pdfWorkerUrl}
                    isDark={isDark}
                    borderRadius={token.borderRadiusLG}
                    backgroundLayout={token.colorBgLayout}
                    backgroundContainer={token.colorBgContainer}
                  />
                </div>
              </div>
            )}
          </Layout.Content>

          {/* 移动端：底部抽屉 */}
          {isMobile && (
            <Drawer
              title="航线规划"
              placement="bottom"
              height="75vh"
              open={!siderCollapsed}
              onClose={() => {
                setMobileDrawerFullyOpen(false);
                setSiderCollapsed(true);
              }}
              afterOpenChange={(open) => setMobileDrawerFullyOpen(open)}
              maskClosable
              destroyOnClose={false}
              styles={{
                body: { padding: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)" },
                header: { borderBottom: `1px solid ${token.colorBorderSecondary}` }
              }}
            >
              {mobileDrawerFullyOpen ? renderSidebarContent() : (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Spin />
                </div>
              )}
            </Drawer>
          )}
        </Layout>
      )}
    </div>
  );
}
