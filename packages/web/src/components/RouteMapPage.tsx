/**
 * 航路地图页面
 * 用户输入航路 → 解析 → 在地图上渲染航点和航线
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Button,
  Input,
  Alert,
  Space,
  Typography,
  Spin,
  Tag,
  Divider,
  theme,
  Card
} from "antd";
import {
  EnvironmentOutlined,
  SendOutlined,
  ArrowLeftOutlined,
  QuestionCircleOutlined
} from "@ant-design/icons";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { apiRouteParse, apiRouteStatus, type ParsedRoute, type ParsedRoutePoint, type RouteStatus } from "../api";

// 修复 Leaflet 默认图标问题
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl
});

// 自定义图标
const createIcon = (color: string, size: number = 24) => {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
};

const airportIcon = createIcon("#e74c3c", 20); // 红色 - 机场
const waypointIcon = createIcon("#3498db", 14); // 蓝色 - 航点
const navaidIcon = createIcon("#9b59b6", 16); // 紫色 - 导航台
const explicitWaypointIcon = createIcon("#2ecc71", 16); // 绿色 - 用户指定航点

/** 根据航点类型获取图标 */
function getMarkerIcon(point: ParsedRoutePoint) {
  if (point.isAirport) return airportIcon;
  if (point.type === "navaid") return navaidIcon;
  if (point.isExplicit) return explicitWaypointIcon;
  return waypointIcon;
}

/** 自动调整地图视野的组件 */
function FitBounds({ points }: { points: ParsedRoutePoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;

    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [map, points]);

  return null;
}

export interface RouteMapPageProps {
  onBack: () => void;
}

export function RouteMapPage({ onBack }: RouteMapPageProps) {
  const { token } = theme.useToken();

  // 状态
  const [routeStatus, setRouteStatus] = useState<RouteStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [routeInput, setRouteInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParsedRoute | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [showHelp, setShowHelp] = useState(false);

  // 检查航路解析功能是否可用
  useEffect(() => {
    (async () => {
      try {
        setStatusLoading(true);
        const status = await apiRouteStatus();
        setRouteStatus(status);
      } catch (e: any) {
        setRouteStatus({ available: false, message: e?.message || "无法连接服务器" });
      } finally {
        setStatusLoading(false);
      }
    })();
  }, []);

  // 解析航路
  const handleParse = useCallback(async () => {
    if (!routeInput.trim()) return;

    setParsing(true);
    setParseError(null);
    setParseResult(null);

    try {
      const result = await apiRouteParse(routeInput);
      if (result.success) {
        setParseResult(result);
      } else {
        setParseError(result.error || "解析失败");
      }
    } catch (e: any) {
      setParseError(e?.message || "解析请求失败");
    } finally {
      setParsing(false);
    }
  }, [routeInput]);

  // 回车提交
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
  };

  // 示例航路
  const exampleRoute = "ZSPD SHA3P PIMOL G471 VMB A593 BTO A470 LAMEN STAR2A ZGGG";

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: token.colorBgLayout
      }}
    >
      {/* 顶部栏 */}
      <div
        style={{
          padding: "12px 16px",
          background: token.colorBgElevated,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0
        }}
      >
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          航路规划
        </Typography.Title>
        <Button
          type="text"
          icon={<QuestionCircleOutlined />}
          onClick={() => setShowHelp((v) => !v)}
        >
          帮助
        </Button>
      </div>

      {/* 帮助说明 */}
      {showHelp && (
        <div
          style={{
            padding: "12px 16px",
            background: token.colorInfoBg,
            borderBottom: `1px solid ${token.colorInfoBorder}`
          }}
        >
          <Typography.Title level={5} style={{ margin: "0 0 8px 0" }}>
            航路输入格式说明
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>
            请按照以下格式输入航路：<br />
            <code style={{ background: token.colorFillSecondary, padding: "2px 6px", borderRadius: 4 }}>
              起飞机场ICAO SID名称 核心航路段 STAR名称 落地机场ICAO
            </code>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ margin: "8px 0 0 0" }}>
            <strong>核心航路段格式：</strong>航点和航路交替出现，如 <code>PIMOL G471 VMB A593 BTO</code>
            <br />
            <em>（当前版本仅解析核心航路段，SID/STAR 仅作为标记显示）</em>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ margin: "8px 0 0 0" }}>
            <strong>示例：</strong>
            <code
              style={{
                background: token.colorFillSecondary,
                padding: "2px 6px",
                borderRadius: 4,
                cursor: "pointer"
              }}
              onClick={() => {
                setRouteInput(exampleRoute);
                setShowHelp(false);
              }}
            >
              {exampleRoute}
            </code>
            <span style={{ marginLeft: 8, color: token.colorTextSecondary }}>(点击填充)</span>
          </Typography.Paragraph>
        </div>
      )}

      {/* 状态检查 */}
      {statusLoading ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin tip="检查导航数据库..." />
        </div>
      ) : routeStatus && !routeStatus.available ? (
        <div style={{ padding: 24 }}>
          <Alert
            type="warning"
            showIcon
            message="航路解析功能不可用"
            description={routeStatus.message}
          />
        </div>
      ) : (
        <>
          {/* 输入区 */}
          <div
            style={{
              padding: "12px 16px",
              background: token.colorBgContainer,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              flexShrink: 0
            }}
          >
            <Space.Compact style={{ width: "100%" }}>
              <Input
                size="large"
                placeholder="输入航路，如：ZSPD SHA3P PIMOL G471 VMB A593 BTO STAR2A ZGGG"
                value={routeInput}
                onChange={(e) => setRouteInput(e.target.value)}
                onKeyDown={handleKeyDown}
                prefix={<EnvironmentOutlined style={{ color: token.colorTextSecondary }} />}
                disabled={parsing}
              />
              <Button
                type="primary"
                size="large"
                icon={<SendOutlined />}
                onClick={handleParse}
                loading={parsing}
                disabled={!routeInput.trim()}
              >
                解析
              </Button>
            </Space.Compact>

            {parseError && (
              <Alert
                style={{ marginTop: 12 }}
                type="error"
                showIcon
                message={parseError}
                closable
                onClose={() => setParseError(null)}
              />
            )}
          </div>

          {/* 解析结果信息 */}
          {parseResult && (
            <div
              style={{
                padding: "8px 16px",
                background: token.colorSuccessBg,
                borderBottom: `1px solid ${token.colorSuccessBorder}`,
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                flexShrink: 0
              }}
            >
              <Tag color="red">{parseResult.departure?.ident}</Tag>
              {parseResult.sid && <Tag color="orange">SID: {parseResult.sid}</Tag>}
              <span style={{ color: token.colorTextSecondary }}>→</span>
              <Tag color="blue">{parseResult.points.filter((p) => !p.isAirport && p.isExplicit).length} 个航点</Tag>
              <span style={{ color: token.colorTextSecondary }}>→</span>
              {parseResult.star && <Tag color="orange">STAR: {parseResult.star}</Tag>}
              <Tag color="green">{parseResult.arrival?.ident}</Tag>

              {parseResult.unknownElements.length > 0 && (
                <>
                  <Divider type="vertical" />
                  <span style={{ color: token.colorWarning }}>
                    未识别: {parseResult.unknownElements.join(", ")}
                  </span>
                </>
              )}
            </div>
          )}

          {/* 地图区域 */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <MapContainer
              center={[35, 105]} // 中国中心
              zoom={5}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {parseResult && parseResult.points.length > 0 && (
                <>
                  <FitBounds points={parseResult.points} />

                  {/* 航线 */}
                  <Polyline
                    positions={parseResult.points.map((p) => [p.lat, p.lon])}
                    pathOptions={{
                      color: "#3498db",
                      weight: 3,
                      opacity: 0.8
                    }}
                  />

                  {/* 航点标记 */}
                  {parseResult.points.map((point, idx) => (
                    <Marker
                      key={`${point.ident}-${idx}`}
                      position={[point.lat, point.lon]}
                      icon={getMarkerIcon(point)}
                    >
                      <Tooltip permanent={point.isAirport || point.isExplicit} direction="top" offset={[0, -10]}>
                        <strong>{point.ident}</strong>
                        {point.viaAirway && <span style={{ marginLeft: 4, opacity: 0.7 }}>via {point.viaAirway}</span>}
                      </Tooltip>
                      <Popup>
                        <div>
                          <strong>{point.ident}</strong>
                          {point.name && <div style={{ color: "#666" }}>{point.name}</div>}
                          <div style={{ fontSize: 12, color: "#999" }}>
                            {point.lat.toFixed(4)}°N, {point.lon.toFixed(4)}°E
                          </div>
                          {point.remark && <div style={{ marginTop: 4, color: "#1890ff" }}>{point.remark}</div>}
                          {point.viaAirway && <div style={{ color: "#52c41a" }}>经由航路: {point.viaAirway}</div>}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </>
              )}
            </MapContainer>

            {/* 图例 */}
            <Card
              size="small"
              style={{
                position: "absolute",
                bottom: 20,
                right: 20,
                zIndex: 1000,
                opacity: 0.95
              }}
            >
              <Space direction="vertical" size={4}>
                <Space>
                  <div style={{ width: 14, height: 14, background: "#e74c3c", borderRadius: "50%" }} />
                  <span>机场</span>
                </Space>
                <Space>
                  <div style={{ width: 14, height: 14, background: "#2ecc71", borderRadius: "50%" }} />
                  <span>指定航点</span>
                </Space>
                <Space>
                  <div style={{ width: 14, height: 14, background: "#3498db", borderRadius: "50%" }} />
                  <span>中间航点</span>
                </Space>
                <Space>
                  <div style={{ width: 14, height: 14, background: "#9b59b6", borderRadius: "50%" }} />
                  <span>VOR/NDB</span>
                </Space>
              </Space>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
