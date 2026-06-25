import { usePlayer } from "@/context/PlayerContext";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, Music, BrainCog } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

function formatTime(secs: number): string {
  if (!secs || isNaN(secs) || !isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function GlobalPlayer() {
  const { currentTrack, isPlaying, currentTime, duration, toggle, seek, next, prev, setVolume, volume, close } = usePlayer();
  const [dragging, setDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const seekBarRef = useRef<HTMLDivElement>(null);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayProgress = dragging ? dragProgress : progress;

  /* Body padding so content isn't hidden behind player */
  useEffect(() => {
    document.body.style.paddingBottom = currentTrack ? "80px" : "";
    return () => { document.body.style.paddingBottom = ""; };
  }, [!!currentTrack]);

  /* MediaSession position sync */
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack || !duration) return;
    try {
      (navigator.mediaSession as any).setPositionState?.({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {}
  }, [currentTime, duration, currentTrack]);

  function calcSeekPos(e: React.MouseEvent | MouseEvent): number {
    const bar = seekBarRef.current;
    if (!bar || !duration) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  }

  function onSeekMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    setDragging(true);
    const pos = calcSeekPos(e);
    setDragProgress((pos / duration) * 100);

    const onMove = (ev: MouseEvent) => {
      const p = calcSeekPos(ev);
      setDragProgress((p / (duration || 1)) * 100);
    };
    const onUp = (ev: MouseEvent) => {
      seek(calcSeekPos(ev));
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }


  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          initial={{ y: 88 }}
          animate={{ y: 0 }}
          exit={{ y: 88 }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          className="fixed bottom-0 left-0 right-0 z-50"
          data-testid="global-player"
        >
          {/* ── Seek bar (clickable strip above panel) ── */}
          <div
            ref={seekBarRef}
            onMouseDown={onSeekMouseDown}
            onClick={e => { if (!dragging) seek(calcSeekPos(e)); }}
            className="relative h-[3px] cursor-pointer group"
            style={{ background: "rgba(255,255,255,0.08)" }}
            data-testid="player-seekbar"
          >
            {/* filled */}
            <div
              className="absolute inset-y-0 left-0 transition-none"
              style={{ width: `${displayProgress}%`, background: "hsl(var(--primary))" }}
            />
            {/* thumb dot */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${displayProgress}%`, transform: "translate(-50%, -50%)", background: "hsl(var(--primary))" }}
            />
          </div>

          {/* ── Main panel ── */}
          <div
            className="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 h-[74px]"
            style={{
              background: "linear-gradient(135deg, #151515 0%, #1c1c1c 100%)",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.55)",
            }}
          >
            {/* Cover */}
            <div
              className="w-[46px] h-[46px] rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.06)", boxShadow: "0 2px 10px rgba(0,0,0,0.4)" }}
            >
              {currentTrack.coverUrl ? (
                <img src={currentTrack.coverUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
              ) : (
                <Music className="w-5 h-5" style={{ color: "rgba(255,255,255,0.3)" }} />
              )}
            </div>

            {/* Title + artist */}
            <div className="flex-1 min-w-0">
              <p
                className="text-[13px] font-semibold leading-tight truncate"
                style={{ color: "#ffffff" }}
                data-testid="player-track-title"
              >
                {currentTrack.title}
              </p>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={prev}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all active:scale-90"
                style={{ color: "rgba(255,255,255,0.55)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
                data-testid="player-prev"
                aria-label="Предыдущий"
              >
                <SkipBack className="w-[17px] h-[17px]" />
              </button>

              <button
                onClick={toggle}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 mx-1"
                style={{ background: "hsl(var(--primary))", boxShadow: "0 0 18px hsla(var(--primary)/0.5)" }}
                data-testid="player-toggle"
                aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
              >
                {isPlaying
                  ? <Pause className="w-[18px] h-[18px] text-white" />
                  : <Play className="w-[18px] h-[18px] text-white translate-x-px" />}
              </button>

              <button
                onClick={next}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all active:scale-90"
                style={{ color: "rgba(255,255,255,0.55)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
                data-testid="player-next"
                aria-label="Следующий"
              >
                <SkipForward className="w-[17px] h-[17px]" />
              </button>
            </div>

            {/* Time — desktop */}
            <div
              className="hidden sm:flex items-center gap-1 text-[11px] tabular-nums flex-shrink-0 font-mono"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              <span style={{ color: "rgba(255,255,255,0.7)" }}>{formatTime(currentTime)}</span>
              <span className="mx-0.5">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Volume — desktop */}
            <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setVolume(volume > 0 ? 0 : 1)}
                className="w-7 h-7 flex items-center justify-center rounded transition-all"
                style={{ color: "rgba(255,255,255,0.42)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.42)")}
                data-testid="player-volume-btn"
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
                className="w-20 cursor-pointer"
                style={{ accentColor: "hsl(var(--primary))", height: "3px" }}
                aria-label="Уровень громкости"
                data-testid="player-volume"
              />
            </div>

            {/* BOOOM AI shortcut */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-booom-ai"))}
              className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg transition-all flex-shrink-0 active:scale-90"
              style={{
                color: "hsl(var(--primary))",
                background: "hsla(var(--primary)/0.15)",
                boxShadow: "0 0 10px hsla(var(--primary)/0.25)",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "hsla(var(--primary)/0.28)";
                e.currentTarget.style.boxShadow = "0 0 16px hsla(var(--primary)/0.5)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "hsla(var(--primary)/0.15)";
                e.currentTarget.style.boxShadow = "0 0 10px hsla(var(--primary)/0.25)";
              }}
              data-testid="player-open-ai"
              aria-label="BOOOM AI"
              title="BOOOM AI"
            >
              <BrainCog className="w-4 h-4" />
            </button>

            {/* Close */}
            <button
              onClick={close}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-all flex-shrink-0 active:scale-90"
              style={{ color: "rgba(255,255,255,0.28)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.28)")}
              data-testid="player-close"
              aria-label="Закрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
