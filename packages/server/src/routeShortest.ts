import type { NavDatabase, NavPoint, NavPointWithId } from "./navdb.js";
import type { ParsedRoutePoint } from "./routeParser.js";

type GraphEdge = {
  to: number;
  airwayIdent: string;
  distanceKm: number;
};

type AirwayGraph = {
  nodes: Map<number, NavPointWithId>;
  adjacency: Map<number, GraphEdge[]>;
  airways: Set<string>;
};

type RouteCandidate = {
  nodeId: number;
  point: NavPointWithId;
  connectorDistanceKm: number;
};

type ResolvedTarget = {
  token: string;
  point: NavPoint;
  candidates: RouteCandidate[];
};

export type ShortestRouteOptions = {
  maxConnectorDistanceKm?: number;
  connectorCandidateLimit?: number;
};

export type ViaRouteItem = {
  type?: "waypoint";
  ident: string;
  waypointId?: number;
  name?: string | null;
  lat?: number;
  lon?: number;
};

export type ShortestRouteLeg = {
  from: string;
  to: string;
  distanceKm: number;
  airwayUsed: boolean;
  fallbackUsed: boolean;
  airways: string[];
  points: ParsedRoutePoint[];
  reason: string | null;
};

export type ShortestRouteResult = {
  success: boolean;
  error: string | null;
  routeString: string;
  departure: NavPoint | null;
  arrival: NavPoint | null;
  points: ParsedRoutePoint[];
  legs: ShortestRouteLeg[];
  distanceKm: number;
  fallbackUsed: boolean;
  unknownElements: string[];
};

const DEFAULT_MAX_CONNECTOR_DISTANCE_KM = 260;
const DEFAULT_CONNECTOR_CANDIDATE_LIMIT = 8;

const graphCache = new WeakMap<NavDatabase, AirwayGraph>();

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getAirwayGraph(navDb: NavDatabase): AirwayGraph {
  const cached = graphCache.get(navDb);
  if (cached) return cached;

  const nodes = new Map<number, NavPointWithId>();
  const adjacency = new Map<number, GraphEdge[]>();
  const airways = new Set<string>();

  for (const edge of navDb.getAirwayGraphEdges()) {
    const airwayIdent = edge.airwayIdent.toUpperCase();
    nodes.set(edge.from.id, edge.from);
    nodes.set(edge.to.id, edge.to);
    airways.add(airwayIdent);

    const distanceKm = haversineDistance(edge.from.lat, edge.from.lon, edge.to.lat, edge.to.lon);
    const forward = adjacency.get(edge.from.id) ?? [];
    forward.push({ to: edge.to.id, airwayIdent, distanceKm });
    adjacency.set(edge.from.id, forward);

    const backward = adjacency.get(edge.to.id) ?? [];
    backward.push({ to: edge.from.id, airwayIdent, distanceKm });
    adjacency.set(edge.to.id, backward);
  }

  const graph = { nodes, adjacency, airways };
  graphCache.set(navDb, graph);
  return graph;
}

class MinHeap<T> {
  private items: Array<{ priority: number; value: T }> = [];

  push(value: T, priority: number) {
    this.items.push({ value, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): { priority: number; value: T } | null {
    if (this.items.length === 0) return null;
    const first = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(index: number) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.items[parent]!.priority <= this.items[current]!.priority) break;
      const tmp = this.items[parent]!;
      this.items[parent] = this.items[current]!;
      this.items[current] = tmp;
      current = parent;
    }
  }

  private bubbleDown(index: number) {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = current * 2 + 2;
      let smallest = current;

      if (left < this.items.length && this.items[left]!.priority < this.items[smallest]!.priority) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right]!.priority < this.items[smallest]!.priority) {
        smallest = right;
      }
      if (smallest === current) break;

      const tmp = this.items[current]!;
      this.items[current] = this.items[smallest]!;
      this.items[smallest] = tmp;
      current = smallest;
    }
  }
}

function toParsedPoint(point: NavPoint, input: { viaAirway?: string | null; isExplicit?: boolean; remark?: string | null }): ParsedRoutePoint {
  return {
    ...point,
    viaAirway: input.viaAirway ?? null,
    isExplicit: input.isExplicit ?? false,
    isAirport: point.type === "airport",
    remark: input.remark ?? null
  };
}

function pushUnique(points: ParsedRoutePoint[], point: ParsedRoutePoint) {
  const last = points[points.length - 1];
  if (last && last.ident === point.ident && Math.abs(last.lat - point.lat) < 1e-8 && Math.abs(last.lon - point.lon) < 1e-8) {
    return;
  }
  points.push(point);
}

function buildConnectorCandidates(graph: AirwayGraph, point: NavPoint, options: Required<ShortestRouteOptions>) {
  return [...graph.nodes.values()]
    .map((node) => ({
      nodeId: node.id,
      point: node,
      connectorDistanceKm: haversineDistance(point.lat, point.lon, node.lat, node.lon)
    }))
    .filter((candidate) => candidate.connectorDistanceKm <= options.maxConnectorDistanceKm)
    .sort((a, b) => a.connectorDistanceKm - b.connectorDistanceKm)
    .slice(0, options.connectorCandidateLimit);
}

function resolveTarget(
  navDb: NavDatabase,
  graph: AirwayGraph,
  token: string,
  options: Required<ShortestRouteOptions>
): ResolvedTarget | null {
  const normalized = token.trim().toUpperCase();
  if (!normalized) return null;

  if (normalized.length === 4) {
    const airport = navDb.findAirport(normalized);
    if (airport) {
      return { token: normalized, point: airport, candidates: buildConnectorCandidates(graph, airport, options) };
    }
  }

  const graphWaypointCandidates = navDb
    .findWaypointCandidates(normalized)
    .filter((point) => graph.nodes.has(point.id))
    .map((point) => ({
      nodeId: point.id,
      point,
      connectorDistanceKm: 0
    }));

  if (graphWaypointCandidates.length > 0) {
    return {
      token: normalized,
      point: graphWaypointCandidates[0]!.point,
      candidates: graphWaypointCandidates
    };
  }

  const point = navDb.findNavPoint(normalized);
  if (!point) return null;

  return { token: normalized, point, candidates: buildConnectorCandidates(graph, point, options) };
}

function resolveWaypointTarget(
  navDb: NavDatabase,
  graph: AirwayGraph,
  item: ViaRouteItem,
  options: Required<ShortestRouteOptions>
): ResolvedTarget | null {
  const normalized = item.ident.trim().toUpperCase();
  if (!normalized) return null;

  if (Number.isInteger(item.waypointId) && item.waypointId && item.waypointId > 0) {
    const selected = navDb.getWaypointCandidateById(item.waypointId);
    if (!selected || selected.ident.toUpperCase() !== normalized) return null;

    if (graph.nodes.has(selected.id)) {
      return {
        token: normalized,
        point: selected,
        candidates: [{
          nodeId: selected.id,
          point: selected,
          connectorDistanceKm: 0
        }]
      };
    }

    return {
      token: normalized,
      point: selected,
      candidates: buildConnectorCandidates(graph, selected, options)
    };
  }

  return resolveTarget(navDb, graph, normalized, options);
}

function stateKey(nodeId: number, requiredMask: number) {
  return `${nodeId}:${requiredMask}`;
}

function dijkstra(
  graph: AirwayGraph,
  startCandidates: RouteCandidate[],
  endCandidates: RouteCandidate[],
  requiredAirways: string[] = []
) {
  if (startCandidates.length === 0 || endCandidates.length === 0) return null;

  const normalizedRequiredAirways = [...new Set(requiredAirways.map((airway) => airway.trim().toUpperCase()).filter(Boolean))];
  if (normalizedRequiredAirways.length > 24) return null;
  const requiredAirwayIndexes = new Map(normalizedRequiredAirways.map((airway, idx) => [airway, idx]));
  const allRequiredMask = (1 << normalizedRequiredAirways.length) - 1;
  const endByNode = new Map<number, RouteCandidate>();
  for (const candidate of endCandidates) {
    const existing = endByNode.get(candidate.nodeId);
    if (!existing || candidate.connectorDistanceKm < existing.connectorDistanceKm) {
      endByNode.set(candidate.nodeId, candidate);
    }
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { prevKey: string; nodeId: number; requiredMask: number; edge: GraphEdge }>();
  const heap = new MinHeap<{ nodeId: number; requiredMask: number }>();

  for (const candidate of startCandidates) {
    const key = stateKey(candidate.nodeId, 0);
    const existing = dist.get(key);
    if (existing == null || candidate.connectorDistanceKm < existing) {
      dist.set(key, candidate.connectorDistanceKm);
      heap.push({ nodeId: candidate.nodeId, requiredMask: 0 }, candidate.connectorDistanceKm);
    }
  }

  let bestEnd: RouteCandidate | null = null;
  let bestEndState: { nodeId: number; requiredMask: number } | null = null;
  let bestTotal = Number.POSITIVE_INFINITY;

  while (true) {
    const item = heap.pop();
    if (!item) break;
    const currentKey = stateKey(item.value.nodeId, item.value.requiredMask);
    const currentDist = dist.get(currentKey);
    if (currentDist == null || item.priority > currentDist) continue;

    const endCandidate = item.value.requiredMask === allRequiredMask ? endByNode.get(item.value.nodeId) : null;
    if (endCandidate) {
      const total = currentDist + endCandidate.connectorDistanceKm;
      if (total < bestTotal) {
        bestTotal = total;
        bestEnd = endCandidate;
        bestEndState = item.value;
      }
    }

    for (const edge of graph.adjacency.get(item.value.nodeId) ?? []) {
      const airwayIndex = requiredAirwayIndexes.get(edge.airwayIdent.toUpperCase());
      const nextRequiredMask = airwayIndex == null ? item.value.requiredMask : item.value.requiredMask | (1 << airwayIndex);
      const nextKey = stateKey(edge.to, nextRequiredMask);
      const nextDist = currentDist + edge.distanceKm;
      if (nextDist >= (dist.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      dist.set(nextKey, nextDist);
      prev.set(nextKey, { prevKey: currentKey, nodeId: item.value.nodeId, requiredMask: item.value.requiredMask, edge });
      heap.push({ nodeId: edge.to, requiredMask: nextRequiredMask }, nextDist);
    }
  }

  if (!bestEnd || !bestEndState) return null;

  const pathIds: number[] = [];
  const pathEdges: GraphEdge[] = [];
  let currentKey = stateKey(bestEndState.nodeId, bestEndState.requiredMask);
  pathIds.push(bestEndState.nodeId);
  while (prev.has(currentKey)) {
    const previous = prev.get(currentKey)!;
    pathEdges.push(previous.edge);
    pathIds.push(previous.nodeId);
    currentKey = previous.prevKey;
  }
  pathIds.reverse();
  pathEdges.reverse();

  const startCandidate =
    startCandidates
      .filter((candidate) => candidate.nodeId === pathIds[0])
      .sort((a, b) => a.connectorDistanceKm - b.connectorDistanceKm)[0] ?? startCandidates[0]!;

  return {
    distanceKm: bestTotal,
    pathIds,
    pathEdges,
    startCandidate,
    endCandidate: bestEnd
  };
}

function uniqueAirways(edges: GraphEdge[]) {
  const result: string[] = [];
  for (const edge of edges) {
    if (!result.includes(edge.airwayIdent)) result.push(edge.airwayIdent);
  }
  return result;
}

function buildLegRouteTokens(points: ParsedRoutePoint[], fallbackDirect: boolean) {
  if (points.length === 0) return [];
  if (fallbackDirect && points.length >= 2) return [points[0]!.ident, "DCT", points[points.length - 1]!.ident];

  const tokens = [points[0]!.ident];
  let currentAirway: string | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    if (point.viaAirway) {
      if (point.viaAirway !== currentAirway) {
        tokens.push(point.viaAirway);
        currentAirway = point.viaAirway;
      }
      const nextAirway = points[i + 1]?.viaAirway ?? null;
      if (nextAirway !== currentAirway || point.isExplicit || point.isAirport || i === points.length - 1) {
        tokens.push(point.ident);
      }
    } else {
      currentAirway = null;
      tokens.push(point.ident);
    }
  }
  return tokens;
}

function solveLeg(
  graph: AirwayGraph,
  from: ResolvedTarget,
  to: ResolvedTarget,
  requiredAirways: string[] = []
): {
  leg: ShortestRouteLeg;
  routeTokens: string[];
  selectedEndCandidate: RouteCandidate | null;
  failedReason: string | null;
} {
  const normalizedRequiredAirways = requiredAirways.map((airway) => airway.trim().toUpperCase()).filter(Boolean);
  const found = dijkstra(graph, from.candidates, to.candidates, normalizedRequiredAirways);
  if (!found) {
    if (normalizedRequiredAirways.length > 0) {
      return {
        selectedEndCandidate: null,
        routeTokens: [],
        failedReason: `未找到经过指定航路 ${normalizedRequiredAirways.join("、")} 的可用路径`,
        leg: {
          from: from.token,
          to: to.token,
          distanceKm: 0,
          airwayUsed: false,
          fallbackUsed: false,
          airways: [],
          points: [],
          reason: `未找到经过指定航路 ${normalizedRequiredAirways.join("、")} 的可用路径`
        }
      };
    }

    const distanceKm = haversineDistance(from.point.lat, from.point.lon, to.point.lat, to.point.lon);
    const points = [
      toParsedPoint(from.point, { isExplicit: true, remark: "起点" }),
      toParsedPoint(to.point, { isExplicit: true, remark: "直连" })
    ];
    return {
      selectedEndCandidate: null,
      routeTokens: buildLegRouteTokens(points, true),
      failedReason: null,
      leg: {
        from: from.token,
        to: to.token,
        distanceKm,
        airwayUsed: false,
        fallbackUsed: true,
        airways: [],
        points,
        reason: "未找到可用航路，已使用直连"
      }
    };
  }

  const points: ParsedRoutePoint[] = [];
  pushUnique(points, toParsedPoint(from.point, { isExplicit: true, remark: "起点" }));

  const startNode = graph.nodes.get(found.pathIds[0]!);
  if (startNode && found.startCandidate.connectorDistanceKm > 0.01) {
    pushUnique(points, toParsedPoint(startNode, { isExplicit: false, remark: "接入航路" }));
  }

  for (let i = 0; i < found.pathIds.length; i += 1) {
    const node = graph.nodes.get(found.pathIds[i]!);
    if (!node) continue;
    const incoming = i > 0 ? found.pathEdges[i - 1] : null;
    pushUnique(points, toParsedPoint(node, {
      viaAirway: incoming?.airwayIdent ?? null,
      isExplicit: node.ident.toUpperCase() === to.token || node.ident.toUpperCase() === from.token,
      remark: null
    }));
  }

  if (found.endCandidate.connectorDistanceKm > 0.01) {
    pushUnique(points, toParsedPoint(to.point, { isExplicit: true, remark: "离开航路" }));
  }

  const fallbackUsed = found.startCandidate.connectorDistanceKm > 0.01 || found.endCandidate.connectorDistanceKm > 0.01;
  const routeTokens = buildLegRouteTokens(points, false);
  const reasonParts = [
    fallbackUsed ? "端点不在航路图上，已接入最近航路点" : null,
    normalizedRequiredAirways.length > 0 ? `已经过指定航路 ${normalizedRequiredAirways.join("、")}` : null
  ].filter(Boolean);

  return {
    selectedEndCandidate: found.endCandidate,
    routeTokens,
    failedReason: null,
    leg: {
      from: from.token,
      to: to.token,
      distanceKm: found.distanceKm,
      airwayUsed: found.pathEdges.length > 0,
      fallbackUsed,
      airways: uniqueAirways(found.pathEdges),
      points,
      reason: reasonParts.length > 0 ? reasonParts.join("；") : null
    }
  };
}

function mergePoints(legs: ShortestRouteLeg[]) {
  const points: ParsedRoutePoint[] = [];
  for (const leg of legs) {
    for (const point of leg.points) pushUnique(points, point);
  }
  return points;
}

function simplifyRepeatedAirwayTokens(tokens: string[], airwaySet: Set<string>) {
  const result = [...tokens];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i <= result.length - 3; i += 1) {
      const airway = result[i]!.toUpperCase();
      const middle = result[i + 1]!.toUpperCase();
      const repeatedAirway = result[i + 2]!.toUpperCase();
      if (
        airway === repeatedAirway &&
        airwaySet.has(airway) &&
        middle !== "DCT" &&
        !airwaySet.has(middle)
      ) {
        result.splice(i + 1, 2);
        changed = true;
        break;
      }
    }
  }

  return result;
}

function mergeRouteTokens(legTokens: string[][], airwaySet: Set<string>) {
  const tokens: string[] = [];
  for (const part of legTokens) {
    for (const token of part) {
      if (tokens.length > 0 && tokens[tokens.length - 1] === token) continue;
      tokens.push(token);
    }
  }
  return simplifyRepeatedAirwayTokens(tokens, airwaySet).join(" ");
}

function normalizeViaItems(input: { via?: string[]; viaItems?: ViaRouteItem[] }): ViaRouteItem[] {
  if (Array.isArray(input.viaItems)) {
    return input.viaItems
      .map(normalizeWaypointItem)
      .filter((item): item is ViaRouteItem => !!item);
  }

  return (input.via ?? [])
    .map((ident) => ({
      type: "waypoint" as const,
      ident: String(ident ?? "").trim().toUpperCase()
    }))
    .filter((item) => item.ident);
}

function normalizeWaypointItem(item: ViaRouteItem | null | undefined): ViaRouteItem | null {
  const ident = String(item?.ident ?? "").trim().toUpperCase();
  if (!ident) return null;
  const waypointId = item?.waypointId;
  const lat = item?.lat;
  const lon = item?.lon;
  return {
    type: "waypoint",
    ident,
    waypointId: Number.isInteger(waypointId) ? waypointId : undefined,
    name: item?.name ?? null,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined
  };
}

type ResolvedViaWaypoint = {
  item: ViaRouteItem;
  target: ResolvedTarget;
};

function buildBoundaryDirectLeg(
  from: ResolvedTarget,
  to: ResolvedTarget,
  fromRemark: string,
  toRemark: string,
  reason: string
) {
  const distanceKm = haversineDistance(from.point.lat, from.point.lon, to.point.lat, to.point.lon);
  const points = [
    toParsedPoint(from.point, { isExplicit: true, remark: fromRemark }),
    toParsedPoint(to.point, { isExplicit: true, remark: toRemark })
  ];

  return {
    leg: {
      from: from.token,
      to: to.token,
      distanceKm,
      airwayUsed: false,
      fallbackUsed: true,
      airways: [],
      points,
      reason
    } satisfies ShortestRouteLeg,
    routeTokens: [from.token, "DCT", to.token]
  };
}

function sameTargetPoint(point: ParsedRoutePoint, target: ResolvedTarget) {
  return (
    point.ident.toUpperCase() === target.token.toUpperCase() &&
    Math.abs(point.lat - target.point.lat) < 1e-8 &&
    Math.abs(point.lon - target.point.lon) < 1e-8
  );
}

function markBoundaryPoints(
  points: ParsedRoutePoint[],
  departureBoundary: ResolvedTarget | null,
  arrivalBoundary: ResolvedTarget | null
) {
  return points.map((point) => {
    if (departureBoundary && sameTargetPoint(point, departureBoundary)) {
      return { ...point, isExplicit: true, remark: "离场点" };
    }
    if (arrivalBoundary && sameTargetPoint(point, arrivalBoundary)) {
      return { ...point, isExplicit: true, remark: "进场点" };
    }
    return point;
  });
}

function chooseWaypointOrder(
  graph: AirwayGraph,
  departure: ResolvedTarget,
  waypoints: ResolvedViaWaypoint[],
  arrival: ResolvedTarget
) {
  const count = waypoints.length;
  if (count <= 1) return waypoints;

  const targets = [departure, ...waypoints.map((item) => item.target), arrival];
  const distanceCache = new Map<string, number>();
  const getDistance = (fromIndex: number, toIndex: number) => {
    const key = `${fromIndex}-${toIndex}`;
    const cached = distanceCache.get(key);
    if (cached != null) return cached;

    const solved = solveLeg(graph, targets[fromIndex]!, targets[toIndex]!);
    distanceCache.set(key, solved.leg.distanceKm);
    return solved.leg.distanceKm;
  };

  if (count > 8) {
    const remaining = new Set(waypoints.map((_, idx) => idx));
    const order: number[] = [];
    let currentTargetIndex = 0;

    while (remaining.size > 0) {
      let bestIndex: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const idx of remaining) {
        const distance = getDistance(currentTargetIndex, idx + 1);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = idx;
        }
      }
      if (bestIndex == null) break;
      order.push(bestIndex);
      remaining.delete(bestIndex);
      currentTargetIndex = bestIndex + 1;
    }

    return order.map((idx) => waypoints[idx]!);
  }

  const totalMasks = 1 << count;
  const dp = Array.from({ length: totalMasks }, () =>
    Array.from({ length: count }, () => ({ distance: Number.POSITIVE_INFINITY, prev: -1 }))
  );

  for (let idx = 0; idx < count; idx += 1) {
    dp[1 << idx]![idx] = { distance: getDistance(0, idx + 1), prev: -1 };
  }

  for (let mask = 1; mask < totalMasks; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      const current = dp[mask]![last]!;
      if (!Number.isFinite(current.distance)) continue;
      for (let next = 0; next < count; next += 1) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const nextDistance = current.distance + getDistance(last + 1, next + 1);
        if (nextDistance < dp[nextMask]![next]!.distance) {
          dp[nextMask]![next] = { distance: nextDistance, prev: last };
        }
      }
    }
  }

  const fullMask = totalMasks - 1;
  let bestLast = 0;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (let last = 0; last < count; last += 1) {
    const total = dp[fullMask]![last]!.distance + getDistance(last + 1, count + 1);
    if (total < bestTotal) {
      bestTotal = total;
      bestLast = last;
    }
  }

  const order: number[] = [];
  let mask = fullMask;
  let current = bestLast;
  while (current >= 0) {
    order.push(current);
    const prev = dp[mask]![current]!.prev;
    mask &= ~(1 << current);
    current = prev;
  }

  return order.reverse().map((idx) => waypoints[idx]!);
}

function assignRequiredAirways(
  graph: AirwayGraph,
  routeTargets: ResolvedTarget[],
  requiredAirways: string[]
): { constraintsByLeg: Map<number, string[]>; error: string | null } {
  const normalizedRequiredAirways = [...new Set(requiredAirways.map((airway) => airway.trim().toUpperCase()).filter(Boolean))];
  const constraintsByLeg = new Map<number, string[]>();
  if (normalizedRequiredAirways.length === 0 || routeTargets.length < 2) {
    return { constraintsByLeg, error: null };
  }

  const baseLegs = routeTargets.slice(0, -1).map((from, idx) => solveLeg(graph, from, routeTargets[idx + 1]!));
  const baseAirways = new Set(baseLegs.flatMap((leg) => leg.leg.airways.map((airway) => airway.toUpperCase())));

  for (const airway of normalizedRequiredAirways) {
    if (baseAirways.has(airway)) continue;

    let bestLegIndex = -1;
    let bestExtraDistance = Number.POSITIVE_INFINITY;
    for (let idx = 0; idx < routeTargets.length - 1; idx += 1) {
      const solved = solveLeg(graph, routeTargets[idx]!, routeTargets[idx + 1]!, [airway]);
      if (solved.failedReason) continue;
      const extraDistance = solved.leg.distanceKm - baseLegs[idx]!.leg.distanceKm;
      if (extraDistance < bestExtraDistance) {
        bestExtraDistance = extraDistance;
        bestLegIndex = idx;
      }
    }

    if (bestLegIndex < 0) {
      return { constraintsByLeg, error: `未找到经过指定航路 ${airway} 的可用路径` };
    }

    const constraints = constraintsByLeg.get(bestLegIndex) ?? [];
    constraints.push(airway);
    constraintsByLeg.set(bestLegIndex, constraints);
  }

  return { constraintsByLeg, error: null };
}

export function calculateShortestRoute(
  navDb: NavDatabase,
  input: {
    departure: string;
    arrival: string;
    via?: string[];
    viaItems?: ViaRouteItem[];
    departurePoint?: ViaRouteItem | null;
    arrivalPoint?: ViaRouteItem | null;
    options?: ShortestRouteOptions;
  }
): ShortestRouteResult {
  const options: Required<ShortestRouteOptions> = {
    maxConnectorDistanceKm: input.options?.maxConnectorDistanceKm ?? DEFAULT_MAX_CONNECTOR_DISTANCE_KM,
    connectorCandidateLimit: input.options?.connectorCandidateLimit ?? DEFAULT_CONNECTOR_CANDIDATE_LIMIT
  };
  const graph = getAirwayGraph(navDb);
  const departureToken = input.departure.trim().toUpperCase();
  const arrivalToken = input.arrival.trim().toUpperCase();
  const viaItems = normalizeViaItems(input);
  const departurePointItem = normalizeWaypointItem(input.departurePoint);
  const arrivalPointItem = normalizeWaypointItem(input.arrivalPoint);
  const unknownElements: string[] = [];
  const departureTarget = resolveTarget(navDb, graph, departureToken, options);
  const arrivalTarget = resolveTarget(navDb, graph, arrivalToken, options);
  if (!departureTarget) unknownElements.push(departureToken);
  if (!arrivalTarget) unknownElements.push(arrivalToken);
  const departurePointTarget = departurePointItem ? resolveWaypointTarget(navDb, graph, departurePointItem, options) : null;
  const arrivalPointTarget = arrivalPointItem ? resolveWaypointTarget(navDb, graph, arrivalPointItem, options) : null;
  if (departurePointItem && !departurePointTarget) unknownElements.push(departurePointItem.ident);
  if (arrivalPointItem && !arrivalPointTarget) unknownElements.push(arrivalPointItem.ident);

  const resolvedViaItems = viaItems.map((item) => {
    const target = resolveWaypointTarget(navDb, graph, item, options);
    if (!target) unknownElements.push(item.ident);
    return { item, target };
  });

  if (!departureToken || !arrivalToken) {
    return {
      success: false,
      error: "请提供起飞机场和降落机场",
      routeString: "",
      departure: null,
      arrival: null,
      points: [],
      legs: [],
      distanceKm: 0,
      fallbackUsed: false,
      unknownElements
    };
  }

  if (
    unknownElements.length > 0 ||
    !departureTarget ||
    !arrivalTarget ||
    (departurePointItem && !departurePointTarget) ||
    (arrivalPointItem && !arrivalPointTarget) ||
    resolvedViaItems.some((item) => !item.target)
  ) {
    return {
      success: false,
      error: `未找到导航点：${unknownElements.join(", ")}`,
      routeString: "",
      departure: departureTarget?.point ?? null,
      arrival: arrivalTarget?.point ?? null,
      points: [],
      legs: [],
      distanceKm: 0,
      fallbackUsed: false,
      unknownElements
    };
  }

  const routeStartTarget = departurePointTarget ?? departureTarget;
  const routeEndTarget = arrivalPointTarget ?? arrivalTarget;
  const viaWaypointTargets = resolvedViaItems
    .filter((item): item is { item: ViaRouteItem; target: ResolvedTarget } => !!item.target)
    .map((item) => ({ item: item.item, target: item.target }));
  const orderedViaWaypointTargets = chooseWaypointOrder(graph, routeStartTarget, viaWaypointTargets, routeEndTarget);
  const routeTargets = [routeStartTarget, ...orderedViaWaypointTargets.map((item) => item.target), routeEndTarget];

  const legs: ShortestRouteLeg[] = [];
  const routeTokenGroups: string[][] = [];

  if (departurePointTarget) {
    const direct = buildBoundaryDirectLeg(departureTarget, departurePointTarget, "起飞机场", "离场点", "机场至离场点直连");
    legs.push(direct.leg);
    routeTokenGroups.push(direct.routeTokens);
  }

  let current = routeStartTarget;

  const solveAndAppend = (next: ResolvedTarget, requiredAirwaysForLeg: string[] = []) => {
    const solved = solveLeg(graph, current, next, requiredAirwaysForLeg);
    if (solved.failedReason) return solved.failedReason;

    legs.push(solved.leg);
    routeTokenGroups.push(solved.routeTokens);

    current = solved.selectedEndCandidate
      ? { ...next, candidates: [solved.selectedEndCandidate] }
      : next;

    return null;
  };

  for (let idx = 1; idx < routeTargets.length; idx += 1) {
    const failedReason = solveAndAppend(routeTargets[idx]!);
    if (failedReason) {
      return {
        success: false,
        error: failedReason,
        routeString: "",
        departure: departureTarget.point,
        arrival: arrivalTarget.point,
        points: [],
        legs,
        distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
        fallbackUsed: legs.some((leg) => leg.fallbackUsed),
        unknownElements: []
      };
    }
  }

  if (arrivalPointTarget) {
    const direct = buildBoundaryDirectLeg(arrivalPointTarget, arrivalTarget, "进场点", "降落机场", "进场点至机场直连");
    legs.push(direct.leg);
    routeTokenGroups.push(direct.routeTokens);
  }

  const points = markBoundaryPoints(mergePoints(legs), departurePointTarget, arrivalPointTarget);

  return {
    success: true,
    error: null,
    routeString: mergeRouteTokens(routeTokenGroups, graph.airways),
    departure: departureTarget.point,
    arrival: arrivalTarget.point,
    points,
    legs,
    distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    fallbackUsed: legs.some((leg) => leg.fallbackUsed),
    unknownElements: []
  };
}
