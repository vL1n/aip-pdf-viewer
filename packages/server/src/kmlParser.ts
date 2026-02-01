/**
 * KML 文件解析器
 * 解析 FlightRadar24 导出的 KML 文件，提取航迹坐标点
 */

/** KML 航迹点 */
export interface KmlTrackPoint {
  /** 经度 */
  lon: number;
  /** 纬度 */
  lat: number;
  /** 高度（米） */
  altitude: number;
  /** 时间戳（可选） */
  timestamp?: string;
  /** 航向（可选） */
  heading?: number;
  /** 速度（节，可选） */
  speed?: number;
}

/** KML 解析结果 */
export interface KmlParseResult {
  /** 是否解析成功 */
  success: boolean;
  /** 错误信息 */
  error: string | null;
  /** 航班名称 */
  name: string | null;
  /** 航迹点序列 */
  points: KmlTrackPoint[];
  /** 总点数 */
  totalPoints: number;
}

/**
 * 解析坐标字符串
 * 格式: "lon,lat,alt" 或 "lon,lat,alt lon,lat,alt ..."
 */
function parseCoordinates(coordStr: string): KmlTrackPoint[] {
  const points: KmlTrackPoint[] = [];
  
  // 清理并分割坐标
  const coords = coordStr
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  
  for (const coord of coords) {
    const parts = coord.split(",");
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const altitude = parts.length >= 3 ? parseFloat(parts[2]) : 0;
      
      if (!isNaN(lon) && !isNaN(lat)) {
        points.push({ lon, lat, altitude: isNaN(altitude) ? 0 : altitude });
      }
    }
  }
  
  return points;
}

/**
 * 从 Placemark 描述中提取速度和航向
 */
function parseDescription(desc: string): { speed?: number; heading?: number } {
  const result: { speed?: number; heading?: number } = {};
  
  // 提取速度 (格式: "Speed:</b></span> <span>123 kt")
  const speedMatch = desc.match(/Speed:<\/b><\/span>\s*<span>(\d+)\s*kt/i);
  if (speedMatch) {
    result.speed = parseInt(speedMatch[1], 10);
  }
  
  // 提取航向 (格式: "Heading:</b></span> <span>123&deg;")
  const headingMatch = desc.match(/Heading:<\/b><\/span>\s*<span>(\d+)/i);
  if (headingMatch) {
    result.heading = parseInt(headingMatch[1], 10);
  }
  
  return result;
}

/**
 * 简单的 XML 标签提取
 * 不使用完整的 XML 解析器，使用正则表达式处理
 */
function extractTagContent(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const matches: string[] = [];
  let match;
  
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1]);
  }
  
  return matches;
}

/**
 * 提取单个标签内容
 */
function extractSingleTag(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1] : null;
}

/**
 * 计算两点间的 Haversine 距离（单位：公里）
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 地球半径（公里）
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
 * 检测并过滤航迹中的回环
 * FlightRadar24 导出的 KML 可能同时包含 Point 和 LineString 数据
 * 这会导致航迹数据重复（先是所有 Point，然后是所有 LineString）
 * 我们检测大距离跳跃（超过 500km）来识别回环起点，只保留第一段航迹
 */
function filterTrackLoop(points: KmlTrackPoint[]): KmlTrackPoint[] {
  if (points.length < 10) return points;
  
  const JUMP_THRESHOLD_KM = 500; // 超过 500km 的跳跃视为回环
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    
    if (dist > JUMP_THRESHOLD_KM) {
      // 检测到大跳跃，返回跳跃之前的部分
      console.log(`[KML Parser] 检测到航迹回环在第 ${i} 个点，跳跃距离 ${dist.toFixed(0)}km，截断后续数据`);
      return points.slice(0, i);
    }
  }
  
  return points;
}

/**
 * 解析 KML 文件内容
 */
export function parseKml(kmlContent: string): KmlParseResult {
  const result: KmlParseResult = {
    success: false,
    error: null,
    name: null,
    points: [],
    totalPoints: 0
  };

  try {
    // 提取文档名称
    const docName = extractSingleTag(kmlContent, "name");
    if (docName) {
      // 清理 CDATA
      result.name = docName.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
    }

    // 分别收集 Point 和 LineString 的坐标
    const pointCoords: KmlTrackPoint[] = [];
    const lineCoords: KmlTrackPoint[] = [];

    // 提取所有 Placemark
    const placemarks = extractTagContent(kmlContent, "Placemark");
    
    for (const placemark of placemarks) {
      // 提取时间戳
      const timestamp = extractSingleTag(placemark, "when");
      
      // 提取描述（用于解析速度和航向）
      const description = extractSingleTag(placemark, "description") || "";
      const { speed, heading } = parseDescription(description);
      
      // 提取 Point 坐标
      const pointContent = extractSingleTag(placemark, "Point");
      if (pointContent) {
        const coordStr = extractSingleTag(pointContent, "coordinates");
        if (coordStr) {
          const points = parseCoordinates(coordStr);
          for (const point of points) {
            pointCoords.push({
              ...point,
              timestamp: timestamp?.trim(),
              speed,
              heading
            });
          }
        }
      }
      
      // 提取 LineString 坐标
      const lineStrings = extractTagContent(placemark, "LineString");
      for (const lineString of lineStrings) {
        const coordStr = extractSingleTag(lineString, "coordinates");
        if (coordStr) {
          const points = parseCoordinates(coordStr);
          lineCoords.push(...points);
        }
      }
      
      // 提取 MultiGeometry 中的 LineString
      const multiGeom = extractSingleTag(placemark, "MultiGeometry");
      if (multiGeom) {
        const innerLineStrings = extractTagContent(multiGeom, "LineString");
        for (const lineString of innerLineStrings) {
          const coordStr = extractSingleTag(lineString, "coordinates");
          if (coordStr) {
            const points = parseCoordinates(coordStr);
            lineCoords.push(...points);
          }
        }
      }
    }

    // 优先使用 Point 数据（通常更完整，有时间戳和元数据）
    // 如果 Point 数据足够（>10个点），使用 Point 数据
    // 否则使用 LineString 数据
    if (pointCoords.length >= 10) {
      result.points = pointCoords;
    } else if (lineCoords.length > 0) {
      result.points = lineCoords;
    } else {
      result.points = pointCoords;
    }

    // 去重（相邻点如果坐标完全相同则去除）
    const dedupedPoints: KmlTrackPoint[] = [];
    for (let i = 0; i < result.points.length; i++) {
      const current = result.points[i];
      const prev = dedupedPoints[dedupedPoints.length - 1];
      
      if (!prev || prev.lat !== current.lat || prev.lon !== current.lon) {
        dedupedPoints.push(current);
      }
    }
    
    // 过滤回环
    result.points = filterTrackLoop(dedupedPoints);
    result.totalPoints = result.points.length;

    if (result.points.length === 0) {
      result.error = "KML 文件中未找到有效的坐标点";
      return result;
    }

    result.success = true;
    return result;
  } catch (err: any) {
    result.error = err?.message || "解析 KML 文件失败";
    return result;
  }
}

/**
 * 对航迹点进行采样，减少点数
 * @param points 原始点序列
 * @param minDistanceKm 最小距离（公里），小于此距离的点会被跳过
 * @returns 采样后的点序列
 */
export function sampleTrackPoints(points: KmlTrackPoint[], minDistanceKm: number = 5): KmlTrackPoint[] {
  if (points.length <= 2) return points;
  
  const sampled: KmlTrackPoint[] = [points[0]]; // 始终保留第一个点
  
  for (let i = 1; i < points.length - 1; i++) {
    const lastSampled = sampled[sampled.length - 1];
    const current = points[i];
    
    const dist = haversineDistance(lastSampled.lat, lastSampled.lon, current.lat, current.lon);
    
    if (dist >= minDistanceKm) {
      sampled.push(current);
    }
  }
  
  // 始终保留最后一个点
  sampled.push(points[points.length - 1]);
  
  return sampled;
}
