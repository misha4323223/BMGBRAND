import { usePlayer } from "@/context/PlayerContext";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

function formatTime(secs: number): string {
  if (!secs || isNaN(secs) || !isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function GlobalPlayer() {
  const { currentTrack, isPlaying, currentTime, duration, toggle, seek, next, prev, setVolume, volume, close } = usePlayer();
  const [showVolume, setShowVolume] = useState(false);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  useEffect(() => {
    if (currentTrack) {
      document.body.style.paddingBottom = "76px";
    } else {
      document.body.style.paddingBottom = "";
    }
    return () => { document.body.style.paddingBottom = ""; };
  }, [!!currentTrack]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack || !duration) return;
    try {
      (navigator.mediaSession as any).setPositionState?.({
        duration: duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {}
  }, [currentTime, duration, currentTrack]);

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="fixed bottom-0 left-0 right-0 z-50"
          data-testid="global-player"
        >
          {/* Seek bar */}
          <div
            className="h-1 bg-white/10 cursor-pointer group/seek"
            onClick={e => {
              if (!duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div
              className="h-full transition-none"
              style={{ width: `${progress}%`, background: "hsl(var(--primary))" }}
            />
          </div>

          {/* Player bar */}
          <div className="bg-black/92 backdrop-blur-xl border-t border-white/10 px-3 sm:px-6 py-2.5 flex items-center gap-3">

            {/* Cover + info */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                {currentTrack.coverUrl && (
                  <img
                    src={currentTrack.coverUrl}
                    alt={currentTrack.title}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p
                  className="text-white text-xs font-semibold truncate leading-tight"
                  data-testid="player-track-title"
                >
                  {currentTrack.title}
                </p>
                <p className="text-white/45 text-[10px] truncate capitalize leading-tight mt-0.5">
                  {currentTrack.artistSlug.replace(/-/g, " ")}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
              <button
                onClick={prev}
                className="w-8 h-8 flex items-center justify-center text-white/55 hover:text-white transition-colors rounded-lg hover:bg-white/8"
                data-testid="player-prev"
                aria-label="Предыдущий трек"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                onClick={toggle}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all active:scale-95 mx-1"
                style={{ background: "hsl(var(--primary))" }}
                data-testid="player-toggle"
                aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
              >
                {isPlaying
                  ? <Pause className="w-[18px] h-[18px]" />
                  : <Play className="w-[18px] h-[18px] translate-x-px" />}
              </button>

              <button
                onClick={next}
                className="w-8 h-8 flex items-center justify-center text-white/55 hover:text-white transition-colors rounded-lg hover:bg-white/8"
                data-testid="player-next"
                aria-label="Следующий трек"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Time (desktop) */}
            <div className="hidden sm:flex items-center gap-1 text-[10px] text-white/40 tabular-nums flex-shrink-0">
              <span>{formatTime(currentTime)}</span>
              <span className="opacity-50">/</span>
              <span>{formatTime(duration)}</span>
            </div>

            {/* Volume (desktop) */}
            <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  if (volume > 0) { setVolume(0); }
                  else { setVolume(1); }
                  setShowVolume(v => !v);
                }}
                className="w-7 h-7 flex items-center justify-center text-white/45 hover:text-white transition-colors"
                data-testid="player-volume"
                aria-label="Громкость"
              >
                {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              {showVolume && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={volume}
                  onChange={e => setVolume(Number(e.target.value))}
                  className="w-20 h-1 accent-primary cursor-pointer"
                  aria-label="Уровень громкости"
                />
              )}
            </div>

            {/* Close */}
            <button
              onClick={close}
              className="w-7 h-7 flex items-center justify-center text-white/35 hover:text-white/80 transition-colors flex-shrink-0"
              data-testid="player-close"
              aria-label="Закрыть плеер"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
