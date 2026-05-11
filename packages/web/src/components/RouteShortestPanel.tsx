/**
 * 最短航路计算面板
 * 使用服务端 Dijkstra 航路图：优先走航路，无法接入航路时才退化为直连航点。
 */
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Button, Input, Space, Tag, Tooltip, Typography, theme } from "antd";
import { ClearOutlined, DeleteOutlined, NodeIndexOutlined } from "@ant-design/icons";
import { apiRouteShortest, type ParsedRoutePoint, type ShortestRouteResult } from "../api";
import { splitRouteTokens } from "../utils/routeEditing";

export interface RouteShortestPanelProps {
  departureIcao: string;
  arrivalIcao: string;
  result: ShortestRouteResult | null;
  onCalculated: (result: ShortestRouteResult) => void;
  onClear: () => void;
  onRemoveAirway: (airway: string) => void;
  onRemovePoint: (pointIndex: number) => void;
  onRemoveRouteToken: (tokenIndex: number) => void;
  disabled?: boolean;
}

function parseViaInput(input: string) {
  return input
    .split(/[\s,，]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function pointTagColor(point: ParsedRoutePoint) {
  if (point.isAirport) return "red";
  if (point.type === "navaid") return "purple";
  if (point.isExplicit) return "geekblue";
  return "blue";
}

function looksLikeAirway(token: string) {
  return /^[A-Z]{1,4}\d+[A-Z]?$/.test(token.toUpperCase());
}

export function RouteShortestPanel({
  departureIcao,
  arrivalIcao,
  result,
  onCalculated,
  onClear,
  onRemoveAirway,
  onRemovePoint,
  onRemoveRouteToken,
  disabled = false
}: RouteShortestPanelProps) {
  const { token } = theme.useToken();
  const [viaInput, setViaInput] = useState("");
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viaPoints = useMemo(() => parseViaInput(viaInput), [viaInput]);
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
  const canCalculate = !!departureIcao && !!arrivalIcao && !disabled;

  const handleCalculate = useCallback(async () => {
    if (!canCalculate) return;
    setCalculating(true);
    setError(null);

    try {
      const next = await apiRouteShortest({
        departure: departureIcao,
        arrival: arrivalIcao,
        via: viaPoints
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
  }, [arrivalIcao, canCalculate, departureIcao, onCalculated, viaPoints]);

  const handleClear = useCallback(() => {
    setError(null);
    onClear();
  }, [onClear]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleCalculate();
    }
  };

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
          <Space size={4} wrap>
            <Tag color="red">{departureIcao}</Tag>
            {viaPoints.map((point) => (
              <React.Fragment key={point}>
                <span style={{ color: token.colorTextSecondary }}>→</span>
                <Tag color="geekblue">{point}</Tag>
              </React.Fragment>
            ))}
            <span style={{ color: token.colorTextSecondary }}>→</span>
            <Tag color="red">{arrivalIcao}</Tag>
          </Space>
        </div>

        <Input.TextArea
          placeholder="途径点，可选；用空格或逗号分隔，例如：PIMOL VMB BTO"
          value={viaInput}
          onChange={(e) => setViaInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={calculating || disabled}
          autoSize={{ minRows: 2, maxRows: 4 }}
          style={{ marginBottom: 10, borderRadius: token.borderRadiusLG }}
        />

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
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  删除航路会同步移除对应中间点
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
