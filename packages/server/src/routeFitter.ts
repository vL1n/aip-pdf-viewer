/**
 * 航路拟合器
 * 根据 KML 航迹点序列，识别转折点，为每段航迹匹配航路，返回多个候选结果
 */

import { NavDatabase, type NavPoint } from "./navdb.js";
import type { KmlTrackPoint } from "./kmlParser.js";

/** 转折点 */
export interface TurnPoint {
  /** 索引 */
  index: number;
  /** 纬度 */
  lat: number;
  /** 经度 */
  lon: number;
  /** 航向变化角度（度） */
  headingChange: number;
}

/** 航段 */
export interface TrackSegment {
  /** 起点索引 */
  startIndex: number;
  /** 终点索引 */
  endIndex: number;
  /** 起点 */
  start: { lat: number; lon: number };
  /** 终点 */
  end: { lat: number; lon: number };
  /** 航段航向（度） */
  heading: number;
  /** 航段距离（公里） */
  distance: number;
}

/** 航段匹配结果 */
export interface SegmentMatch {
  /** 航段索引 */
  segmentIndex: number;
  /** 匹配的航路（可能为空，表示直飞） */
  airway: string | null;
  /** 航路上的入口点 */
  entryPoint: NavPoint | null;
  /** 航路上的出口点 */
  exitPoint: NavPoint | null;
  /** 方向匹配度 (0-100) */
  directionScore: number;
  /** 距离匹配度 (0-100) */
  distanceScore: number;
  /** 总分 (0-100) */
  totalScore: number;
}

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

/** 单个拟合候选结果 */
export interface FitCandidate {
  /** 拟合度分数 (0-100) */
  score: number;
  /** 拟合后的航点序列 */
  waypoints: FittedWaypoint[];
  /** 生成的航路字符串 */
  routeString: string;
  /** 各航段匹配详情 */
  segments: SegmentMatch[];
}

/** 拟合结果 */
export interface FitRouteResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error: string | null;
  /** 最佳结果的航点序列（向后兼容） */
  waypoints: FittedWaypoint[];
  /** 最佳结果的航路字符串（向后兼容） */
  routeString: string;
  /** 原始采样点数 */
  sampledPointsCount: number;
  /** 匹配到的航点数 */
  matchedWaypointsCount: number;
  /** 多个候选结果（按分数降序） */
  candidates: FitCandidate[];
}

/** 拟合配置 */
export interface FitOptions {
  /** 最大匹配距离（公里），超过此距离的点不予匹配 */
  maxDistanceKm?: number;
  /** 转折点检测的航向变化阈值（度） */
  turnAngleThreshold?: number;
  /** 最小航段距离（公里），过短的航段会被合并 */
  minSegmentDistanceKm?: number;
  /** 候选结果数量 */
  maxCandidates?: number;
  /** 方向匹配权重 (0-100)，默认 30 */
  directionWeight?: number;
  /** 距离匹配权重 (0-100)，默认 50 */
  distanceWeight?: number;
  /** 使用航路时的额外加分，默认 20 */
  airwayBonus?: number;
  /** 采样间隔（公里），对航迹进行预处理采样，0 表示不采样 */
  sampleIntervalKm?: number;
  /** 是否强制使用航路（不使用直飞） */
  preferAirways?: boolean;
}

const DEFAULT_OPTIONS: Required<FitOptions> = {
  maxDistanceKm: 30,
  turnAngleThreshold: 25,
  minSegmentDistanceKm: 30,
  maxCandidates: 3,
  directionWeight: 30,
  distanceWeight: 50,
  airwayBonus: 20,
  sampleIntervalKm: 0,
  preferAirways: false
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
 * 计算从点 A 到点 B 的航向（度，0-360）
 */
function calculateHeading(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  let heading = Math.atan2(y, x) * 180 / Math.PI;
  heading = (heading + 360) % 360;
  return heading;
}

/**
 * 计算两个航向之间的角度差（0-180度）
 */
function headingDifference(h1: number, h2: number): number {
  let diff = Math.abs(h1 - h2);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * 检测转折点
 * 根据航向变化识别航迹中的转折点
 */
function detectTurnPoints(
  points: KmlTrackPoint[],
  turnAngleThreshold: number,
  minSegmentDistanceKm: number
): TurnPoint[] {
  if (points.length < 3) return [];
  
  const turnPoints: TurnPoint[] = [];
  let lastTurnIndex = 0;
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    // 计算进入和离开当前点的航向
    const headingIn = calculateHeading(prev.lat, prev.lon, curr.lat, curr.lon);
    const headingOut = calculateHeading(curr.lat, curr.lon, next.lat, next.lon);
    
    // 计算航向变化
    const change = headingDifference(headingIn, headingOut);
    
    // 检查是否超过阈值
    if (change >= turnAngleThreshold) {
      // 检查与上一个转折点的距离
      const distFromLastTurn = haversineDistance(
        points[lastTurnIndex].lat, points[lastTurnIndex].lon,
        curr.lat, curr.lon
      );
      
      // 如果距离太近，更新上一个转折点（保留航向变化更大的）
      if (distFromLastTurn < minSegmentDistanceKm && turnPoints.length > 0) {
        const lastTurn = turnPoints[turnPoints.length - 1];
        if (change > lastTurn.headingChange) {
          turnPoints[turnPoints.length - 1] = {
            index: i,
            lat: curr.lat,
            lon: curr.lon,
            headingChange: change
          };
          lastTurnIndex = i;
        }
      } else {
        turnPoints.push({
          index: i,
          lat: curr.lat,
          lon: curr.lon,
          headingChange: change
        });
        lastTurnIndex = i;
      }
    }
  }
  
  return turnPoints;
}

/**
 * 根据转折点将航迹分割为航段
 */
function splitIntoSegments(points: KmlTrackPoint[], turnPoints: TurnPoint[]): TrackSegment[] {
  const segments: TrackSegment[] = [];
  
  // 所有需要分割的索引点（包括起点、转折点、终点）
  const splitIndices = [0, ...turnPoints.map(tp => tp.index), points.length - 1];
  
  // 去重并排序
  const uniqueIndices = [...new Set(splitIndices)].sort((a, b) => a - b);
  
  for (let i = 0; i < uniqueIndices.length - 1; i++) {
    const startIdx = uniqueIndices[i];
    const endIdx = uniqueIndices[i + 1];
    
    const start = points[startIdx];
    const end = points[endIdx];
    
    const distance = haversineDistance(start.lat, start.lon, end.lat, end.lon);
    const heading = calculateHeading(start.lat, start.lon, end.lat, end.lon);
    
    segments.push({
      startIndex: startIdx,
      endIndex: endIdx,
      start: { lat: start.lat, lon: start.lon },
      end: { lat: end.lat, lon: end.lon },
      heading,
      distance
    });
  }
  
  return segments;
}

/**
 * 为单个航段查找可能的航路匹配
 */
function findAirwayMatchesForSegment(
  navDb: NavDatabase,
  segment: TrackSegment,
  opts: Required<FitOptions>
): Array<{
  airway: string | null;
  entryPoint: NavPoint | null;
  exitPoint: NavPoint | null;
  directionScore: number;
  distanceScore: number;
}> {
  const matches: Array<{
    airway: string | null;
    entryPoint: NavPoint | null;
    exitPoint: NavPoint | null;
    directionScore: number;
    distanceScore: number;
  }> = [];
  
  const { maxDistanceKm, directionWeight, distanceWeight, airwayBonus, preferAirways } = opts;
  
  // 查找起点和终点附近的航点
  const startPoint = navDb.findNearestNavPoint(segment.start.lat, segment.start.lon, maxDistanceKm);
  const endPoint = navDb.findNearestNavPoint(segment.end.lat, segment.end.lon, maxDistanceKm);
  
  if (!startPoint || !endPoint) {
    // 如果找不到航点，返回直飞选项（除非强制使用航路）
    if (!preferAirways) {
      matches.push({
        airway: null,
        entryPoint: startPoint,
        exitPoint: endPoint,
        directionScore: 50,
        distanceScore: startPoint && endPoint ? 70 : 30
      });
    }
    return matches;
  }
  
  // 计算直飞的分数
  const directHeading = calculateHeading(startPoint.lat, startPoint.lon, endPoint.lat, endPoint.lon);
  const directHeadingDiff = headingDifference(segment.heading, directHeading);
  const directDirectionScore = Math.max(0, 100 - directHeadingDiff * 2);
  
  const startDist = haversineDistance(segment.start.lat, segment.start.lon, startPoint.lat, startPoint.lon);
  const endDist = haversineDistance(segment.end.lat, segment.end.lon, endPoint.lat, endPoint.lon);
  const avgDist = (startDist + endDist) / 2;
  const directDistanceScore = Math.max(0, 100 - avgDist * 5);
  
  // 添加直飞选项（除非强制使用航路）
  if (!preferAirways) {
    matches.push({
      airway: null,
      entryPoint: startPoint,
      exitPoint: endPoint,
      directionScore: directDirectionScore,
      distanceScore: directDistanceScore
    });
  }
  
  // 尝试查找连接两点的航路
  const commonAirway = navDb.findCommonAirway(startPoint.ident, endPoint.ident);
  
  if (commonAirway) {
    // 获取航路上的航点序列
    const airwaySegment = navDb.getAirwaySegment(commonAirway, startPoint.ident, endPoint.ident);
    
    if (airwaySegment && airwaySegment.length >= 2) {
      // 计算航路的方向
      const awFirst = airwaySegment[0];
      const awLast = airwaySegment[airwaySegment.length - 1];
      const airwayHeading = calculateHeading(awFirst.lat, awFirst.lon, awLast.lat, awLast.lon);
      const headingDiff = headingDifference(segment.heading, airwayHeading);
      
      // 航路方向分数
      const airwayDirectionScore = Math.max(0, 100 - headingDiff * 1.5);
      
      // 航路距离分数（计算航路中间点与航迹的平均距离）
      let totalMidDist = 0;
      for (const wp of airwaySegment) {
        // 计算航点到航迹线段的距离（简化：计算到起点和终点连线的垂直距离）
        const distToStart = haversineDistance(wp.lat, wp.lon, segment.start.lat, segment.start.lon);
        const distToEnd = haversineDistance(wp.lat, wp.lon, segment.end.lat, segment.end.lon);
        totalMidDist += Math.min(distToStart, distToEnd);
      }
      const avgMidDist = totalMidDist / airwaySegment.length;
      const airwayDistanceScore = Math.max(0, 100 - avgMidDist * 3);
      
      matches.push({
        airway: commonAirway,
        entryPoint: airwaySegment[0],
        exitPoint: airwaySegment[airwaySegment.length - 1],
        directionScore: airwayDirectionScore,
        distanceScore: airwayDistanceScore
      });
    }
  }
  
  // 如果强制使用航路但没有找到，添加直飞作为后备
  if (preferAirways && matches.length === 0) {
    matches.push({
      airway: null,
      entryPoint: startPoint,
      exitPoint: endPoint,
      directionScore: directDirectionScore,
      distanceScore: directDistanceScore
    });
  }
  
  // 按总分排序（使用可配置权重）
  const totalWeight = directionWeight + distanceWeight;
  matches.sort((a, b) => {
    const scoreA = (a.directionScore * directionWeight + a.distanceScore * distanceWeight) / totalWeight * 100 + (a.airway ? airwayBonus : 0);
    const scoreB = (b.directionScore * directionWeight + b.distanceScore * distanceWeight) / totalWeight * 100 + (b.airway ? airwayBonus : 0);
    return scoreB - scoreA;
  });
  
  return matches;
}

/**
 * 为所有航段查找匹配并生成候选组合
 */
function generateCandidates(
  navDb: NavDatabase,
  segments: TrackSegment[],
  opts: Required<FitOptions>
): FitCandidate[] {
  const { maxCandidates, directionWeight, distanceWeight, airwayBonus } = opts;
  
  // 为每个航段找到匹配选项
  const segmentMatches: Array<Array<{
    airway: string | null;
    entryPoint: NavPoint | null;
    exitPoint: NavPoint | null;
    directionScore: number;
    distanceScore: number;
  }>> = [];
  
  for (const segment of segments) {
    const matches = findAirwayMatchesForSegment(navDb, segment, opts);
    segmentMatches.push(matches.slice(0, 3)); // 每段最多保留前3个选项
  }
  
  // 生成组合（使用贪心策略，每次选择当前最优）
  const candidates: FitCandidate[] = [];
  const scoreOpts = { directionWeight, distanceWeight, airwayBonus };
  
  // 策略1：每段都选最优
  const bestChoice = generateCandidate(segments, segmentMatches, 0, scoreOpts);
  if (bestChoice) candidates.push(bestChoice);
  
  // 策略2：第一段选次优（如果有的话）
  if (segmentMatches[0]?.length > 1) {
    const secondChoice = generateCandidate(segments, segmentMatches, 1, scoreOpts);
    if (secondChoice && !isSameCandidate(bestChoice, secondChoice)) {
      candidates.push(secondChoice);
    }
  }
  
  // 策略3：尝试更多航路匹配（优先使用航路）
  const airwayPreferChoice = generateAirwayPreferCandidate(segments, segmentMatches, scoreOpts);
  if (airwayPreferChoice && !candidates.some(c => isSameCandidate(c, airwayPreferChoice))) {
    candidates.push(airwayPreferChoice);
  }
  
  // 按分数排序
  candidates.sort((a, b) => b.score - a.score);
  
  return candidates.slice(0, maxCandidates);
}

/**
 * 检查两个候选结果是否相同
 */
function isSameCandidate(a: FitCandidate | null, b: FitCandidate | null): boolean {
  if (!a || !b) return false;
  return a.routeString === b.routeString;
}

/**
 * 根据每段的匹配选择生成候选结果
 */
function generateCandidate(
  segments: TrackSegment[],
  segmentMatches: Array<Array<{
    airway: string | null;
    entryPoint: NavPoint | null;
    exitPoint: NavPoint | null;
    directionScore: number;
    distanceScore: number;
  }>>,
  variantIndex: number,
  scoreOpts: { directionWeight: number; distanceWeight: number; airwayBonus: number }
): FitCandidate | null {
  const { directionWeight, distanceWeight, airwayBonus } = scoreOpts;
  const totalWeight = directionWeight + distanceWeight;
  
  const segmentMatchResults: SegmentMatch[] = [];
  const waypoints: FittedWaypoint[] = [];
  let totalScore = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const options = segmentMatches[i];
    if (!options || options.length === 0) continue;
    
    // 对于第一段使用 variantIndex，其他段使用最优
    const choiceIdx = i === 0 ? Math.min(variantIndex, options.length - 1) : 0;
    const choice = options[choiceIdx];
    
    const totalSegScore = (choice.directionScore * directionWeight + choice.distanceScore * distanceWeight) / totalWeight * 100 + (choice.airway ? airwayBonus : 0);
    
    segmentMatchResults.push({
      segmentIndex: i,
      airway: choice.airway,
      entryPoint: choice.entryPoint,
      exitPoint: choice.exitPoint,
      directionScore: choice.directionScore,
      distanceScore: choice.distanceScore,
      totalScore: totalSegScore
    });
    
    // 添加入口航点
    if (choice.entryPoint) {
      const lastWp = waypoints[waypoints.length - 1];
      if (!lastWp || lastWp.ident !== choice.entryPoint.ident) {
        waypoints.push({
          ident: choice.entryPoint.ident,
          name: choice.entryPoint.name,
          lat: choice.entryPoint.lat,
          lon: choice.entryPoint.lon,
          type: choice.entryPoint.type,
          distanceFromTrack: haversineDistance(
            segments[i].start.lat, segments[i].start.lon,
            choice.entryPoint.lat, choice.entryPoint.lon
          ),
          viaAirway: i > 0 ? segmentMatchResults[i - 1]?.airway || null : null,
          isAirport: choice.entryPoint.type === "airport"
        });
      }
    }
    
    // 添加出口航点（最后一段）
    if (i === segments.length - 1 && choice.exitPoint) {
      const lastWp = waypoints[waypoints.length - 1];
      if (!lastWp || lastWp.ident !== choice.exitPoint.ident) {
        waypoints.push({
          ident: choice.exitPoint.ident,
          name: choice.exitPoint.name,
          lat: choice.exitPoint.lat,
          lon: choice.exitPoint.lon,
          type: choice.exitPoint.type,
          distanceFromTrack: haversineDistance(
            segments[i].end.lat, segments[i].end.lon,
            choice.exitPoint.lat, choice.exitPoint.lon
          ),
          viaAirway: choice.airway,
          isAirport: choice.exitPoint.type === "airport"
        });
      }
    }
    
    totalScore += totalSegScore;
  }
  
  if (waypoints.length < 2) return null;
  
  // 计算平均分数
  const avgScore = segments.length > 0 ? totalScore / segments.length : 0;
  
  // 生成航路字符串
  const routeString = generateRouteString(waypoints);
  
  return {
    score: Math.round(avgScore),
    waypoints,
    routeString,
    segments: segmentMatchResults
  };
}

/**
 * 生成优先使用航路的候选
 */
function generateAirwayPreferCandidate(
  segments: TrackSegment[],
  segmentMatches: Array<Array<{
    airway: string | null;
    entryPoint: NavPoint | null;
    exitPoint: NavPoint | null;
    directionScore: number;
    distanceScore: number;
  }>>,
  scoreOpts: { directionWeight: number; distanceWeight: number; airwayBonus: number }
): FitCandidate | null {
  const { directionWeight, distanceWeight, airwayBonus } = scoreOpts;
  const totalWeight = directionWeight + distanceWeight;
  
  const segmentMatchResults: SegmentMatch[] = [];
  const waypoints: FittedWaypoint[] = [];
  let totalScore = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const options = segmentMatches[i];
    if (!options || options.length === 0) continue;
    
    // 优先选择有航路的选项
    let choice = options.find(opt => opt.airway !== null) || options[0];
    
    const totalSegScore = (choice.directionScore * directionWeight + choice.distanceScore * distanceWeight) / totalWeight * 100 + (choice.airway ? airwayBonus : 0);
    
    segmentMatchResults.push({
      segmentIndex: i,
      airway: choice.airway,
      entryPoint: choice.entryPoint,
      exitPoint: choice.exitPoint,
      directionScore: choice.directionScore,
      distanceScore: choice.distanceScore,
      totalScore: totalSegScore
    });
    
    // 添加入口航点
    if (choice.entryPoint) {
      const lastWp = waypoints[waypoints.length - 1];
      if (!lastWp || lastWp.ident !== choice.entryPoint.ident) {
        waypoints.push({
          ident: choice.entryPoint.ident,
          name: choice.entryPoint.name,
          lat: choice.entryPoint.lat,
          lon: choice.entryPoint.lon,
          type: choice.entryPoint.type,
          distanceFromTrack: haversineDistance(
            segments[i].start.lat, segments[i].start.lon,
            choice.entryPoint.lat, choice.entryPoint.lon
          ),
          viaAirway: i > 0 ? segmentMatchResults[i - 1]?.airway || null : null,
          isAirport: choice.entryPoint.type === "airport"
        });
      }
    }
    
    // 添加出口航点（最后一段）
    if (i === segments.length - 1 && choice.exitPoint) {
      const lastWp = waypoints[waypoints.length - 1];
      if (!lastWp || lastWp.ident !== choice.exitPoint.ident) {
        waypoints.push({
          ident: choice.exitPoint.ident,
          name: choice.exitPoint.name,
          lat: choice.exitPoint.lat,
          lon: choice.exitPoint.lon,
          type: choice.exitPoint.type,
          distanceFromTrack: haversineDistance(
            segments[i].end.lat, segments[i].end.lon,
            choice.exitPoint.lat, choice.exitPoint.lon
          ),
          viaAirway: choice.airway,
          isAirport: choice.exitPoint.type === "airport"
        });
      }
    }
    
    totalScore += totalSegScore;
  }
  
  if (waypoints.length < 2) return null;
  
  const avgScore = segments.length > 0 ? totalScore / segments.length : 0;
  const routeString = generateRouteString(waypoints);
  
  return {
    score: Math.round(avgScore),
    waypoints,
    routeString,
    segments: segmentMatchResults
  };
}

/**
 * 生成航路字符串
 */
function generateRouteString(waypoints: FittedWaypoint[]): string {
  if (waypoints.length === 0) return "";
  
  const parts: string[] = [];
  
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    parts.push(wp.ident);
    
    // 如果下一个点有航路，添加航路
    const next = i < waypoints.length - 1 ? waypoints[i + 1] : null;
    if (next?.viaAirway) {
      parts.push(next.viaAirway);
    }
  }
  
  return parts.join(" ");
}

/**
 * 对航迹点进行采样（减少点数以提高效率和减少噪声）
 */
function sampleTrackPoints(points: KmlTrackPoint[], intervalKm: number): KmlTrackPoint[] {
  if (intervalKm <= 0 || points.length <= 2) return points;
  
  const sampled: KmlTrackPoint[] = [points[0]];
  let lastSampledIdx = 0;
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = haversineDistance(
      points[lastSampledIdx].lat, points[lastSampledIdx].lon,
      points[i].lat, points[i].lon
    );
    if (dist >= intervalKm) {
      sampled.push(points[i]);
      lastSampledIdx = i;
    }
  }
  
  // 始终保留最后一个点
  sampled.push(points[points.length - 1]);
  return sampled;
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
    matchedWaypointsCount: 0,
    candidates: []
  };

  if (trackPoints.length < 2) {
    result.error = "航迹点数量不足，至少需要 2 个点";
    return result;
  }

  try {
    // 0. 采样（如果设置了采样间隔）
    const sampledPoints = sampleTrackPoints(trackPoints, opts.sampleIntervalKm);
    result.sampledPointsCount = sampledPoints.length;
    
    // 1. 检测转折点
    const turnPoints = detectTurnPoints(sampledPoints, opts.turnAngleThreshold, opts.minSegmentDistanceKm);
    
    // 2. 分割航段
    const segments = splitIntoSegments(sampledPoints, turnPoints);
    
    if (segments.length === 0) {
      result.error = "无法识别有效航段";
      return result;
    }
    
    // 3. 为每个航段匹配航路，生成候选
    const candidates = generateCandidates(navDb, segments, opts);
    
    if (candidates.length === 0) {
      result.error = "未能生成任何有效的拟合结果";
      return result;
    }
    
    // 4. 取最佳结果
    const best = candidates[0];
    
    result.success = true;
    result.waypoints = best.waypoints;
    result.routeString = best.routeString;
    result.matchedWaypointsCount = best.waypoints.length;
    result.candidates = candidates;

    return result;
  } catch (err: any) {
    result.error = err?.message || "拟合航路失败";
    return result;
  }
}
