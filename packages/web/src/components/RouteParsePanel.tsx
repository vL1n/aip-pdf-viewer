/**
 * 航路解析面板组件
 * 输入航路字符串 → 解析 → 显示结果
 */
import React, { useState, useCallback } from "react";
import {
  Button,
  Input,
  Alert,
  Space,
  Tag,
  Divider,
  theme
} from "antd";
import {
  EnvironmentOutlined,
  SendOutlined
} from "@ant-design/icons";
import { apiRouteParse, type ParsedRoute, type ParsedRoutePoint } from "../api";

export interface RouteParsePanelProps {
  /** 解析成功后的回调，返回解析结果 */
  onParseSuccess: (result: ParsedRoute) => void;
  /** 解析结果清除时的回调 */
  onClear: () => void;
  /** 当前解析结果（受控） */
  parseResult: ParsedRoute | null;
  /** 是否禁用 */
  disabled?: boolean;
  /** 外部设置的航路输入值 */
  externalRouteInput?: string;
  /** 清除外部输入标记 */
  onExternalInputUsed?: () => void;
}

export function RouteParsePanel({
  onParseSuccess,
  onClear,
  parseResult,
  disabled = false,
  externalRouteInput,
  onExternalInputUsed
}: RouteParsePanelProps) {
  const { token } = theme.useToken();

  const [routeInput, setRouteInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // 处理外部输入
  React.useEffect(() => {
    if (externalRouteInput && externalRouteInput !== routeInput) {
      setRouteInput(externalRouteInput);
      onExternalInputUsed?.();
    }
  }, [externalRouteInput, routeInput, onExternalInputUsed]);

  // 解析航路
  const handleParse = useCallback(async () => {
    if (!routeInput.trim()) return;

    setParsing(true);
    setParseError(null);

    try {
      const result = await apiRouteParse(routeInput);
      if (result.success) {
        onParseSuccess(result);
      } else {
        setParseError(result.error || "解析失败");
      }
    } catch (e: any) {
      setParseError(e?.message || "解析请求失败");
    } finally {
      setParsing(false);
    }
  }, [routeInput, onParseSuccess]);

  // 清除
  const handleClear = useCallback(() => {
    setRouteInput("");
    setParseError(null);
    onClear();
  }, [onClear]);

  // 回车提交
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
  };

  return (
    <div>
      {/* 输入区 */}
      <Space.Compact style={{ width: "100%" }}>
        <Input
          size="large"
          placeholder="输入航路，如：ZSPD SHA3P PIMOL G471 VMB A593 BTO STAR2A ZGGG"
          value={routeInput}
          onChange={(e) => setRouteInput(e.target.value)}
          onKeyDown={handleKeyDown}
          prefix={<EnvironmentOutlined style={{ color: token.colorTextSecondary }} />}
          disabled={parsing || disabled}
        />
        <Button
          type="primary"
          size="large"
          icon={<SendOutlined />}
          onClick={handleParse}
          loading={parsing}
          disabled={!routeInput.trim() || disabled}
        >
          解析
        </Button>
        {parseResult && (
          <Button size="large" onClick={handleClear} disabled={disabled}>
            清除
          </Button>
        )}
      </Space.Compact>

      {/* 错误信息 */}
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

      {/* 解析结果信息 */}
      {parseResult && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: token.colorSuccessBg,
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorSuccessBorder}`,
            overflowX: "auto"
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
            {parseResult.points.map((point: ParsedRoutePoint, idx: number) => (
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
    </div>
  );
}
