import { useEffect } from "react";
import { useLocation } from "wouter";
import { ChevronUp, Loader2, Pause, Play } from "lucide-react";
import { RADIO_STATION, shouldShowRadioStrip } from "@shared/radio";
import { useRadio } from "@/context/RadioContext";
import { usePlayer } from "@/context/PlayerContext";
import { Equalizer } from "@/components/RadioStrip";

/**
 * Мобильный мини-плеер радио — «место» свёрнутой полоски эфира.
 *
 * Логика та же, что у плеера сайта (GlobalPlayer): тёмная панель, прижатая к низу
 * экрана; если открыт плеер сайта, наш встаёт ровно над ним. Кнопка-стрелка вверх
 * возвращает полоску в навбар (`setCollapsed(false)`).
 *
 * Пока плеер открыт, освобождаем место внизу страницы (padding у `#root`) и прячем
 * кнопку чата — плеер сайта делает ровно то же. Десктоп не затрагивается: там
 * полоска всегда развёрнута, а сам плеер скрыт (`lg:hidden`).
 */

/** Высота панели плеера сайта (74px) + полоса перемотки (3px) — встаём ровно над ним. */
const SITE_PLAYER_HEIGHT_PX = 77;

export function RadioMiniPlayer() {
  const { isPlaying, isConnecting, error, nowPlaying, toggle, collapsed, setCollapsed } = useRadio();
  const { currentTrack } = usePlayer();
  const [location] = useLocation();
  const visible = collapsed && shouldShowRadioStrip(location);

  useEffect(() => {
    if (!visible) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      const active = !desktop.matches;
      document.body.classList.toggle("radio-mini-open", active);
      const root = document.getElementById("root");
      if (root) root.style.paddingBottom = active ? "64px" : "";
    };
    apply();
    desktop.addEventListener("change", apply);
    return () => {
      desktop.removeEventListener("change", apply);
      document.body.classList.remove("radio-mini-open");
      const root = document.getElementById("root");
      if (root) root.style.paddingBottom = "";
    };
  }, [visible]);

  if (!visible) return null;

  const label = isConnecting
    ? "Подключаемся к эфиру…"
    : error
      ? error
      : nowPlaying
        ? nowPlaying
        : RADIO_STATION.tagline;

  return (
    <div
      className="radio-mini-player fixed inset-x-0 z-40 transition-[bottom] duration-300 lg:hidden"
      style={{ bottom: currentTrack ? SITE_PLAYER_HEIGHT_PX : 0 }}
      role="region"
      aria-label="Радио «Дикая Мята»"
      data-testid="radio-mini-player"
    >
      <div
        className="flex h-14 items-center gap-3 px-3 animate-in slide-in-from-bottom-4 duration-300"
        style={{
          background: "linear-gradient(135deg, #151515 0%, #1c1c1c 100%)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.55)",
        }}
      >
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <Equalizer playing={isPlaying} />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-semibold leading-tight text-white"
            data-testid="radio-mini-now-playing"
          >
            {label}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-white/40">
            {RADIO_STATION.name} · прямой эфир
          </p>
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Поставить эфир на паузу" : "Слушать эфир «Дикая Мята»"}
          data-testid="button-radio-mini-toggle"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all active:scale-90"
          style={{ background: "hsl(var(--primary))", boxShadow: "0 0 18px hsla(var(--primary) / 0.5)" }}
        >
          {isConnecting ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin text-white" />
          ) : isPlaying ? (
            <Pause className="h-[18px] w-[18px] text-white" />
          ) : (
            <Play className="h-[18px] w-[18px] translate-x-px text-white" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Вернуть полоску эфира в навбар"
          title="Вернуть в навбар"
          data-testid="button-radio-mini-expand"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/45 transition-all hover:text-white active:scale-90"
        >
          <ChevronUp className="h-[17px] w-[17px]" />
        </button>
      </div>
    </div>
  );
}
