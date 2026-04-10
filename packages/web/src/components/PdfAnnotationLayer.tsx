import React, { useCallback, useMemo, useRef, useState } from "react";

import type { PdfAnnotation, PdfAnnotationKind, PdfAnnotationPoint } from "../api";

export type AnnotationMode = "browse" | "pen" | "highlighter" | "erase";

type DraftStroke = {
  kind: PdfAnnotationKind;
  points: PdfAnnotationPoint[];
  pointerId: number;
};

const MIN_POINT_DELTA = 0.002;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function appendPoint(points: PdfAnnotationPoint[], next: PdfAnnotationPoint) {
  const last = points[points.length - 1];
  if (!last) return [next];
  if (Math.hypot(last.x - next.x, last.y - next.y) < MIN_POINT_DELTA) return points;
  return [...points, next];
}

function buildSvgPath(points: PdfAnnotationPoint[], width: number, height: number) {
  if (points.length === 0) return "";
  return points
    .map((point, index) => {
      const x = Number((point.x * width).toFixed(2));
      const y = Number((point.y * height).toFixed(2));
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function getStrokeStyle(kind: PdfAnnotationKind, color: string) {
  return {
    color,
    opacity: kind === "highlighter" ? 0.35 : 0.92,
    strokeWidth: kind === "highlighter" ? 0.014 : 0.0045
  };
}

function buildStrokeKey(stroke: DraftStroke) {
  return JSON.stringify({
    kind: stroke.kind,
    pointerId: stroke.pointerId,
    points: stroke.points.map((point) => ({
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4))
    }))
  });
}

export function PdfAnnotationLayer(props: {
  pageIndex: number;
  width: number;
  height: number;
  mode: AnnotationMode;
  penColor: string;
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
}) {
  const { pageIndex, width, height, mode, penColor, annotations, onCreateAnnotation, onDeleteAnnotation } = props;

  const layerRef = useRef<HTMLDivElement>(null);
  const activePointerIdsRef = useRef<Set<number>>(new Set());
  const [draftStroke, setDraftStroke] = useState<DraftStroke | null>(null);
  const draftStrokeRef = useRef<DraftStroke | null>(draftStroke);
  draftStrokeRef.current = draftStroke;
  const submittedStrokeKeysRef = useRef<Set<string>>(new Set());

  const activeKind = mode === "pen" || mode === "highlighter" ? mode : null;
  const activeStroke = activeKind ? getStrokeStyle(activeKind, activeKind === "highlighter" ? "#fadb14" : penColor) : null;
  const draftPath = useMemo(
    () => (draftStroke ? buildSvgPath(draftStroke.points, width, height) : ""),
    [draftStroke, height, width]
  );

  const getPointFromEvent = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = layerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height)
    };
  }, []);

  const finishStroke = useCallback(
    (stroke: DraftStroke | null) => {
      if (!stroke || stroke.points.length < 2) return;
      const strokeKey = buildStrokeKey(stroke);
      if (submittedStrokeKeysRef.current.has(strokeKey)) return;
      submittedStrokeKeysRef.current.add(strokeKey);
      const style = getStrokeStyle(stroke.kind, stroke.kind === "highlighter" ? "#fadb14" : penColor);
      void onCreateAnnotation({
        pageIndex,
        kind: stroke.kind,
        color: style.color,
        opacity: style.opacity,
        strokeWidth: style.strokeWidth,
        points: stroke.points
      });
    },
    [onCreateAnnotation, pageIndex, penColor]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!activeKind) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      activePointerIdsRef.current.add(event.pointerId);
      if (activePointerIdsRef.current.size !== 1) {
        draftStrokeRef.current = null;
        setDraftStroke(null);
        return;
      }
      const point = getPointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const nextStroke = {
        kind: activeKind,
        points: [point],
        pointerId: event.pointerId
      };
      submittedStrokeKeysRef.current.clear();
      draftStrokeRef.current = nextStroke;
      setDraftStroke(nextStroke);
    },
    [activeKind, getPointFromEvent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const currentStroke = draftStrokeRef.current;
      if (!currentStroke || currentStroke.pointerId !== event.pointerId) return;
      if (activePointerIdsRef.current.size !== 1) return;
      const point = getPointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      const nextStroke = {
        ...currentStroke,
        points: appendPoint(currentStroke.points, point)
      };
      draftStrokeRef.current = nextStroke;
      setDraftStroke(nextStroke);
    },
    [getPointFromEvent]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      activePointerIdsRef.current.delete(event.pointerId);
      const currentStroke = draftStrokeRef.current;
      if (currentStroke?.pointerId === event.pointerId) {
        event.preventDefault();
        draftStrokeRef.current = null;
        setDraftStroke(null);
        finishStroke(currentStroke);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [finishStroke]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      activePointerIdsRef.current.delete(event.pointerId);
      if (draftStrokeRef.current?.pointerId === event.pointerId) {
        draftStrokeRef.current = null;
        setDraftStroke(null);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    []
  );

  return (
    <div
      ref={layerRef}
      className="pdfAnnotationLayer"
      style={{
        pointerEvents: mode === "browse" ? "none" : "auto",
        touchAction: mode === "browse" ? "pan-x pan-y" : "none"
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        {annotations.map((annotation) => {
          const path = buildSvgPath(annotation.points, width, height);
          const strokeWidth = Math.max(2, annotation.strokeWidth * width);
          const deleteAnnotation = () => {
            void onDeleteAnnotation(annotation.id);
          };
          return (
            <g key={annotation.id}>
              <path
                d={path}
                fill="none"
                stroke={annotation.color}
                strokeOpacity={annotation.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
                pointerEvents="none"
              />
              {mode === "erase" && (
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={Math.max(18, strokeWidth + 12)}
                  pointerEvents="stroke"
                  style={{ cursor: "pointer" }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    deleteAnnotation();
                  }}
                />
              )}
            </g>
          );
        })}
        {draftStroke && activeStroke && (
          <path
            d={draftPath}
            fill="none"
            stroke={activeStroke.color}
            strokeOpacity={activeStroke.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={Math.max(2, activeStroke.strokeWidth * width)}
          />
        )}
      </svg>
    </div>
  );
}
