/**
 * 航路拟合面板组件
 * 基于 KML 数据进行航路拟合
 */
import React, { useState, useCallback } from "react";
import {
  Button,
  Alert,
  Space,
  Tag,
  Typography,
  Slider,
  Collapse,
  theme,
  Empty
} from "antd";
import {
  ThunderboltOutlined,
  DeleteOutlined,
  SettingOutlined
} from "@ant-design/icons";
import {
  apiRouteFit,
  type KmlParseResult,
  type KmlTrackPoint,
  type FitRouteResult,
  type FittedWaypoint
} from "../api";

export interface RouteFitPanelProps {
  /** KML 解析结果（作为拟合数据源） */
  kmlResult: KmlParseResult | null;
  /** 航路拟合成功后的回调 */
  onRouteFitted: (result: FitRouteResult) => void;
  /** 清除时的回调 */
  onClear: () => void;
  /** 当前拟合结果 */
  fitResult: FitRouteResult | null;
  /** 是否禁用 */
  disabled?: boolean;
}

export function RouteFitPanel({
  kmlResult,
  onRouteFitted,
  onClear,
  fitResult,
  disabled = false
}: RouteFitPanelProps) {
  const { token } = theme.useToken();

  const [fitting, setFitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 拟合参数
  const [maxDistanceKm, setMaxDistanceKm] = useState(30);
  const [sampleIntervalKm, setSampleIntervalKm] = useState(50);

  // 拟合航路
  const handleFit = useCallback(async () => {
    if (!kmlResult || kmlResult.points.length < 2) return;

    setFitting(true);
    setError(null);

    try {
      const points = kmlResult.points.map((p: KmlTrackPoint) => ({
        lat: p.lat,
        lon: p.lon,
        altitude: p.altitude
      }));

      const result = await apiRouteFit(points, {
        maxDistanceKm,
        sampleIntervalKm,
        useAirways: true
      });

      if (result.success) {
        onRouteFitted(result);
      } else {
        setError(result.error || "拟合航路失败");
      }
    } catch (err: any) {
      setError(err?.message || "拟合请求失败");
    } finally {
      setFitting(false);
    }
  }, [kmlResult, maxDistanceKm, sampleIntervalKm, onRouteFitted]);

  // 清除
  const handleClear = useCallback(() => {
    setError(null);
    onClear();
  }, [onClear]);

  // 如果没有 KML 数据，显示提示
  if (!kmlResult) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="请先在顶部导入 KML 文件"
        style={{ padding: "40px 0" }}
      />
    );
  }

  return (
    <div>
      {/* 操作按钮 */}
      <Space wrap>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleFit}
          loading={fitting}
          disabled={disabled || kmlResult.points.length < 2}
          style={{ background: token.colorSuccess }}
        >
          {fitting ? "拟合中..." : "拟合航路"}
        </Button>
        {fitResult && (
          <Button
            icon={<DeleteOutlined />}
            onClick={handleClear}
            disabled={disabled}
          >
            清除拟合结果
          </Button>
        )}
      </Space>

      {/* 拟合参数 */}
      <Collapse
        ghost
        size="small"
        style={{ marginTop: 12 }}
        items={[
          {
            key: "settings",
            label: (
              <Space>
                <SettingOutlined />
                <span>拟合参数</span>
              </Space>
            ),
            children: (
              <div style={{ padding: "0 8px" }}>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    最大匹配距离：{maxDistanceKm} 公里
                  </Typography.Text>
                  <Slider
                    min={10}
                    max={100}
                    value={maxDistanceKm}
                    onChange={setMaxDistanceKm}
                    disabled={fitting || disabled}
                  />
                </div>
                <div>
                  <Typography.Text style={{ fontSize: 12 }}>
                    采样间隔：{sampleIntervalKm} 公里
                  </Typography.Text>
                  <Slider
                    min={10}
                    max={200}
                    value={sampleIntervalKm}
                    onChange={setSampleIntervalKm}
                    disabled={fitting || disabled}
                  />
                </div>
              </div>
            )
          }
        ]}
      />

      {/* 错误信息 */}
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

      {/* 拟合结果 */}
      {fitResult && (
        <div
          style={{
            marginTop: 12,
            padding: "12px",
            background: token.colorSuccessBg,
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorSuccessBorder}`
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <Space size="middle">
              <Tag color="green">{fitResult.matchedWaypointsCount} 个航点</Tag>
              <Typography.Text style={{ fontSize: 12 }}>
                采样点: {fitResult.sampledPointsCount}
              </Typography.Text>
            </Space>
          </div>
          
          <div style={{ marginBottom: 8 }}>
            <Typography.Text strong style={{ fontSize: 12 }}>拟合航路：</Typography.Text>
            <Typography.Text copyable style={{ fontSize: 13, display: "block", marginTop: 4 }}>
              {fitResult.routeString}
            </Typography.Text>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              overflowX: "auto",
              paddingTop: 8,
              borderTop: `1px solid ${token.colorBorderSecondary}`
            }}
          >
            {fitResult.waypoints.map((wp: FittedWaypoint, idx: number) => (
              <React.Fragment key={`${wp.ident}-${idx}`}>
                {idx > 0 && wp.viaAirway && (
                  <Tag color="cyan" style={{ margin: 0, fontSize: 10 }}>
                    {wp.viaAirway}
                  </Tag>
                )}
                {idx > 0 && (
                  <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>→</span>
                )}
                <Tag
                  color={wp.isAirport ? "red" : wp.type === "navaid" ? "purple" : "blue"}
                  style={{ margin: 0 }}
                >
                  {wp.ident}
                </Tag>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
