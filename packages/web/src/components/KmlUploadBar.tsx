/**
 * KML 上传控制栏组件
 * 独立的 KML 上传功能，可以在任何模式下叠加使用
 */
import React, { useState, useCallback, useRef } from "react";
import {
  Button,
  Tag,
  Space,
  theme,
  Tooltip
} from "antd";
import {
  UploadOutlined,
  DeleteOutlined,
  FileTextOutlined
} from "@ant-design/icons";
import {
  apiKmlParse,
  type KmlParseResult
} from "../api";

export interface KmlUploadBarProps {
  /** KML 解析成功后的回调 */
  onKmlParsed: (result: KmlParseResult) => void;
  /** 清除时的回调 */
  onClear: () => void;
  /** 当前 KML 解析结果 */
  kmlResult: KmlParseResult | null;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否使用内联模式（无容器样式） */
  inline?: boolean;
  /** 紧凑模式，用于移动端底部操作条 */
  compact?: boolean;
  /** 紧凑模式下是否显示短文案 */
  showLabels?: boolean;
  /** 底部操作条统一按钮样式 */
  buttonStyle?: React.CSSProperties;
}

export function KmlUploadBar({
  onKmlParsed,
  onClear,
  kmlResult,
  disabled = false,
  inline = false,
  compact = false,
  showLabels = !compact,
  buttonStyle
}: KmlUploadBarProps) {
  const { token } = theme.useToken();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 处理文件选择
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [onKmlParsed]);

  // 触发文件选择
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 清除
  const handleClear = useCallback(() => {
    setError(null);
    onClear();
  }, [onClear]);

  const containerStyle = inline
    ? {
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 8,
        flexWrap: compact ? "nowrap" as const : "wrap" as const,
        flex: compact ? "0 0 auto" : undefined,
        minWidth: 0
      }
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
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".kml,.KML"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* 上传控件 */}
      <Space size={compact ? 4 : "small"}>
        <Tooltip title={compact ? (parsing ? "正在解析 KML" : "导入 KML") : undefined}>
          <Button
            size="small"
            shape={showLabels ? "round" : "circle"}
            icon={<UploadOutlined />}
            onClick={handleUploadClick}
            loading={parsing}
            disabled={disabled}
            aria-label="导入 KML"
            style={buttonStyle ?? { boxShadow: "none" }}
          >
            {showLabels ? (compact ? "KML" : parsing ? "解析中" : "导入 KML") : null}
          </Button>
        </Tooltip>
      </Space>

      {/* KML 信息 */}
      {kmlResult && (
        <Space size={compact ? 4 : "small"}>
          {compact ? (
            <Tooltip title={kmlResult.name || "KML 已导入"}>
              <Tag color="blue" style={{ margin: 0 }}>
                <FileTextOutlined />
              </Tag>
            </Tooltip>
          ) : (
            <Tag color="blue" style={{ margin: 0 }}>
              <FileTextOutlined style={{ marginRight: 4 }} />
              {kmlResult.name || "KML"}
            </Tag>
          )}
          {!compact && <Tag color="cyan" style={{ margin: 0 }}>
            {kmlResult.totalPoints} 点
          </Tag>}
          <Tooltip title="清除 KML">
            <Button
              size="small"
              shape={showLabels ? "round" : "circle"}
              icon={<DeleteOutlined />}
              onClick={handleClear}
              disabled={disabled}
              aria-label="清除 KML"
              style={buttonStyle ?? { boxShadow: "none" }}
            >
              {showLabels ? "清除" : null}
            </Button>
          </Tooltip>
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
