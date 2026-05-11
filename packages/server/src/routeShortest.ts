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

  for (const edge of navDb.getAirwayGraphEdges()) {
    nodes.set(edge.from.id, edge.from);
    nodes.set(edge.to.id, edge.to);

    const distanceKm = haversineDistance(edge.from.lat, edge.from.lon, edge.to.lat, edge.to.lon);
    const forward = adjacency.get(edge.from.id) ?? [];
    forward.push({ to: edge.to.id, airwayIdent: edge.airwayIdent, distanceKm });
    adjacency.set(edge.from.id, forward);

    const backward = adjacency.get(edge.to.id) ?? [];
    backward.push({ to: edge.from.id, airwayIdent: edge.airwayIdent, distanceKm });
    adjacency.set(edge.to.id, backward);
  }

  const graph = { nodes, adjacency };
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

function dijkstra(graph: AirwayGraph, startCandidates: RouteCandidate[], endCandidates: RouteCandidate[]) {
  if (startCandidates.length === 0 || endCandidates.length === 0) return null;

  const endByNode = new Map(endCandidates.map((candidate) => [candidate.nodeId, candidate]));
  const dist = new Map<number, number>();
  const prev = new Map<number, { nodeId: number; edge: GraphEdge }>();
  const heap = new MinHeap<number>();

  for (const candidate of startCandidates) {
    const existing = dist.get(candidate.nodeId);
    if (existing == null || candidate.connectorDistanceKm < existing) {
      dist.set(candidate.nodeId, candidate.connectorDistanceKm);
      heap.push(candidate.nodeId, candidate.connectorDistanceKm);
    }
  }

  let bestEnd: RouteCandidate | null = null;
  let bestTotal = Number.POSITIVE_INFINITY;

  while (true) {
    const item = heap.pop();
    if (!item) break;
    const currentDist = dist.get(item.value);
    if (currentDist == null || item.priority > currentDist) continue;

    const endCandidate = endByNode.get(item.value);
    if (endCandidate) {
      const total = currentDist + endCandidate.connectorDistanceKm;
      if (total < bestTotal) {
        bestTotal = total;
        bestEnd = endCandidate;
      }
    }

    for (const edge of graph.adjacency.get(item.value) ?? []) {
      const nextDist = currentDist + edge.distanceKm;
      if (nextDist >= (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      dist.set(edge.to, nextDist);
      prev.set(edge.to, { nodeId: item.value, edge });
      heap.push(edge.to, nextDist);
    }
  }

  if (!bestEnd) return null;

  const pathIds: number[] = [];
  const pathEdges: GraphEdge[] = [];
  let current = bestEnd.nodeId;
  pathIds.push(current);
  while (prev.has(current)) {
    const previous = prev.get(current)!;
    pathEdges.push(previous.edge);
    current = previous.nodeId;
    pathIds.push(current);
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
  to: ResolvedTarget
): {
  leg: ShortestRouteLeg;
  routeTokens: string[];
  selectedEndCandidate: RouteCandidate | null;
} {
  const found = dijkstra(graph, from.candidates, to.candidates);
  if (!found) {
    const distanceKm = haversineDistance(from.point.lat, from.point.lon, to.point.lat, to.point.lon);
    const points = [
      toParsedPoint(from.point, { isExplicit: true, remark: "起点" }),
      toParsedPoint(to.point, { isExplicit: true, remark: "直连" })
    ];
    return {
      selectedEndCandidate: null,
      routeTokens: buildLegRouteTokens(points, true),
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

  return {
    selectedEndCandidate: found.endCandidate,
    routeTokens,
    leg: {
      from: from.token,
      to: to.token,
      distanceKm: found.distanceKm,
      airwayUsed: found.pathEdges.length > 0,
      fallbackUsed,
      airways: uniqueAirways(found.pathEdges),
      points,
      reason: fallbackUsed ? "端点不在航路图上，已接入最近航路点" : null
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

function mergeRouteTokens(legTokens: string[][]) {
  const tokens: string[] = [];
  for (const part of legTokens) {
    for (const token of part) {
      if (tokens.length > 0 && tokens[tokens.length - 1] === token) continue;
      tokens.push(token);
    }
  }
  return tokens.join(" ");
}

export function calculateShortestRoute(
  navDb: NavDatabase,
  input: {
    departure: string;
    arrival: string;
    via?: string[];
    options?: ShortestRouteOptions;
  }
): ShortestRouteResult {
  const options: Required<ShortestRouteOptions> = {
    maxConnectorDistanceKm: input.options?.maxConnectorDistanceKm ?? DEFAULT_MAX_CONNECTOR_DISTANCE_KM,
    connectorCandidateLimit: input.options?.connectorCandidateLimit ?? DEFAULT_CONNECTOR_CANDIDATE_LIMIT
  };
  const graph = getAirwayGraph(navDb);
  const tokens = [
    input.departure.trim().toUpperCase(),
    ...(input.via ?? []).map((item) => item.trim().toUpperCase()).filter(Boolean),
    input.arrival.trim().toUpperCase()
  ];

  const unknownElements: string[] = [];
  const targets = tokens.map((token) => {
    const target = resolveTarget(navDb, graph, token, options);
    if (!target) unknownElements.push(token);
    return target;
  });

  if (tokens.length < 2 || !tokens[0] || !tokens[tokens.length - 1]) {
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

  if (unknownElements.length > 0 || targets.some((target) => !target)) {
    return {
      success: false,
      error: `未找到导航点：${unknownElements.join(", ")}`,
      routeString: "",
      departure: targets[0]?.point ?? null,
      arrival: targets[targets.length - 1]?.point ?? null,
      points: [],
      legs: [],
      distanceKm: 0,
      fallbackUsed: false,
      unknownElements
    };
  }

  const legs: ShortestRouteLeg[] = [];
  const routeTokenGroups: string[][] = [];
  let current = targets[0]!;

  for (let i = 1; i < targets.length; i += 1) {
    const next = targets[i]!;
    const solved = solveLeg(graph, current, next);
    legs.push(solved.leg);
    routeTokenGroups.push(solved.routeTokens);

    current = solved.selectedEndCandidate
      ? { ...next, candidates: [solved.selectedEndCandidate] }
      : next;
  }

  const points = mergePoints(legs);
  return {
    success: true,
    error: null,
    routeString: mergeRouteTokens(routeTokenGroups),
    departure: targets[0]!.point,
    arrival: targets[targets.length - 1]!.point,
    points,
    legs,
    distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    fallbackUsed: legs.some((leg) => leg.fallbackUsed),
    unknownElements: []
  };
}
