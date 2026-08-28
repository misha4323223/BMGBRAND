import { useQuery } from "@tanstack/react-query";
import { BarChart3, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function YandexMetrikaPanel({ apiKey }: Props) {
  const status = useQuery<Status>({
    queryKey: ["yandex-metrika-status"],
    queryFn: async () => fetchReport<Status>("/api/admin/yandex-metrika/status", apiKey),
    enabled: !!apiKey,
    staleTime: 60_000,
  });
  const summary = useQuery({
    queryKey: ["yandex-metrika-summary"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/summary", apiKey),
    enabled: !!apiKey && status.data?.configured === true,
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ["yandex-metrika-products"],
    queryFn: () => fetchReport("/api/admin/yandex-metrika/products", apiKey),
    enabled: !!apiKey && status.data?.configured === true,
    staleTime: 60_000,
  });

  if (status.isLoading) return <Loading />;
  if (status.isError) return <Message text="Не удалось проверить подключение к Яндекс.Метрике." error />;
  if (!status.data?.configured) return <Message text="Добавьте серверный секрет YANDEX_METRIKA_OAUTH_TOKEN, чтобы включить отчёты." />;

  const rows = summary.data?.data ?? [];
  const metrics = rows.reduce((acc, row) => {
    (row.metrics ?? []).forEach((value, index) => { acc[index] = (acc[index] || 0) + Number(value || 0); });
    return acc;
  }, [] as number[]);

  return <div className="p-4 space-y-5 bg-zinc-950 min-h-full text-white">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-red-400" />Яндекс.Метрика</h2><p className="text-xs text-zinc-500 mt-1">Счётчик {status.data.counterId} · данные за 7 дней</p></div>
      <Button size="sm" variant="outline" onClick={() => { void summary.refetch(); void products.refetch(); }}><RefreshCw className="w-4 h-4 mr-1.5" />Обновить</Button>
    </div>
    {summary.isError && <Message text={summary.error.message} error />}
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat label="Визиты" value={metrics[0]} /><Stat label="Пользователи" value={metrics[1]} /><Stat label="Просмотры" value={metrics[2]} /><Stat label="Выручка" value={metrics[4] ? `${Math.round(metrics[4]).toLocaleString("ru-RU")} ₽` : "—"} /><Stat label="Покупки" value={metrics[5]} />
    </div>
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><h3 className="font-semibold mb-3">Источники трафика</h3>{summary.isLoading ? <Loading /> : <Rows rows={rows} />}</section>
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><h3 className="font-semibold mb-3">Товары электронной коммерции</h3>{products.isLoading ? <Loading /> : <Rows rows={products.data?.data ?? []} />}</section>
  </div>;
}

function Rows({ rows }: { rows: Row[] }) { return rows.length ? <div className="space-y-2">{rows.slice(0, 20).map((row, index) => <div key={index} className="flex justify-between gap-4 text-sm border-b border-zinc-800 pb-2"><span className="text-zinc-300 truncate">{row.dimensions?.map((d) => d.name).join(" / ") || "Без названия"}</span><span className="text-zinc-400">{(row.metrics ?? []).map((v) => Number(v).toLocaleString("ru-RU")).join(" · ")}</span></div>)}</div> : <p className="text-sm text-zinc-500">Нет данных за период.</p>; }
function Stat({ label, value }: { label: string; value?: number | string }) { return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-500">{label}</p><p className="text-lg font-bold mt-1">{value == null ? "—" : typeof value === "number" ? value.toLocaleString("ru-RU") : value}</p></div>; }
function Loading() { return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>; }
function Message({ text, error = false }: { text: string; error?: boolean }) { return <div className={`m-4 rounded-xl border p-4 text-sm ${error ? "border-red-900 bg-red-950/30 text-red-300" : "border-zinc-800 bg-zinc-900 text-zinc-300"}`}>{error && <AlertTriangle className="inline w-4 h-4 mr-2" />}{text}</div>; }
