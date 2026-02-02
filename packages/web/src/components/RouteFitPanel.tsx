/**
 * 航路拟合面板组件
 * 基于 KML 数据进行航路拟合，展示多个候选结果
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
  Empty,
  Progress,
  Switch,
  Divider
} from "antd";
import {
  ThunderboltOutlined,
  DeleteOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  TrophyOutlined
} from "@ant-design/icons";
import {
  apiRouteFit,
  type KmlParseResult,
  type KmlTrackPoint,
  type FitRouteResult,
  type FittedWaypoint,
  type FitCandidate
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
  /** 当前选中的候选索引 */
  selectedCandidateIndex?: number;
  /** 候选索引改变回调 */
  onCandidateIndexChange?: (index: number) => void;
}

export function RouteFitPanel({
  kmlResult,
  onRouteFitted,
  onClear,
  fitResult,
  disabled = false,
  selectedCandidateIndex = 0,
  onCandidateIndexChange
}: RouteFitPanelProps) {
  const { token } = theme.useToken();

  const [fitting, setFitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 基础拟合参数
  const [maxDistanceKm, setMaxDistanceKm] = useState(30);
  const [turnAngleThreshold, setTurnAngleThreshold] = useState(25);
  const [minSegmentDistanceKm, setMinSegmentDistanceKm] = useState(30);
  
  // 高级拟合参数
  const [directionWeight, setDirectionWeight] = useState(30);
  const [distanceWeight, setDistanceWeight] = useState(50);
  const [airwayBonus, setAirwayBonus] = useState(20);
  const [sampleIntervalKm, setSampleIntervalKm] = useState(0);
  const [preferAirways, setPreferAirways] = useState(false);

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
        turnAngleThreshold,
        minSegmentDistanceKm,
        maxCandidates: 3,
        directionWeight,
        distanceWeight,
        airwayBonus,
        sampleIntervalKm,
        preferAirways
      });

      if (result.success) {
        onRouteFitted(result);
        onCandidateIndexChange?.(0); // 重置选中索引
      } else {
        setError(result.error || "拟合航路失败");
      }
    } catch (err: any) {
      setError(err?.message || "拟合请求失败");
    } finally {
      setFitting(false);
    }
  }, [kmlResult, maxDistanceKm, turnAngleThreshold, minSegmentDistanceKm, directionWeight, distanceWeight, airwayBonus, sampleIntervalKm, preferAirways, onRouteFitted, onCandidateIndexChange]);

  // 清除
  const handleClear = useCallback(() => {
    setError(null);
    onClear();
  }, [onClear]);

  // 获取分数颜色
  const getScoreColor = (score: number) => {
    if (score >= 80) return token.colorSuccess;
    if (score >= 60) return token.colorWarning;
    return token.colorError;
  };

  // 获取分数标签
  const getScoreLabel = (score: number) => {
    if (score >= 80) return "优秀";
    if (score >= 60) return "良好";
    if (score >= 40) return "一般";
    return "较差";
  };

  // 渲染单个候选结果
  const renderCandidate = (candidate: FitCandidate, index: number, isSelected: boolean) => {
    const isFirst = index === 0;
    
    return (
      <div
        key={index}
        onClick={() => onCandidateIndexChange?.(index)}
        style={{
          padding: "12px",
          background: isSelected ? token.colorSuccessBg : token.colorBgContainer,
          borderRadius: token.borderRadius,
          border: `1px solid ${isSelected ? token.colorSuccessBorder : token.colorBorderSecondary}`,
          cursor: "pointer",
          transition: "all 0.2s",
          marginBottom: index < (fitResult?.candidates.length || 0) - 1 ? 8 : 0
        }}
      >
        {/* 标题行 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {isFirst && (
            <Tag color="gold" icon={<TrophyOutlined />} style={{ margin: 0 }}>
              最佳
            </Tag>
          )}
          {isSelected && !isFirst && (
            <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
              已选
            </Tag>
          )}
          <Tag color="blue" style={{ margin: 0 }}>
            方案 {index + 1}
          </Tag>
          
          {/* 分数 */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <Progress
              type="circle"
              percent={candidate.score}
              size={36}
              strokeColor={getScoreColor(candidate.score)}
              format={(percent) => `${percent}`}
            />
            <Typography.Text style={{ fontSize: 11, color: getScoreColor(candidate.score) }}>
              {getScoreLabel(candidate.score)}
            </Typography.Text>
          </div>
        </div>

        {/* 航路字符串 */}
        <div style={{ marginBottom: 8 }}>
          <Typography.Text
            copyable={isSelected}
            style={{ fontSize: 13, wordBreak: "break-all" }}
          >
            {candidate.routeString}
          </Typography.Text>
        </div>

        {/* 航点可视化（仅选中时展开） */}
        {isSelected && (
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
            {candidate.waypoints.map((wp: FittedWaypoint, idx: number) => (
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
        )}
      </div>
    );
  };

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
            key: "basic",
            label: (
              <Space>
                <SettingOutlined />
                <span>基础参数</span>
              </Space>
            ),
            children: (
              <div style={{ padding: "0 8px" }}>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    最大匹配距离：{maxDistanceKm} 公里
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    航点搜索半径，越大找到的航点越多
                  </Typography.Text>
                  <Slider
                    min={10}
                    max={100}
                    value={maxDistanceKm}
                    onChange={setMaxDistanceKm}
                    disabled={fitting || disabled}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    转折点检测阈值：{turnAngleThreshold}°
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    航向变化超过此角度视为转折点，越小检测越敏感
                  </Typography.Text>
                  <Slider
                    min={10}
                    max={60}
                    value={turnAngleThreshold}
                    onChange={setTurnAngleThreshold}
                    disabled={fitting || disabled}
                  />
                </div>
                <div>
                  <Typography.Text style={{ fontSize: 12 }}>
                    最小航段距离：{minSegmentDistanceKm} 公里
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    过短的航段会被合并
                  </Typography.Text>
                  <Slider
                    min={10}
                    max={100}
                    value={minSegmentDistanceKm}
                    onChange={setMinSegmentDistanceKm}
                    disabled={fitting || disabled}
                  />
                </div>
              </div>
            )
          },
          {
            key: "advanced",
            label: (
              <Space>
                <SettingOutlined />
                <span>高级参数</span>
              </Space>
            ),
            children: (
              <div style={{ padding: "0 8px" }}>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    采样间隔：{sampleIntervalKm === 0 ? "不采样" : `${sampleIntervalKm} 公里`}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    对航迹进行预处理，减少噪声干扰
                  </Typography.Text>
                  <Slider
                    min={0}
                    max={50}
                    step={5}
                    value={sampleIntervalKm}
                    onChange={setSampleIntervalKm}
                    disabled={fitting || disabled}
                    marks={{ 0: "关", 10: "10", 25: "25", 50: "50" }}
                  />
                </div>

                <Divider style={{ margin: "12px 0" }} />
                
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    方向权重：{directionWeight}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    航路方向与航迹方向匹配的重要性
                  </Typography.Text>
                  <Slider
                    min={0}
                    max={100}
                    value={directionWeight}
                    onChange={setDirectionWeight}
                    disabled={fitting || disabled}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    距离权重：{distanceWeight}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    航点与航迹距离匹配的重要性
                  </Typography.Text>
                  <Slider
                    min={0}
                    max={100}
                    value={distanceWeight}
                    onChange={setDistanceWeight}
                    disabled={fitting || disabled}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    航路加分：{airwayBonus}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 10, display: "block" }}>
                    使用航路连接时的额外加分，越高越倾向使用航路
                  </Typography.Text>
                  <Slider
                    min={0}
                    max={50}
                    value={airwayBonus}
                    onChange={setAirwayBonus}
                    disabled={fitting || disabled}
                  />
                </div>

                <Divider style={{ margin: "12px 0" }} />
                
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Switch
                    size="small"
                    checked={preferAirways}
                    onChange={setPreferAirways}
                    disabled={fitting || disabled}
                  />
                  <Typography.Text style={{ fontSize: 12 }}>
                    优先使用航路
                  </Typography.Text>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 4 }}>
                  开启后会尽量避免直飞，优先匹配有航路的路径
                </Typography.Text>
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

      {/* 拟合结果 - 多候选展示 */}
      {fitResult && fitResult.candidates && fitResult.candidates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <Space size="middle">
              <Typography.Text strong style={{ fontSize: 14 }}>
                拟合结果
              </Typography.Text>
              <Tag color="green">{fitResult.candidates.length} 个候选</Tag>
              <Typography.Text style={{ fontSize: 12 }}>
                采样点: {fitResult.sampledPointsCount}
              </Typography.Text>
            </Space>
          </div>

          {/* 候选列表 */}
          <div>
            {fitResult.candidates.map((candidate, index) => 
              renderCandidate(candidate, index, index === selectedCandidateIndex)
            )}
          </div>
        </div>
      )}

      {/* 向后兼容：如果没有 candidates 但有 waypoints */}
      {fitResult && (!fitResult.candidates || fitResult.candidates.length === 0) && fitResult.waypoints.length > 0 && (
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
