/**
 * 航路解析面板组件
 * 输入航路字符串 → 解析 → 显示结果
 * 支持智能填充起/降机场
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  Button,
  Input,
  Alert,
  Space,
  Tag,
  Divider,
  Typography,
  theme
} from "antd";
import { SendOutlined } from "@ant-design/icons";
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
  /** 起飞机场 ICAO（用于智能填充） */
  departureIcao?: string;
  /** 降落机场 ICAO（用于智能填充） */
  arrivalIcao?: string;
}

/**
 * 智能构建完整航路字符串
 * 如果用户输入的航路首尾没有起/降机场，自动补充
 */
function buildFullRoute(input: string, departure: string, arrival: string): {
  fullRoute: string;
  addedDeparture: boolean;
  addedArrival: boolean;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      fullRoute: `${departure} ${arrival}`,
      addedDeparture: true,
      addedArrival: true
    };
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0].toUpperCase();
  const last = parts[parts.length - 1].toUpperCase();

  let result = trimmed;
  let addedDeparture = false;
  let addedArrival = false;

  if (first !== departure.toUpperCase()) {
    result = `${departure} ${result}`;
    addedDeparture = true;
  }
  if (last !== arrival.toUpperCase()) {
    result = `${result} ${arrival}`;
    addedArrival = true;
  }

  return { fullRoute: result, addedDeparture, addedArrival };
}

export function RouteParsePanel({
  onParseSuccess,
  onClear,
  parseResult,
  disabled = false,
  externalRouteInput,
  onExternalInputUsed,
  departureIcao = "",
  arrivalIcao = ""
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

  // 计算智能填充预览
  const fillPreview = useMemo(() => {
    if (!departureIcao || !arrivalIcao) return null;

    const trimmed = routeInput.trim();
    if (!trimmed) {
      return { addedDeparture: true, addedArrival: true };
    }

    const parts = trimmed.split(/\s+/);
    const first = parts[0].toUpperCase();
    const last = parts[parts.length - 1].toUpperCase();

    const addedDeparture = first !== departureIcao.toUpperCase();
    const addedArrival = last !== arrivalIcao.toUpperCase();

    if (!addedDeparture && !addedArrival) return null;
    return { addedDeparture, addedArrival };
  }, [routeInput, departureIcao, arrivalIcao]);

  // 解析航路
  const handleParse = useCallback(async () => {
    if (!routeInput.trim() && !departureIcao && !arrivalIcao) return;

    setParsing(true);
    setParseError(null);

    try {
      // 智能填充起/降机场
      let routeToSend = routeInput.trim();
      if (departureIcao && arrivalIcao) {
        const { fullRoute } = buildFullRoute(routeInput, departureIcao, arrivalIcao);
        routeToSend = fullRoute;
      }

      const result = await apiRouteParse(routeToSend);
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
  }, [routeInput, departureIcao, arrivalIcao, onParseSuccess]);

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

  // 是否可以解析（有输入或有起降机场）
  const canParse = routeInput.trim() || (departureIcao && arrivalIcao);

  return (
    <div>
      {/* 起/降机场提示 */}
      {departureIcao && arrivalIcao && (
        <div style={{ marginBottom: 8 }}>
          <Space size={4}>
            <Tag color="red">{departureIcao}</Tag>
            <span style={{ color: token.colorTextSecondary }}>→</span>
            <Tag color="red">{arrivalIcao}</Tag>
          </Space>
        </div>
      )}

      {/* 输入区 */}
      <div>
        <Input.TextArea
          placeholder={
            departureIcao && arrivalIcao
              ? "输入中间航路（可省略起降机场），如：SID WPT1 G471 WPT2 STAR"
              : "输入航路，如：ZSPD SHA3P PIMOL G471 VMB A593 BTO STAR2A ZGGG"
          }
          value={routeInput}
          onChange={(e) => setRouteInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={parsing || disabled}
          autoSize={{ minRows: 2, maxRows: 6 }}
          style={{ marginBottom: 8 }}
        />
        <Space>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleParse}
            loading={parsing}
            disabled={!canParse || disabled}
          >
            解析
          </Button>
          {parseResult && (
            <Button onClick={handleClear} disabled={disabled}>
              清除
            </Button>
          )}
        </Space>
      </div>

      {/* 智能填充提示 */}
      {fillPreview && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将自动补充：
            {fillPreview.addedDeparture && <Tag color="blue" style={{ marginLeft: 4 }}>起飞 {departureIcao}</Tag>}
            {fillPreview.addedArrival && <Tag color="blue" style={{ marginLeft: 4 }}>降落 {arrivalIcao}</Tag>}
          </Typography.Text>
        </div>
      )}

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
