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
}

export function KmlUploadBar({
  onKmlParsed,
  onClear,
  kmlResult,
  disabled = false,
  inline = false
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
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".kml,.KML"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* 上传控件 */}
      <Space size="small">
        <span style={{ color: token.colorTextSecondary, fontSize: 13, whiteSpace: "nowrap" }}>
          📁 KML 导入
        </span>
        <Button
          size="small"
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          loading={parsing}
          disabled={disabled}
        >
          {parsing ? "解析中..." : "选择文件"}
        </Button>
      </Space>

      {/* KML 信息 */}
      {kmlResult && (
        <Space size="small">
          <Tag color="blue" style={{ margin: 0 }}>
            <FileTextOutlined style={{ marginRight: 4 }} />
            {kmlResult.name || "KML"}
          </Tag>
          <Tag color="cyan" style={{ margin: 0 }}>
            {kmlResult.totalPoints} 点
          </Tag>
          <Tooltip title="清除 KML">
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              onClick={handleClear}
              disabled={disabled}
            />
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
