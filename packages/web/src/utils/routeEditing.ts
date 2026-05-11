import type { ParsedRoutePoint, ShortestRouteResult } from "../api";

export function splitRouteTokens(routeString: string) {
  return routeString
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function haversineDistanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function calculateDistanceKm(points: ParsedRoutePoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineDistanceKm(points[i - 1]!, points[i]!);
  }
  return total;
}

export function buildRouteStringFromPoints(points: ParsedRoutePoint[]) {
  if (points.length === 0) return "";

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

  return tokens.filter((token, idx) => idx === 0 || token !== tokens[idx - 1]).join(" ");
}

function rebuildEditedResult(result: ShortestRouteResult, points: ParsedRoutePoint[], routeString?: string): ShortestRouteResult {
  const nextRouteString = routeString ?? buildRouteStringFromPoints(points);
  return {
    ...result,
    routeString: nextRouteString,
    points,
    distanceKm: calculateDistanceKm(points),
    legs: [],
    fallbackUsed: result.fallbackUsed || nextRouteString.includes("DCT"),
    manuallyEdited: true
  };
}

export function removeShortestRoutePoint(result: ShortestRouteResult, pointIndex: number) {
  const points = result.points.filter((_, idx) => idx !== pointIndex);
  return rebuildEditedResult(result, points);
}

export function removeShortestRouteToken(result: ShortestRouteResult, tokenIndex: number) {
  const tokens = splitRouteTokens(result.routeString).filter((_, idx) => idx !== tokenIndex);
  return rebuildEditedResult(result, result.points, tokens.join(" "));
}

export function removeShortestRouteAirway(result: ShortestRouteResult, airway: string) {
  const normalized = airway.toUpperCase();
  const points = result.points
    .map((point) => {
      if (point.viaAirway?.toUpperCase() !== normalized) return point;
      if (!point.isExplicit && !point.isAirport) return null;
      return {
        ...point,
        viaAirway: null,
        remark: point.remark ?? "保留关键点"
      };
    })
    .filter(Boolean) as ParsedRoutePoint[];

  if (points.length !== result.points.length) {
    return rebuildEditedResult(result, points);
  }

  const tokens = splitRouteTokens(result.routeString).filter((token) => token.toUpperCase() !== normalized);
  return rebuildEditedResult(result, points, tokens.join(" "));
}
