import { useQuery } from "@tanstack/react-query";
import { usePlayer, type ArtistTrack } from "@/context/PlayerContext";
import { Play, Pause, Music, X, ChevronDown, Headphones } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";

function formatDuration(secs: number): string {
  if (!secs || isNaN(secs)) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface ArtistGroup {
  slug: string;
  name: string;
  tracks: ArtistTrack[];
}

interface MusicDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MusicDrawer({ open, onClose }: MusicDrawerProps) {
  const { data, isLoading } = useQuery<{ artists: ArtistGroup[] }>({
    queryKey: ["/api/artists/all-tracks"],
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const artists = data?.artists ?? [];
  const { currentTrack, isPlaying, play, pause } = usePlayer();
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (artists.length > 0 && expandedArtist === null) {
      setExpandedArtist(artists[0].slug);
    }
  }, [open, artists.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onOutside), 100);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open, onClose]);

  const allTracks = artists.flatMap(a => a.tracks);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            ref={drawerRef}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-[420px] flex flex-col"
            style={{
              background: "linear-gradient(160deg, #0f0f0f 0%, #161616 60%, #111 100%)",
              borderLeft: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "-24px 0 80px rgba(0,0,0,0.6)",
            }}
            data-testid="music-drawer"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="flex items-center gap-2.5">
                <Headphones className="w-4 h-4" style={{ color: "hsl(var(--primary))" }} />
                <span className="text-sm font-bold tracking-wide text-white">Музыка</span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                style={{ color: "rgba(255,255,255,0.35)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                data-testid="music-drawer-close"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2">
              {isLoading && (
                <div className="space-y-2 px-2 pt-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.08)" }} />
                  ))}
                </div>
              )}

              {!isLoading && artists.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                  <Music className="w-10 h-10 opacity-15 text-white" />
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Треки ещё не добавлены</p>
                </div>
              )}

              {!isLoading && artists.map((artist) => {
                const isExpanded = expandedArtist === artist.slug;
                const artistHasActive = artist.tracks.some(t => currentTrack?.id === t.id);

                return (
                  <div key={artist.slug} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
                    {/* Artist row */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedArtist(isExpanded ? null : artist.slug)}
                      onKeyDown={e => { if (e.key === "Enter") setExpandedArtist(isExpanded ? null : artist.slug); }}
                      className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                      style={{ color: artistHasActive ? "hsl(var(--primary))" : "rgba(255,255,255,0.85)" }}
                      data-testid={`music-drawer-artist-${artist.slug}`}
                    >
                      <div
                        className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.08)" }}
                      >
                        {artist.tracks[0]?.coverUrl ? (
                          <img src={artist.tracks[0].coverUrl} alt={artist.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <Music className="w-4 h-4 opacity-30" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[13px] font-semibold leading-tight truncate">{artist.name}</p>
                        <p className="text-[11px] mt-0.5 opacity-40">
                          {artist.tracks.length} {artist.tracks.length === 1 ? "трек" : artist.tracks.length < 5 ? "трека" : "треков"}
                        </p>
                      </div>
                      <ChevronDown
                        className="w-4 h-4 flex-shrink-0 transition-transform duration-200 opacity-40"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                      />
                    </div>

                    {/* Tracks */}
                    <div
                      style={{
                        maxHeight: isExpanded ? `${artist.tracks.length * 60 + 8}px` : "0px",
                        overflow: "hidden",
                        transition: "max-height 0.3s cubic-bezier(0.4,0,0.2,1)",
                      }}
                    >
                      <div className="px-2 pb-2 space-y-0.5">
                        {artist.tracks.map((track, idx) => {
                          const isActive = currentTrack?.id === track.id;
                          const isThisPlaying = isActive && isPlaying;

                          return (
                            <div
                              key={track.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => { if (isActive && isThisPlaying) pause(); else play(track, allTracks); }}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  if (isActive && isThisPlaying) pause(); else play(track, allTracks);
                                }
                              }}
                              className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer select-none transition-all duration-150"
                              style={{ background: isActive ? "hsla(var(--primary)/0.12)" : "transparent" }}
                              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.05)"; }}
                              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                              data-testid={`music-drawer-track-${track.id}`}
                            >
                              <div className="relative w-9 h-9 rounded-lg overflow-hidden flex-shrink-0" style={{ background: "rgba(255,255,255,0.1)" }}>
                                {track.coverUrl ? (
                                  <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Music className="w-4 h-4 opacity-20" />
                                  </div>
                                )}
                                {isActive && (
                                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
                                    {isThisPlaying ? <Pause className="w-3.5 h-3.5 text-white" /> : <Play className="w-3.5 h-3.5 text-white" />}
                                  </div>
                                )}
                              </div>

                              <div className="w-4 flex-shrink-0 flex items-center justify-center">
                                {isActive ? (
                                  <div className="flex items-end gap-[2px] h-3.5">
                                    {[0, 1, 2].map(i => (
                                      <div
                                        key={i}
                                        className="w-[2.5px] rounded-full"
                                        style={{
                                          height: isThisPlaying ? `${7 + i * 3}px` : "3px",
                                          background: "hsl(var(--primary))",
                                          animation: isThisPlaying ? `pulse ${0.5 + i * 0.2}s ease-in-out infinite alternate` : "none",
                                        }}
                                      />
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[11px] opacity-25 text-white">{idx + 1}</span>
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-medium leading-tight truncate" style={{ color: isActive ? "hsl(var(--primary))" : "rgba(255,255,255,0.8)" }}>
                                  {track.title}
                                </p>
                                {track.subtitle && (
                                  <p className="text-[10px] mt-0.5 opacity-35 truncate text-white">{track.subtitle}</p>
                                )}
                              </div>

                              <span className="text-[11px] opacity-30 flex-shrink-0 tabular-nums text-white">
                                {formatDuration(track.duration)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <Link
                href="/products/merch"
                onClick={onClose}
                className="text-[12px] text-center block w-full transition-colors font-medium"
                style={{ color: "rgba(255,255,255,0.6)" }}
                onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#fff")}
                onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.6)")}
              >
                Все коллаборации →
              </Link>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
