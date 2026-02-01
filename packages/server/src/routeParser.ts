/**
 * 航路解析器
 * 解析用户输入的标准航路描述，返回航点坐标序列
 * 
 * 输入格式：起飞机场ICAO SID 核心航路段 STAR 落地机场ICAO
 * 示例：ZSPD SHA3P PIMOL G471 VMB A593 BTO FU2A ZGGG
 * 
 * 本期仅支持核心航路段解析
 */

import { NavDatabase, type NavPoint } from "./navdb.js";

/** 解析后的航路点 */
export interface ParsedRoutePoint extends NavPoint {
  /** 航路标识（该点是从哪条航路来的） */
  viaAirway: string | null;
  /** 是否为用户直接输入的点（非航路中间点） */
  isExplicit: boolean;
  /** 是否为机场 */
  isAirport: boolean;
  /** 备注（如：SID/STAR 名称） */
  remark: string | null;
}

/** 解析结果 */
export interface ParsedRoute {
  /** 是否解析成功 */
  success: boolean;
  /** 错误信息 */
  error: string | null;
  /** 起飞机场 */
  departure: NavPoint | null;
  /** 落地机场 */
  arrival: NavPoint | null;
  /** SID 名称 */
  sid: string | null;
  /** STAR 名称 */
  star: string | null;
  /** 航路点序列 */
  points: ParsedRoutePoint[];
  /** 未能识别的元素 */
  unknownElements: string[];
}

/**
 * 判断是否可能为航路代码（格式匹配）
 * 航路代码通常为 1-2 个字母 + 数字，如 G471, A593, W1, B215
 */
function looksLikeAirwayCode(s: string): boolean {
  return /^[A-Z]{1,2}\d{1,4}$/i.test(s);
}

/**
 * 判断是否可能为航点代码（格式匹配）
 * 航点通常为 2-5 个字母，或者 1 个字母 + 数字（如 P366）
 */
function looksLikeWaypointCode(s: string): boolean {
  // 纯字母 2-5 个
  if (/^[A-Z]{2,5}$/i.test(s)) return true;
  // 1 个字母 + 数字（如 P366, P490）- 也可能是航点
  if (/^[A-Z]\d{1,4}$/i.test(s)) return true;
  return false;
}

/**
 * 判断是否为机场 ICAO 代码
 * ICAO 代码为 4 个字母，中国机场以 Z 开头
 */
function isAirportCode(s: string): boolean {
  return /^[A-Z]{4}$/i.test(s);
}

/**
 * 解析航路字符串
 */
export function parseRoute(navDb: NavDatabase, routeString: string): ParsedRoute {
  const result: ParsedRoute = {
    success: false,
    error: null,
    departure: null,
    arrival: null,
    sid: null,
    star: null,
    points: [],
    unknownElements: []
  };

  // 清理输入
  const cleaned = routeString
    .toUpperCase()
    .replace(/[,\->/]+/g, " ")  // 替换常见分隔符
    .replace(/\s+/g, " ")        // 合并空格
    .trim();

  if (!cleaned) {
    result.error = "航路为空";
    return result;
  }

  const elements = cleaned.split(" ").filter(Boolean);
  if (elements.length < 3) {
    result.error = "航路格式不正确，至少需要：起飞机场 SID 核心航路 STAR 落地机场";
    return result;
  }

  // 第一个元素应为起飞机场
  const depCode = elements[0];
  result.departure = navDb.findAirport(depCode);
  if (!result.departure) {
    result.error = `未找到起飞机场: ${depCode}`;
    return result;
  }

  // 最后一个元素应为落地机场
  const arrCode = elements[elements.length - 1];
  result.arrival = navDb.findAirport(arrCode);
  if (!result.arrival) {
    result.error = `未找到落地机场: ${arrCode}`;
    return result;
  }

  // 添加起飞机场为第一个点
  result.points.push({
    ...result.departure,
    viaAirway: null,
    isExplicit: true,
    isAirport: true,
    remark: "起飞机场"
  });

  // 中间元素：SID, 核心航路, STAR
  const middleElements = elements.slice(1, -1);
  
  if (middleElements.length < 3) {
    result.error = "航路格式不正确，需要包含 SID、核心航路段、STAR";
    return result;
  }

  // 第一个中间元素为 SID
  result.sid = middleElements[0];
  result.points.push({
    ident: result.sid,
    name: "标准离场程序",
    lat: result.departure.lat,
    lon: result.departure.lon,
    type: "waypoint",
    viaAirway: null,
    isExplicit: true,
    isAirport: false,
    remark: `SID: ${result.sid}`
  });

  // 最后一个中间元素为 STAR
  result.star = middleElements[middleElements.length - 1];

  // 核心航路段：中间的元素
  const coreElements = middleElements.slice(1, -1);
  
  // 解析核心航路段
  let currentAirway: string | null = null;
  let lastWaypoint: NavPoint | null = null;
  
  // 用上一个已知位置作为参考点，初始为起飞机场
  let refLat = result.departure.lat;
  let refLon = result.departure.lon;

  for (let i = 0; i < coreElements.length; i++) {
    const elem = coreElements[i];

    // 判断是航路还是航点：优先检查数据库
    let isAirway = false;
    let isWaypoint = false;
    
    if (looksLikeAirwayCode(elem)) {
      // 可能是航路，查询数据库确认
      const airway = navDb.findAirway(elem);
      if (airway) {
        isAirway = true;
      } else if (looksLikeWaypointCode(elem)) {
        // 不是航路，可能是航点
        isWaypoint = true;
      }
    } else if (looksLikeWaypointCode(elem)) {
      isWaypoint = true;
    }

    if (isAirway) {
      // 这是航路代码，记录下来等待下一个航点
      currentAirway = elem;
    } else if (isWaypoint) {
      // 这是航点代码
      
      // 如果有上一个航点和航路代码，尝试获取航路中间点
      if (lastWaypoint && currentAirway) {
        const segment = navDb.getAirwaySegment(currentAirway, lastWaypoint.ident, elem);
        if (segment && segment.length >= 2) {
          // 添加中间航点（跳过第一个，因为已经添加过）
          for (let j = 1; j < segment.length - 1; j++) {
            result.points.push({
              ...segment[j],
              viaAirway: currentAirway,
              isExplicit: false,
              isAirport: false,
              remark: null
            });
            // 更新参考点
            refLat = segment[j].lat;
            refLon = segment[j].lon;
          }
          // 使用航路段最后一个点的坐标作为当前航点
          // 航路段的最后一个点就是当前航点，直接使用其坐标
          const lastSegPoint = segment[segment.length - 1];
          result.points.push({
            ...lastSegPoint,
            viaAirway: currentAirway,
            isExplicit: true,
            isAirport: false,
            remark: null
          });
          lastWaypoint = lastSegPoint;
          refLat = lastSegPoint.lat;
          refLon = lastSegPoint.lon;
          currentAirway = null;
          continue; // 跳过下面的普通航点处理
        }
      }
      
      // 普通航点处理（无航路或航路段查询失败）
      const point = navDb.findNavPointNear(elem, refLat, refLon);
      if (point) {
        result.points.push({
          ...point,
          viaAirway: currentAirway,
          isExplicit: true,
          isAirport: false,
          remark: null
        });
        lastWaypoint = point;
        // 更新参考点为当前航点
        refLat = point.lat;
        refLon = point.lon;
        currentAirway = null;
      } else {
        result.unknownElements.push(elem);
      }
    } else {
      // 无法识别的元素
      result.unknownElements.push(elem);
    }
  }

  // 添加 STAR 标记点
  result.points.push({
    ident: result.star,
    name: "标准进场程序",
    lat: result.arrival.lat,
    lon: result.arrival.lon,
    type: "waypoint",
    viaAirway: null,
    isExplicit: true,
    isAirport: false,
    remark: `STAR: ${result.star}`
  });

  // 添加落地机场为最后一个点
  result.points.push({
    ...result.arrival,
    viaAirway: null,
    isExplicit: true,
    isAirport: true,
    remark: "落地机场"
  });

  result.success = true;
  return result;
}

/**
 * 简化的航路解析（仅提取可用坐标点）
 * 对于 SID/STAR，使用对应机场的坐标作为占位
 */
export function parseRouteSimple(navDb: NavDatabase, routeString: string): {
  success: boolean;
  error: string | null;
  points: Array<{
    ident: string;
    lat: number;
    lon: number;
    type: string;
    remark: string | null;
  }>;
} {
  const result = parseRoute(navDb, routeString);
  
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      points: []
    };
  }

  return {
    success: true,
    error: null,
    points: result.points.map((p) => ({
      ident: p.ident,
      lat: p.lat,
      lon: p.lon,
      type: p.type,
      remark: p.remark
    }))
  };
}
