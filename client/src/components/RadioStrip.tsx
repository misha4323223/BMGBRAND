import { ChevronDown, ChevronUp, Headphones, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
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

const EQUALIZER_BARS = [12, 20, 10, 17, 14];

/** Эквалайзер эфира; экспортируется — нижний мини-плеер рисует такой же. */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span
      className={`flex h-5 items-end gap-[3px] ${playing ? "" : "opacity-35"}`}
      aria-hidden="true"
      data-testid="radio-equalizer"
    >
      {EQUALIZER_BARS.map((height, index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full bg-primary ${playing ? "radio-eq-bar" : ""}`}
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
        ? nowPlaying
        : RADIO_STATION.tagline;

  return (
    <div
      className="mt-1.5 lg:mt-0 lg:-mx-8"
      data-testid="radio-strip"
    >
      {collapsed ? (
        <div className="flex h-7 items-center justify-center lg:h-6 lg:justify-end lg:border-t lg:border-b lg:border-border/20 lg:px-8">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Развернуть полоску радио"
            title="Показать полоску радио"
            data-testid="button-radio-expand"
            className="flex h-5 w-5 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
      <div className="relative flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2 lg:h-[64px] lg:gap-2.5 lg:rounded-none lg:border-0 lg:border-t lg:border-b lg:border-border/20 lg:bg-transparent lg:px-8">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Поставить эфир на паузу" : "Слушать эфир «Дикая Мята»"}
          data-testid="button-radio-toggle"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-card transition-transform hover:scale-110 lg:h-6 lg:w-6"
        >
          {isConnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="ml-[1px] h-3.5 w-3.5" />
          )}
        </button>

        <span className="flex shrink-0 items-center gap-1 lg:gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground" />
          </span>
          {/* На мобиле логотип тёмный — даём ему белую «таблетку», иначе слипается с тёмной капсулой. */}
          <span className="flex items-center rounded-md bg-white p-[3px] lg:bg-transparent lg:p-0">
            <img
              src="/radio-live.webp"
              alt="Дикая Мята LIVE"
              width={79}
              height={112}
              className="h-7 w-auto shrink-0 lg:h-14 lg:translate-y-[3px]"
            />
          </span>
        </span>

        {/* Постоянное название станции — видно всегда, не заменяется треком. */}
        <span className="hidden min-w-0 shrink truncate text-xs font-semibold text-foreground lg:block lg:text-base lg:tracking-[0.02em]" data-testid="radio-tagline">
          {RADIO_STATION.tagline}
        </span>

        {/* Набор справа (слушатели, эквалайзер, громкость) прижат к правому краю панели. */}
        <span className="hidden flex-1 lg:block" aria-hidden="true" />

        {/* Десктоп: исполнитель и трек ровно по центру панели. */}
        <span
          className="absolute left-1/2 top-1/2 hidden max-w-[34%] -translate-x-1/2 -translate-y-1/2 items-center lg:flex"
          data-testid="radio-now-playing"
        >
          {isConnecting ? (
            <span className="truncate text-xs text-foreground/60 lg:text-sm">Подключаемся к эфиру…</span>
          ) : error ? (
            <span className="truncate text-xs font-medium text-primary lg:text-sm">{error}</span>
          ) : nowPlaying ? (
            <span className="min-w-0 truncate font-display text-base font-semibold tracking-wide text-foreground lg:text-lg">
              {nowPlaying}
            </span>
          ) : null}
        </span>

        {/* Мобилка: трек/название в центре строки, крупным "радио"- шрифтом. */}
        <span
          className={`min-w-0 flex-1 truncate font-display text-xs font-semibold lg:hidden ${error ? "text-primary" : "text-foreground/85"}`}
        >
          {label}
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

        {/* Свернуть на десктопе: полоска схлопывается в тонкую планку со стрелкой. */}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Свернуть полоску радио"
          title="Свернуть радио"
          data-testid="button-radio-collapse-desktop"
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-white/10 hover:text-foreground lg:flex"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>
      )}
    </div>
  );
}
