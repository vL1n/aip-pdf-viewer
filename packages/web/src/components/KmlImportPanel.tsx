/**
 * KML 导入面板组件
 * 上传 KML 文件 → 解析航迹 → 拟合航路
 */
import React, { useState, useCallback, useRef } from "react";
import {
  Button,
  Alert,
  Space,
  Tag,
  Typography,
  Spin,
  Slider,
  Collapse,
  theme
} from "antd";
import {
  UploadOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  SettingOutlined
} from "@ant-design/icons";
import {
  apiKmlParse,
  apiRouteFit,
  type KmlParseResult,
  type KmlTrackPoint,
  type FitRouteResult,
  type FittedWaypoint
} from "../api";

export interface KmlImportPanelProps {
  /** KML 解析成功后的回调 */
  onKmlParsed: (result: KmlParseResult) => void;
  /** 航路拟合成功后的回调 */
  onRouteFitted: (result: FitRouteResult) => void;
  /** 清除时的回调 */
  onClear: () => void;
  /** 当前 KML 解析结果 */
  kmlResult: KmlParseResult | null;
  /** 当前拟合结果 */
  fitResult: FitRouteResult | null;
  /** 是否禁用 */
  disabled?: boolean;
}

export function KmlImportPanel({
  onKmlParsed,
  onRouteFitted,
  onClear,
  kmlResult,
  fitResult,
  disabled = false
}: KmlImportPanelProps) {
  const { token } = theme.useToken();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 拟合参数
  const [maxDistanceKm, setMaxDistanceKm] = useState(30);
  const [sampleIntervalKm, setSampleIntervalKm] = useState(50);

  // 处理文件选择
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 重置状态
    setError(null);
    setParsing(true);

    try {
      const content = await file.text();
      const result = await apiKmlParse(content);

      if (result.success) {
        onKmlParsed(result);
      } else {
        setError(result.error || "解析 KML 文件失败");
      }
    } catch (err: any) {
      setError(err?.message || "读取文件失败");
    } finally {
      setParsing(false);
      // 重置 input 以便可以重复选择同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [onKmlParsed]);

  // 触发文件选择
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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

  return (
    <div>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".kml,.KML"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* 上传按钮区 */}
      <Space wrap>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          loading={parsing}
          disabled={disabled}
        >
          {parsing ? "解析中..." : "选择 KML 文件"}
        </Button>

        {kmlResult && (
          <>
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
            <Button
              icon={<DeleteOutlined />}
              onClick={handleClear}
              disabled={disabled}
            >
              清除
            </Button>
          </>
        )}
      </Space>

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

      {/* KML 信息 */}
      {kmlResult && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: token.colorInfoBg,
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorInfoBorder}`
          }}
        >
          <Space size="middle">
            {kmlResult.name && (
              <span>
                <strong>航班：</strong>{kmlResult.name}
              </span>
            )}
            <Tag color="blue">{kmlResult.totalPoints} 个航迹点</Tag>
          </Space>
        </div>
      )}

      {/* 拟合参数 */}
      {kmlResult && (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
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
      )}

      {/* 拟合结果 */}
      {fitResult && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: token.colorSuccessBg,
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorSuccessBorder}`
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <Space size="middle">
              <Tag color="green">{fitResult.matchedWaypointsCount} 个航点</Tag>
              <Typography.Text copyable style={{ fontSize: 12 }}>
                {fitResult.routeString}
              </Typography.Text>
            </Space>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              overflowX: "auto"
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
