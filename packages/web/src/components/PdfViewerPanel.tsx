import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty } from "antd";
import { SpecialZoomLevel, Viewer, Worker } from "@react-pdf-viewer/core";
import { zoomPlugin } from "@react-pdf-viewer/zoom";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const WHEEL_DELTA_FACTOR = 0.002;

function distance(
  touches: { length: number; 0?: { clientX: number; clientY: number }; 1?: { clientX: number; clientY: number } }
): number {
  if (touches.length < 2) return 0;
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return 0;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

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
  const { openedFileId, pdfHref, workerUrl, plugins, isDark, backgroundLayout } = props;

  // 必须在顶层无条件调用，否则 zoomPlugin 内部的 Hooks 会违反 React 规则
  const zoomPluginInstance = zoomPlugin();
  const zoomPluginStableRef = useRef(zoomPluginInstance);
  zoomPluginStableRef.current = zoomPluginInstance;
  const zoomTo = zoomPluginInstance.zoomTo;
  const allPlugins = useMemo(
    () => [...plugins, zoomPluginStableRef.current],
    [plugins]
  );

  const scaleRef = useRef(1);
  const [pinchState, setPinchState] = useState<{ initialDistance: number; initialScale: number } | null>(null);
  const pinchStateRef = useRef(pinchState);
  pinchStateRef.current = pinchState;
  const containerRef = useRef<HTMLDivElement>(null);

  const clampScale = useCallback((s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)), []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!openedFileId || !pdfHref) return;
      e.preventDefault();
      const delta = -e.deltaY * WHEEL_DELTA_FACTOR;
      const next = clampScale(scaleRef.current * (1 + delta));
      scaleRef.current = next;
      zoomTo(next);
    },
    [openedFileId, pdfHref, zoomTo, clampScale]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return;
      setPinchState({
        initialDistance: distance(e.touches),
        initialScale: scaleRef.current
      });
    },
    []
  );

  const handleTouchMoveRef = useRef<(e: TouchEvent) => void>(() => {});
  handleTouchMoveRef.current = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    const state = pinchStateRef.current;
    if (!state) return;
    e.preventDefault();
    const d = distance(e.touches);
    if (d <= 0) return;
    const ratio = d / state.initialDistance;
    const next = clampScale(state.initialScale * ratio);
    scaleRef.current = next;
    zoomTo(next);
  };

  const hasPdf = Boolean(openedFileId && pdfHref);

  useEffect(() => {
    if (!hasPdf) return;
    const el = containerRef.current;
    if (!el) return;

    const onTouchMove = (e: TouchEvent) => handleTouchMoveRef.current(e);
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    // Safari iOS：双指刚接触时就阻止默认，避免页面跟随缩放
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: false });

    // Safari / WebKit：阻止系统手势（双指缩放页面）
    const preventGesture = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", preventGesture);
    el.addEventListener("gesturechange", preventGesture);
    el.addEventListener("gestureend", preventGesture);

    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("gesturestart", preventGesture);
      el.removeEventListener("gesturechange", preventGesture);
      el.removeEventListener("gestureend", preventGesture);
    };
  }, [hasPdf]);

  const handleTouchEnd = useCallback(() => {
    setPinchState(null);
  }, []);

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: backgroundLayout
      }}
    >
      {openedFileId && pdfHref ? (
        <div
          ref={containerRef}
          style={{
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            // 禁止浏览器在该区域解释双指为页面缩放，仅我们自己做 PDF 缩放
            touchAction: "pan-x pan-y"
          }}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={(e) => {
            if (e.touches.length !== 2) setPinchState(null);
          }}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <Worker workerUrl={workerUrl}>
            <Viewer
              fileUrl={pdfHref}
              defaultScale={SpecialZoomLevel.PageFit}
              plugins={allPlugins}
              theme={isDark ? "dark" : "light"}
            />
          </Worker>
        </div>
      ) : (
        <div style={{ padding: 24 }}>
          <Empty description="点击左侧文件即可打开" />
        </div>
      )}
    </div>
  );
}
