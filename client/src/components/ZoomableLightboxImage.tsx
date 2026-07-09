import { useRef, useState, useEffect, useCallback } from "react";

interface ZoomableLightboxImageProps {
  src: string;
  alt: string;
  className?: string;
  "data-testid"?: string;
  /** Reset zoom whenever this key changes (e.g. image index) */
  resetKey: string | number;
  onZoomChange?: (zoomed: boolean) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;

/**
 * Full-screen lightbox image with pinch-to-zoom, double-tap-to-zoom and
 * pan (drag) once zoomed in. Built on raw Pointer Events, no extra deps.
 */
export function ZoomableLightboxImage({
  src,
  alt,
  className,
  resetKey,
  onZoomChange,
  ...rest
}: ZoomableLightboxImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  // live refs to avoid stale closures inside pointer handlers
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  scaleRef.current = scale;
  translateRef.current = translate;

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number; mid: { x: number; y: number } } | null>(null);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTapRef = useRef(0);
  // Tracks a candidate single tap (down position/time) so pointerUp can tell
  // a genuine tap (no movement) apart from a drag, without being confused by
  // the double-tap-zoom gesture handled separately in handlePointerDown.
  const tapCandidateRef = useRef<{ pointerId: number; x: number; y: number; time: number } | null>(null);
  // Holds the "close on single tap" decision until the double-tap window
  // has fully elapsed, so an intended double-tap never gets pre-empted by
  // the first tap's single-tap-close action.
  const pendingCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TAP_MOVE_TOLERANCE = 10;
  const TAP_MAX_MS = 300;

  const clearPendingClose = () => {
    if (pendingCloseTimeoutRef.current !== null) {
      clearTimeout(pendingCloseTimeoutRef.current);
      pendingCloseTimeoutRef.current = null;
    }
  };

  // Reset zoom and any in-flight gesture state when the image changes
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    pointers.current.clear();
    pinchStart.current = null;
    dragStart.current = null;
    lastTapRef.current = 0;
    tapCandidateRef.current = null;
    clearPendingClose();
    onZoomChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Clear any pending timeout on unmount
  useEffect(() => () => clearPendingClose(), []);

  const clampTranslate = useCallback((tx: number, ty: number, s: number) => {
    const containerEl = containerRef.current;
    const imgEl = imgRef.current;
    if (!containerEl || !imgEl) return { x: tx, y: ty };
    const containerRect = containerEl.getBoundingClientRect();
    // Use the actual rendered (unscaled) image box, not the container box,
    // since object-contain can render the image smaller than the container.
    const imgRect = imgEl.getBoundingClientRect();
    const baseWidth = imgRect.width / scaleRef.current;
    const baseHeight = imgRect.height / scaleRef.current;
    const scaledWidth = baseWidth * s;
    const scaledHeight = baseHeight * s;
    const maxX = Math.max(0, (scaledWidth - containerRect.width) / 2);
    const maxY = Math.max(0, (scaledHeight - containerRect.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, tx)),
      y: Math.min(maxY, Math.max(-maxY, ty)),
    };
  }, []);

  const applyZoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const prevScale = scaleRef.current;
    const prevT = translateRef.current;

    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    // Keep the point under the finger/cursor stationary while scaling
    const factor = clamped / prevScale;
    const nx = cx - (cx - prevT.x) * factor;
    const ny = cy - (cy - prevT.y) * factor;
    const clampedT = clampTranslate(nx, ny, clamped);

    setScale(clamped);
    setTranslate(clampedT);
    onZoomChange?.(clamped > 1.01);
  }, [clampTranslate, onZoomChange]);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // A second finger landed: this is a pinch, never a tap.
      tapCandidateRef.current = null;
      clearPendingClose();
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStart.current = {
        dist,
        scale: scaleRef.current,
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
      dragStart.current = null;
    } else if (pointers.current.size === 1) {
      // Double-tap / double-click detection
      const now = Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        tapCandidateRef.current = null; // this pointerup belongs to the double-tap, not a single tap
        clearPendingClose(); // cancel any pending single-tap-close from the first tap
        if (scaleRef.current > 1.01) {
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomChange?.(false);
        } else {
          applyZoomAt(e.clientX, e.clientY, DOUBLE_TAP_SCALE);
        }
        return;
      }
      lastTapRef.current = now;
      tapCandidateRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, time: now };

      if (scaleRef.current > 1.01) {
        dragStart.current = {
          x: e.clientX,
          y: e.clientY,
          tx: translateRef.current.x,
          ty: translateRef.current.y,
        };
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Movement beyond tolerance disqualifies this gesture from being a tap
    const tap = tapCandidateRef.current;
    if (tap && tap.pointerId === e.pointerId) {
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      if (moved > TAP_MOVE_TOLERANCE) tapCandidateRef.current = null;
    }

    if (pointers.current.size === 2 && pinchStart.current) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const nextScale = pinchStart.current.scale * (dist / pinchStart.current.dist);
      applyZoomAt(pinchStart.current.mid.x, pinchStart.current.mid.y, nextScale);
    } else if (pointers.current.size === 1 && dragStart.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const clamped = clampTranslate(dragStart.current.tx + dx, dragStart.current.ty + dy, scaleRef.current);
      setTranslate(clamped);
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size < 1) dragStart.current = null;

    // Snap back to 1x if the user pinched below the minimum
    if (pointers.current.size === 0 && scaleRef.current < MIN_SCALE + 0.01) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      onZoomChange?.(false);
    }

    // A single tap (no drag, released quickly) while zoomed in closes the zoom.
    // The close is deferred until the double-tap window fully elapses, so an
    // intended double-tap's first tap-up never pre-empts the double-tap action
    // (handlePointerDown cancels this timeout as soon as a 2nd tap arrives).
    const tap = tapCandidateRef.current;
    if (tap && tap.pointerId === e.pointerId) {
      tapCandidateRef.current = null;
      const withinTime = Date.now() - tap.time < TAP_MAX_MS;
      if (withinTime && scaleRef.current > 1.01) {
        clearPendingClose();
        pendingCloseTimeoutRef.current = setTimeout(() => {
          pendingCloseTimeoutRef.current = null;
          setScale(1);
          setTranslate({ x: 0, y: 0 });
          onZoomChange?.(false);
        }, DOUBLE_TAP_MS);
      }
    }
  };

  const zoomed = scale > 1.01;

  return (
    <div
      ref={containerRef}
      className="max-w-[92vw] max-h-[92vh] w-full h-full flex items-center justify-center touch-none select-none"
      style={{ overscrollBehavior: "contain" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className={className}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: zoomed ? "none" : "transform 0.15s ease-out",
          cursor: zoomed ? "grab" : "zoom-in",
          willChange: "transform",
        }}
        {...rest}
      />
    </div>
  );
}
