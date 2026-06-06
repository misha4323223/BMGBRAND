import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

interface SpinViewerProps {
  frames: string[];
  fps?: number;
  className?: string;
}

export default function SpinViewer({ frames, fps = 8, className = "" }: SpinViewerProps) {
  const [current, setCurrent] = useState(0);
  const [spinning, setSpinning] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const dragStartFrame = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = frames.length;

  useEffect(() => {
    if (spinning && !dragging) {
      intervalRef.current = setInterval(() => {
        setCurrent((c) => (c + 1) % total);
      }, 1000 / fps);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [spinning, dragging, fps, total]);

  const stopSpin = () => setSpinning(false);
  const startSpin = () => { if (!dragging) setSpinning(true); };

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    setSpinning(false);
    dragStartX.current = e.clientX;
    dragStartFrame.current = current;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || dragStartX.current === null) return;
    const dx = e.clientX - dragStartX.current;
    const step = Math.round(dx / 40);
    const next = ((dragStartFrame.current - step) % total + total) % total;
    setCurrent(next);
  };

  const onPointerUp = () => {
    setDragging(false);
    dragStartX.current = null;
  };

  return (
    <div
      className={`relative select-none overflow-hidden rounded-xl bg-white ${className}`}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onMouseEnter={stopSpin}
      onMouseLeave={startSpin}
    >
      {frames.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={`view-${i}`}
          draggable={false}
          className="w-full h-full object-cover absolute inset-0 transition-opacity duration-75"
          style={{ opacity: i === current ? 1 : 0 }}
        />
      ))}

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/30 backdrop-blur-sm text-white text-xs font-medium px-3 py-1 rounded-full pointer-events-none">
        <RotateCcw className="w-3 h-3" />
        360°
      </div>

      {!spinning && (
        <button
          className="absolute top-3 right-3 bg-black/20 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded-full hover:bg-black/40 transition-colors pointer-events-auto"
          onMouseDown={(e) => { e.stopPropagation(); setSpinning(true); }}
        >
          ▶ авто
        </button>
      )}
    </div>
  );
}
