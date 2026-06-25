import { createContext, useContext, useRef, useState, useEffect, useCallback, type ReactNode } from "react";

export interface ArtistTrack {
  id: number;
  artistSlug: string;
  title: string;
  subtitle: string;
  audioUrl: string;
  coverUrl: string;
  duration: number;
  trackOrder: number;
  plays: number;
  isActive: boolean;
  createdAt: string;
}

interface PlayerContextValue {
  currentTrack: ArtistTrack | null;
  queue: ArtistTrack[];
  isPlaying: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  play: (track: ArtistTrack, queue?: ArtistTrack[]) => void;
  pause: () => void;
  resume: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const pendingPlays = new Map<number, number>();

function flushPlays() {
  if (pendingPlays.size === 0) return;
  for (const [trackId, count] of pendingPlays.entries()) {
    fetch(`/api/artists/tracks/${trackId}/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    }).catch(() => {});
  }
  pendingPlays.clear();
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<ArtistTrack[]>([]);
  const currentTrackRef = useRef<ArtistTrack | null>(null);
  const [currentTrack, setCurrentTrack] = useState<ArtistTrack | null>(null);
  const [queue, setQueue] = useState<ArtistTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const playTrack = useCallback((track: ArtistTrack, q: ArtistTrack[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = track.audioUrl;
    audio.load();
    audio.play().catch(() => {});
    currentTrackRef.current = track;
    queueRef.current = q;
    setCurrentTrack(track);
    setQueue(q);
    setCurrentTime(0);
    setDuration(0);
    pendingPlays.set(track.id, (pendingPlays.get(track.id) || 0) + 1);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artistSlug.replace(/-/g, " "),
        artwork: track.coverUrl
          ? [{ src: track.coverUrl, sizes: "512x512", type: "image/jpeg" }]
          : [],
      });
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDuration = () => setDuration(isNaN(audio.duration) ? 0 : audio.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      const q = queueRef.current;
      const cur = currentTrackRef.current;
      if (!cur || q.length === 0) return;
      const idx = q.findIndex(t => t.id === cur.id);
      if (idx >= 0 && idx < q.length - 1) {
        playTrack(q[idx + 1], q);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    const flushInterval = setInterval(flushPlays, 60_000);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      clearInterval(flushInterval);
      flushPlays();
    };
  }, [playTrack]);

  const play = useCallback((track: ArtistTrack, q?: ArtistTrack[]) => {
    playTrack(track, q || [track]);
  }, [playTrack]);

  const pause = useCallback(() => { audioRef.current?.pause(); }, []);
  const resume = useCallback(() => { audioRef.current?.play().catch(() => {}); }, []);
  const toggle = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.paused ? audioRef.current.play().catch(() => {}) : audioRef.current.pause();
  }, []);

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const setVolume = useCallback((v: number) => {
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  }, []);

  const next = useCallback(() => {
    const q = queueRef.current;
    const cur = currentTrackRef.current;
    if (!cur || q.length === 0) return;
    const idx = q.findIndex(t => t.id === cur.id);
    if (idx >= 0 && idx < q.length - 1) playTrack(q[idx + 1], q);
  }, [playTrack]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const q = queueRef.current;
    const cur = currentTrackRef.current;
    if (!cur || q.length === 0) return;
    const idx = q.findIndex(t => t.id === cur.id);
    if (idx > 0) playTrack(q[idx - 1], q);
  }, [playTrack]);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ""; }
    currentTrackRef.current = null;
    queueRef.current = [];
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", resume);
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", prev);
  }, [resume, pause, next, prev]);

  return (
    <PlayerContext.Provider value={{
      currentTrack, queue, isPlaying, volume, currentTime, duration,
      play, pause, resume, toggle, seek, setVolume, next, prev, close,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
