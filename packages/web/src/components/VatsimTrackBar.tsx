/**
 * VATSIM 追踪控制栏组件
 * 独立的追踪功能，可以在任何模式下叠加显示
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Input,
  Switch,
  Tag,
  Space,
  Button,
  theme,
  Tooltip
} from "antd";
import {
  ImportOutlined,
  AimOutlined
} from "@ant-design/icons";
import { fetchVatsimPilot, type VatsimPilot } from "../api";

export interface VatsimTrackBarProps {
  /** 追踪状态变化时的回调 */
  onPilotUpdate: (pilot: VatsimPilot | null) => void;
  /** 导入航路到解析面板的回调 */
  onImportRoute?: (route: string) => void;
  /** 定位到飞机位置的回调 */
  onLocateAircraft?: () => void;
  /** 当前追踪的飞行员数据 */
  pilot: VatsimPilot | null;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否使用内联模式（无容器样式） */
  inline?: boolean;
}

export function VatsimTrackBar({
  onPilotUpdate,
  onImportRoute,
  onLocateAircraft,
  pilot,
  disabled = false,
  inline = false
}: VatsimTrackBarProps) {
  const { token } = theme.useToken();

  const [trackEnabled, setTrackEnabled] = useState(false);
  const [cidInput, setCidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // VATSIM 数据轮询
  useEffect(() => {
    if (!trackEnabled || !cidInput.trim()) {
      onPilotUpdate(null);
      setError(null);
      return;
    }

    const cidNum = parseInt(cidInput.trim(), 10);
    if (isNaN(cidNum)) {
      setError("CID 必须是数字");
      onPilotUpdate(null);
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await fetchVatsimPilot(cidNum);
        if (cancelled) return;
        if (result) {
          onPilotUpdate(result);
          setError(null);
        } else {
          onPilotUpdate(null);
          setError(`未找到 CID ${cidNum} 的在线用户`);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "获取 VATSIM 数据失败");
        onPilotUpdate(null);
      } finally {
        if (!cancelled) setLoading(false);
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
  }, [trackEnabled, cidInput, onPilotUpdate]);

  // 导入航路
  const handleImportRoute = useCallback(() => {
    if (!pilot?.flight_plan?.route) return;
    const fp = pilot.flight_plan;
    const fullRoute = `${fp.departure} ${fp.route} ${fp.arrival}`;
    onImportRoute?.(fullRoute);
  }, [pilot, onImportRoute]);

  const containerStyle = inline
    ? { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }
    : {
        padding: "8px 16px",
        background: token.colorBgElevated,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap" as const
      };

  return (
    <div style={containerStyle}>
      {/* 追踪开关 */}
      <Space size="small">
        <Tooltip title="开启后将在地图上显示该用户的实时位置">
          <Space size={4}>
            <span style={{ color: token.colorTextSecondary, fontSize: 13, whiteSpace: "nowrap" }}>
              ✈️ VATSIM 追踪
            </span>
            <Switch
              size="small"
              checked={trackEnabled}
              onChange={setTrackEnabled}
              loading={loading}
              disabled={disabled}
            />
          </Space>
        </Tooltip>
      </Space>

      {/* CID 输入 */}
      <Input
        size="small"
        placeholder="CID"
        style={{ width: 100 }}
        value={cidInput}
        onChange={(e) => setCidInput(e.target.value)}
        disabled={!trackEnabled || disabled}
      />

      {/* 在线状态和航班信息 */}
      {pilot && (
        <Space size="small">
          <Tag color="green" style={{ margin: 0 }}>
            {pilot.callsign}
          </Tag>
          <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
            FL{Math.round(pilot.altitude / 100)} | {pilot.groundspeed}kt | {pilot.heading}°
          </span>
          {pilot.flight_plan && (
            <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              {pilot.flight_plan.departure} → {pilot.flight_plan.arrival}
            </span>
          )}
        </Space>
      )}

      {/* 操作按钮 */}
      {pilot && (
        <Space size="small">
          {pilot.flight_plan?.route && onImportRoute && (
            <Tooltip title="导入航路到解析面板">
              <Button
                size="small"
                icon={<ImportOutlined />}
                onClick={handleImportRoute}
                disabled={disabled}
              >
                导入航路
              </Button>
            </Tooltip>
          )}
          {onLocateAircraft && (
            <Tooltip title="定位到飞机位置">
              <Button
                size="small"
                icon={<AimOutlined />}
                onClick={onLocateAircraft}
                disabled={disabled}
              />
            </Tooltip>
          )}
        </Space>
      )}

      {/* 错误信息 */}
      {error && (
        <Tag color="red" style={{ margin: 0 }}>
          {error}
        </Tag>
      )}
    </div>
  );
}
