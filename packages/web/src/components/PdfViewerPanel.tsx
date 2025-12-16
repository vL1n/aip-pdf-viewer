import React from "react";
import { Empty } from "antd";
import { SpecialZoomLevel, Viewer, Worker } from "@react-pdf-viewer/core";

export function PdfViewerPanel(props: {
  openedFileId: number | null;
  pdfHref: string | null;
  workerUrl: string;
  plugins: any[];
  isDark: boolean;
  borderRadius: number;
  backgroundLayout: string;
  backgroundContainer: string;
}) {
  const { openedFileId, pdfHref, workerUrl, plugins, isDark, borderRadius, backgroundLayout, backgroundContainer } = props;

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        padding: 8,
        background: backgroundLayout,
        boxSizing: "border-box"
      }}
    >
      {openedFileId && pdfHref ? (
        <div
          style={{
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            borderRadius: borderRadius - 2,
            background: backgroundContainer
          }}
        >
          {/* 让 @react-pdf-viewer 自己管理内部滚动；外层不要再包一层 overflow:auto */}
          <div style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
            <Worker workerUrl={workerUrl}>
              <Viewer
                fileUrl={pdfHref}
                defaultScale={SpecialZoomLevel.PageFit}
                plugins={plugins}
                theme={isDark ? "dark" : "light"}
              />
            </Worker>
          </div>
        </div>
      ) : (
        <div style={{ padding: 24 }}>
          <Empty description="点击左侧文件即可打开" />
        </div>
      )}
    </div>
  );
}


