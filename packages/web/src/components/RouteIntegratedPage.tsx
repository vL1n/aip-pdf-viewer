/**
 * 航线规划整合页面
 * 整合功能：航路解析、最短航路、KML 导入、VATSIM 追踪、航图浏览
 *
 * 页面结构：
 * - 顶栏：返回按钮 + VATSIM 追踪 + KML 导入
 * - 左侧 Tabs：总览（航路解析+最短航路）、航图（机场选择+目录树）
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
  Slider,
  Select,
  theme,
  Tooltip as AntTooltip
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  ArrowLeftOutlined,
  FullscreenOutlined,
  AimOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  MenuOutlined,
  CloseOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { Circle, MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  apiRouteStatus,
  apiRouteAirports,
  apiTree,
  apiFavoriteRelPaths,
  apiFavoriteAdd,
  apiFavoriteRemove,
  apiRouteHighWaypoints,
  pdfUrl,
  type ParsedRoute,
  type ParsedRoutePoint,
  type RouteStatus,
  type VatsimPilot,
  type KmlParseResult,
  type HighAirwayWaypoint,
  type ShortestRouteResult,
  type ViaRouteItem,
  type AirportRow,
  type TreeNode
} from "../api";

import { RouteParsePanel } from "./RouteParsePanel";
import { RouteShortestPanel } from "./RouteShortestPanel";
import { VatsimTrackBar } from "./VatsimTrackBar";
import { KmlUploadBar } from "./KmlUploadBar";
import { PdfViewerPanel } from "./PdfViewerPanel";
import { buildChartGroupTags, buildSidebarTreeData, type ChartGroupTag } from "../selectors/sidebar";
import {
  removeShortestRouteAirway,
  removeShortestRoutePoint,
  removeShortestRouteToken,
  simplifyShortestRouteAirways
} from "../utils/routeEditing";

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
const departureBoundaryIcon = createIcon("#f97316", 12);
const arrivalBoundaryIcon = createIcon("#06b6d4", 12);
const highAirwayWaypointIcon = createIcon("#f59e0b", 9);
const searchAnchorIcon = createIcon("#111827", 12);
const NM_TO_METERS = 1852;

function normalizeAirportIcao(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function airportOptionLabel(airport: AirportRow) {
  const chartSuffix = Number(airport.fileCount ?? 0) > 0 ? `${airport.fileCount}图` : "无航图";
  return `${airport.icao}${airport.name ? ` - ${airport.name}` : ""} · ${chartSuffix}`;
}

function filterAirportOption(input: string, option?: { label?: unknown; value?: unknown }) {
  const keyword = input.trim().toUpperCase();
  if (!keyword) return true;
  return `${option?.value ?? ""} ${String(option?.label ?? "")}`.toUpperCase().includes(keyword);
}

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
  if (point.remark === "离场点") return departureBoundaryIcon;
  if (point.remark === "进场点") return arrivalBoundaryIcon;
  if (point.type === "navaid") return navaidIcon;
  if (point.isExplicit) return explicitWaypointIcon;
  return waypointIcon;
}

/** 自动调整地图视野的组件 */
function FitBounds({
  points,
  trigger,
  bottomInsetPx
}: {
  points: Array<{ lat: number; lon: number }>;
  trigger: number;
  bottomInsetPx: number;
}) {
  const map = useMap();
  const [lastTrigger, setLastTrigger] = useState(0);

  useEffect(() => {
    if (trigger > lastTrigger && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds, {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [50, Math.max(50, bottomInsetPx + 32)]
      });
      setLastTrigger(trigger);
    }
  }, [bottomInsetPx, map, points, trigger, lastTrigger]);

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

function MapRightClickSelector({
  searchActive,
  onSelect,
  onCancel
}: {
  searchActive: boolean;
  onSelect: (point: { lat: number; lon: number }) => void;
  onCancel: () => void;
}) {
  useMapEvents({
    contextmenu: (e) => {
      e.originalEvent.preventDefault();
      onSelect({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
    click: () => {
      if (searchActive) onCancel();
    }
  });
  return null;
}

function DisableMapNativeLongPress() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const preventNativeMenu = (event: Event) => {
      event.preventDefault();
    };

    container.addEventListener("contextmenu", preventNativeMenu);
    container.addEventListener("selectstart", preventNativeMenu);
    container.addEventListener("dragstart", preventNativeMenu);

    return () => {
      container.removeEventListener("contextmenu", preventNativeMenu);
      container.removeEventListener("selectstart", preventNativeMenu);
      container.removeEventListener("dragstart", preventNativeMenu);
    };
  }, [map]);

  return null;
}

export interface RouteIntegratedPageProps {
  onBack: () => void;
  isDark: boolean;
  /** 初始起飞机场 ICAO */
  initialDepartureIcao: string;
  /** 初始降落机场 ICAO */
  initialArrivalIcao: string;
  /** 起降机场变化时同步外部 URL 状态 */
  onRouteAirportsChange?: (departureIcao: string, arrivalIcao: string) => void;
}

type TabKey = "overview" | "chart";

export function RouteIntegratedPage({
  onBack,
  isDark,
  initialDepartureIcao,
  initialArrivalIcao,
  onRouteAirportsChange
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
  const [shortestResult, setShortestResult] = useState<ShortestRouteResult | null>(null);
  const [shortestDeparturePoint, setShortestDeparturePoint] = useState<ViaRouteItem | null>(null);
  const [shortestArrivalPoint, setShortestArrivalPoint] = useState<ViaRouteItem | null>(null);
  const [shortestViaItems, setShortestViaItems] = useState<ViaRouteItem[]>([]);

  // 地图右键高空航路点搜索
  const [airwaySearchAnchor, setAirwaySearchAnchor] = useState<{ lat: number; lon: number } | null>(null);
  const [airwaySearchRadiusNm, setAirwaySearchRadiusNm] = useState(30);
  const [airwaySearchPoints, setAirwaySearchPoints] = useState<HighAirwayWaypoint[]>([]);
  const [airwaySearchLoading, setAirwaySearchLoading] = useState(false);
  const [airwaySearchError, setAirwaySearchError] = useState<string | null>(null);

  // VATSIM 追踪状态
  const [vatsimPilot, setVatsimPilot] = useState<VatsimPilot | null>(null);

  // 地图控制
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [vatsimCenterTrigger, setVatsimCenterTrigger] = useState(0);
  const [mapBottomBarHeight, setMapBottomBarHeight] = useState(0);
  const [mobileBottomBarLabelsVisible, setMobileBottomBarLabelsVisible] = useState(true);
  const mapBottomBarRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!isMobile) setSiderCollapsed(false);
  }, [isMobile]);

  useEffect(() => {
    setDepartureIcao(normalizeAirportIcao(initialDepartureIcao));
  }, [initialDepartureIcao]);

  useEffect(() => {
    setArrivalIcao(normalizeAirportIcao(initialArrivalIcao));
  }, [initialArrivalIcao]);

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
        const res = await apiRouteAirports();
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
  const routeAirportOptions = useMemo(() => {
    return airports.map((airport) => ({
      value: airport.icao.toUpperCase(),
      label: airportOptionLabel(airport)
    }));
  }, [airports]);

  const routeChartIcaos = useMemo(() => {
    const fileCounts = new Map(airports.map((airport) => [airport.icao.toUpperCase(), Number(airport.fileCount ?? 0)]));
    return [departureIcao, arrivalIcao]
      .map((icao) => icao.toUpperCase())
      .filter((icao, idx, list) => icao && list.indexOf(icao) === idx && (fileCounts.get(icao) ?? 0) > 0);
  }, [airports, arrivalIcao, departureIcao]);

  useEffect(() => {
    if (airportsLoading) return;
    if (routeChartIcaos.length === 0) {
      if (activeIcao) setActiveIcao("");
      if (activeTab === "chart") setActiveTab("overview");
      return;
    }
    if (!routeChartIcaos.includes(activeIcao)) {
      setActiveIcao(routeChartIcaos[0] ?? "");
    }
  }, [activeIcao, activeTab, airportsLoading, routeChartIcaos]);

  useEffect(() => {
    const element = mapBottomBarRef.current;
    if (!element) return;
    let measureFrame = 0;

    const updateHeight = () => {
      const current = mapBottomBarRef.current;
      if (!current) return;
      setMapBottomBarHeight(Math.ceil(current.getBoundingClientRect().height));
    };
    const recomputeMobileLabels = () => {
      updateHeight();
      if (!isMobile) {
        setMobileBottomBarLabelsVisible(true);
        return;
      }

      setMobileBottomBarLabelsVisible(true);
      if (measureFrame) window.cancelAnimationFrame(measureFrame);
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = window.requestAnimationFrame(() => {
          const current = mapBottomBarRef.current;
          if (!current) return;
          setMobileBottomBarLabelsVisible(current.scrollWidth <= current.clientWidth + 2);
          updateHeight();
        });
      });
    };
    recomputeMobileLabels();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (measureFrame) window.cancelAnimationFrame(measureFrame);
      };
    }
    const observer = new ResizeObserver(recomputeMobileLabels);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (measureFrame) window.cancelAnimationFrame(measureFrame);
    };
  }, [
    openedFileId,
    isMobile,
    Boolean(vatsimPilot),
    vatsimPilot?.callsign,
    vatsimPilot?.flight_plan?.route,
    Boolean(kmlResult),
    kmlResult?.name,
    kmlResult?.totalPoints,
    kmlResult?.points.length,
    parseResult?.points.length,
    shortestResult?.points.length
  ]);

  const handleRouteEndpointChange = useCallback((role: "departure" | "arrival", value: string | undefined) => {
    const normalized = normalizeAirportIcao(value);
    const nextDeparture = role === "departure" ? normalized : departureIcao;
    const nextArrival = role === "arrival" ? normalized : arrivalIcao;

    setDepartureIcao(nextDeparture);
    setArrivalIcao(nextArrival);
    setShortestResult(null);
    setParseResult(null);
    setOpenedFileId(null);

    if (nextDeparture && nextArrival && nextDeparture !== nextArrival) {
      onRouteAirportsChange?.(nextDeparture, nextArrival);
    }
  }, [arrivalIcao, departureIcao, onRouteAirportsChange]);

  useEffect(() => {
    if (!airwaySearchAnchor) {
      setAirwaySearchPoints([]);
      setAirwaySearchError(null);
      setAirwaySearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          setAirwaySearchLoading(true);
          setAirwaySearchError(null);
          const res = await apiRouteHighWaypoints({
            lat: airwaySearchAnchor.lat,
            lon: airwaySearchAnchor.lon,
            radiusNm: airwaySearchRadiusNm,
            limit: 200
          });
          if (cancelled) return;
          if (!res.success) {
            setAirwaySearchError(res.error || "查询高空航路点失败");
            setAirwaySearchPoints([]);
            return;
          }
          setAirwaySearchPoints(res.waypoints ?? []);
        } catch (e: any) {
          if (!cancelled) {
            setAirwaySearchError(e?.message || "查询高空航路点失败");
            setAirwaySearchPoints([]);
          }
        } finally {
          if (!cancelled) setAirwaySearchLoading(false);
        }
      })();
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [airwaySearchAnchor, airwaySearchRadiusNm]);

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
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleShortestCalculated = useCallback((result: ShortestRouteResult) => {
    setShortestResult(result);
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleKmlClear = useCallback(() => {
    setKmlResult(null);
  }, []);

  const handleShortestClear = useCallback(() => {
    setShortestResult(null);
  }, []);

  const toViaRouteItem = useCallback((input: string | Pick<HighAirwayWaypoint, "id" | "ident" | "name" | "lat" | "lon">): ViaRouteItem | null => {
    const normalized = (typeof input === "string" ? input : input.ident).trim().toUpperCase();
    if (!normalized) return null;
    return typeof input === "string"
      ? { type: "waypoint", ident: normalized }
      : {
          type: "waypoint",
          ident: normalized,
          waypointId: input.id,
          name: input.name,
          lat: input.lat,
          lon: input.lon
        };
  }, []);

  const handleAddViaWaypoint = useCallback((input: string | Pick<HighAirwayWaypoint, "id" | "ident" | "name" | "lat" | "lon">) => {
    const nextItem = toViaRouteItem(input);
    if (!nextItem) return;
    const normalized = nextItem.ident;

    setShortestViaItems((prev) => {
      const exists = prev.some((item) => (
        nextItem.waypointId != null
          ? item.waypointId === nextItem.waypointId
          : item.ident.toUpperCase() === normalized
      ));
      if (exists) return prev;
      return [...prev, nextItem];
    });
    setActiveTab("overview");
    if (isMobile) setSiderCollapsed(false);
  }, [isMobile, toViaRouteItem]);

  const handleSetBoundaryWaypoint = useCallback((
    role: "departure" | "arrival",
    input: string | Pick<HighAirwayWaypoint, "id" | "ident" | "name" | "lat" | "lon">
  ) => {
    const nextItem = toViaRouteItem(input);
    if (!nextItem) return;
    if (role === "departure") setShortestDeparturePoint(nextItem);
    else setShortestArrivalPoint(nextItem);
    setActiveTab("overview");
    if (isMobile) setSiderCollapsed(false);
  }, [isMobile, toViaRouteItem]);

  const handleRemoveShortestPoint = useCallback((pointIndex: number) => {
    setShortestResult((prev) => (prev ? removeShortestRoutePoint(prev, pointIndex) : prev));
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleRemoveShortestAirway = useCallback((airway: string) => {
    setShortestResult((prev) => (prev ? removeShortestRouteAirway(prev, airway) : prev));
    setFitBoundsTrigger((v) => v + 1);
  }, []);

  const handleRemoveShortestRouteToken = useCallback((tokenIndex: number) => {
    setShortestResult((prev) => (prev ? removeShortestRouteToken(prev, tokenIndex) : prev));
  }, []);

  const handleSimplifyShortestRoute = useCallback(() => {
    setShortestResult((prev) => (prev ? simplifyShortestRouteAirways(prev) : prev));
  }, []);

  // 处理 VATSIM 导入航路
  const handleImportVatsimRoute = useCallback((route: string) => {
    setActiveTab("overview");
    setExternalRouteInput(route);
  }, []);

  const handleLocateAircraft = useCallback(() => {
    setVatsimCenterTrigger((v) => v + 1);
  }, []);

  // 收集所有地图数据点
  const getAllMapPoints = useCallback((): Array<{ lat: number; lon: number }> => {
    const points: Array<{ lat: number; lon: number }> = [];
    if (parseResult) {
      points.push(...parseResult.points.map((p) => ({ lat: p.lat, lon: p.lon })));
    }
    if (kmlResult) {
      points.push(...kmlResult.points.map((p) => ({ lat: p.lat, lon: p.lon })));
    }
    if (shortestResult) {
      points.push(...shortestResult.points.map((point) => ({ lat: point.lat, lon: point.lon })));
    }
    return points;
  }, [parseResult, kmlResult, shortestResult]);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflowY: "auto" }}>
      <div
        style={{
          padding: 14,
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer})`
        }}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr auto", gap: 10, alignItems: "end" }}>
            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>起飞机场</Typography.Text>
              <Select
                value={departureIcao || undefined}
                options={routeAirportOptions.filter((option) => !arrivalIcao || option.value !== arrivalIcao)}
                loading={airportsLoading}
                disabled={airportsLoading || routeAirportOptions.length === 0}
                showSearch
                allowClear
                optionFilterProp="label"
                filterOption={filterAirportOption}
                onChange={(value) => handleRouteEndpointChange("departure", value)}
                placeholder="搜索 nd.db3 全量机场"
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>降落机场</Typography.Text>
              <Select
                value={arrivalIcao || undefined}
                options={routeAirportOptions.filter((option) => !departureIcao || option.value !== departureIcao)}
                loading={airportsLoading}
                disabled={airportsLoading || routeAirportOptions.length === 0}
                showSearch
                allowClear
                optionFilterProp="label"
                filterOption={filterAirportOption}
                onChange={(value) => handleRouteEndpointChange("arrival", value)}
                placeholder="搜索 nd.db3 全量机场"
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
            <Button
              size="small"
              icon={<FullscreenOutlined />}
              disabled={getAllMapPoints().length === 0}
              onClick={() => setFitBoundsTrigger((v) => v + 1)}
              style={{ width: isMobile ? "100%" : undefined }}
            >
              定位路线
            </Button>
          </div>
          <Space size={6} wrap>
            <Tag color="blue">{departureIcao || "----"} → {arrivalIcao || "----"}</Tag>
            {shortestResult ? <Tag color="green">最短航路 {shortestResult.distanceKm.toFixed(0)} km</Tag> : <Tag>待生成最短航路</Tag>}
            {shortestResult ? <Tag color="blue">{shortestResult.points.length} 点</Tag> : null}
            <Tag color={routeChartIcaos.length > 0 ? "cyan" : "default"}>
              {routeChartIcaos.length > 0 ? `${routeChartIcaos.length} 个机场有航图` : "起降机场暂无航图"}
            </Tag>
          </Space>
        </Space>
      </div>
      <RouteShortestPanel
        departureIcao={departureIcao}
        arrivalIcao={arrivalIcao}
        departurePoint={shortestDeparturePoint}
        arrivalPoint={shortestArrivalPoint}
        onDeparturePointChange={setShortestDeparturePoint}
        onArrivalPointChange={setShortestArrivalPoint}
        viaItems={shortestViaItems}
        onViaItemsChange={setShortestViaItems}
        result={shortestResult}
        onCalculated={handleShortestCalculated}
        onClear={handleShortestClear}
        onRemoveAirway={handleRemoveShortestAirway}
        onRemovePoint={handleRemoveShortestPoint}
        onRemoveRouteToken={handleRemoveShortestRouteToken}
        onSimplifyRoute={handleSimplifyShortestRoute}
      />
      <RouteParsePanel
        parseResult={parseResult}
        onParseSuccess={handleParseSuccess}
        onClear={handleParseClear}
        externalRouteInput={externalRouteInput}
        onExternalInputUsed={() => setExternalRouteInput(undefined)}
        departureIcao={departureIcao}
        arrivalIcao={arrivalIcao}
      />
    </div>
  );

  // 渲染航图 Tab 内容
  const renderChartTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* 起降机场切换 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {routeChartIcaos.map((icao) => (
          <Tag
            key={icao}
            color={activeIcao === icao ? "blue" : "default"}
            onClick={() => setActiveIcao(icao)}
            style={{ cursor: "pointer", userSelect: "none", margin: 0 }}
          >
            {icao === departureIcao ? "起" : icao === arrivalIcao ? "降" : "航图"} {icao}
          </Tag>
        ))}
        {routeChartIcaos.length === 1 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            另一机场暂无航图
          </Typography.Text>
        )}
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
          <Empty description="起降机场暂无可用航图" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
                规划
              </Space>
            ),
            children: renderOverviewTab()
          },
          routeChartIcaos.length > 0 ? {
            key: "chart",
            label: (
              <Space>
                <FileTextOutlined />
                航图
              </Space>
            ),
            children: renderChartTab()
          } : null
        ].filter(Boolean) as any}
        style={{ flex: 1 }}
      />
    </div>
  );

  // 渲染地图
  const renderMap = () => (
    <MapContainer
      className="routeMapCanvas"
      center={[35, 105]}
      zoom={5}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={getAllMapPoints()} trigger={fitBoundsTrigger} bottomInsetPx={mapBottomBarHeight} />
      <FollowAircraft pilot={vatsimPilot} enabled={!!vatsimPilot} centerTrigger={vatsimCenterTrigger} />
      <DisableMapNativeLongPress />
      <MapRightClickSelector
        searchActive={!!airwaySearchAnchor}
        onSelect={setAirwaySearchAnchor}
        onCancel={() => setAirwaySearchAnchor(null)}
      />

      {/* 右键搜索高空航路点 */}
      {airwaySearchAnchor && (
        <>
          <Circle
            center={[airwaySearchAnchor.lat, airwaySearchAnchor.lon]}
            radius={airwaySearchRadiusNm * NM_TO_METERS}
            pathOptions={{ color: "#f59e0b", weight: 2, opacity: 0.9, fillColor: "#f59e0b", fillOpacity: 0.08 }}
          />
          <Marker position={[airwaySearchAnchor.lat, airwaySearchAnchor.lon]} icon={searchAnchorIcon} zIndexOffset={900}>
            <Tooltip permanent direction="top" offset={[0, -10]}>
              搜索中心 · {airwaySearchRadiusNm}NM
            </Tooltip>
          </Marker>
          {airwaySearchPoints.map((point) => (
            <Marker
              key={`high-airway-${point.id}`}
              position={[point.lat, point.lon]}
              icon={highAirwayWaypointIcon}
              zIndexOffset={800}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                <strong>{point.ident}</strong>
                <span style={{ marginLeft: 4, opacity: 0.7 }}>{point.distanceNm.toFixed(1)}NM</span>
              </Tooltip>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{point.ident}</strong>
                  {point.name && <div style={{ color: "#666" }}>{point.name}</div>}
                  <div style={{ fontSize: 12, color: "#999" }}>
                    {point.lat.toFixed(4)}°N, {point.lon.toFixed(4)}°E
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
                    距搜索点 {point.distanceNm.toFixed(1)} NM
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {point.airways.slice(0, 8).map((airway) => (
                      <Tag
                        key={airway}
                        color="cyan"
                        style={{ marginBottom: 4 }}
                      >
                        {airway}
                      </Tag>
                    ))}
                    {point.airways.length > 8 && <Tag>+{point.airways.length - 8}</Tag>}
                  </div>
                  <Space size={6} wrap style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => handleAddViaWaypoint(point)}
                    >
                      途径点
                    </Button>
                    <Button size="small" onClick={() => handleSetBoundaryWaypoint("departure", point)}>
                      设为离场
                    </Button>
                    <Button size="small" onClick={() => handleSetBoundaryWaypoint("arrival", point)}>
                      设为进场
                    </Button>
                  </Space>
                </div>
              </Popup>
            </Marker>
          ))}
        </>
      )}

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

      {/* 最短航路 */}
      {shortestResult && shortestResult.points.length > 0 && (
        <>
          <Polyline
            positions={shortestResult.points.map((point) => [point.lat, point.lon])}
            pathOptions={{ color: "#16a085", weight: 3, opacity: 0.8 }}
          />
          {shortestResult.points.map((point, idx) => (
            <Marker key={`shortest-${point.ident}-${idx}`} position={[point.lat, point.lon]} icon={getMarkerIcon(point)}>
              <Tooltip permanent={point.isAirport || point.isExplicit} direction="top" offset={[0, -10]}>
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
                  <Button
                    danger
                    size="small"
                    type="link"
                    onClick={() => handleRemoveShortestPoint(idx)}
                    style={{ padding: 0, marginTop: 6 }}
                  >
                    删除该生成航点
                  </Button>
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

  const renderAirwaySearchPanel = () => {
    if (!airwaySearchAnchor) return null;

    return (
      <div
      style={{
        position: "absolute",
        top: 14,
        left: 14,
        zIndex: 1000,
        width: isMobile ? "calc(100% - 78px)" : 360,
        maxWidth: "calc(100% - 28px)",
        pointerEvents: "auto"
      }}
    >
      <div
        style={{
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            background: `linear-gradient(135deg, rgba(245,158,11,0.16), ${token.colorBgElevated})`,
            borderBottom: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
            <div>
              <Typography.Text strong>高空航路点查找</Typography.Text>
              <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                右键地图选择圆心，点击候选点可加入途径点
              </Typography.Text>
            </div>
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setAirwaySearchAnchor(null)} />
          </Space>
        </div>

        <div style={{ padding: 12 }}>
          <Space size={6} wrap style={{ marginBottom: 8 }}>
            <Tag color="gold">{airwaySearchRadiusNm} NM</Tag>
            <Tag color={airwaySearchLoading ? "processing" : "blue"}>
              {airwaySearchLoading ? "查询中" : `${airwaySearchPoints.length} 个点`}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {airwaySearchAnchor.lat.toFixed(3)}, {airwaySearchAnchor.lon.toFixed(3)}
            </Typography.Text>
          </Space>

          <Slider
            min={5}
            max={120}
            step={5}
            value={airwaySearchRadiusNm}
            onChange={setAirwaySearchRadiusNm}
            tooltip={{ formatter: (value) => `${value} NM` }}
            styles={{ track: { background: "#f59e0b" } }}
          />

          {airwaySearchError && (
            <Alert type="error" showIcon message={airwaySearchError} style={{ marginBottom: 8 }} />
          )}

          <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
            可途径航点
          </Typography.Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 154, overflowY: "auto" }}>
            {airwaySearchPoints.slice(0, 30).map((point) => (
              <Tag
                key={`panel-high-airway-${point.id}`}
                color="gold"
                onClick={() => handleAddViaWaypoint(point)}
                style={{ margin: 0, padding: "4px 8px", borderRadius: 999, cursor: "pointer" }}
              >
                <PlusOutlined style={{ marginRight: 4 }} />
                {point.ident}
                <span style={{ marginLeft: 4, opacity: 0.75 }}>{point.distanceNm.toFixed(0)}NM</span>
              </Tag>
            ))}
            {!airwaySearchLoading && airwaySearchPoints.length === 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前范围内没有高空航路点，可以放大半径再试。
              </Typography.Text>
            )}
          </div>
        </div>
      </div>
    </div>
    );
  };

  const bottomBarShowLabels = !isMobile || mobileBottomBarLabelsVisible;
  const bottomActionButtonStyle: React.CSSProperties = {
    background: "#111827",
    borderColor: "#111827",
    color: "#f8fafc",
    boxShadow: "none",
    fontWeight: 600
  };
  const bottomActionButtonShape = bottomBarShowLabels ? "round" as const : "circle" as const;

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
        <div
          aria-hidden="true"
          style={{
            width: 1,
            height: 22,
            background: token.colorBorderSecondary,
            flex: "0 0 auto"
          }}
        />
        <Typography.Text strong style={{ fontSize: 16 }}>
          航线规划
        </Typography.Text>
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
              theme="light"
              style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, overflow: "hidden" }}
            >
              {renderSidebarContent()}
            </Layout.Sider>
          )}

          {/* 主内容区 */}
          <Layout.Content style={{ position: "relative", minHeight: 0 }}>
            {/* 右侧预览区：地图或 PDF */}
            {openedFileId === null ? (
              <>
                {renderMap()}
                {renderAirwaySearchPanel()}

                {/* 地图控制按钮 */}
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
                    left: isMobile ? 12 : 20,
                    right: isMobile ? 12 : 20,
                    zIndex: 1000,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    pointerEvents: "none"
                  }}
                >
	                  <div
                      ref={mapBottomBarRef}
	                    style={{
	                      display: "flex",
	                      flexDirection: "row",
	                      alignItems: "center",
	                      justifyContent: "center",
	                      gap: 10,
	                      width: isMobile ? "100%" : "min(980px, 100%)",
	                      padding: 8,
	                      borderRadius: 999,
	                      background: token.colorBgElevated,
	                      border: `1px solid ${token.colorBorderSecondary}`,
	                      boxShadow: "0 10px 28px rgba(15, 23, 42, 0.24)",
	                      pointerEvents: "auto",
                        overflowX: "auto",
                        overflowY: "hidden",
                        WebkitOverflowScrolling: "touch",
                        scrollbarWidth: "thin"
	                    }}
	                  >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "nowrap",
                          flex: "0 0 auto",
                          minWidth: 0
                        }}
                      >
                        <VatsimTrackBar
                          pilot={vatsimPilot}
	                          onPilotUpdate={setVatsimPilot}
	                          onImportRoute={handleImportVatsimRoute}
	                          inline
	                          compact={isMobile}
                            showLabels={bottomBarShowLabels}
                            buttonStyle={bottomActionButtonStyle}
	                        />
	                        <KmlUploadBar
	                          kmlResult={kmlResult}
	                          onKmlParsed={handleKmlParsed}
	                          onClear={handleKmlClear}
	                          inline
	                          compact={isMobile}
                            showLabels={bottomBarShowLabels}
                            buttonStyle={bottomActionButtonStyle}
	                        />
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
	                          justifyContent: "center",
                          gap: 8,
                          flex: "0 0 auto",
                          flexWrap: "nowrap"
                        }}
                      >
                        {vatsimPilot && (
                          <AntTooltip title="定位到 VATSIM 飞机">
                            <Button
                              size="small"
                              shape={bottomActionButtonShape}
                              icon={<AimOutlined />}
                              onClick={handleLocateAircraft}
                              aria-label="定位到 VATSIM 飞机"
                              style={bottomActionButtonStyle}
                            >
                              {bottomBarShowLabels ? "定位" : null}
                            </Button>
                          </AntTooltip>
                        )}

                        {getAllMapPoints().length > 0 && (
                          <AntTooltip title="缩放到全图">
                            <Button
                              size="small"
                              shape={bottomActionButtonShape}
                              icon={<FullscreenOutlined />}
                              onClick={() => setFitBoundsTrigger((v) => v + 1)}
                              aria-label="缩放到全图"
                              style={bottomActionButtonStyle}
                            >
                              {bottomBarShowLabels ? "全图" : null}
                            </Button>
                          </AntTooltip>
                        )}

                        {isMobile && (
                          <AntTooltip title="打开面板">
                            <Button
                              size="small"
                              shape={bottomActionButtonShape}
                              icon={<MenuOutlined />}
                              aria-label="打开面板"
                              style={bottomActionButtonStyle}
                              onClick={() => {
                                setMobileDrawerFullyOpen(false);
                                setSiderCollapsed(false);
                              }}
                            >
                              {bottomBarShowLabels ? "面板" : null}
                            </Button>
                          </AntTooltip>
                        )}
                      </div>
                  </div>
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
