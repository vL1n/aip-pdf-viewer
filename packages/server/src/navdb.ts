/**
 * 导航数据库 (nd.db3) 查询封装
 * 只读访问，用于航路解析和航点坐标查询
 */
import type Database from "better-sqlite3";

/** 航点类型 */
export type NavPointType = "airport" | "waypoint" | "navaid";

/** 航点数据 */
export interface NavPoint {
  ident: string;
  name: string | null;
  lat: number;
  lon: number;
  type: NavPointType;
}

/** 航路信息 */
export interface Airway {
  id: number;
  ident: string;
}

/** 航路段 */
export interface AirwayLeg {
  airwayId: number;
  waypoint1Id: number;
  waypoint2Id: number;
  isStart: boolean;
  isEnd: boolean;
}

/** 带数据库 ID 的航点 */
export interface NavPointWithId extends NavPoint {
  id: number;
}

/** 航路图边 */
export interface AirwayGraphEdge {
  airwayId: number;
  airwayIdent: string;
  from: NavPointWithId;
  to: NavPointWithId;
}

/** 半径搜索到的高空航路点 */
export interface HighAirwayWaypoint extends NavPointWithId {
  distanceNm: number;
  airways: string[];
  levels: string[];
}

/** 导航数据库机场摘要 */
export interface NavAirport {
  icao: string;
  name: string | null;
  lat: number;
  lon: number;
}


/**
 * 导航数据库查询类
 */
export class NavDatabase {
  constructor(private db: Database.Database) {}

  /** 通过 ICAO 代码查询机场 */
  findAirport(icao: string): NavPoint | null {
    const row = this.db
      .prepare(`SELECT ICAO, Name, Latitude, Longtitude FROM Airports WHERE ICAO = ? COLLATE NOCASE`)
      .get(icao.toUpperCase()) as { ICAO: string; Name: string; Latitude: number; Longtitude: number } | undefined;

    if (!row) return null;
    return {
      ident: row.ICAO,
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude,
      type: "airport"
    };
  }

  /** 查询 nd.db3 中的全部机场 */
  listAirports(): NavAirport[] {
    const rows = this.db
      .prepare(
        `
          SELECT ICAO, Name, Latitude, Longtitude
          FROM Airports
          WHERE ICAO IS NOT NULL AND TRIM(ICAO) <> ''
          ORDER BY ICAO
        `
      )
      .all() as Array<{ ICAO: string; Name: string | null; Latitude: number; Longtitude: number }>;

    return rows.map((row) => ({
      icao: String(row.ICAO).toUpperCase(),
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude
    }));
  }

  /** 通过标识符查询航点 (Waypoint)，返回所有匹配的航点 */
  findWaypointsAll(ident: string): NavPoint[] {
    const rows = this.db
      .prepare(`SELECT Ident, Name, Latitude, Longtitude FROM Waypoints WHERE Ident = ? COLLATE NOCASE`)
      .all(ident.toUpperCase()) as Array<{ Ident: string; Name: string; Latitude: number; Longtitude: number }>;

    return rows.map((row) => ({
      ident: row.Ident,
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude,
      type: "waypoint" as const
    }));
  }

  /** 通过标识符查询航点 (Waypoint)，返回第一个匹配 */
  findWaypoint(ident: string): NavPoint | null {
    const all = this.findWaypointsAll(ident);
    return all.length > 0 ? all[0] : null;
  }

  /**
   * 通过标识符查询航点，根据参考点选择最近的航点
   * @param ident 航点标识符
   * @param refLat 参考纬度
   * @param refLon 参考经度
   */
  findWaypointNear(ident: string, refLat: number, refLon: number): NavPoint | null {
    const all = this.findWaypointsAll(ident);
    if (all.length === 0) return null;
    if (all.length === 1) return all[0];

    // 选择距离参考点最近的航点
    let best = all[0];
    let bestDist = this.haversineDistance(refLat, refLon, best.lat, best.lon);

    for (let i = 1; i < all.length; i++) {
      const dist = this.haversineDistance(refLat, refLon, all[i].lat, all[i].lon);
      if (dist < bestDist) {
        bestDist = dist;
        best = all[i];
      }
    }

    return best;
  }

  /** 计算两点间的 Haversine 距离（单位：千米） */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // 地球半径（千米）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /** 通过标识符查询导航台 (VOR/NDB) */
  findNavaid(ident: string): NavPoint | null {
    const row = this.db
      .prepare(`SELECT Ident, Name, Latitude, Longtitude, Type FROM Navaids WHERE Ident = ? COLLATE NOCASE`)
      .get(ident.toUpperCase()) as { Ident: string; Name: string; Latitude: number; Longtitude: number; Type: string } | undefined;

    if (!row) return null;
    return {
      ident: row.Ident,
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude,
      type: "navaid"
    };
  }

  /**
   * 查询任意导航点（依次尝试：机场 -> 航点 -> 导航台）
   */
  findNavPoint(ident: string): NavPoint | null {
    // 4 字母代码优先检查机场
    if (ident.length === 4) {
      const airport = this.findAirport(ident);
      if (airport) return airport;
    }
    // 5 字母代码通常是航点
    const waypoint = this.findWaypoint(ident);
    if (waypoint) return waypoint;
    // 2-3 字母代码通常是 VOR/NDB
    const navaid = this.findNavaid(ident);
    if (navaid) return navaid;
    // 最后再试机场（以防非 4 字母）
    const airport = this.findAirport(ident);
    if (airport) return airport;

    return null;
  }

  /**
   * 查询任意导航点，根据参考点选择最近的
   * @param ident 标识符
   * @param refLat 参考纬度
   * @param refLon 参考经度
   */
  findNavPointNear(ident: string, refLat: number, refLon: number): NavPoint | null {
    // 4 字母代码优先检查机场
    if (ident.length === 4) {
      const airport = this.findAirport(ident);
      if (airport) return airport;
    }
    // 5 字母代码通常是航点
    const waypoint = this.findWaypointNear(ident, refLat, refLon);
    if (waypoint) return waypoint;
    // 2-3 字母代码通常是 VOR/NDB
    const navaid = this.findNavaid(ident);
    if (navaid) return navaid;
    // 最后再试机场（以防非 4 字母）
    const airport = this.findAirport(ident);
    if (airport) return airport;

    return null;
  }

  /** 查询航路 */
  findAirway(ident: string): Airway | null {
    const row = this.db
      .prepare(`SELECT ID, Ident FROM Airways WHERE Ident = ? COLLATE NOCASE`)
      .get(ident.toUpperCase()) as { ID: number; Ident: string } | undefined;

    if (!row) return null;
    return { id: row.ID, ident: row.Ident };
  }

  /** 获取航路的所有航段 */
  getAirwayLegs(airwayId: number): AirwayLeg[] {
    const rows = this.db
      .prepare(
        `SELECT AirwayID, Waypoint1ID, Waypoint2ID, IsStart, IsEnd 
         FROM AirwayLegs 
         WHERE AirwayID = ? 
         ORDER BY ID`
      )
      .all(airwayId) as Array<{
      AirwayID: number;
      Waypoint1ID: number;
      Waypoint2ID: number;
      IsStart: number;
      IsEnd: number;
    }>;

    return rows.map((r) => ({
      airwayId: r.AirwayID,
      waypoint1Id: r.Waypoint1ID,
      waypoint2Id: r.Waypoint2ID,
      isStart: r.IsStart === 1,
      isEnd: r.IsEnd === 1
    }));
  }

  /** 通过 ID 获取航点信息 */
  getWaypointById(id: number): NavPoint | null {
    const row = this.db
      .prepare(`SELECT Ident, Name, Latitude, Longtitude FROM Waypoints WHERE ID = ?`)
      .get(id) as { Ident: string; Name: string; Latitude: number; Longtitude: number } | undefined;

    if (!row) return null;
    return {
      ident: row.Ident,
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude,
      type: "waypoint"
    };
  }

  /** 通过 ID 获取航点信息，并保留数据库 ID */
  getWaypointCandidateById(id: number): NavPointWithId | null {
    const row = this.db
      .prepare(`SELECT ID, Ident, Name, Latitude, Longtitude FROM Waypoints WHERE ID = ?`)
      .get(id) as { ID: number; Ident: string; Name: string; Latitude: number; Longtitude: number } | undefined;

    if (!row) return null;
    return {
      id: row.ID,
      ident: row.Ident,
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude,
      type: "waypoint"
    };
  }

  /** 通过标识符查询航点并保留数据库 ID */
  findWaypointCandidates(ident: string): NavPointWithId[] {
    const rows = this.db
      .prepare(`SELECT ID, Ident, Name, Latitude, Longtitude FROM Waypoints WHERE Ident = ? COLLATE NOCASE`)
      .all(ident.toUpperCase()) as Array<{ ID: number; Ident: string; Name: string; Latitude: number; Longtitude: number }>;

    return rows.map((row) => ({
      id: row.ID,
      ident: row.Ident,
      name: row.Name,
      lat: row.Latitude,
      lon: row.Longtitude,
      type: "waypoint" as const
    }));
  }

  /** 获取所有参与航路图的航点 ID，用于判断候选点是否可直接接入航路网 */
  getAirwayWaypointIds(): Set<number> {
    const rows = this.db
      .prepare(
        `
          SELECT Waypoint1ID AS ID FROM AirwayLegs WHERE Waypoint1ID IS NOT NULL
          UNION
          SELECT Waypoint2ID AS ID FROM AirwayLegs WHERE Waypoint2ID IS NOT NULL
        `
      )
      .all() as Array<{ ID: number }>;

    return new Set(rows.map((row) => row.ID));
  }

  /** 读取全量航路图边，用于最短航路计算 */
  getAirwayGraphEdges(): AirwayGraphEdge[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            l.AirwayID,
            a.Ident AS AirwayIdent,
            w1.ID AS FromID,
            w1.Ident AS FromIdent,
            w1.Name AS FromName,
            w1.Latitude AS FromLatitude,
            w1.Longtitude AS FromLongtitude,
            w2.ID AS ToID,
            w2.Ident AS ToIdent,
            w2.Name AS ToName,
            w2.Latitude AS ToLatitude,
            w2.Longtitude AS ToLongtitude
          FROM AirwayLegs l
          JOIN Airways a ON a.ID = l.AirwayID
          JOIN Waypoints w1 ON w1.ID = l.Waypoint1ID
          JOIN Waypoints w2 ON w2.ID = l.Waypoint2ID
        `
      )
      .all() as Array<{
      AirwayID: number;
      AirwayIdent: string;
      FromID: number;
      FromIdent: string;
      FromName: string | null;
      FromLatitude: number;
      FromLongtitude: number;
      ToID: number;
      ToIdent: string;
      ToName: string | null;
      ToLatitude: number;
      ToLongtitude: number;
    }>;

    return rows.map((row) => ({
      airwayId: row.AirwayID,
      airwayIdent: row.AirwayIdent,
      from: {
        id: row.FromID,
        ident: row.FromIdent,
        name: row.FromName,
        lat: row.FromLatitude,
        lon: row.FromLongtitude,
        type: "waypoint" as const
      },
      to: {
        id: row.ToID,
        ident: row.ToIdent,
        name: row.ToName,
        lat: row.ToLatitude,
        lon: row.ToLongtitude,
        type: "waypoint" as const
      }
    }));
  }

  /** 查询指定范围内的高空航路点。Level=H 或 B 都视为高空可用。 */
  findHighAirwayWaypointsNear(lat: number, lon: number, radiusNm: number, limit: number = 200): HighAirwayWaypoint[] {
    const radiusKm = radiusNm * 1.852;
    const degRange = radiusKm / 111 * 1.25;
    const latMin = lat - degRange;
    const latMax = lat + degRange;
    const lonDegRange = degRange / Math.max(Math.cos(lat * Math.PI / 180), 0.2);
    const lonMin = lon - lonDegRange;
    const lonMax = lon + lonDegRange;

    const rows = this.db
      .prepare(
        `
          WITH high_legs AS (
            SELECT AirwayID, Level, Waypoint1ID AS WaypointID
            FROM AirwayLegs
            WHERE Level IN ('H', 'B') AND Waypoint1ID IS NOT NULL
            UNION ALL
            SELECT AirwayID, Level, Waypoint2ID AS WaypointID
            FROM AirwayLegs
            WHERE Level IN ('H', 'B') AND Waypoint2ID IS NOT NULL
          )
          SELECT
            w.ID,
            w.Ident,
            w.Name,
            w.Latitude,
            w.Longtitude,
            a.Ident AS AirwayIdent,
            h.Level
          FROM high_legs h
          JOIN Airways a ON a.ID = h.AirwayID
          JOIN Waypoints w ON w.ID = h.WaypointID
          WHERE w.Latitude BETWEEN ? AND ?
            AND w.Longtitude BETWEEN ? AND ?
        `
      )
      .all(latMin, latMax, lonMin, lonMax) as Array<{
      ID: number;
      Ident: string;
      Name: string | null;
      Latitude: number;
      Longtitude: number;
      AirwayIdent: string;
      Level: string;
    }>;

    const byId = new Map<number, HighAirwayWaypoint>();
    for (const row of rows) {
      const distanceNm = this.haversineDistance(lat, lon, row.Latitude, row.Longtitude) / 1.852;
      if (distanceNm > radiusNm) continue;

      const existing = byId.get(row.ID);
      if (existing) {
        if (!existing.airways.includes(row.AirwayIdent)) existing.airways.push(row.AirwayIdent);
        if (!existing.levels.includes(row.Level)) existing.levels.push(row.Level);
        continue;
      }

      byId.set(row.ID, {
        id: row.ID,
        ident: row.Ident,
        name: row.Name,
        lat: row.Latitude,
        lon: row.Longtitude,
        type: "waypoint",
        distanceNm,
        airways: [row.AirwayIdent],
        levels: [row.Level]
      });
    }

    return [...byId.values()]
      .sort((a, b) => a.distanceNm - b.distanceNm || a.ident.localeCompare(b.ident, "en"))
      .slice(0, limit)
      .map((point) => ({
        ...point,
        airways: point.airways.sort((a, b) => a.localeCompare(b, "en")),
        levels: point.levels.sort((a, b) => a.localeCompare(b, "en"))
      }));
  }

  /**
   * 查找距离指定坐标最近的航点/导航台
   * @param lat 纬度
   * @param lon 经度
   * @param maxDistanceKm 最大距离（公里），超过此距离返回 null
   * @returns 最近的航点，如果没有找到则返回 null
   */
  findNearestNavPoint(lat: number, lon: number, maxDistanceKm: number = 50): NavPoint | null {
    // 粗略的经纬度范围过滤（1度约111公里）
    const degRange = maxDistanceKm / 111 * 1.5; // 加50%余量
    const latMin = lat - degRange;
    const latMax = lat + degRange;
    const lonMin = lon - degRange;
    const lonMax = lon + degRange;

    // 查询航点
    const waypoints = this.db
      .prepare(`
        SELECT Ident, Name, Latitude, Longtitude FROM Waypoints 
        WHERE Latitude BETWEEN ? AND ? AND Longtitude BETWEEN ? AND ?
      `)
      .all(latMin, latMax, lonMin, lonMax) as Array<{ Ident: string; Name: string; Latitude: number; Longtitude: number }>;

    // 查询导航台
    const navaids = this.db
      .prepare(`
        SELECT Ident, Name, Latitude, Longtitude FROM Navaids 
        WHERE Latitude BETWEEN ? AND ? AND Longtitude BETWEEN ? AND ?
      `)
      .all(latMin, latMax, lonMin, lonMax) as Array<{ Ident: string; Name: string; Latitude: number; Longtitude: number }>;

    // 合并候选点
    const candidates: Array<{ point: NavPoint; distance: number }> = [];

    for (const row of waypoints) {
      const dist = this.haversineDistance(lat, lon, row.Latitude, row.Longtitude);
      if (dist <= maxDistanceKm) {
        candidates.push({
          point: { ident: row.Ident, name: row.Name, lat: row.Latitude, lon: row.Longtitude, type: "waypoint" },
          distance: dist
        });
      }
    }

    for (const row of navaids) {
      const dist = this.haversineDistance(lat, lon, row.Latitude, row.Longtitude);
      if (dist <= maxDistanceKm) {
        candidates.push({
          point: { ident: row.Ident, name: row.Name, lat: row.Latitude, lon: row.Longtitude, type: "navaid" },
          distance: dist
        });
      }
    }

    if (candidates.length === 0) return null;

    // 返回最近的
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].point;
  }

  /**
   * 查找连接两个航点的航路（直接相邻）
   * @param fromIdent 起始航点标识符
   * @param toIdent 结束航点标识符
   * @returns 航路代码，如果没有找到则返回 null
   */
  findConnectingAirway(fromIdent: string, toIdent: string): string | null {
    // 首先找到两个航点的 ID
    const fromWpt = this.db
      .prepare(`SELECT ID FROM Waypoints WHERE Ident = ? COLLATE NOCASE`)
      .all(fromIdent.toUpperCase()) as Array<{ ID: number }>;
    
    const toWpt = this.db
      .prepare(`SELECT ID FROM Waypoints WHERE Ident = ? COLLATE NOCASE`)
      .all(toIdent.toUpperCase()) as Array<{ ID: number }>;

    if (fromWpt.length === 0 || toWpt.length === 0) return null;

    // 查找包含这两个航点的航路段
    const fromIds = fromWpt.map(w => w.ID);
    const toIds = toWpt.map(w => w.ID);

    // 构建 IN 子句
    const fromPlaceholders = fromIds.map(() => "?").join(", ");
    const toPlaceholders = toIds.map(() => "?").join(", ");

    // 查找正向连接 (from -> to)
    const forwardQuery = `
      SELECT DISTINCT a.Ident FROM AirwayLegs l
      JOIN Airways a ON a.ID = l.AirwayID
      WHERE l.Waypoint1ID IN (${fromPlaceholders}) AND l.Waypoint2ID IN (${toPlaceholders})
    `;
    
    const forwardResult = this.db.prepare(forwardQuery).get(...fromIds, ...toIds) as { Ident: string } | undefined;
    if (forwardResult) return forwardResult.Ident;

    // 查找反向连接 (to -> from)
    const reverseQuery = `
      SELECT DISTINCT a.Ident FROM AirwayLegs l
      JOIN Airways a ON a.ID = l.AirwayID
      WHERE l.Waypoint1ID IN (${toPlaceholders}) AND l.Waypoint2ID IN (${fromPlaceholders})
    `;
    
    const reverseResult = this.db.prepare(reverseQuery).get(...toIds, ...fromIds) as { Ident: string } | undefined;
    if (reverseResult) return reverseResult.Ident;

    return null;
  }

  /**
   * 查找包含两个航点的共同航路（不一定直接相邻）
   * 这个方法更宽松，只要两个航点都在同一条航路上就返回该航路
   * @param ident1 航点1标识符
   * @param ident2 航点2标识符
   * @returns 航路代码，如果没有找到则返回 null
   */
  findCommonAirway(ident1: string, ident2: string): string | null {
    // 首先尝试直接相邻的航路
    const direct = this.findConnectingAirway(ident1, ident2);
    if (direct) return direct;

    // 查找两个航点各自所在的航路
    const query = `
      SELECT DISTINCT a.Ident
      FROM Airways a
      WHERE a.ID IN (
        SELECT l.AirwayID FROM AirwayLegs l
        JOIN Waypoints w ON (w.ID = l.Waypoint1ID OR w.ID = l.Waypoint2ID)
        WHERE w.Ident = ? COLLATE NOCASE
      )
      AND a.ID IN (
        SELECT l.AirwayID FROM AirwayLegs l
        JOIN Waypoints w ON (w.ID = l.Waypoint1ID OR w.ID = l.Waypoint2ID)
        WHERE w.Ident = ? COLLATE NOCASE
      )
      LIMIT 1
    `;
    
    const result = this.db.prepare(query).get(ident1.toUpperCase(), ident2.toUpperCase()) as { Ident: string } | undefined;
    return result?.Ident ?? null;
  }

  /**
   * 获取航路上两个航点之间的所有中间航点
   * @param airwayIdent 航路标识符 (如 G471)
   * @param fromIdent 起始航点标识符 (如 PIMOL)
   * @param toIdent 结束航点标识符 (如 VMB)
   * @returns 按顺序排列的航点数组（包含起止点），如果找不到则返回 null
   */
  getAirwaySegment(airwayIdent: string, fromIdent: string, toIdent: string): NavPoint[] | null {
    const airway = this.findAirway(airwayIdent);
    if (!airway) return null;

    const legs = this.getAirwayLegs(airway.id);
    if (legs.length === 0) return null;

    // 构建航路图（邻接表）
    const graph = new Map<number, number[]>();
    const allWptIds = new Set<number>();

    for (const leg of legs) {
      allWptIds.add(leg.waypoint1Id);
      allWptIds.add(leg.waypoint2Id);

      if (!graph.has(leg.waypoint1Id)) graph.set(leg.waypoint1Id, []);
      if (!graph.has(leg.waypoint2Id)) graph.set(leg.waypoint2Id, []);

      graph.get(leg.waypoint1Id)!.push(leg.waypoint2Id);
      graph.get(leg.waypoint2Id)!.push(leg.waypoint1Id);
    }

    // 查找起止点 ID
    let fromId: number | null = null;
    let toId: number | null = null;

    for (const wptId of allWptIds) {
      const wpt = this.getWaypointById(wptId);
      if (!wpt) continue;
      if (wpt.ident.toUpperCase() === fromIdent.toUpperCase()) fromId = wptId;
      if (wpt.ident.toUpperCase() === toIdent.toUpperCase()) toId = wptId;
    }

    if (fromId === null || toId === null) return null;

    // BFS 查找路径
    const queue: number[][] = [[fromId]];
    const visited = new Set<number>([fromId]);

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1];

      if (current === toId) {
        // 找到路径，转换为航点信息
        return path.map((id) => this.getWaypointById(id)).filter((p): p is NavPoint => p !== null);
      }

      const neighbors = graph.get(current) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      }
    }

    return null;
  }

  /**
   * 获取航路的所有航点（按顺序）
   * @param airwayIdent 航路标识符
   * @returns 航点数组，如果航路不存在则返回 null
   */
  getAirwayFullPoints(airwayIdent: string): NavPoint[] | null {
    const airway = this.findAirway(airwayIdent);
    if (!airway) return null;

    const legs = this.getAirwayLegs(airway.id);
    if (legs.length === 0) return null;

    // 构建航路图（邻接表）和度数统计
    const graph = new Map<number, Set<number>>();
    const degree = new Map<number, number>();

    for (const leg of legs) {
      if (!graph.has(leg.waypoint1Id)) graph.set(leg.waypoint1Id, new Set());
      if (!graph.has(leg.waypoint2Id)) graph.set(leg.waypoint2Id, new Set());

      graph.get(leg.waypoint1Id)!.add(leg.waypoint2Id);
      graph.get(leg.waypoint2Id)!.add(leg.waypoint1Id);

      degree.set(leg.waypoint1Id, (degree.get(leg.waypoint1Id) || 0) + 1);
      degree.set(leg.waypoint2Id, (degree.get(leg.waypoint2Id) || 0) + 1);
    }

    // 找到端点（度数为1的节点）
    const endpoints: number[] = [];
    for (const [id, deg] of degree) {
      if (deg === 1) endpoints.push(id);
    }

    // 如果没有端点（环形航路），从任意点开始
    const startId = endpoints.length > 0 ? endpoints[0] : legs[0].waypoint1Id;

    // 从端点开始遍历整条航路
    const result: NavPoint[] = [];
    const visited = new Set<number>();
    let current = startId;

    while (current !== undefined) {
      visited.add(current);
      const wpt = this.getWaypointById(current);
      if (wpt) result.push(wpt);

      const neighbors = graph.get(current);
      if (!neighbors) break;

      let next: number | undefined;
      for (const n of neighbors) {
        if (!visited.has(n)) {
          next = n;
          break;
        }
      }
      current = next!;
    }

    return result.length > 0 ? result : null;
  }

  /**
   * 查找两条航路的交点（共同航点）
   * @param airway1 航路1标识符
   * @param airway2 航路2标识符
   * @returns 交点航点数组（可能有多个交点）
   */
  findAirwayIntersection(airway1: string, airway2: string): NavPoint[] {
    const aw1 = this.findAirway(airway1);
    const aw2 = this.findAirway(airway2);

    if (!aw1 || !aw2) return [];

    // 查找两条航路共同的航点
    const query = `
      SELECT DISTINCT w.ID, w.Ident, w.Name, w.Latitude, w.Longtitude
      FROM Waypoints w
      WHERE w.ID IN (
        SELECT Waypoint1ID FROM AirwayLegs WHERE AirwayID = ?
        UNION
        SELECT Waypoint2ID FROM AirwayLegs WHERE AirwayID = ?
      )
      AND w.ID IN (
        SELECT Waypoint1ID FROM AirwayLegs WHERE AirwayID = ?
        UNION
        SELECT Waypoint2ID FROM AirwayLegs WHERE AirwayID = ?
      )
    `;

    const rows = this.db.prepare(query).all(aw1.id, aw1.id, aw2.id, aw2.id) as Array<{
      ID: number;
      Ident: string;
      Name: string;
      Latitude: number;
      Longtitude: number;
    }>;

    return rows.map(r => ({
      ident: r.Ident,
      name: r.Name,
      lat: r.Latitude,
      lon: r.Longtitude,
      type: "waypoint" as const
    }));
  }

}
