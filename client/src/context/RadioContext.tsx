import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RADIO_STATION } from "@shared/radio";
import { usePlayer } from "@/context/PlayerContext";
import { getGuestSessionId } from "@/hooks/use-session";

/**
 * Живой эфир «Дикой Мяты» — глобальное состояние на весь сайт.
 *
 * Почему провайдер, а не компонент полоски: каждая страница монтирует свой
 * `<Navbar />`, поэтому аудио-элемент внутри полоски умирал бы на каждом
 * переходе и эфир обрывался. Провайдер смонтирован один раз в App и живёт
 * дольше страниц.
 *
 * Аудио идёт напрямую со станции в браузер — наш сервер в потоке не участвует,
 * поэтому расход трафика у сайта не растёт. Метаданные трека («сейчас играет»)
 * читает сервер одним кэширующим запросом: /api/radio/now-playing.
 */

const VOLUME_STORAGE_KEY = "booomerangs_radio_volume";
/** Свёрнута ли полоска на мобильном (эфир уезжает в нижний мини-плеер). */
const COLLAPSED_STORAGE_KEY = "booomerangs_radio_collapsed";
const DEFAULT_VOLUME = 0.8;
const NOW_PLAYING_POLL_MS = 25_000;
const CONNECT_TIMEOUT_MS = 15_000;

interface RadioContextValue {
  isPlaying: boolean;
  isConnecting: boolean;
  error: string | null;
  volume: number;
  nowPlaying: string | null;
  /** Сколько людей слушают эфир на нашем сайте прямо сейчас (null — неизвестно). */
  listeners: number | null;
  /** Свёрнута ли полоска на мобильном: она уходит из навбара в нижний мини-плеер. */
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setVolume: (value: number) => void;
}

const RadioContext = createContext<RadioContextValue | null>(null);

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function RadioProvider({ children }: { children: ReactNode }) {
  const player = usePlayer();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState<number>(readStoredVolume);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [listeners, setListeners] = useState<number | null>(null);
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed);
  const volumeRef = useRef(volume);
  // Плеер сайта обновляет контекст каждую секунду (currentTime) — держим его в ref,
  // чтобы наш value не менял идентичность и не ре-рендерил полоску зря.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current !== null) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;

    const audio = new Audio();
    audio.preload = "none";
    audio.volume = volumeRef.current;

    audio.addEventListener("playing", () => {
      setIsPlaying(true);
      setIsConnecting(false);
      setError(null);
      clearConnectTimer();
    });
    audio.addEventListener("pause", () => {
      setIsPlaying(false);
      setIsConnecting(false);
    });
    audio.addEventListener("waiting", () => setIsConnecting(true));
    audio.addEventListener("error", () => {
      // Снятый src (после паузы) — это не ошибка: соединение закрыли намеренно.
      if (!audio.getAttribute("src")) return;
      setIsPlaying(false);
      setIsConnecting(false);
      setError("Эфир недоступен");
    });

    audioRef.current = audio;
    return audio;
  }, [clearConnectTimer]);

  const play = useCallback(() => {
    // Трек из «Музыки» сайта и живой эфир не должны звучать одновременно.
    playerRef.current.pause();

    const audio = getAudio();
    setError(null);
    setIsConnecting(true);

    if (audio.getAttribute("src") !== RADIO_STATION.streamUrl) {
      audio.setAttribute("src", RADIO_STATION.streamUrl);
    }

    const started = audio.play();
    if (started && typeof started.catch === "function") {
      started.catch(() => {
        setIsPlaying(false);
        setIsConnecting(false);
        setError("Не удалось включить эфир");
      });
    }

    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      connectTimerRef.current = null;
      const current = audioRef.current;
      // Если поток так и не начал играть (или сразу встал) — говорим об этом честно.
      if (!current || !current.paused) return;
      setIsConnecting(false);
      setError("Эфир не отвечает — попробуйте позже");
    }, CONNECT_TIMEOUT_MS);
  }, [clearConnectTimer, getAudio]);

  const pause = useCallback(() => {
    clearConnectTimer();
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    // Закрываем соединение со станцией: иначе браузер продолжает тянуть live-поток в фоне.
    audio.removeAttribute("src");
    audio.load();
    setIsPlaying(false);
    setIsConnecting(false);
  }, [clearConnectTimer]);

  const toggle = useCallback(() => {
    if (isPlaying || isConnecting) pause();
    else play();
  }, [isConnecting, isPlaying, pause, play]);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  }, []);

  const setVolume = useCallback((value: number) => {
    const next = clampVolume(value);
    setVolumeState(next);
    if (audioRef.current) audioRef.current.volume = next;
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  }, []);

  // Громкость на элемент + в ref (audio создаётся лениво, уже после первого клика).
  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Включили трек в плеере сайта — эфир уходит на паузу.
  const siteIsPlaying = player.isPlaying;
  useEffect(() => {
    if (siteIsPlaying && isPlaying) pause();
  }, [siteIsPlaying, isPlaying, pause]);

  // «Сейчас играет» — только пока эфир играет, раз в 25 секунд.
  useEffect(() => {
    if (!isPlaying) {
      setNowPlaying(null);
      setListeners(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    // Тот же анонимный id, что и у корзины: один человек = один слушатель.
    const guestId = getGuestSessionId();
    const url = guestId
      ? `${RADIO_STATION.nowPlayingUrl}?listener=${encodeURIComponent(guestId)}`
      : RADIO_STATION.nowPlayingUrl;

    const load = async () => {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { title?: string | null; listeners?: number | null };
        if (cancelled) return;
        setNowPlaying(data.title && data.title.trim() ? data.title.trim() : null);
        setListeners(
          typeof data.listeners === "number" && Number.isFinite(data.listeners)
            ? data.listeners
            : null,
        );
      } catch {
        /* тихо: полоска покажет подпись станции */
      }
    };

    void load();
    const timer = setInterval(() => void load(), NOW_PLAYING_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [isPlaying]);

  // Уход со вкладки/размонтирование — не оставляем соединение висеть.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
    };
  }, []);

  const value = useMemo<RadioContextValue>(
    () => ({
      isPlaying,
      isConnecting,
      error,
      volume,
      nowPlaying,
      listeners,
      collapsed,
      setCollapsed,
      play,
      pause,
      toggle,
      setVolume,
    }),
    [
      collapsed,
      error,
      isConnecting,
      isPlaying,
      listeners,
      nowPlaying,
      pause,
      play,
      setCollapsed,
      setVolume,
      toggle,
      volume,
    ],
  );

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio must be used within RadioProvider");
  return ctx;
}
