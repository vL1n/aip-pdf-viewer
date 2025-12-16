import React from "react";
import { Alert, Progress, Space, Typography } from "antd";
import type { IndexStatus } from "../api";

export function IndexStatusBar(props: {
  indexStatus: IndexStatus | null;
  apiConnectError: string | null;
  progressPercent: number;
  borderColor: string;
  background: string;
}) {
  const { indexStatus, apiConnectError, progressPercent, borderColor, background } = props;

  return (
    <div style={{ flex: "0 0 auto", padding: 12, borderBottom: `1px solid ${borderColor}`, background }}>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        {apiConnectError ? <Alert type="error" showIcon message={apiConnectError} /> : null}
        <Alert
          type={indexStatus?.phase === "error" ? "error" : "info"}
          message={indexStatus?.phase === "error" ? "索引失败" : "正在构建索引…"}
          description={
            <Space wrap>
              <Typography.Text>{indexStatus?.message || "请稍候"}</Typography.Text>
              {indexStatus?.totalPdfs != null ? (
                <Typography.Text className="mono">
                  {Math.min(indexStatus.processedPdfs, indexStatus.totalPdfs)}/{indexStatus.totalPdfs}
                </Typography.Text>
              ) : null}
            </Space>
          }
          showIcon
        />
        <Progress percent={progressPercent} status={indexStatus?.phase === "error" ? "exception" : "active"} />
        {indexStatus?.phase === "error" && indexStatus.lastError ? (
          <Typography.Paragraph style={{ margin: 0 }} type="danger">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{indexStatus.lastError}</pre>
          </Typography.Paragraph>
        ) : null}
      </Space>
    </div>
  );
}


