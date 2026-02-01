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
  Card,
  Switch,
  Tooltip as AntTooltip
} from "antd";
import {
  EnvironmentOutlined,
  SendOutlined,
  ArrowLeftOutlined,
  QuestionCircleOutlined,
  UnorderedListOutlined,
  CloseOutlined,
  ImportOutlined,
  AimOutlined,
  FullscreenOutlined
} from "@ant-design/icons";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { apiRouteParse, apiRouteStatus, fetchVatsimPilot, type ParsedRoute, type ParsedRoutePoint, type RouteStatus, type VatsimPilot } from "../api";

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

const airportIcon = createIcon("#e74c3c", 14); // 红色 - 机场
const waypointIcon = createIcon("#3498db", 8); // 蓝色 - 航点
const navaidIcon = createIcon("#9b59b6", 10); // 紫色 - 导航台
const explicitWaypointIcon = createIcon("#2ecc71", 10); // 绿色 - 用户指定航点

// 创建飞机图标（带朝向）
const createAircraftIcon = (heading: number) => {
  return L.divIcon({
    className: "aircraft-marker",
    html: `<div style="
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: rotate(${heading}deg);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    ">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="#f39c12" stroke="#fff" stroke-width="0.5">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
};

/** 根据航点类型获取图标 */
function getMarkerIcon(point: ParsedRoutePoint) {
  if (point.isAirport) return airportIcon;
  if (point.type === "navaid") return navaidIcon;
  if (point.isExplicit) return explicitWaypointIcon;
  return waypointIcon;
}

/** 自动调整地图视野的组件 */
function FitBounds({ points, trigger }: { points: ParsedRoutePoint[]; trigger: number }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;

    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [map, points, trigger]);

  return null;
}

/** 跟随 VATSIM 飞机位置的组件 */
function FollowAircraft({ pilot, enabled, centerTrigger }: { pilot: VatsimPilot | null; enabled: boolean; centerTrigger: number }) {
  const map = useMap();
  const [hasInitialCenter, setHasInitialCenter] = useState(false);
  const [lastTrigger, setLastTrigger] = useState(0);

  useEffect(() => {
    if (!enabled || !pilot) {
      setHasInitialCenter(false);
      return;
    }

    // 首次追踪时居中并设置缩放级别
    if (!hasInitialCenter) {
      map.setView([pilot.latitude, pilot.longitude], 8);
      setHasInitialCenter(true);
    }
  }, [map, pilot, enabled, hasInitialCenter]);

  // 手动触发居中
  useEffect(() => {
    if (centerTrigger > lastTrigger && pilot) {
      map.setView([pilot.latitude, pilot.longitude], 8);
      setLastTrigger(centerTrigger);
    }
  }, [map, pilot, centerTrigger, lastTrigger]);

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
  const [showLegend, setShowLegend] = useState(false);
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);
  const [vatsimCenterTrigger, setVatsimCenterTrigger] = useState(0);

  // VATSIM 追踪状态
  const [trackVatsim, setTrackVatsim] = useState(false);
  const [vatsimCid, setVatsimCid] = useState("");
  const [vatsimPilot, setVatsimPilot] = useState<VatsimPilot | null>(null);
  const [vatsimError, setVatsimError] = useState<string | null>(null);
  const [vatsimLoading, setVatsimLoading] = useState(false);

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

  // VATSIM 数据轮询
  useEffect(() => {
    if (!trackVatsim || !vatsimCid.trim()) {
      setVatsimPilot(null);
      setVatsimError(null);
      return;
    }

    const cidNum = parseInt(vatsimCid.trim(), 10);
    if (isNaN(cidNum)) {
      setVatsimError("CID 必须是数字");
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      setVatsimLoading(true);
      try {
        const pilot = await fetchVatsimPilot(cidNum);
        if (cancelled) return;
        if (pilot) {
          setVatsimPilot(pilot);
          setVatsimError(null);
        } else {
          setVatsimPilot(null);
          setVatsimError(`未找到 CID ${cidNum} 的在线用户`);
        }
      } catch (e: any) {
        if (cancelled) return;
        setVatsimError(e?.message || "获取 VATSIM 数据失败");
      } finally {
        if (!cancelled) setVatsimLoading(false);
      }
    };

    // 立即获取一次
    fetchData();

    // 每 3 秒轮询
    const interval = setInterval(fetchData, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [trackVatsim, vatsimCid]);

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

        {/* 右侧空间推开 */}
        <div style={{ flex: 1 }} />

        {/* VATSIM 追踪控件 */}
        <Space size="small">
          <AntTooltip title="开启后将在地图上显示该用户的实时位置">
            <Space size={4}>
              <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>追踪 VATSIM</span>
              <Switch
                size="small"
                checked={trackVatsim}
                onChange={setTrackVatsim}
                loading={vatsimLoading}
              />
            </Space>
          </AntTooltip>
          <Input
            size="small"
            placeholder="CID"
            style={{ width: 100 }}
            value={vatsimCid}
            onChange={(e) => setVatsimCid(e.target.value)}
            disabled={!trackVatsim}
          />
          {vatsimPilot && (
            <>
              <Tag color="green" style={{ margin: 0 }}>
                {vatsimPilot.callsign}
              </Tag>
              {vatsimPilot.flight_plan && vatsimPilot.flight_plan.route && (
                <AntTooltip title="导入航路到输入框">
                  <Button
                    size="small"
                    icon={<ImportOutlined />}
                    onClick={() => {
                      const fp = vatsimPilot.flight_plan!;
                      // 组合完整航路：起飞机场 + 航路 + 落地机场
                      const fullRoute = `${fp.departure} ${fp.route} ${fp.arrival}`;
                      setRouteInput(fullRoute);
                    }}
                  >
                    导入航路
                  </Button>
                </AntTooltip>
              )}
            </>
          )}
          {vatsimError && (
            <Tag color="red" style={{ margin: 0 }}>
              {vatsimError}
            </Tag>
          )}
        </Space>

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
                overflowX: "auto",
                flexShrink: 0
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  whiteSpace: "nowrap"
                }}
              >
                {parseResult.points.map((point, idx) => (
                  <React.Fragment key={`${point.ident}-${idx}`}>
                    {idx > 0 && (
                      <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>→</span>
                    )}
                    <Tag
                      color={point.isAirport ? "red" : point.isExplicit ? "blue" : "default"}
                      style={{ margin: 0 }}
                    >
                      {point.ident}
                    </Tag>
                  </React.Fragment>
                ))}

                {parseResult.unknownElements.length > 0 && (
                  <>
                    <Divider type="vertical" />
                    <span style={{ color: token.colorWarning, fontSize: 12 }}>
                      未识别: {parseResult.unknownElements.join(", ")}
                    </span>
                  </>
                )}
              </div>
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

              {/* 跟随 VATSIM 飞机 */}
              <FollowAircraft pilot={vatsimPilot} enabled={trackVatsim} centerTrigger={vatsimCenterTrigger} />

              {/* VATSIM 飞机标记 */}
              {vatsimPilot && (
                <Marker
                  position={[vatsimPilot.latitude, vatsimPilot.longitude]}
                  icon={createAircraftIcon(vatsimPilot.heading)}
                  zIndexOffset={1000}
                >
                  <Tooltip permanent direction="top" offset={[0, -16]}>
                    <strong>{vatsimPilot.callsign}</strong>
                  </Tooltip>
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                        {vatsimPilot.callsign}
                      </div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        <div>CID: {vatsimPilot.cid}</div>
                        <div>高度: {vatsimPilot.altitude} ft</div>
                        <div>地速: {vatsimPilot.groundspeed} kts</div>
                        <div>航向: {vatsimPilot.heading}°</div>
                        {vatsimPilot.flight_plan && (
                          <>
                            <div style={{ marginTop: 4, borderTop: "1px solid #eee", paddingTop: 4 }}>
                              <div>{vatsimPilot.flight_plan.departure} → {vatsimPilot.flight_plan.arrival}</div>
                              <div>机型: {vatsimPilot.flight_plan.aircraft_short}</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )}

              {parseResult && parseResult.points.length > 0 && (
                <>
                  <FitBounds points={parseResult.points} trigger={fitBoundsTrigger} />

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
                      <Tooltip permanent={point.isAirport} direction="top" offset={[0, -10]}>
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

            {/* 地图控制按钮 */}
            <div
              style={{
                position: "absolute",
                bottom: 20,
                right: 20,
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 8
              }}
            >
              {/* 定位到 VATSIM 位置按钮 */}
              {vatsimPilot && (
                <AntTooltip title="定位到 VATSIM 位置" placement="left">
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<AimOutlined />}
                    onClick={() => setVatsimCenterTrigger((v) => v + 1)}
                    style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                  />
                </AntTooltip>
              )}

              {/* 航路居中按钮 */}
              {parseResult && parseResult.points.length > 0 && (
                <AntTooltip title="航路居中" placement="left">
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<FullscreenOutlined />}
                    onClick={() => setFitBoundsTrigger((v) => v + 1)}
                    style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                  />
                </AntTooltip>
              )}

              {/* 图例 */}
              {showLegend ? (
                <Card
                  size="small"
                  style={{ opacity: 0.95 }}
                  title={
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12 }}>图例</span>
                      <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setShowLegend(false)} style={{ marginRight: -8 }} />
                    </div>
                  }
                  styles={{ header: { minHeight: 32, padding: "0 12px" }, body: { padding: "8px 12px" } }}
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
                    {vatsimPilot && (
                      <Space>
                        <div style={{ width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="#f39c12">
                            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                          </svg>
                        </div>
                        <span>VATSIM</span>
                      </Space>
                    )}
                  </Space>
                </Card>
              ) : (
                <Button
                  type="primary"
                  shape="circle"
                  icon={<UnorderedListOutlined />}
                  onClick={() => setShowLegend(true)}
                  style={{ opacity: 0.9, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
