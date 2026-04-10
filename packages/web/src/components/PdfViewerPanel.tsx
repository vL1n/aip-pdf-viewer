import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Popconfirm, Space, Tag, Tooltip, message } from "antd";
import type { Plugin } from "@react-pdf-viewer/core";
import { SpecialZoomLevel, Viewer, Worker } from "@react-pdf-viewer/core";
import { zoomPlugin } from "@react-pdf-viewer/zoom";

import {
  apiAddAnnotation,
  apiAnnotations,
  apiClearAnnotations,
  apiDeleteAnnotation,
  type PdfAnnotation
} from "../api";
import { PdfAnnotationLayer, type AnnotationMode } from "./PdfAnnotationLayer";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const WHEEL_DELTA_FACTOR = 0.002;
const PEN_COLORS = ["#ff4d4f", "#1677ff", "#13c2c2", "#722ed1", "#111111"];

function distance(
  touches: { length: number; 0?: { clientX: number; clientY: number }; 1?: { clientX: number; clientY: number } }
): number {
  if (touches.length < 2) return 0;
  const a = touches[0];
  const b = touches[1];
  if (!a || !b) return 0;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function sortAnnotations(items: PdfAnnotation[]) {
  return [...items].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return a.id - b.id;
  });
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
  const { openedFileId, pdfHref, workerUrl, plugins, isDark, borderRadius, backgroundLayout, backgroundContainer } = props;

  // 必须在顶层无条件调用，否则 zoomPlugin 内部的 Hooks 会违反 React 规则
  const zoomPluginInstance = zoomPlugin();
  const zoomPluginStableRef = useRef(zoomPluginInstance);
  zoomPluginStableRef.current = zoomPluginInstance;
  const zoomTo = zoomPluginInstance.zoomTo;

  const scaleRef = useRef(1);
  const nextTempAnnotationIdRef = useRef(-1);
  const [pinchState, setPinchState] = useState<{ initialDistance: number; initialScale: number } | null>(null);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("browse");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const pinchStateRef = useRef(pinchState);
  pinchStateRef.current = pinchState;
  const containerRef = useRef<HTMLDivElement>(null);

  const hasPdf = Boolean(openedFileId && pdfHref);
  const clampScale = useCallback((s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)), []);

  useEffect(() => {
    if (!openedFileId || !pdfHref) {
      setAnnotations([]);
      setCurrentPageIndex(0);
      scaleRef.current = 1;
      return;
    }

    let cancelled = false;
    setCurrentPageIndex(0);
    void (async () => {
      try {
        const res = await apiAnnotations(openedFileId);
        if (!cancelled) {
          setAnnotations(sortAnnotations(res.annotations));
        }
      } catch (e: any) {
        if (!cancelled) {
          setAnnotations([]);
          void message.error(`加载标注失败：${e?.message || String(e)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openedFileId, pdfHref]);

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, PdfAnnotation[]>();
    for (const annotation of annotations) {
      const pageItems = grouped.get(annotation.pageIndex) ?? [];
      pageItems.push(annotation);
      grouped.set(annotation.pageIndex, pageItems);
    }
    return grouped;
  }, [annotations]);

  const handleCreateAnnotation = useCallback(
    async (input: {
      pageIndex: number;
      kind: "pen" | "highlighter";
      color: string;
      opacity: number;
      strokeWidth: number;
      points: Array<{ x: number; y: number }>;
    }) => {
      if (!openedFileId) return;

      const tempId = nextTempAnnotationIdRef.current--;
      const now = Date.now();
      const optimistic: PdfAnnotation = {
        id: tempId,
        relPath: "",
        pageIndex: input.pageIndex,
        kind: input.kind,
        color: input.color,
        opacity: input.opacity,
        strokeWidth: input.strokeWidth,
        points: input.points,
        createdAtMs: now,
        updatedAtMs: now
      };

      setAnnotations((prev) => sortAnnotations([...prev, optimistic]));

      try {
        const res = await apiAddAnnotation({
          fileId: openedFileId,
          pageIndex: input.pageIndex,
          kind: input.kind,
          color: input.color,
          opacity: input.opacity,
          strokeWidth: input.strokeWidth,
          points: input.points
        });
        setAnnotations((prev) => sortAnnotations(prev.map((item) => (item.id === tempId ? res.annotation : item))));
      } catch (e: any) {
        setAnnotations((prev) => prev.filter((item) => item.id !== tempId));
        void message.error(`保存标注失败：${e?.message || String(e)}`);
      }
    },
    [openedFileId]
  );

  const handleDeleteAnnotation = useCallback(
    async (id: number) => {
      const removed = annotations.find((item) => item.id === id);
      if (!removed) return;

      setAnnotations((prev) => prev.filter((item) => item.id !== id));
      if (id <= 0) return;

      try {
        await apiDeleteAnnotation(id);
      } catch (e: any) {
        setAnnotations((prev) => sortAnnotations([...prev, removed]));
        void message.error(`删除标注失败：${e?.message || String(e)}`);
      }
    },
    [annotations]
  );

  const handleClearAnnotations = useCallback(
    async (scope: "page" | "document") => {
      if (!openedFileId) return;

      const removed =
        scope === "page" ? annotations.filter((item) => item.pageIndex === currentPageIndex) : annotations;
      if (removed.length === 0) return;

      setAnnotations((prev) =>
        scope === "page" ? prev.filter((item) => item.pageIndex !== currentPageIndex) : []
      );

      try {
        await apiClearAnnotations(
          scope === "page" ? { fileId: openedFileId, pageIndex: currentPageIndex } : { fileId: openedFileId }
        );
      } catch (e: any) {
        setAnnotations((prev) => sortAnnotations([...prev, ...removed]));
        void message.error(`清空标注失败：${e?.message || String(e)}`);
      }
    },
    [annotations, currentPageIndex, openedFileId]
  );

  const annotationPlugin = useMemo<Plugin>(
    () => ({
      renderPageLayer: (renderProps) => (
        <PdfAnnotationLayer
          pageIndex={renderProps.pageIndex}
          width={renderProps.width}
          height={renderProps.height}
          mode={annotationMode}
          penColor={penColor}
          annotations={annotationsByPage.get(renderProps.pageIndex) ?? []}
          onCreateAnnotation={handleCreateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
        />
      )
    }),
    [annotationMode, annotationsByPage, handleCreateAnnotation, handleDeleteAnnotation, penColor]
  );

  const allPlugins = useMemo(() => [...plugins, annotationPlugin, zoomPluginStableRef.current], [plugins, annotationPlugin]);

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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    setPinchState({
      initialDistance: distance(e.touches),
      initialScale: scaleRef.current
    });
  }, []);

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

  const currentPageAnnotations = annotationsByPage.get(currentPageIndex)?.length ?? 0;

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: backgroundLayout,
        display: "flex",
        flexDirection: "column"
      }}
    >
      {openedFileId && pdfHref ? (
        <>
          <div
            className="pdfAnnotationToolbar"
            style={{
              background: backgroundContainer,
              borderBottom: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)",
              padding: "8px 12px"
            }}
          >
            <Space wrap size={[8, 8]}>
              <Button type={annotationMode === "browse" ? "primary" : "default"} onClick={() => setAnnotationMode("browse")}>
                浏览
              </Button>
              <Button type={annotationMode === "pen" ? "primary" : "default"} onClick={() => setAnnotationMode("pen")}>
                画笔
              </Button>
              <Button
                type={annotationMode === "highlighter" ? "primary" : "default"}
                onClick={() => setAnnotationMode("highlighter")}
              >
                荧光笔
              </Button>
              <Button type={annotationMode === "erase" ? "primary" : "default"} danger={annotationMode === "erase"} onClick={() => setAnnotationMode("erase")}>
                删除
              </Button>
              <Space size={6}>
                {PEN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="pdfAnnotationColor"
                    aria-label={`选择颜色 ${color}`}
                    onClick={() => {
                      setPenColor(color);
                      setAnnotationMode("pen");
                    }}
                    style={{
                      background: color,
                      borderRadius: 999,
                      width: 24,
                      height: 24,
                      border: penColor === color ? "2px solid #1677ff" : "1px solid rgba(0,0,0,0.15)",
                      boxShadow: penColor === color ? "0 0 0 2px rgba(22,119,255,0.18)" : "none",
                      cursor: "pointer"
                    }}
                  />
                ))}
              </Space>
              <Tag bordered={false} color="processing">
                第 {currentPageIndex + 1} 页
              </Tag>
              <Tag bordered={false}>{currentPageAnnotations} 条标注</Tag>
              <Tooltip title="iPad 上进入画笔/荧光笔模式后，可直接用手指或 Apple Pencil 标注">
                <Tag bordered={false}>Win / macOS / iPad</Tag>
              </Tooltip>
              <Popconfirm
                title="清空当前页标注？"
                okText="清空"
                cancelText="取消"
                disabled={currentPageAnnotations === 0}
                onConfirm={() => void handleClearAnnotations("page")}
              >
                <Button danger disabled={currentPageAnnotations === 0}>
                  清空本页
                </Button>
              </Popconfirm>
              <Popconfirm
                title="清空当前 PDF 的全部标注？"
                okText="清空"
                cancelText="取消"
                disabled={annotations.length === 0}
                onConfirm={() => void handleClearAnnotations("document")}
              >
                <Button danger type="text" disabled={annotations.length === 0}>
                  清空全文档
                </Button>
              </Popconfirm>
            </Space>
          </div>
          <div
            ref={containerRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              borderRadius,
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
                onPageChange={(e) => setCurrentPageIndex(e.currentPage)}
                onZoom={(e) => {
                  scaleRef.current = e.scale;
                }}
              />
            </Worker>
          </div>
        </>
      ) : (
        <div style={{ padding: 24 }}>
          <Empty description="点击左侧文件即可打开" />
        </div>
      )}
    </div>
  );
}
