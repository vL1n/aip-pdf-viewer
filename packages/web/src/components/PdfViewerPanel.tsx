import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FormOutlined,
  HighlightOutlined
} from "@ant-design/icons";
import { Button, Empty, Popconfirm, Tooltip, message } from "antd";
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
export const PEN_COLORS = ["#ff4d4f", "#1677ff", "#13c2c2", "#722ed1", "#111111"];

export type PdfAnnotationUiState = {
  toolsOpen: boolean;
  mode: AnnotationMode;
  penColor: string;
};

export type PdfAnnotationMeta = {
  hasPdf: boolean;
  currentPageIndex: number;
  currentPageAnnotations: number;
  totalAnnotations: number;
};

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

function buildCreateAnnotationKey(input: {
  fileId: number;
  pageIndex: number;
  kind: "pen" | "highlighter";
  color: string;
  opacity: number;
  strokeWidth: number;
  points: Array<{ x: number; y: number }>;
}) {
  return JSON.stringify({
    fileId: input.fileId,
    pageIndex: input.pageIndex,
    kind: input.kind,
    color: input.color,
    opacity: Number(input.opacity.toFixed(3)),
    strokeWidth: Number(input.strokeWidth.toFixed(4)),
    points: input.points.map((point) => ({
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4))
    }))
  });
}

export function PdfViewerPanel(props: {
  openedFileId: number | null;
  pdfHref: string | null;
  workerUrl: string;
  isDark: boolean;
  borderRadius: number;
  backgroundLayout: string;
  backgroundContainer: string;
  annotationControlsPlacement?: "internal" | "external";
  annotationUi?: PdfAnnotationUiState;
  onAnnotationUiChange?: (next: PdfAnnotationUiState) => void;
  onAnnotationMetaChange?: (next: PdfAnnotationMeta) => void;
  clearPageRequestKey?: number;
  clearDocumentRequestKey?: number;
}) {
  const {
    openedFileId,
    pdfHref,
    workerUrl,
    isDark,
    borderRadius,
    backgroundLayout,
    backgroundContainer,
    annotationControlsPlacement = "internal",
    annotationUi,
    onAnnotationUiChange,
    onAnnotationMetaChange,
    clearPageRequestKey = 0,
    clearDocumentRequestKey = 0
  } = props;

  // 必须在顶层无条件调用，否则 zoomPlugin 内部的 Hooks 会违反 React 规则
  const zoomPluginInstance = zoomPlugin();
  const zoomPluginStableRef = useRef(zoomPluginInstance);
  zoomPluginStableRef.current = zoomPluginInstance;
  const zoomTo = zoomPluginInstance.zoomTo;

  const scaleRef = useRef(1);
  const nextTempAnnotationIdRef = useRef(-1);
  const pendingCreateKeysRef = useRef<Set<string>>(new Set());
  const recentCreateKeysRef = useRef<Map<string, number>>(new Map());
  const [pinchState, setPinchState] = useState<{ initialDistance: number; initialScale: number } | null>(null);
  const [internalAnnotationToolsOpen, setInternalAnnotationToolsOpen] = useState(false);
  const [internalAnnotationMode, setInternalAnnotationMode] = useState<AnnotationMode>("browse");
  const [internalPenColor, setInternalPenColor] = useState(PEN_COLORS[0]);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const pinchStateRef = useRef(pinchState);
  pinchStateRef.current = pinchState;
  const containerRef = useRef<HTMLDivElement>(null);

  const hasPdf = Boolean(openedFileId && pdfHref);
  const annotationToolsOpen = annotationUi?.toolsOpen ?? internalAnnotationToolsOpen;
  const annotationMode = annotationUi?.mode ?? internalAnnotationMode;
  const penColor = annotationUi?.penColor ?? internalPenColor;
  const isAnnotationUiControlled = annotationUi != null;
  const clampScale = useCallback((s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)), []);

  const updateAnnotationUi = useCallback(
    (patch: Partial<PdfAnnotationUiState>) => {
      const next: PdfAnnotationUiState = {
        toolsOpen: patch.toolsOpen ?? annotationToolsOpen,
        mode: patch.mode ?? annotationMode,
        penColor: patch.penColor ?? penColor
      };

      if (!isAnnotationUiControlled) {
        setInternalAnnotationToolsOpen(next.toolsOpen);
        setInternalAnnotationMode(next.mode);
        setInternalPenColor(next.penColor);
      }

      onAnnotationUiChange?.(next);
    },
    [annotationMode, annotationToolsOpen, isAnnotationUiControlled, onAnnotationUiChange, penColor]
  );

  useEffect(() => {
    if (!openedFileId || !pdfHref) {
      setAnnotations([]);
      setCurrentPageIndex(0);
      if (!isAnnotationUiControlled) {
        setInternalAnnotationToolsOpen(false);
        setInternalAnnotationMode("browse");
        setInternalPenColor(PEN_COLORS[0]);
      }
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
  }, [isAnnotationUiControlled, openedFileId, pdfHref]);

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
      const requestKey = buildCreateAnnotationKey({
        fileId: openedFileId,
        pageIndex: input.pageIndex,
        kind: input.kind,
        color: input.color,
        opacity: input.opacity,
        strokeWidth: input.strokeWidth,
        points: input.points
      });
      const nowTs = Date.now();
      const lastTs = recentCreateKeysRef.current.get(requestKey);
      if (pendingCreateKeysRef.current.has(requestKey)) return;
      if (lastTs && nowTs - lastTs < 2000) return;
      pendingCreateKeysRef.current.add(requestKey);

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
        recentCreateKeysRef.current.set(requestKey, Date.now());
      } catch (e: any) {
        setAnnotations((prev) => prev.filter((item) => item.id !== tempId));
        void message.error(`保存标注失败：${e?.message || String(e)}`);
      } finally {
        pendingCreateKeysRef.current.delete(requestKey);
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

  const toggleAnnotationTools = useCallback(() => {
    const nextToolsOpen = !annotationToolsOpen;
    updateAnnotationUi({
      toolsOpen: nextToolsOpen,
      mode: nextToolsOpen ? (annotationMode === "browse" ? "pen" : annotationMode) : "browse"
    });
  }, [annotationMode, annotationToolsOpen, updateAnnotationUi]);

  const setActiveAnnotationMode = useCallback(
    (nextMode: AnnotationMode) => {
      updateAnnotationUi({ mode: nextMode });
    },
    [updateAnnotationUi]
  );

  const setActivePenColor = useCallback(
    (color: string) => {
      updateAnnotationUi({ penColor: color, mode: "pen" });
    },
    [updateAnnotationUi]
  );

  const effectiveAnnotationMode: AnnotationMode = annotationToolsOpen ? annotationMode : "browse";
  const annotationsByPageRef = useRef(annotationsByPage);
  annotationsByPageRef.current = annotationsByPage;
  const effectiveAnnotationModeRef = useRef<AnnotationMode>(effectiveAnnotationMode);
  effectiveAnnotationModeRef.current = effectiveAnnotationMode;
  const penColorRef = useRef(penColor);
  penColorRef.current = penColor;
  const createAnnotationRef = useRef(handleCreateAnnotation);
  createAnnotationRef.current = handleCreateAnnotation;
  const deleteAnnotationRef = useRef(handleDeleteAnnotation);
  deleteAnnotationRef.current = handleDeleteAnnotation;

  const annotationPluginRef = useRef<Plugin | null>(null);
  if (!annotationPluginRef.current) {
    annotationPluginRef.current = {
      renderPageLayer: (renderProps) => (
        <PdfAnnotationLayer
          pageIndex={renderProps.pageIndex}
          width={renderProps.width}
          height={renderProps.height}
          mode={effectiveAnnotationModeRef.current}
          penColor={penColorRef.current}
          annotations={annotationsByPageRef.current.get(renderProps.pageIndex) ?? []}
          onCreateAnnotation={(input) => createAnnotationRef.current(input)}
          onDeleteAnnotation={(id) => deleteAnnotationRef.current(id)}
        />
      )
    };
  }
  const annotationPlugin = annotationPluginRef.current;

  const allPlugins = useMemo(() => [annotationPlugin, zoomPluginStableRef.current], [annotationPlugin]);

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
  const totalAnnotations = annotations.length;
  const annotationToolsVisible = annotationToolsOpen;

  useEffect(() => {
    onAnnotationMetaChange?.({
      hasPdf,
      currentPageIndex,
      currentPageAnnotations,
      totalAnnotations
    });
  }, [currentPageAnnotations, currentPageIndex, hasPdf, onAnnotationMetaChange, totalAnnotations]);

  const lastClearPageRequestKeyRef = useRef(clearPageRequestKey);
  useEffect(() => {
    if (clearPageRequestKey > 0 && clearPageRequestKey !== lastClearPageRequestKeyRef.current) {
      lastClearPageRequestKeyRef.current = clearPageRequestKey;
      void handleClearAnnotations("page");
      return;
    }
    lastClearPageRequestKeyRef.current = clearPageRequestKey;
  }, [clearPageRequestKey, handleClearAnnotations]);

  const lastClearDocumentRequestKeyRef = useRef(clearDocumentRequestKey);
  useEffect(() => {
    if (clearDocumentRequestKey > 0 && clearDocumentRequestKey !== lastClearDocumentRequestKeyRef.current) {
      lastClearDocumentRequestKeyRef.current = clearDocumentRequestKey;
      void handleClearAnnotations("document");
      return;
    }
    lastClearDocumentRequestKeyRef.current = clearDocumentRequestKey;
  }, [clearDocumentRequestKey, handleClearAnnotations]);

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
          {annotationControlsPlacement === "internal" && (
            <div
              className="pdfAnnotationToolbar"
              style={{
                background: backgroundContainer,
                borderBottom: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.08)",
                padding: "8px 12px",
                height: 64
              }}
            >
              <div className="pdfAnnotationToolbarRail">
                <Tooltip title={annotationToolsVisible ? "退出标注" : "进入标注"}>
                  <Button
                    className="pdfAnnotationToggleButton"
                    type={annotationToolsVisible ? "primary" : "default"}
                    shape="circle"
                    size="large"
                    icon={annotationToolsVisible ? <CloseOutlined /> : <FormOutlined />}
                    aria-label={annotationToolsVisible ? "退出标注" : "进入标注"}
                    onClick={toggleAnnotationTools}
                  />
                </Tooltip>

                <div
                  className={`pdfAnnotationNativeBar${annotationToolsVisible ? " is-open" : ""}`}
                  style={{
                    background: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.04)",
                    border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.08)",
                    boxShadow: isDark ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "inset 0 1px 0 rgba(255,255,255,0.7)"
                  }}
                >
                  {annotationToolsVisible ? (
                    <>
                      <div className="pdfAnnotationToolCluster">
                        <Tooltip title="浏览">
                          <Button
                            type={annotationMode === "browse" ? "primary" : "text"}
                            shape="circle"
                            size="large"
                            icon={<EyeOutlined />}
                            aria-label="浏览"
                            onClick={() => setActiveAnnotationMode("browse")}
                          />
                        </Tooltip>
                        <Tooltip title="画笔">
                          <Button
                            type={annotationMode === "pen" ? "primary" : "text"}
                            shape="circle"
                            size="large"
                            icon={<EditOutlined />}
                            aria-label="画笔"
                            onClick={() => setActiveAnnotationMode("pen")}
                          />
                        </Tooltip>
                        <Tooltip title="荧光笔">
                          <Button
                            type={annotationMode === "highlighter" ? "primary" : "text"}
                            shape="circle"
                            size="large"
                            icon={<HighlightOutlined />}
                            aria-label="荧光笔"
                            onClick={() => setActiveAnnotationMode("highlighter")}
                          />
                        </Tooltip>
                        <Tooltip title="删除标注">
                          <Button
                            type={annotationMode === "erase" ? "primary" : "text"}
                            danger={annotationMode === "erase"}
                            shape="circle"
                            size="large"
                            icon={<DeleteOutlined />}
                            aria-label="删除标注"
                            onClick={() => setActiveAnnotationMode("erase")}
                          />
                        </Tooltip>
                      </div>

                      <div className="pdfAnnotationDivider" />

                      <div className="pdfAnnotationColorCluster">
                        {PEN_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className="pdfAnnotationColor"
                            aria-label={`选择颜色 ${color}`}
                            onClick={() => setActivePenColor(color)}
                            style={{
                              background: color,
                              borderRadius: 999,
                              width: 22,
                              height: 22,
                              border: penColor === color ? "2px solid #1677ff" : "1px solid rgba(0,0,0,0.15)",
                              boxShadow: penColor === color ? "0 0 0 2px rgba(22,119,255,0.18)" : "none",
                              cursor: "pointer"
                            }}
                          />
                        ))}
                      </div>

                      <div className="pdfAnnotationDivider" />

                      <div className="pdfAnnotationStatusText">
                        第 {currentPageIndex + 1} 页
                      </div>
                      <div className="pdfAnnotationStatusText">
                        {currentPageAnnotations} 条标注
                      </div>

                      <div className="pdfAnnotationDivider" />

                      <div className="pdfAnnotationActionCluster">
                        <Popconfirm
                          title="清空当前页标注？"
                          okText="清空"
                          cancelText="取消"
                          disabled={currentPageAnnotations === 0}
                          onConfirm={() => void handleClearAnnotations("page")}
                        >
                          <Button type="text" danger disabled={currentPageAnnotations === 0}>
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
                          <Button type="text" danger disabled={annotations.length === 0}>
                            清空全文
                          </Button>
                        </Popconfirm>
                      </div>
                    </>
                  ) : (
                    <div className="pdfAnnotationStatusText">
                      {annotations.length > 0 ? `${annotations.length} 条标注` : "标注工具"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
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
