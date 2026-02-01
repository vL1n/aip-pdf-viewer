/**
 * 航路拟合器
 * 根据 KML 航迹点序列，在导航数据库中拟合出最匹配的航路
 */

import { NavDatabase, type NavPoint } from "./navdb.js";
import type { KmlTrackPoint } from "./kmlParser.js";

/** 拟合后的航点 */
export interface FittedWaypoint {
  /** 航点标识 */
  ident: string;
  /** 航点名称 */
  name: string | null;
  /** 纬度 */
  lat: number;
  /** 经度 */
  lon: number;
  /** 类型 */
  type: "airport" | "waypoint" | "navaid";
  /** 与原始航迹点的距离（公里） */
  distanceFromTrack: number;
  /** 经由航路（如果有） */
  viaAirway: string | null;
  /** 是否为机场 */
  isAirport: boolean;
}

/** 拟合结果 */
export interface FitRouteResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error: string | null;
  /** 拟合后的航点序列 */
  waypoints: FittedWaypoint[];
  /** 生成的航路字符串 */
  routeString: string;
  /** 原始采样点数 */
  sampledPointsCount: number;
  /** 匹配到的航点数 */
  matchedWaypointsCount: number;
}

/** 拟合配置 */
export interface FitOptions {
  /** 最大匹配距离（公里），超过此距离的点不予匹配 */
  maxDistanceKm?: number;
  /** 采样间隔（公里） */
  sampleIntervalKm?: number;
  /** 是否尝试使用航路连接 */
  useAirways?: boolean;
}

const DEFAULT_OPTIONS: Required<FitOptions> = {
  maxDistanceKm: 30,      // 最大匹配距离 30 公里
  sampleIntervalKm: 50,   // 每 50 公里采样一个点
  useAirways: true
};

/**
 * 计算两点间的 Haversine 距离（单位：公里）
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 对航迹点进行采样
 */
function samplePoints(points: KmlTrackPoint[], intervalKm: number): KmlTrackPoint[] {
  if (points.length <= 2) return points;
  
  const sampled: KmlTrackPoint[] = [points[0]];
  
  for (let i = 1; i < points.length - 1; i++) {
    const lastSampled = sampled[sampled.length - 1];
    const current = points[i];
    const dist = haversineDistance(lastSampled.lat, lastSampled.lon, current.lat, current.lon);
    
    if (dist >= intervalKm) {
      sampled.push(current);
    }
  }
  
  // 始终保留最后一个点
  const lastPoint = points[points.length - 1];
  const lastSampled = sampled[sampled.length - 1];
  if (lastPoint.lat !== lastSampled.lat || lastPoint.lon !== lastSampled.lon) {
    sampled.push(lastPoint);
  }
  
  return sampled;
}

/**
 * 为每个采样点找到最近的航点
 */
function findNearestWaypoints(
  navDb: NavDatabase,
  sampledPoints: KmlTrackPoint[],
  maxDistanceKm: number
): Array<{ point: KmlTrackPoint; waypoint: NavPoint | null; distance: number }> {
  const results: Array<{ point: KmlTrackPoint; waypoint: NavPoint | null; distance: number }> = [];
  
  for (const point of sampledPoints) {
    const nearest = navDb.findNearestNavPoint(point.lat, point.lon, maxDistanceKm);
    
    if (nearest) {
      const distance = haversineDistance(point.lat, point.lon, nearest.lat, nearest.lon);
      results.push({ point, waypoint: nearest, distance });
    } else {
      results.push({ point, waypoint: null, distance: Infinity });
    }
  }
  
  return results;
}

/**
 * 去重相邻的相同航点
 */
function deduplicateWaypoints(waypoints: Array<{ waypoint: NavPoint; distance: number }>): Array<{ waypoint: NavPoint; distance: number }> {
  const deduped: Array<{ waypoint: NavPoint; distance: number }> = [];
  
  for (const wp of waypoints) {
    const last = deduped[deduped.length - 1];
    if (!last || last.waypoint.ident !== wp.waypoint.ident) {
      deduped.push(wp);
    }
  }
  
  return deduped;
}

/**
 * 尝试用航路连接相邻航点
 * 优先使用航路，尽可能将连续航点归入同一航路
 */
function tryConnectWithAirways(
  navDb: NavDatabase,
  waypoints: Array<{ waypoint: NavPoint; distance: number }>
): FittedWaypoint[] {
  const result: FittedWaypoint[] = [];
  
  for (let i = 0; i < waypoints.length; i++) {
    const current = waypoints[i];
    const prev = i > 0 ? waypoints[i - 1] : null;
    
    let viaAirway: string | null = null;
    
    // 尝试查找连接前一个航点和当前航点的航路
    if (prev) {
      // 首先尝试查找共同航路（更宽松的匹配）
      const commonAirway = navDb.findCommonAirway(prev.waypoint.ident, current.waypoint.ident);
      if (commonAirway) {
        viaAirway = commonAirway;
      }
    }
    
    result.push({
      ident: current.waypoint.ident,
      name: current.waypoint.name,
      lat: current.waypoint.lat,
      lon: current.waypoint.lon,
      type: current.waypoint.type,
      distanceFromTrack: current.distance,
      viaAirway,
      isAirport: current.waypoint.type === "airport"
    });
  }
  
  return result;
}

/**
 * 压缩航路：当连续航点在同一条航路上时，只保留起点和终点
 * 例如：A W226 B W226 C W226 D → A W226 D
 */
function compressAirwaySegments(waypoints: FittedWaypoint[]): FittedWaypoint[] {
  if (waypoints.length <= 2) return waypoints;
  
  const compressed: FittedWaypoint[] = [waypoints[0]];
  
  for (let i = 1; i < waypoints.length; i++) {
    const current = waypoints[i];
    const prev = compressed[compressed.length - 1];
    const next = i < waypoints.length - 1 ? waypoints[i + 1] : null;
    
    // 如果当前点和下一个点都通过相同的航路到达，可以跳过当前点
    // 但如果这是航路的终点（下一个点没有航路或航路不同），需要保留
    const isAirwayMidpoint = current.viaAirway && 
                              next?.viaAirway === current.viaAirway;
    
    if (isAirwayMidpoint) {
      // 这是航路中间点，跳过
      continue;
    }
    
    compressed.push(current);
  }
  
  return compressed;
}

/**
 * 生成航路字符串
 * 格式：航点 航路 航点 航路 航点...
 * 优先使用航路连接，减少航点数量
 */
function generateRouteString(waypoints: FittedWaypoint[]): string {
  if (waypoints.length === 0) return "";
  
  // 先压缩航路段
  const compressed = compressAirwaySegments(waypoints);
  
  const parts: string[] = [];
  
  for (let i = 0; i < compressed.length; i++) {
    const wp = compressed[i];
    
    // 添加航点
    parts.push(wp.ident);
    
    // 如果下一个点有航路，添加航路
    const next = i < compressed.length - 1 ? compressed[i + 1] : null;
    if (next?.viaAirway) {
      parts.push(next.viaAirway);
    }
  }
  
  return parts.join(" ");
}

/**
 * 拟合航路
 * @param navDb 导航数据库
 * @param trackPoints KML 航迹点序列
 * @param options 拟合选项
 */
export function fitRoute(
  navDb: NavDatabase,
  trackPoints: KmlTrackPoint[],
  options: FitOptions = {}
): FitRouteResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const result: FitRouteResult = {
    success: false,
    error: null,
    waypoints: [],
    routeString: "",
    sampledPointsCount: 0,
    matchedWaypointsCount: 0
  };

  if (trackPoints.length < 2) {
    result.error = "航迹点数量不足，至少需要 2 个点";
    return result;
  }

  try {
    // 1. 采样
    const sampledPoints = samplePoints(trackPoints, opts.sampleIntervalKm);
    result.sampledPointsCount = sampledPoints.length;

    // 2. 为每个采样点找最近航点
    const matches = findNearestWaypoints(navDb, sampledPoints, opts.maxDistanceKm);
    
    // 3. 过滤掉没有匹配到的点
    const validMatches = matches.filter(m => m.waypoint !== null) as Array<{ point: KmlTrackPoint; waypoint: NavPoint; distance: number }>;
    
    if (validMatches.length < 2) {
      result.error = `匹配到的航点数量不足（仅 ${validMatches.length} 个），请检查航迹是否在有效区域内`;
      return result;
    }

    // 4. 去重
    const deduped = deduplicateWaypoints(validMatches.map(m => ({ waypoint: m.waypoint, distance: m.distance })));
    
    // 5. 尝试用航路连接
    let fittedWaypoints: FittedWaypoint[];
    if (opts.useAirways) {
      fittedWaypoints = tryConnectWithAirways(navDb, deduped);
    } else {
      fittedWaypoints = deduped.map(d => ({
        ident: d.waypoint.ident,
        name: d.waypoint.name,
        lat: d.waypoint.lat,
        lon: d.waypoint.lon,
        type: d.waypoint.type,
        distanceFromTrack: d.distance,
        viaAirway: null,
        isAirport: d.waypoint.type === "airport"
      }));
    }

    // 6. 生成航路字符串
    const routeString = generateRouteString(fittedWaypoints);

    result.success = true;
    result.waypoints = fittedWaypoints;
    result.routeString = routeString;
    result.matchedWaypointsCount = fittedWaypoints.length;

    return result;
  } catch (err: any) {
    result.error = err?.message || "拟合航路失败";
    return result;
  }
}
