import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { apiKey: string };
type Row = { dimensions?: Array<{ name?: string }>; metrics?: number[] };
type Report = { data?: Row[] };
type Status = { configured: boolean; counterId?: string; error?: string };

async function fetchReport<T = Report>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(path, { headers: { "x-api-key": apiKey }, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const DEVICE_RU: Record<string, string> = {
  "Smartphones": "Смартфоны",
  "mobile": "Смартфоны",
  "Desktops": "Компьютеры",
  "desktop": "Компьютеры",
  "Tablets": "Планшеты",
  "tablet": "Планшеты",
  "TV": "ТВ",
  "tv": "ТВ",
  "Unknown": "Другое",
};

const fmtRub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const fmtNum = (n: number) => Math.round(Number(n) || 0).toLocaleString("ru-RU");
const fmtPct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`;
const fmtShortDate = (iso: string) => {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}` : String(iso).slice(5);
};

export function YandexMetrikaPanel({ apiKey }: Props) {
  const [productFilter, setProductFilter] = useState("");
  const [showAllDates, setShowAllDates] = useState(false);

  const status = useQuery<Status>({
    queryKey: ["yandex-metrika-status"],
    queryFn: async () => fetchReport<Status>("/api/admin/yandex-metrika/status", apiKey),
    enabled: !!apiKey,
    staleTime: 60_000,
  });
  const configured = status.data?.configured === true;

  const summary = useQuery({
    queryKey: ["yandex-metrika-summary"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/summary", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["yandex-metrika-products"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/products", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });
  const daily = useQuery({
    queryKey: ["yandex-metrika-daily"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/daily", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });
  const productDates = useQuery({
    queryKey: ["yandex-metrika-product-dates"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/product-dates", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });
  const pages = useQuery({
    queryKey: ["yandex-metrika-pages"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/pages", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });
  const devices = useQuery({
    queryKey: ["yandex-metrika-devices"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/devices", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });
  const geo = useQuery({
    queryKey: ["yandex-metrika-geo"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/geo", apiKey),
    enabled: !!apiKey && configured,
    staleTime: 60_000,
  });

  if (status.isLoading) return <Loading />;
  if (status.isError) return <Message text="Не удалось проверить подключение к Яндекс.Метрике." error />;
  if (!configured) return <Message text="Добавьте серверный секрет YANDEX_METRIKA_OAUTH_TOKEN, чтобы включить отчёты." />;

  const refreshAll = () => {
    void summary.refetch();
    void products.refetch();
    void daily.refetch();
    void productDates.refetch();
    void pages.refetch();
    void devices.refetch();
    void geo.refetch();
  };

  const rows = summary.data?.data ?? [];
  const metrics = rows.reduce((acc, row) => {
    (row.metrics ?? []).forEach((value, index) => { acc[index] = (acc[index] || 0) + Number(value || 0); });
    return acc;
  }, [] as number[]);

  const dailyRows = useMemo(
    () => [...(daily.data?.data ?? [])].sort((a, b) => String(a.dimensions?.[0]?.name).localeCompare(String(b.dimensions?.[0]?.name))),
    [daily.data],
  );

  const productDateRows = useMemo(() => {
    const filter = productFilter.trim().toLowerCase();
    const rows = productDates.data?.data ?? [];
    const filtered = filter
      ? rows.filter((r) => String(r.dimensions?.[0]?.name || "").toLowerCase().includes(filter))
      : rows;
    return showAllDates ? filtered : filtered.slice(0, 60);
  }, [productDates.data, productFilter, showAllDates]);

  return (
    <div className="p-4 space-y-5 bg-zinc-950 min-h-full text-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-red-400" />Яндекс.Метрика</h2>
          <p className="text-xs text-zinc-500 mt-1">Счётчик {status.data?.counterId}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refreshAll}><RefreshCw className="w-4 h-4 mr-1.5" />Обновить</Button>
      </div>

      {summary.isError && <Message text={summary.error.message} error />}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Визиты" value={metrics[0]} />
        <Stat label="Пользователи" value={metrics[1]} />
        <Stat label="Просмотры" value={metrics[2]} />
        <Stat label="Выручка" value={metrics[4] ? fmtRub(metrics[4]) : "—"} />
        <Stat label="Покупки" value={metrics[5]} />
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="font-semibold mb-1">Посещаемость и выручка по дням</h3>
        <p className="text-xs text-zinc-500 mb-3">Последние 30 дней</p>
        {daily.isLoading ? <Loading /> : daily.isError ? <Message text={daily.error.message} error /> : dailyRows.length === 0 ? (
          <p className="text-sm text-zinc-500">Нет данных за период.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-zinc-400 mb-1.5">Визиты</p>
              <BarChart rows={dailyRows} metricIndex={0} color="bg-red-500/80" />
            </div>
            <div>
              <p className="text-xs text-zinc-400 mb-1.5">Выручка, ₽</p>
              <BarChart rows={dailyRows} metricIndex={3} color="bg-emerald-500/80" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                    <th className="py-1.5 pr-3">Дата</th>
                    <th className="py-1.5 pr-3">Визиты</th>
                    <th className="py-1.5 pr-3">Просмотры</th>
                    <th className="py-1.5 pr-3">Выручка</th>
                    <th className="py-1.5">Покупки</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.slice(-14).map((r, i) => (
                    <tr key={i} className="border-b border-zinc-800/60">
                      <td className="py-1.5 pr-3 text-zinc-300">{fmtShortDate(String(r.dimensions?.[0]?.name || ""))}</td>
                      <td className="py-1.5 pr-3">{fmtNum(Number(r.metrics?.[0] || 0))}</td>
                      <td className="py-1.5 pr-3">{fmtNum(Number(r.metrics?.[2] || 0))}</td>
                      <td className="py-1.5 pr-3">{fmtRub(Number(r.metrics?.[3] || 0))}</td>
                      <td className="py-1.5">{fmtNum(Number(r.metrics?.[4] || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="font-semibold mb-3">Источники трафика</h3>
        {summary.isLoading ? <Loading /> : <Rows rows={rows} />}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="font-semibold mb-3">Товары электронной коммерции</h3>
        {products.isLoading ? <Loading /> : products.isError ? <Message text={products.error.message} error /> : <Rows rows={products.data?.data ?? []} />}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-semibold">Продажи товаров по дням</h3>
          <div className="flex items-center gap-2">
            <Input
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              placeholder="Фильтр по товару…"
              className="h-8 w-44 bg-zinc-950 text-sm"
            />
            <Button variant="ghost" size="sm" onClick={() => setShowAllDates((v) => !v)}>
              {showAllDates ? "Свернуть" : "Все"}
            </Button>
          </div>
        </div>
        {productDates.isLoading ? <Loading /> : productDates.isError ? <Message text={productDates.error.message} error /> : productDateRows.length === 0 ? (
          <p className="text-sm text-zinc-500">Нет данных за период.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {productDateRows.map((r, i) => (
              <div key={i} className="flex justify-between gap-4 text-sm border-b border-zinc-800 pb-1.5">
                <div className="min-w-0">
                  <p className="text-zinc-300 truncate">{r.dimensions?.[0]?.name || "—"}</p>
                  <p className="text-[11px] text-zinc-600">{fmtShortDate(String(r.dimensions?.[1]?.name || ""))}</p>
                </div>
                <div className="text-right shrink-0 text-zinc-400 whitespace-nowrap">
                  <span className="text-zinc-200">{fmtNum(Number(r.metrics?.[0] || 0))} покуп.</span>
                  <span className="ml-2">{fmtRub(Number(r.metrics?.[1] || 0))}</span>
                  <span className="ml-2 text-zinc-600">×{fmtNum(Number(r.metrics?.[2] || 0))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="font-semibold mb-3">Популярные страницы входа</h3>
          {pages.isLoading ? <Loading /> : pages.isError ? <Message text={pages.error.message} error /> : <Rows rows={pages.data?.data ?? []} />}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="font-semibold mb-3">Устройства</h3>
          {devices.isLoading ? <Loading /> : devices.isError ? <Message text={devices.error.message} error /> : (
            <Rows rows={(devices.data?.data ?? []).map((r) => ({
              ...r,
              dimensions: [{ name: DEVICE_RU[String(r.dimensions?.[0]?.name || "")] || r.dimensions?.[0]?.name || "—" }],
            }))} />
          )}
        </section>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="font-semibold mb-3">Города</h3>
        {geo.isLoading ? <Loading /> : geo.isError ? <Message text={geo.error.message} error /> : <Rows rows={geo.data?.data ?? []} />}
      </section>
    </div>
  );
}

function BarChart({ rows, metricIndex, color }: { rows: Row[]; metricIndex: number; color: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.metrics?.[metricIndex] || 0)));
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-end gap-[2px] min-w-[560px] h-24">
        {rows.map((r, i) => {
          const v = Number(r.metrics?.[metricIndex] || 0);
          const h = Math.max(2, Math.round((v / max) * 88));
          const label = fmtShortDate(String(r.dimensions?.[0]?.name || ""));
          return (
            <div
              key={i}
              className={`flex-1 min-w-[8px] rounded-t ${color} hover:opacity-80 transition-opacity`}
              style={{ height: `${h}px` }}
              title={`${label}: ${fmtNum(v)}${metricIndex === 3 ? " ₽" : ""}`}
            />
          );
        })}
      </div>
      <div className="flex gap-[2px] min-w-[560px] mt-1">
        {rows.filter((_, i) => i % 5 === 0 || i === rows.length - 1).map((r, i) => (
          <span key={i} className="flex-1 text-center text-[9px] text-zinc-600 truncate">
            {fmtShortDate(String(r.dimensions?.[0]?.name || ""))}
          </span>
        ))}
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return rows.length ? (
    <div className="space-y-2">
      {rows.slice(0, 20).map((row, index) => (
        <div key={index} className="flex justify-between gap-4 text-sm border-b border-zinc-800 pb-2">
          <span className="text-zinc-300 truncate">{row.dimensions?.map((d) => d.name).join(" / ") || "Без названия"}</span>
          <span className="text-zinc-400 shrink-0">{(row.metrics ?? []).map((v) => fmtNum(v)).join(" · ")}</span>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-sm text-zinc-500">Нет данных за период.</p>
  );
}

function Stat({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-bold mt-1">{value == null ? "—" : typeof value === "number" ? fmtNum(value) : value}</p>
    </div>
  );
}

function Loading() {
  return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;
}

function Message({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <div className={`m-4 rounded-xl border p-4 text-sm ${error ? "border-red-900 bg-red-950/30 text-red-300" : "border-zinc-800 bg-zinc-900 text-zinc-300"}`}>
      {error && <AlertTriangle className="inline w-4 h-4 mr-2" />}
      {text}
    </div>
  );
}
