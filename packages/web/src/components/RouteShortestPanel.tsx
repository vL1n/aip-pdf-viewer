/**
 * 最短航路计算面板
 * 使用服务端 Dijkstra 航路图：优先走航路，无法接入航路时才退化为直连航点。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Space, Tag, Tooltip, Typography, theme } from "antd";
import { ClearOutlined, CompressOutlined, DeleteOutlined, NodeIndexOutlined, PlusOutlined } from "@ant-design/icons";
import {
  apiRouteShortest,
  apiRouteWaypointCandidates,
  type ParsedRoutePoint,
  type ShortestRouteResult,
  type ViaRouteItem,
  type WaypointCandidate
} from "../api";
import { splitRouteTokens } from "../utils/routeEditing";

export interface RouteShortestPanelProps {
  departureIcao: string;
  arrivalIcao: string;
  departurePoint: ViaRouteItem | null;
  arrivalPoint: ViaRouteItem | null;
  onDeparturePointChange: (item: ViaRouteItem | null) => void;
  onArrivalPointChange: (item: ViaRouteItem | null) => void;
  viaItems: ViaRouteItem[];
  onViaItemsChange: (items: ViaRouteItem[]) => void;
  result: ShortestRouteResult | null;
  onCalculated: (result: ShortestRouteResult) => void;
  onClear: () => void;
  onRemoveAirway: (airway: string) => void;
  onRemovePoint: (pointIndex: number) => void;
  onRemoveRouteToken: (tokenIndex: number) => void;
  onSimplifyRoute: () => void;
  disabled?: boolean;
}

function parseViaDraft(input: string) {
  return input
    .split(/[\s,，]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function pointTagColor(point: ParsedRoutePoint) {
  if (point.isAirport) return "red";
  if (point.remark === "离场点") return "orange";
  if (point.remark === "进场点") return "cyan";
  if (point.type === "navaid") return "purple";
  if (point.isExplicit) return "geekblue";
  return "blue";
}

function looksLikeAirway(token: string) {
  return /^[A-Z]{1,4}\d+[A-Z]?$/.test(token.toUpperCase());
}

function formatCoordinate(lat: number, lon: number) {
  return `纬 ${lat.toFixed(4)} / 经 ${lon.toFixed(4)}`;
}

function toViaItem(candidate: WaypointCandidate): ViaRouteItem {
  return {
    type: "waypoint",
    ident: candidate.ident.toUpperCase(),
    waypointId: candidate.id,
    name: candidate.name,
    lat: candidate.lat,
    lon: candidate.lon
  };
}

function viaItemTooltip(item: ViaRouteItem) {
  const parts = [`航点 ${item.ident}`];
  if (item.name) parts.push(item.name);
  if (item.lat != null && item.lon != null) parts.push(formatCoordinate(item.lat, item.lon));
  return parts.join(" · ");
}

export function RouteShortestPanel({
  departureIcao,
  arrivalIcao,
  departurePoint,
  arrivalPoint,
  onDeparturePointChange,
  onArrivalPointChange,
  viaItems,
  onViaItemsChange,
  result,
  onCalculated,
  onClear,
  onRemoveAirway,
  onRemovePoint,
  onRemoveRouteToken,
  onSimplifyRoute,
  disabled = false
}: RouteShortestPanelProps) {
  const { token } = theme.useToken();
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viaDraft, setViaDraft] = useState("");
  const [departurePointDraft, setDeparturePointDraft] = useState("");
  const [arrivalPointDraft, setArrivalPointDraft] = useState("");
  const [addingVia, setAddingVia] = useState(false);
  const [addingBoundaryPoint, setAddingBoundaryPoint] = useState<"departure" | "arrival" | null>(null);
  const [candidateOptions, setCandidateOptions] = useState<Record<string, WaypointCandidate[]>>({});

  const routeTokens = useMemo(() => splitRouteTokens(result?.routeString ?? ""), [result?.routeString]);
  const airwayTokens = useMemo(() => {
    const airways = new Set<string>();
    for (const point of result?.points ?? []) {
      if (point.viaAirway) airways.add(point.viaAirway.toUpperCase());
    }
    for (const leg of result?.legs ?? []) {
      for (const airway of leg.airways) airways.add(airway.toUpperCase());
    }
    return airways;
  }, [result]);
  const allConstraintItems = useMemo(
    () => [departurePoint, arrivalPoint, ...viaItems].filter(Boolean) as ViaRouteItem[],
    [arrivalPoint, departurePoint, viaItems]
  );
  const unresolvedAmbiguousItems = useMemo(() => {
    const entries: Array<{
      role: "departure" | "arrival" | "via";
      label: string;
      item: ViaRouteItem;
      idx?: number;
      candidates: WaypointCandidate[];
    }> = [];
    if (departurePoint) {
      entries.push({
        role: "departure",
        label: "离场点",
        item: departurePoint,
        candidates: candidateOptions[departurePoint.ident.toUpperCase()] ?? []
      });
    }
    if (arrivalPoint) {
      entries.push({
        role: "arrival",
        label: "进场点",
        item: arrivalPoint,
        candidates: candidateOptions[arrivalPoint.ident.toUpperCase()] ?? []
      });
    }
    viaItems.forEach((item, idx) => {
      entries.push({
        role: "via",
        label: "途径点",
        item,
        idx,
        candidates: candidateOptions[item.ident.toUpperCase()] ?? []
      });
    });
    return entries.filter(({ item, candidates }) => candidates.length > 1 && !item.waypointId);
  }, [arrivalPoint, candidateOptions, departurePoint, viaItems]);
  const canCalculate = !!departureIcao && !!arrivalIcao && !disabled && unresolvedAmbiguousItems.length === 0;

  useEffect(() => {
    const missingIdents = [...new Set(allConstraintItems.map((item) => item.ident.toUpperCase()))]
      .filter((ident) => candidateOptions[ident] == null);
    if (missingIdents.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missingIdents.map(async (ident) => {
          try {
            const res = await apiRouteWaypointCandidates(ident);
            return [ident, res.candidates ?? []] as const;
          } catch {
            return [ident, [] as WaypointCandidate[]] as const;
          }
        })
      );
      if (cancelled) return;
      setCandidateOptions((prev) => {
        const next = { ...prev };
        for (const [ident, candidates] of entries) next[ident] = candidates;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [allConstraintItems, candidateOptions]);

  const handleCalculate = useCallback(async () => {
    if (unresolvedAmbiguousItems.length > 0) {
      setError(`航点 ${unresolvedAmbiguousItems[0]!.item.ident} 有多个坐标，请先选择实际使用的点`);
      return;
    }
    if (!canCalculate) return;
    setCalculating(true);
    setError(null);

    try {
      const next = await apiRouteShortest({
        departure: departureIcao,
        arrival: arrivalIcao,
        departurePoint,
        arrivalPoint,
        viaItems
      });
      if (!next.success) {
        setError(next.error || "最短航路计算失败");
        return;
      }
      onCalculated(next);
    } catch (e: any) {
      setError(e?.message || "最短航路请求失败");
    } finally {
      setCalculating(false);
    }
  }, [arrivalIcao, arrivalPoint, canCalculate, departureIcao, departurePoint, onCalculated, unresolvedAmbiguousItems, viaItems]);

  const handleClear = useCallback(() => {
    setError(null);
    onClear();
  }, [onClear]);

  const handleAddViaItems = useCallback(async () => {
    const idents = parseViaDraft(viaDraft);
    if (idents.length === 0) return;

    setAddingVia(true);
    setError(null);
    try {
      const nextItems = [...viaItems];
      const nextCandidateOptions: Record<string, WaypointCandidate[]> = {};
      const failed: string[] = [];

      for (const ident of idents) {
        if (nextItems.some((item) => item.ident.toUpperCase() === ident)) continue;

        try {
          const res = await apiRouteWaypointCandidates(ident);
          const candidates = res.candidates ?? [];
          nextCandidateOptions[ident] = candidates;

          if (candidates.length === 0) {
            failed.push(ident);
            continue;
          }

          nextItems.push(candidates.length === 1 ? toViaItem(candidates[0]!) : { type: "waypoint", ident });
        } catch {
          failed.push(ident);
        }
      }

      setCandidateOptions((prev) => ({ ...prev, ...nextCandidateOptions }));
      onViaItemsChange(nextItems);
      setViaDraft("");
      if (failed.length > 0) {
        setError(`未找到途径航点：${failed.join(", ")}`);
      }
    } finally {
      setAddingVia(false);
    }
  }, [onViaItemsChange, viaDraft, viaItems]);

  const handleSetBoundaryPoint = useCallback(async (role: "departure" | "arrival") => {
    const draft = role === "departure" ? departurePointDraft : arrivalPointDraft;
    const ident = parseViaDraft(draft)[0];
    if (!ident) return;

    setAddingBoundaryPoint(role);
    setError(null);
    try {
      const res = await apiRouteWaypointCandidates(ident);
      const candidates = res.candidates ?? [];
      setCandidateOptions((prev) => ({ ...prev, [ident]: candidates }));
      if (candidates.length === 0) {
        setError(`未找到${role === "departure" ? "离场点" : "进场点"}：${ident}`);
        return;
      }

      const nextItem = candidates.length === 1 ? toViaItem(candidates[0]!) : { type: "waypoint" as const, ident };
      if (role === "departure") {
        onDeparturePointChange(nextItem);
        setDeparturePointDraft("");
      } else {
        onArrivalPointChange(nextItem);
        setArrivalPointDraft("");
      }
    } catch (e: any) {
      setError(e?.message || `设置${role === "departure" ? "离场点" : "进场点"}失败`);
    } finally {
      setAddingBoundaryPoint(null);
    }
  }, [arrivalPointDraft, departurePointDraft, onArrivalPointChange, onDeparturePointChange]);

  const handleRemoveViaItem = useCallback((pointIndex: number) => {
    onViaItemsChange(viaItems.filter((_, idx) => idx !== pointIndex));
  }, [onViaItemsChange, viaItems]);

  const handleSelectViaCandidate = useCallback((pointIndex: number, candidate: WaypointCandidate) => {
    onViaItemsChange(viaItems.map((item, idx) => (idx === pointIndex ? toViaItem(candidate) : item)));
  }, [onViaItemsChange, viaItems]);

  const handleSelectConstraintCandidate = useCallback((
    entry: { role: "departure" | "arrival" | "via"; idx?: number },
    candidate: WaypointCandidate
  ) => {
    if (entry.role === "departure") {
      onDeparturePointChange(toViaItem(candidate));
      return;
    }
    if (entry.role === "arrival") {
      onArrivalPointChange(toViaItem(candidate));
      return;
    }
    if (entry.idx != null) handleSelectViaCandidate(entry.idx, candidate);
  }, [handleSelectViaCandidate, onArrivalPointChange, onDeparturePointChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (viaDraft.trim()) void handleAddViaItems();
      else void handleCalculate();
    }
  };

  const renderBoundaryEditor = (
    role: "departure" | "arrival",
    label: string,
    point: ViaRouteItem | null,
    draft: string,
    setDraft: (value: string) => void,
    onChange: (item: ViaRouteItem | null) => void,
    color: string
  ) => (
    <div
      style={{
        flex: "1 1 180px",
        minWidth: 0,
        padding: 8,
        borderRadius: token.borderRadiusLG,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 6 }}>
        <Typography.Text strong style={{ fontSize: 12 }}>{label}</Typography.Text>
        {point && (
          <Tooltip title={viaItemTooltip(point)}>
            <Tag
              color={color}
              closable={!disabled}
              onClose={(e) => {
                e.preventDefault();
                onChange(null);
              }}
              style={{ margin: 0, borderRadius: 999 }}
            >
              {point.ident}
              {candidateOptions[point.ident.toUpperCase()]?.length > 1 && !point.waypointId && (
                <span style={{ marginLeft: 4 }}>待选</span>
              )}
            </Tag>
          </Tooltip>
        )}
      </Space>
      <div style={{ display: "flex", gap: 6 }}>
        <Input
          size="small"
          placeholder={role === "departure" ? "离场航点" : "进场航点"}
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSetBoundaryPoint(role);
            }
          }}
          disabled={calculating || addingBoundaryPoint === role || disabled}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button
          size="small"
          onClick={() => void handleSetBoundaryPoint(role)}
          loading={addingBoundaryPoint === role}
          disabled={calculating || addingBoundaryPoint === role || disabled || !draft.trim()}
        >
          设置
        </Button>
      </div>
    </div>
  );

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          padding: 14,
          background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer})`,
          borderBottom: `1px solid ${token.colorBorderSecondary}`
        }}
      >
        <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              最短航路工作台
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Dijkstra 优先走航路；无航路时才退化为直连。
            </Typography.Text>
          </div>
          {result?.manuallyEdited && <Tag color="gold">已手动编辑</Tag>}
        </Space>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <Space size={6} wrap>
            <Tag color="red">{departureIcao}</Tag>
            <span style={{ color: token.colorTextSecondary }}>→</span>
            {departurePoint && (
              <>
                <Tag color="orange">离场 {departurePoint.ident}</Tag>
                <span style={{ color: token.colorTextSecondary }}>→</span>
              </>
            )}
            {viaItems.length > 0 && (
              <>
                <Tag color="geekblue">{viaItems.length} 个途径点</Tag>
                <span style={{ color: token.colorTextSecondary }}>→</span>
              </>
            )}
            {arrivalPoint && (
              <>
                <Tag color="cyan">进场 {arrivalPoint.ident}</Tag>
                <span style={{ color: token.colorTextSecondary }}>→</span>
              </>
            )}
            <Tag color="red">{arrivalIcao}</Tag>
          </Space>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {renderBoundaryEditor(
            "departure",
            "离场点",
            departurePoint,
            departurePointDraft,
            setDeparturePointDraft,
            onDeparturePointChange,
            "orange"
          )}
          {renderBoundaryEditor(
            "arrival",
            "进场点",
            arrivalPoint,
            arrivalPointDraft,
            setArrivalPointDraft,
            onArrivalPointChange,
            "cyan"
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
          <Input
            placeholder="输入途径航点，如 PIMOL；同名航点会要求选择坐标"
            value={viaDraft}
            onChange={(e) => setViaDraft(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            disabled={calculating || addingVia || disabled}
            style={{ flex: 1, borderRadius: token.borderRadiusLG }}
          />
          <Button
            icon={<PlusOutlined />}
            onClick={() => void handleAddViaItems()}
            loading={addingVia}
            disabled={calculating || addingVia || disabled || !viaDraft.trim()}
          >
            添加
          </Button>
        </div>

        {(viaItems.length > 0 || unresolvedAmbiguousItems.length > 0) && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              borderRadius: token.borderRadiusLG,
              background: token.colorFillQuaternary,
              border: `1px dashed ${token.colorBorder}`
            }}
          >
            {viaItems.length > 0 && (
              <>
                <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 6 }}>
                  <Typography.Text strong>
                    途径约束 <Typography.Text type="secondary">({viaItems.length})</Typography.Text>
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    自动选择经过顺序
                  </Typography.Text>
                </Space>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    maxHeight: 92,
                    overflowY: "auto",
                    paddingRight: 2
                  }}
                >
                  {viaItems.map((item, idx) => {
                    const needsCoordinateChoice = candidateOptions[item.ident.toUpperCase()]?.length > 1 && !item.waypointId;
                    return (
                      <Tooltip key={`${item.ident}-${item.waypointId ?? idx}`} title={viaItemTooltip(item)}>
                        <Tag
                          closable={!disabled}
                          color={needsCoordinateChoice ? "orange" : "geekblue"}
                          onClose={(e) => {
                            e.preventDefault();
                            handleRemoveViaItem(idx);
                          }}
                          style={{
                            margin: 0,
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            lineHeight: "22px",
                            boxShadow: "0 1px 4px rgba(15, 23, 42, 0.08)"
                          }}
                        >
                          <span style={{ opacity: 0.65, marginRight: 4 }}>{idx + 1}</span>
                          {item.ident}
                          {needsCoordinateChoice && (
                            <span style={{ marginLeft: 4, opacity: 0.75 }}>待选坐标</span>
                          )}
                        </Tag>
                      </Tooltip>
                    );
                  })}
                </div>
              </>
            )}
            {unresolvedAmbiguousItems.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                  同名航点坐标选择
                </Typography.Text>
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {unresolvedAmbiguousItems.map(({ role, label, item, idx, candidates }) => (
                    <div
                      key={`candidate-${role}-${item.ident}-${idx ?? "boundary"}`}
                      style={{
                        padding: 10,
                        borderRadius: token.borderRadius,
                        background: token.colorBgElevated,
                        border: `1px solid ${token.colorBorderSecondary}`
                      }}
                    >
                      <Typography.Text style={{ display: "block", marginBottom: 8 }}>
                        {label} {item.ident} 有 {candidates.length} 个坐标，请选择实际经过的点：
                      </Typography.Text>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {candidates.map((candidate) => (
                          <Button
                            key={candidate.id}
                            size="small"
                            type={item.waypointId === candidate.id ? "primary" : "default"}
                            onClick={() => handleSelectConstraintCandidate({ role, idx }, candidate)}
                            style={{
                              height: "auto",
                              padding: "5px 9px",
                              borderRadius: token.borderRadiusLG,
                              textAlign: "left"
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>#{candidate.id}</span>
                            <span style={{ marginLeft: 6 }}>{formatCoordinate(candidate.lat, candidate.lon)}</span>
                            {!candidate.inAirwayGraph && (
                              <span style={{ marginLeft: 6, opacity: 0.65 }}>需接入航路</span>
                            )}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </Space>
              </div>
            )}
          </div>
        )}

        <Space wrap>
          <Button
            type="primary"
            icon={<NodeIndexOutlined />}
            onClick={handleCalculate}
            loading={calculating}
            disabled={!canCalculate}
          >
            {calculating ? "计算中..." : "生成最短航路"}
          </Button>
          {result && (
            <Button danger icon={<ClearOutlined />} onClick={handleClear} disabled={disabled}>
              清空结果
            </Button>
          )}
        </Space>

        {error && (
          <Alert
            style={{ marginTop: 12 }}
            type="error"
            showIcon
            message={error}
            closable
            onClose={() => setError(null)}
          />
        )}

        {result && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                padding: 12,
                borderRadius: token.borderRadiusLG,
                background: token.colorSuccessBg,
                border: `1px solid ${token.colorSuccessBorder}`
              }}
            >
              <Space size={6} wrap style={{ marginBottom: 8 }}>
                <Tag color="green">距离 {result.distanceKm.toFixed(1)} km</Tag>
                <Tag color={result.fallbackUsed ? "orange" : "cyan"}>
                  {result.fallbackUsed ? "含接入/直连" : "全程航路"}
                </Tag>
                <Tag color="blue">{result.points.length} 个航点</Tag>
              </Space>

              <Typography.Paragraph copyable style={{ marginBottom: 0, wordBreak: "break-all", lineHeight: 1.7 }}>
                {result.routeString || "航路串已清空"}
              </Typography.Paragraph>
            </div>

            <div style={{ marginTop: 12 }}>
              <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                <Typography.Text strong>航路串编辑</Typography.Text>
                <Space size={8} wrap style={{ justifyContent: "flex-end" }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    删除航路会同步移除对应中间点
                  </Typography.Text>
                  <Tooltip title="把同一 airway 连续段中的中间点折叠，只保留段尾点">
                    <Button
                      size="small"
                      icon={<CompressOutlined />}
                      onClick={onSimplifyRoute}
                      disabled={disabled || routeTokens.length < 3}
                    >
                      一键简化航路
                    </Button>
                  </Tooltip>
                </Space>
              </Space>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: 10,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillQuaternary
                }}
              >
                {routeTokens.length > 0 ? routeTokens.map((routeToken, idx) => {
                  const upper = routeToken.toUpperCase();
                  const matchingPoint = result.points.find((point) => point.ident.toUpperCase() === upper);
                  const isAirway = airwayTokens.has(upper) || (!matchingPoint && looksLikeAirway(upper));
                  const isDirect = upper === "DCT";
                  const color = isDirect ? "orange" : isAirway ? "cyan" : matchingPoint ? pointTagColor(matchingPoint) : "default";
                  return (
                    <Tooltip
                      key={`${routeToken}-${idx}`}
                      title={isAirway ? "删除这条航路，并移除该航路上的中间生成点" : "只从航路串中删除这个 token"}
                    >
                      <Tag
                        closable={!disabled}
                        color={color}
                        onClose={(e) => {
                          e.preventDefault();
                          if (isAirway) onRemoveAirway(routeToken);
                          else onRemoveRouteToken(idx);
                        }}
                        style={{ margin: 0, padding: "4px 8px", borderRadius: 999 }}
                      >
                        {routeToken}
                      </Tag>
                    </Tooltip>
                  );
                }) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    航路串为空
                  </Typography.Text>
                )}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                <Typography.Text strong>航点序列</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  删除航点会同步刷新地图
                </Typography.Text>
              </Space>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: 10,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillQuaternary
                }}
              >
                {result.points.length > 0 ? result.points.map((point, idx) => (
                  <Tooltip key={`${point.ident}-${idx}`} title={point.viaAirway ? `经由 ${point.viaAirway}` : "生成航点"}>
                    <Tag
                      closable={!disabled}
                      color={pointTagColor(point)}
                      closeIcon={<DeleteOutlined />}
                      onClose={(e) => {
                        e.preventDefault();
                        onRemovePoint(idx);
                      }}
                      style={{ margin: 0, padding: "4px 8px", borderRadius: 999 }}
                    >
                      {idx + 1}. {point.ident}
                    </Tag>
                  </Tooltip>
                )) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    航点已清空
                  </Typography.Text>
                )}
              </div>
            </div>

            {!result.manuallyEdited && result.legs.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text strong>原始航段</Typography.Text>
                <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 8 }}>
                  {result.legs.map((leg, idx) => (
                    <div
                      key={`${leg.from}-${leg.to}-${idx}`}
                      style={{
                        padding: "8px 10px",
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadius,
                        background: token.colorBgElevated
                      }}
                    >
                      <Space size={4} wrap>
                        <Tag color="default">
                          {leg.from} → {leg.to}
                        </Tag>
                        <Tag color={leg.airwayUsed ? "cyan" : "orange"}>
                          {leg.airwayUsed ? leg.airways.join(" / ") || "航路" : "DCT"}
                        </Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {leg.distanceKm.toFixed(1)} km
                        </Typography.Text>
                      </Space>
                      {leg.reason && (
                        <Typography.Text type="secondary" style={{ display: "block", marginTop: 2, fontSize: 12 }}>
                          {leg.reason}
                        </Typography.Text>
                      )}
                    </div>
                  ))}
                </Space>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
