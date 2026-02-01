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
}
