import { ChevronDown, Headphones, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { RADIO_STATION, getVisibleListenersCount, listenersVerb } from "@shared/radio";
import { useRadio } from "@/context/RadioContext";

/**
 * Постоянная полоска эфира «Дикой Мяты» — встроена в навбар под строкой меню.
 *
 * Мобилка: аккуратный мини-плеер внутри тёмной капсулы навбара. Кнопка-шеврон
 * сворачивает полоску: она полностью уходит из навбара, а эфир дальше показывает
 * нижний мини-плеер (`RadioMiniPlayer`) — та же логика, что у плеера сайта.
 * Десктоп: тонкая полоса во всю ширину светлой стеклянной шапки, всегда развёрнута.
 * Полоска уезжает вместе с навбаром (в т.ч. при скрытии на мобильном скролле)
 * и не конфликтует с баннером партнёрки — тот выезжает ниже.
 */

const EQUALIZER_BARS = [9, 14, 7, 12, 10];

/** Эквалайзер эфира; экспортируется — нижний мини-плеер рисует такой же. */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span
      className={`flex h-3.5 items-end gap-[2px] ${playing ? "" : "opacity-35"}`}
      aria-hidden="true"
      data-testid="radio-equalizer"
    >
      {EQUALIZER_BARS.map((height, index) => (
        <span
          key={index}
          className={`w-[2px] rounded-full bg-primary ${playing ? "radio-eq-bar" : ""}`}
          style={{ height: `${height}px`, animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  );
}

export function RadioStrip() {
  const {
    isPlaying,
    isConnecting,
    error,
    volume,
    nowPlaying,
    listeners,
    toggle,
    setVolume,
    collapsed,
    setCollapsed,
  } = useRadio();
  const visibleListeners = getVisibleListenersCount(listeners);

  const label = isConnecting
    ? "Подключаемся к эфиру…"
    : error
      ? error
      : nowPlaying
        ? `Сейчас: ${nowPlaying}`
        : RADIO_STATION.tagline;

  return (
    <div
      className={`mt-1.5 lg:mt-0 lg:-mx-8 ${collapsed ? "hidden lg:block" : ""}`}
      data-testid="radio-strip"
    >
      <div className="flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2 lg:h-[34px] lg:gap-2.5 lg:rounded-none lg:border-0 lg:border-t lg:border-b lg:border-border/20 lg:bg-transparent lg:px-8">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Поставить эфир на паузу" : "Слушать эфир «Дикая Мята»"}
          data-testid="button-radio-toggle"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-110 lg:h-6 lg:w-6"
        >
          {isConnecting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="ml-[1px] h-3 w-3" />
          )}
        </button>

        <span className="flex shrink-0 items-center gap-1 lg:gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="hidden text-[11px] font-bold uppercase tracking-[0.2em] text-primary lg:inline">
            LIVE
          </span>
        </span>

        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.07em] text-foreground lg:text-xs lg:tracking-[0.12em]">
          {RADIO_STATION.name}
        </span>

        {visibleListeners !== null && (
          <span
            className="flex shrink-0 items-center gap-0.5 text-[9px] font-semibold text-foreground/75 lg:gap-1 lg:text-[11px]"
            data-testid="radio-listeners"
            title="Слушают эфир на сайте прямо сейчас"
          >
            <Headphones className="h-2.5 w-2.5 lg:h-3 lg:w-3" />
            {visibleListeners}
            <span className="hidden sm:inline">{listenersVerb(visibleListeners)}</span>
          </span>
        )}

        <Equalizer playing={isPlaying} />

        <span
          className={`min-w-0 flex-1 truncate text-[10px] lg:text-xs ${error ? "text-primary" : "text-foreground/60"}`}
          data-testid="radio-now-playing"
        >
          {label}
        </span>

        {/* Свернуть: полоска уходит из навбара, эфир продолжается в нижнем мини-плеере. */}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Свернуть: плеер радио переедет вниз"
          title="Свернуть в нижний плеер"
          data-testid="button-radio-collapse"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-white/10 hover:text-foreground lg:hidden"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <span className="hidden shrink-0 items-center gap-1.5 lg:flex">
          <button
            type="button"
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            aria-label={volume > 0 ? "Выключить звук эфира" : "Включить звук эфира"}
            data-testid="button-radio-mute"
            className="text-foreground/50 transition-colors hover:text-foreground"
          >
            {volume > 0 ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Громкость эфира"
            data-testid="slider-radio-volume"
            className="h-1 w-16 cursor-pointer accent-primary"
          />
        </span>
      </div>
    </div>
  );
}
