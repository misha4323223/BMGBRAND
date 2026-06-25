import { useQuery } from "@tanstack/react-query";
import { usePlayer, type ArtistTrack } from "@/context/PlayerContext";
import { Play, Pause, Music, Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function formatDuration(secs: number): string {
  if (!secs || isNaN(secs)) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPlays(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function extractDominantColor(imgUrl: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve([80, 80, 80]); return; }
        ctx.drawImage(img, 0, 0, 40, 40);
        const { data } = ctx.getImageData(0, 0, 40, 40);
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        if (count > 0) resolve([Math.round(r / count), Math.round(g / count), Math.round(b / count)]);
        else resolve([80, 80, 80]);
      } catch { resolve([80, 80, 80]); }
    };
    img.onerror = () => resolve([80, 80, 80]);
    img.src = imgUrl;
  });
}

interface TrackListProps {
  artistSlug: string;
  accentColor?: string;
  textColor?: string;
  bgColor?: string;
  isColored?: boolean;
}

export function TrackList({ artistSlug, accentColor, textColor, bgColor, isColored }: TrackListProps) {
  const { data, isLoading } = useQuery<{ tracks: ArtistTrack[] }>({
    queryKey: [`/api/artists/${artistSlug}/tracks`],
  });
  const tracks = data?.tracks || [];
  const { currentTrack, isPlaying, play, pause } = usePlayer();
  const [sectionBg, setSectionBg] = useState<string>("");
  const extractedForRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentTrack || currentTrack.artistSlug !== artistSlug) return;
    if (extractedForRef.current === currentTrack.id) return;
    if (!currentTrack.coverUrl) return;
    extractedForRef.current = currentTrack.id;
    extractDominantColor(currentTrack.coverUrl).then(([r, g, b]) => {
      setSectionBg(`rgba(${r},${g},${b},0.13)`);
    });
  }, [currentTrack, artistSlug]);

  useEffect(() => {
    if (extractedForRef.current !== null || tracks.length === 0) return;
    const first = tracks.find(t => t.coverUrl);
    if (!first) return;
    extractedForRef.current = -1;
    extractDominantColor(first.coverUrl).then(([r, g, b]) => {
      setSectionBg(`rgba(${r},${g},${b},0.10)`);
    });
  }, [tracks]);

  if (!isLoading && tracks.length === 0) return null;

  const accent = accentColor || "hsl(var(--primary))";

  return (
    <section
      className="py-14 sm:py-20 transition-colors duration-700"
      style={{ background: sectionBg || (bgColor ? bgColor : isColored ? "transparent" : "var(--background)") }}
      data-testid="section-artist-tracks"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-12">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-[2px] w-6 rounded-full shrink-0" style={{ background: accent }} />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.28em]"
            style={{ color: accent }}
          >
            Дискография
          </span>
        </div>
        <div className="flex items-center gap-3 mb-8">
          <h2
            className="text-2xl sm:text-3xl font-black tracking-tight"
            style={textColor ? { color: textColor } : {}}
          >
            Треки
          </h2>
          <Music className="w-5 h-5 opacity-30" />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[68px] rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {tracks.map((track, idx) => {
              const isActive = currentTrack?.id === track.id;
              const isThisPlaying = isActive && isPlaying;

              return (
                <div
                  key={track.id}
                  data-testid={`track-card-${track.id}`}
                  role="button"
                  tabIndex={0}
                  className="group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer select-none"
                  style={{
                    background: isActive ? `${accent}18` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isActive ? `${accent}45` : "rgba(255,255,255,0.08)"}`,
                  }}
                  onClick={() => {
                    if (isActive && isThisPlaying) pause();
                    else play(track, tracks);
                  }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (isActive && isThisPlaying) pause(); else play(track, tracks); } }}
                >
                  {/* Cover */}
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                    {track.coverUrl ? (
                      <img
                        src={track.coverUrl}
                        alt={track.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-5 h-5 opacity-30" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isThisPlaying
                        ? <Pause className="w-5 h-5 text-white" />
                        : <Play className="w-5 h-5 text-white" />}
                    </div>
                  </div>

                  {/* Track number / equalizer */}
                  <div className="w-5 flex-shrink-0 flex items-center justify-center">
                    {isActive ? (
                      <div className="flex items-end gap-[2px] h-4">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            className="w-[3px] rounded-full"
                            style={{
                              height: isThisPlaying ? `${10 + i * 3}px` : "4px",
                              background: accent,
                              animation: isThisPlaying ? `pulse ${0.6 + i * 0.2}s ease-in-out infinite alternate` : "none",
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs opacity-40" style={textColor ? { color: textColor } : {}}>
                        {idx + 1}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-semibold text-sm truncate transition-colors"
                      style={{ color: isActive ? accent : (textColor || "") }}
                    >
                      {track.title}
                    </p>
                  </div>

                  {/* Plays */}
                  <div className="hidden sm:flex items-center gap-1 text-xs opacity-40 flex-shrink-0">
                    <Headphones className="w-3 h-3" />
                    <span style={textColor ? { color: textColor } : {}}>{formatPlays(track.plays)}</span>
                  </div>

                  {/* Duration */}
                  <div
                    className="text-xs opacity-40 flex-shrink-0 w-9 text-right tabular-nums"
                    style={textColor ? { color: textColor } : {}}
                  >
                    {formatDuration(track.duration)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
