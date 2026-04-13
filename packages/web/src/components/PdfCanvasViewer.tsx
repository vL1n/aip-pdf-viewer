import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Empty, Spin } from "antd";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask
} from "pdfjs-dist";

import type { PdfAnnotation, PdfAnnotationKind, PdfAnnotationPoint } from "../api";
import { PdfAnnotationLayer, type AnnotationMode } from "./PdfAnnotationLayer";

const PAGE_GAP = 16;
const RENDER_BUFFER_PAGES = 2;
const MAX_RENDER_PIXEL_RATIO = 2.5;
const WHEEL_DELTA_FACTOR = 0.002;

type PdfPageSize = {
  pageIndex: number;
  width: number;
  height: number;
};

type PdfDocumentState = {
  pdf: PDFDocumentProxy;
  pages: PdfPageSize[];
};

type RenderWindow = {
  start: number;
  end: number;
};

type PinchGestureState = {
  initialDistance: number;
  initialScale: number;
  finalScale: number;
  ratio: number;
  startScrollLeft: number;
  startScrollTop: number;
  anchorX: number;
  anchorY: number;
  lastCenterX: number;
  lastCenterY: number;
  translateX: number;
  translateY: number;
  rafId: number | null;
};

type PendingScaleCommit = {
  scrollLeft: number;
  scrollTop: number;
};

type TouchPairLike = {
  length: number;
  0?: { clientX: number; clientY: number };
  1?: { clientX: number; clientY: number };
};

function getTouchDistance(touches: TouchPairLike) {
  const a = touches[0];
  const b = touches[1];
  if (touches.length < 2 || !a || !b) return 0;
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function getTouchCenter(touches: TouchPairLike) {
  const a = touches[0];
  const b = touches[1];
  if (touches.length < 2 || !a || !b) return null;
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  };
}

function clampScrollPosition(element: HTMLElement, left: number, top: number) {
  const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollLeft = Math.max(0, Math.min(maxLeft, left));
  element.scrollTop = Math.max(0, Math.min(maxTop, top));
}

function getRenderPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
}

function isRenderCancel(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function PdfCanvasPage(props: {
  pdf: PDFDocumentProxy;
  page: PdfPageSize;
  scale: number;
  isDark: boolean;
  shouldRender: boolean;
  annotationMode: AnnotationMode;
  penColor: string;
  widthKey: number;
  annotations: PdfAnnotation[];
  onCreateAnnotation: (input: {
    pageIndex: number;
    kind: PdfAnnotationKind;
    color: string;
    opacity: number;
    strokeWidth: number;
    points: PdfAnnotationPoint[];
  }) => Promise<void> | void;
  onDeleteAnnotation: (id: number) => Promise<void> | void;
  onPageElement: (pageIndex: number, element: HTMLDivElement | null) => void;
}) {
  const {
    pdf,
    page,
    scale,
    isDark,
    shouldRender,
    annotationMode,
    penColor,
    widthKey,
    annotations,
    onCreateAnnotation,
    onDeleteAnnotation,
    onPageElement
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRendering, setIsRendering] = useState(false);

  const width = page.width * scale;
  const height = page.height * scale;
  const handlePageRef = useCallback(
    (element: HTMLDivElement | null) => onPageElement(page.pageIndex, element),
    [onPageElement, page.pageIndex]
  );

  useEffect(() => {
    if (!shouldRender) return;
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    void (async () => {
      setIsRendering(true);
      const pdfPage = await pdf.getPage(page.pageIndex + 1);
      if (cancelled) return;

      const viewport = pdfPage.getViewport({ scale });
      const pixelRatio = getRenderPixelRatio();
      const nextCanvas = document.createElement("canvas");
      nextCanvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
      nextCanvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));

      const nextContext = nextCanvas.getContext("2d");
      if (!nextContext) {
        setIsRendering(false);
        return;
      }

      nextContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      renderTask = pdfPage.render({
        canvasContext: nextContext,
        viewport
      });
      await renderTask.promise;
      if (cancelled) return;

      const visibleContext = visibleCanvas.getContext("2d");
      visibleCanvas.width = nextCanvas.width;
      visibleCanvas.height = nextCanvas.height;
      visibleCanvas.style.width = `${viewport.width}px`;
      visibleCanvas.style.height = `${viewport.height}px`;
      visibleContext?.drawImage(nextCanvas, 0, 0);
      setIsRendering(false);
    })().catch((error) => {
      if (!cancelled && !isRenderCancel(error)) {
        // 渲染失败不阻断整个 PDF，保留上一帧画面方便继续滚动/缩放。
        console.error("PDF page render failed", error);
        setIsRendering(false);
      }
    });

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // PDF.js cancel can throw if the task already completed.
        }
      }
    };
  }, [page.pageIndex, pdf, scale, shouldRender]);

  return (
    <div
      ref={handlePageRef}
      className="pdfCanvasPage"
      data-page-index={page.pageIndex}
      style={{
        width,
        height,
        background: "#fff",
        boxShadow: isDark ? "0 10px 30px rgba(0,0,0,0.45)" : "0 10px 30px rgba(15,23,42,0.16)"
      }}
    >
      <canvas
        ref={canvasRef}
        className="pdfCanvasPageCanvas"
        style={{ width, height }}
      />
      {isRendering && <div className="pdfCanvasPageRendering" aria-hidden="true" />}
      <PdfAnnotationLayer
        pageIndex={page.pageIndex}
        width={width}
        height={height}
        mode={annotationMode}
        penColor={penColor}
        widthKey={widthKey}
        annotations={annotations}
        onCreateAnnotation={onCreateAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
      />
    </div>
  );
}

export function PdfCanvasViewer(props: {
  fileUrl: string;
  workerUrl: string;
  isDark: boolean;
  minScale: number;
  maxScale: number;
  annotationMode: AnnotationMode;
  penColor: string;
  widthKey: number;
  annotationsByPage: Map<number, PdfAnnotation[]>;
  onCreateAnnotation: (input: {
    pageIndex: number;
    kind: PdfAnnotationKind;
    color: string;
    opacity: number;
    strokeWidth: number;
    points: PdfAnnotationPoint[];
  }) => Promise<void> | void;
  onDeleteAnnotation: (id: number) => Promise<void> | void;
  onCurrentPageChange: (pageIndex: number) => void;
}) {
  const {
    fileUrl,
    workerUrl,
    isDark,
    minScale,
    maxScale,
    annotationMode,
    penColor,
    widthKey,
    annotationsByPage,
    onCreateAnnotation,
    onDeleteAnnotation,
    onCurrentPageChange
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const annotationModeRef = useRef(annotationMode);
  const committedScaleRef = useRef(1);
  const hasUserScaleRef = useRef(false);
  const pinchGestureRef = useRef<PinchGestureState | null>(null);
  const pendingScaleCommitRef = useRef<PendingScaleCommit | null>(null);
  const currentPageRef = useRef(0);
  const scrollUpdateFrameRef = useRef<number | null>(null);

  const [documentState, setDocumentState] = useState<PdfDocumentState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [committedScale, setCommittedScale] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [renderWindow, setRenderWindow] = useState<RenderWindow>({ start: 0, end: 3 });

  annotationModeRef.current = annotationMode;
  committedScaleRef.current = committedScale;

  const clampScale = useCallback(
    (scale: number) => Math.max(minScale, Math.min(maxScale, scale)),
    [maxScale, minScale]
  );

  const clearContentTransform = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    content.style.transform = "";
    content.style.transformOrigin = "";
    content.style.transition = "";
    content.style.willChange = "";
  }, []);

  const updateScrollDerivedState = useCallback(() => {
    const scroll = scrollRef.current;
    const pages = documentState?.pages;
    if (!scroll || !pages?.length) return;

    const scrollTop = scroll.scrollTop;
    const viewportBottom = scrollTop + scroll.clientHeight;
    const viewportCenter = scrollTop + scroll.clientHeight / 2;
    const buffer = Math.max(scroll.clientHeight * 1.4, 900);
    let firstVisible = Number.POSITIVE_INFINITY;
    let lastVisible = -1;
    let nearestPageIndex = currentPageRef.current;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const page of pages) {
      const element = pageElementsRef.current.get(page.pageIndex);
      if (!element) continue;

      const pageTop = element.offsetTop;
      const pageBottom = pageTop + element.offsetHeight;
      if (pageBottom >= scrollTop - buffer && pageTop <= viewportBottom + buffer) {
        firstVisible = Math.min(firstVisible, page.pageIndex);
        lastVisible = Math.max(lastVisible, page.pageIndex);
      }

      const pageCenter = pageTop + element.offsetHeight / 2;
      const distance = Math.abs(pageCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPageIndex = page.pageIndex;
      }
    }

    if (Number.isFinite(firstVisible) && lastVisible >= 0) {
      const nextWindow = {
        start: Math.max(0, firstVisible - RENDER_BUFFER_PAGES),
        end: Math.min(pages.length - 1, lastVisible + RENDER_BUFFER_PAGES)
      };
      setRenderWindow((prev) =>
        prev.start === nextWindow.start && prev.end === nextWindow.end ? prev : nextWindow
      );
    }

    if (nearestPageIndex !== currentPageRef.current) {
      currentPageRef.current = nearestPageIndex;
      onCurrentPageChange(nearestPageIndex);
    }
  }, [documentState?.pages, onCurrentPageChange]);

  const requestScrollDerivedStateUpdate = useCallback(() => {
    if (scrollUpdateFrameRef.current != null) return;
    scrollUpdateFrameRef.current = window.requestAnimationFrame(() => {
      scrollUpdateFrameRef.current = null;
      updateScrollDerivedState();
    });
  }, [updateScrollDerivedState]);

  const setPageElement = useCallback(
    (pageIndex: number, element: HTMLDivElement | null) => {
      if (element) {
        pageElementsRef.current.set(pageIndex, element);
      } else {
        pageElementsRef.current.delete(pageIndex);
      }
      requestScrollDerivedStateUpdate();
    },
    [requestScrollDerivedStateUpdate]
  );

  const computeFitScale = useCallback(
    (pages: PdfPageSize[], size: { width: number; height: number }) => {
      const firstPage = pages[0];
      if (!firstPage || size.width <= 0 || size.height <= 0) return 1;
      const availableWidth = Math.max(1, size.width - PAGE_GAP * 2);
      const availableHeight = Math.max(1, size.height - PAGE_GAP * 2);
      return clampScale(Math.min(availableWidth / firstPage.width, availableHeight / firstPage.height));
    },
    [clampScale]
  );

  const commitScaleAtViewportPoint = useCallback(
    (nextScaleInput: number, centerX: number, centerY: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;

      const nextScale = clampScale(nextScaleInput);
      const currentScale = committedScaleRef.current || 1;
      if (Math.abs(nextScale - currentScale) < 0.001) return;

      const ratio = nextScale / currentScale;
      const anchorX = scroll.scrollLeft + centerX;
      const anchorY = scroll.scrollTop + centerY;
      pendingScaleCommitRef.current = {
        scrollLeft: anchorX * ratio - centerX,
        scrollTop: anchorY * ratio - centerY
      };
      hasUserScaleRef.current = true;
      committedScaleRef.current = nextScale;
      setCommittedScale(nextScale);
    },
    [clampScale]
  );

  const startPinchGesture = useCallback(
    (event: TouchEvent) => {
      if (event.touches.length !== 2 || annotationModeRef.current !== "browse") return false;
      const scroll = scrollRef.current;
      const content = contentRef.current;
      const distance = getTouchDistance(event.touches);
      const center = getTouchCenter(event.touches);
      if (!scroll || !content || !center || distance <= 0) return false;

      const rect = scroll.getBoundingClientRect();
      const centerX = center.x - rect.left;
      const centerY = center.y - rect.top;

      if (pinchGestureRef.current?.rafId != null) {
        window.cancelAnimationFrame(pinchGestureRef.current.rafId);
      }

      content.style.transformOrigin = "0 0";
      content.style.transition = "none";
      content.style.willChange = "transform";

      pinchGestureRef.current = {
        initialDistance: distance,
        initialScale: committedScaleRef.current || 1,
        finalScale: committedScaleRef.current || 1,
        ratio: 1,
        startScrollLeft: scroll.scrollLeft,
        startScrollTop: scroll.scrollTop,
        anchorX: scroll.scrollLeft + centerX,
        anchorY: scroll.scrollTop + centerY,
        lastCenterX: centerX,
        lastCenterY: centerY,
        translateX: 0,
        translateY: 0,
        rafId: null
      };

      event.preventDefault();
      return true;
    },
    []
  );

  const updatePinchGesture = useCallback(
    (event: TouchEvent) => {
      const session = pinchGestureRef.current;
      if (!session || event.touches.length !== 2) return false;

      const scroll = scrollRef.current;
      const content = contentRef.current;
      const distance = getTouchDistance(event.touches);
      const center = getTouchCenter(event.touches);
      if (!scroll || !content || !center || distance <= 0) return false;

      const rect = scroll.getBoundingClientRect();
      const centerX = center.x - rect.left;
      const centerY = center.y - rect.top;
      const nextScale = clampScale(session.initialScale * (distance / session.initialDistance));
      const ratio = session.initialScale > 0 ? nextScale / session.initialScale : 1;

      session.finalScale = nextScale;
      session.ratio = ratio;
      session.lastCenterX = centerX;
      session.lastCenterY = centerY;
      session.translateX = centerX + session.startScrollLeft - session.anchorX * ratio;
      session.translateY = centerY + session.startScrollTop - session.anchorY * ratio;

      if (session.rafId == null) {
        session.rafId = window.requestAnimationFrame(() => {
          session.rafId = null;
          if (pinchGestureRef.current !== session) return;
          content.style.transform = `translate3d(${session.translateX}px, ${session.translateY}px, 0) scale(${session.ratio})`;
        });
      }

      event.preventDefault();
      return true;
    },
    [clampScale]
  );

  const finishPinchGesture = useCallback(
    (commit: boolean) => {
      const session = pinchGestureRef.current;
      if (!session) return;
      pinchGestureRef.current = null;

      if (session.rafId != null) {
        window.cancelAnimationFrame(session.rafId);
      }

      if (!commit || Math.abs(session.finalScale - session.initialScale) < 0.001) {
        clearContentTransform();
        return;
      }

      pendingScaleCommitRef.current = {
        scrollLeft: session.anchorX * session.ratio - session.lastCenterX,
        scrollTop: session.anchorY * session.ratio - session.lastCenterY
      };
      hasUserScaleRef.current = true;
      committedScaleRef.current = session.finalScale;
      setCommittedScale(session.finalScale);
    },
    [clearContentTransform]
  );

  useEffect(() => {
    let cancelled = false;
    GlobalWorkerOptions.workerSrc = workerUrl;
    const loadingTask = getDocument({ url: fileUrl });

    pageElementsRef.current.clear();
    currentPageRef.current = 0;
    hasUserScaleRef.current = false;
    pendingScaleCommitRef.current = null;
    pinchGestureRef.current = null;
    clearContentTransform();
    setDocumentState(null);
    setLoadError(null);
    setIsLoading(true);
    setCommittedScale(1);
    setRenderWindow({ start: 0, end: 3 });
    onCurrentPageChange(0);

    void (async () => {
      try {
        const pdf = await loadingTask.promise;
        const pages: PdfPageSize[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1 });
          pages.push({
            pageIndex: pageNumber - 1,
            width: viewport.width,
            height: viewport.height
          });
        }
        if (cancelled) return;
        setDocumentState({ pdf, pages });
        setIsLoading(false);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      finishPinchGesture(false);
      void loadingTask.destroy();
    };
  }, [clearContentTransform, fileUrl, finishPinchGesture, onCurrentPageChange, workerUrl]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const updateSize = () => {
      setViewportSize({
        width: scroll.clientWidth,
        height: scroll.clientHeight
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!documentState || hasUserScaleRef.current) return;
    const nextScale = computeFitScale(documentState.pages, viewportSize);
    committedScaleRef.current = nextScale;
    setCommittedScale(nextScale);
  }, [computeFitScale, documentState, viewportSize]);

  useLayoutEffect(() => {
    const pending = pendingScaleCommitRef.current;
    if (!pending) return;
    pendingScaleCommitRef.current = null;
    clearContentTransform();
    const scroll = scrollRef.current;
    if (scroll) {
      clampScrollPosition(scroll, pending.scrollLeft, pending.scrollTop);
    }
    requestScrollDerivedStateUpdate();
  }, [clearContentTransform, committedScale, requestScrollDerivedStateUpdate]);

  useEffect(() => {
    requestScrollDerivedStateUpdate();
  }, [documentState, committedScale, requestScrollDerivedStateUpdate]);

  useEffect(() => {
    if (annotationMode !== "browse") {
      finishPinchGesture(false);
    }
  }, [annotationMode, finishPinchGesture]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const onTouchStart = (event: TouchEvent) => {
      void startPinchGesture(event);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (pinchGestureRef.current) {
        void updatePinchGesture(event);
        return;
      }
      if (event.touches.length === 2) {
        void startPinchGesture(event);
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!pinchGestureRef.current || event.touches.length >= 2) return;
      event.preventDefault();
      finishPinchGesture(true);
    };
    const onTouchCancel = (event: TouchEvent) => {
      if (!pinchGestureRef.current) return;
      event.preventDefault();
      finishPinchGesture(false);
    };
    const preventGesture = (event: Event) => event.preventDefault();

    scroll.addEventListener("touchstart", onTouchStart, { passive: false });
    scroll.addEventListener("touchmove", onTouchMove, { passive: false });
    scroll.addEventListener("touchend", onTouchEnd, { passive: false });
    scroll.addEventListener("touchcancel", onTouchCancel, { passive: false });
    scroll.addEventListener("gesturestart", preventGesture);
    scroll.addEventListener("gesturechange", preventGesture);
    scroll.addEventListener("gestureend", preventGesture);

    return () => {
      scroll.removeEventListener("touchstart", onTouchStart);
      scroll.removeEventListener("touchmove", onTouchMove);
      scroll.removeEventListener("touchend", onTouchEnd);
      scroll.removeEventListener("touchcancel", onTouchCancel);
      scroll.removeEventListener("gesturestart", preventGesture);
      scroll.removeEventListener("gesturechange", preventGesture);
      scroll.removeEventListener("gestureend", preventGesture);
      finishPinchGesture(false);
    };
  }, [finishPinchGesture, startPinchGesture, updatePinchGesture]);

  useEffect(() => {
    return () => {
      if (scrollUpdateFrameRef.current != null) {
        window.cancelAnimationFrame(scrollUpdateFrameRef.current);
      }
      finishPinchGesture(false);
    };
  }, [finishPinchGesture]);

  const contentWidth = useMemo(() => {
    const pages = documentState?.pages ?? [];
    const maxPageWidth = pages.reduce((max, page) => Math.max(max, page.width * committedScale), 0);
    return Math.max(viewportSize.width, maxPageWidth + PAGE_GAP * 2);
  }, [committedScale, documentState?.pages, viewportSize.width]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const scroll = scrollRef.current;
      if (!scroll) return;
      event.preventDefault();
      const rect = scroll.getBoundingClientRect();
      const nextScale = committedScaleRef.current * (1 - event.deltaY * WHEEL_DELTA_FACTOR);
      commitScaleAtViewportPoint(nextScale, event.clientX - rect.left, event.clientY - rect.top);
    },
    [commitScaleAtViewportPoint]
  );

  return (
    <div
      ref={scrollRef}
      className="pdfCanvasViewport"
      data-theme={isDark ? "dark" : "light"}
      onScroll={requestScrollDerivedStateUpdate}
      onWheel={handleWheel}
    >
      {documentState ? (
        <div
          ref={contentRef}
          className="pdfCanvasContent"
          style={{
            width: contentWidth,
            padding: PAGE_GAP,
            gap: PAGE_GAP
          }}
        >
          {documentState.pages.map((page) => (
            <PdfCanvasPage
              key={page.pageIndex}
              pdf={documentState.pdf}
              page={page}
              scale={committedScale}
              isDark={isDark}
              shouldRender={page.pageIndex >= renderWindow.start && page.pageIndex <= renderWindow.end}
              annotationMode={annotationMode}
              penColor={penColor}
              widthKey={widthKey}
              annotations={annotationsByPage.get(page.pageIndex) ?? []}
              onCreateAnnotation={onCreateAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onPageElement={setPageElement}
            />
          ))}
        </div>
      ) : null}

      {(isLoading || loadError) && (
        <div className="pdfCanvasStatusOverlay">
          {isLoading ? (
            <Spin tip="PDF 加载中..." />
          ) : (
            <Empty description={`PDF 加载失败：${loadError || "未知错误"}`} />
          )}
        </div>
      )}
    </div>
  );
}
