import { usePlayer } from "@/context/PlayerContext";
import { extractDominantColor } from "@/lib/color";
import { ChevronDown, Play, Pause, SkipBack, SkipForward, Music, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";

function formatTime(secs: number): string {
  if (!secs || isNaN(secs) || !isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface FullScreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullScreenPlayer({ open, onClose }: FullScreenPlayerProps) {
  const { currentTrack, isPlaying, currentTime, duration, toggle, seek, next, prev, setVolume, volume } = usePlayer();
  const [bgColor, setBgColor] = useState<string>("40,40,40");
  const [dragging, setDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const dragX = useMotionValue(0);
  const coverScale = useTransform(dragX, [-200, 0, 200], [0.85, 1, 0.85]);
  const coverOpacity = useTransform(dragX, [-200, 0, 200], [0.4, 1, 0.4]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayProgress = dragging ? dragProgress : progress;

  useEffect(() => {
    if (!currentTrack?.coverUrl) { setBgColor("40,40,40"); return; }
    let cancelled = false;
    extractDominantColor(currentTrack.coverUrl).then(([r, g, b]) => {
      if (!cancelled) setBgColor(`${r},${g},${b}`);
    });
    return () => { cancelled = true; };
  }, [currentTrack?.coverUrl]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function calcSeekPos(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): number {
    const bar = seekBarRef.current;
    if (!bar || !duration) return 0;
    const clientX = "touches" in e ? (e.touches[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? 0) : e.clientX;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  }

  function onSeekStart(e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
    setDragging(true);
    const pos = calcSeekPos(e);
    setDragProgress((pos / duration) * 100);

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const p = calcSeekPos(ev);
      setDragProgress((p / (duration || 1)) * 100);
    };
    const onEnd = (ev: MouseEvent | TouchEvent) => {
      seek(calcSeekPos(ev));
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
  }

  if (!currentTrack) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 340, damping: 36 }}
          className="fixed inset-0 z-[70] flex flex-col overflow-hidden"
          data-testid="fullscreen-player"
        >
          {/* Dynamic blurred background */}
          <div className="absolute inset-0 -z-10">
            <div
              className="absolute inset-0 transition-colors duration-700"
              style={{
                background: `radial-gradient(120% 90% at 50% 0%, rgba(${bgColor},0.55) 0%, rgba(10,10,10,0.97) 55%, #060606 100%)`,
              }}
            />
            {currentTrack.coverUrl && (
              <img
                src={currentTrack.coverUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover opacity-25"
                style={{ filter: "blur(60px) saturate(1.4)", transform: "scale(1.3)" }}
              />
            )}
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+16px)] pb-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform"
              style={{ background: "rgba(255,255,255,0.08)" }}
              data-testid="fullscreen-player-close"
              aria-label="Свернуть"
            >
              <ChevronDown className="w-5 h-5 text-white" />
            </button>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-semibold">Сейчас играет</p>
              <p className="text-[11px] text-white/70 truncate max-w-[160px] mx-auto">{currentTrack.subtitle || currentTrack.artistSlug}</p>
            </div>
            <div className="w-9 h-9" />
          </div>

          {/* Cover with swipe */}
          <div className="flex-1 flex items-center justify-center px-8 min-h-0">
            <motion.div
              className="relative w-full max-w-[340px] aspect-square rounded-2xl overflow-hidden touch-pan-y"
              style={{ x: dragX, scale: coverScale, opacity: coverOpacity, boxShadow: `0 30px 80px -20px rgba(${bgColor},0.6), 0 10px 30px rgba(0,0,0,0.5)` }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={(_, info) => {
                if (info.offset.x < -80) next();
                else if (info.offset.x > 80) prev();
                dragX.set(0);
              }}
              data-testid="fullscreen-player-cover"
            >
              {currentTrack.coverUrl ? (
                <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-full h-full object-cover pointer-events-none select-none" draggable={false} />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                  <Music className="w-16 h-16 text-white/20" />
                </div>
              )}
            </motion.div>
          </div>

          {/* Title */}
          <div className="px-7 flex-shrink-0">
            <h2 className="text-2xl font-black text-white leading-tight truncate" data-testid="fullscreen-player-title">
              {currentTrack.title}
            </h2>
            <p className="text-sm text-white/50 mt-1 truncate">{currentTrack.subtitle || currentTrack.artistSlug}</p>
          </div>

          {/* Seek bar */}
          <div className="px-7 mt-6 flex-shrink-0">
            <div
              ref={seekBarRef}
              onMouseDown={onSeekStart}
              onTouchStart={onSeekStart}
              className="relative h-1.5 rounded-full cursor-pointer group"
              style={{ background: "rgba(255,255,255,0.15)" }}
              data-testid="fullscreen-player-seekbar"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${displayProgress}%`, background: `rgb(${bgColor})`, filter: `drop-shadow(0 0 6px rgba(${bgColor},0.7))` }}
              />
              <div
                className="absolute top-1/2 w-3.5 h-3.5 rounded-full -translate-y-1/2 shadow-lg"
                style={{ left: `${displayProgress}%`, transform: "translate(-50%, -50%)", background: "#fff" }}
              />
            </div>
            <div className="flex justify-between mt-2 text-[11px] tabular-nums text-white/40 font-mono">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6 px-7 mt-8 flex-shrink-0">
            <button
              onClick={prev}
              className="w-11 h-11 flex items-center justify-center text-white/70 active:scale-90 transition-transform"
              data-testid="fullscreen-player-prev"
              aria-label="Предыдущий"
            >
              <SkipBack className="w-7 h-7" fill="currentColor" />
            </button>
            <button
              onClick={toggle}
              className="w-[72px] h-[72px] rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: "#fff", boxShadow: `0 8px 24px rgba(${bgColor},0.5)` }}
              data-testid="fullscreen-player-toggle"
              aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
            >
              {isPlaying
                ? <Pause className="w-8 h-8 text-black" fill="currentColor" />
                : <Play className="w-8 h-8 text-black translate-x-0.5" fill="currentColor" />}
            </button>
            <button
              onClick={next}
              className="w-11 h-11 flex items-center justify-center text-white/70 active:scale-90 transition-transform"
              data-testid="fullscreen-player-next"
              aria-label="Следующий"
            >
              <SkipForward className="w-7 h-7" fill="currentColor" />
            </button>
          </div>

          {/* Volume */}
          <div className="hidden sm:flex items-center gap-3 px-7 mt-8 flex-shrink-0">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 1)}
              className="text-white/50"
              aria-label="Громкость"
            >
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              className="flex-1 cursor-pointer"
              style={{ accentColor: `rgb(${bgColor})` }}
              aria-label="Уровень громкости"
            />
          </div>

          <p className="text-center text-[10px] text-white/25 mt-6 mb-[calc(env(safe-area-inset-bottom)+20px)] flex-shrink-0">
            Свайп по обложке — следующий / предыдущий трек
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
