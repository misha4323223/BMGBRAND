import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw, Loader2, TrendingUp, ShoppingBag, Package, Banknote, Music2, ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Button } from "@/components/ui/button";

type MonthStat = {
  month: string;
  retailCount: number;
  wholesaleCount: number;
  retailRevenue: number;
  wholesaleRevenue: number;
};

type ArtistOrderItem = { name: string; qty: number; price: number };
type ArtistOrder = { orderId: number; date: string; customerName: string; items: ArtistOrderItem[]; total: number };
type ArtistStat = {
  artist: string;
  revenue: number;
  orders: number;
  items: number;
  ordersList: ArtistOrder[];
};

const MONTHS_RU: Record<string, string> = {
  "01": "Янв", "02": "Фев", "03": "Мар", "04": "Апр",
  "05": "Май", "06": "Июн", "07": "Июл", "08": "Авг",
  "09": "Сен", "10": "Окт", "11": "Ноя", "12": "Дек",
};

const CHART_STYLE = {
  background: "#18181b",
  borderRadius: 8,
  border: "1px solid #27272a",
  padding: "12px 0 4px",
};

const ARTIST_COLORS = ["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#f97316", "#8b5cf6"];

export function AnalyticsTab({ apiKey }: { apiKey: string }) {
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<MonthStat[]>({
    queryKey: ["admin-analytics-orders"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/orders", {
        headers: { "x-api-key": apiKey },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!apiKey,
    staleTime: 0,
  });

  const { data: artistData, isLoading: artistLoading, isError: artistError } = useQuery<ArtistStat[]>({
    queryKey: ["admin-analytics-artists"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/artists", {
        headers: { "x-api-key": apiKey },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!apiKey,
    staleTime: 0,
  });

  const rows = data ?? [];
  const chartData = rows.map((m) => ({
    ...m,
    label: `${MONTHS_RU[m.month.slice(5, 7)] ?? m.month.slice(5, 7)} '${m.month.slice(2, 4)}`,
  }));

  const totalRetail    = rows.reduce((s, m) => s + m.retailCount, 0);
  const totalWholesale = rows.reduce((s, m) => s + m.wholesaleCount, 0);
  const totalRetailRev = rows.reduce((s, m) => s + m.retailRevenue, 0);
  const totalWsRev     = rows.reduce((s, m) => s + m.wholesaleRevenue, 0);
  const totalOrders    = totalRetail + totalWholesale;
  const totalRevenue   = totalRetailRev + totalWsRev;

  const artists = artistData ?? [];
  const artistChartData = artists.map((a) => ({
    ...a,
    revenueRub: Math.round(a.revenue / 100),
  }));

  return (
    <div className="p-4 space-y-5" style={{ background: "#09090b", minHeight: "100%" }}>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          Аналитика заказов
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          data-testid="button-analytics-refresh"
        >
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Обновить
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center h-32 rounded-xl border border-red-800 bg-red-950/30">
          <p className="text-sm text-red-400">Ошибка загрузки данных. Нажмите «Обновить».</p>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={<ShoppingBag className="w-4 h-4 text-blue-400" />} label="Все заказы" value={String(totalOrders)} testId="analytics-total-count" />
            <StatCard icon={<Package className="w-4 h-4 text-blue-400" />} label="Розница" value={String(totalRetail)} testId="analytics-retail-count" />
            <StatCard icon={<Package className="w-4 h-4 text-amber-400" />} label="Опт" value={String(totalWholesale)} testId="analytics-wholesale-count" />
            <StatCard icon={<Banknote className="w-4 h-4 text-green-400" />} label="Вся выручка" value={`${(totalRevenue / 100).toLocaleString("ru-RU")} ₽`} testId="analytics-total-revenue" />
            <StatCard icon={<TrendingUp className="w-4 h-4 text-blue-400" />} label="Выручка розница" value={`${(totalRetailRev / 100).toLocaleString("ru-RU")} ₽`} testId="analytics-retail-revenue" />
            <StatCard icon={<TrendingUp className="w-4 h-4 text-amber-400" />} label="Выручка опт" value={`${(totalWsRev / 100).toLocaleString("ru-RU")} ₽`} testId="analytics-wholesale-revenue" />
          </div>

          <div style={CHART_STYLE}>
            <p className="text-sm font-medium text-zinc-400 px-4 mb-3">Количество оплаченных заказов по месяцам</p>
            {chartData.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-10">Нет данных</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#27272a" }} tickLine={false} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#27272a" }} contentStyle={{ background: "#0f0f11", border: "1px solid #3f3f46", borderRadius: 8, color: "#f4f4f5", fontSize: 13 }} labelStyle={{ color: "#a1a1aa", marginBottom: 4 }} />
                  <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                  <Bar dataKey="retailCount" name="Розница" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="wholesaleCount" name="Опт" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={CHART_STYLE}>
            <p className="text-sm font-medium text-zinc-400 px-4 mb-3">Выручка по месяцам (₽)</p>
            {chartData.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-10">Нет данных</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={{ stroke: "#27272a" }} tickLine={false} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}к`} />
                  <Tooltip cursor={{ fill: "#27272a" }} contentStyle={{ background: "#0f0f11", border: "1px solid #3f3f46", borderRadius: 8, color: "#f4f4f5", fontSize: 13 }} labelStyle={{ color: "#a1a1aa", marginBottom: 4 }} formatter={(v: any) => [`${Number(v).toLocaleString("ru-RU")} ₽`]} />
                  <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                  <Bar dataKey="retailRevenue" name="Розница" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="wholesaleRevenue" name="Опт" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Аналитика по артистам */}
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2 mb-3">
              <Music2 className="w-4 h-4 text-purple-400" />
              Продажи по артистам / коллаборациям
            </h3>

            {artistLoading && (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
              </div>
            )}

            {artistError && (
              <div className="flex items-center justify-center h-20 rounded-xl border border-red-800 bg-red-950/30">
                <p className="text-sm text-red-400">Ошибка загрузки данных по артистам.</p>
              </div>
            )}

            {!artistLoading && !artistError && (
              <>
                {artists.length === 0 ? (
                  <p className="text-sm text-zinc-500 text-center py-8">Нет данных</p>
                ) : (
                  <>
                    <div style={CHART_STYLE} className="mb-4">
                      <p className="text-sm font-medium text-zinc-400 px-4 mb-3">Выручка по артистам (₽)</p>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={artistChartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                          <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}к`} />
                          <YAxis type="category" dataKey="artist" tick={{ fill: "#e4e4e7", fontSize: 12 }} axisLine={false} tickLine={false} width={130} />
                          <Tooltip cursor={{ fill: "#27272a" }} contentStyle={{ background: "#0f0f11", border: "1px solid #3f3f46", borderRadius: 8, color: "#f4f4f5", fontSize: 13 }} formatter={(v: any) => [`${Number(v).toLocaleString("ru-RU")} ₽`, "Выручка"]} />
                          <Bar dataKey="revenueRub" name="Выручка" radius={[0, 4, 4, 0]} maxBarSize={32}>
                            {artistChartData.map((_, i) => (
                              <Cell key={i} fill={ARTIST_COLORS[i % ARTIST_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Таблица с аккордеоном */}
                    <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
                      {artists.map((row, i) => {
                        const isExpanded = expandedArtist === row.artist;
                        const color = ARTIST_COLORS[i % ARTIST_COLORS.length];
                        return (
                          <div key={row.artist} style={{ borderBottom: i < artists.length - 1 ? "1px solid #27272a" : "none" }}>
                            {/* Строка артиста — кликабельная */}
                            <div
                              className="flex items-center cursor-pointer hover:bg-zinc-800/40 transition-colors"
                              onClick={() => setExpandedArtist(isExpanded ? null : row.artist)}
                              data-testid={`row-artist-${i}`}
                            >
                              <div className="flex items-center gap-2 flex-1 py-3 px-4">
                                {isExpanded
                                  ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                                  : <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                                }
                                <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                                <span className="text-white font-medium text-sm">{row.artist}</span>
                              </div>
                              <div className="text-right text-zinc-200 py-3 px-3 font-medium text-sm w-28">
                                {(row.revenue / 100).toLocaleString("ru-RU")} ₽
                              </div>
                              <div className="text-right text-zinc-400 py-3 px-3 text-sm w-20">{row.orders} зак.</div>
                              <div className="text-right text-zinc-400 py-3 px-4 text-sm w-24">{row.items} шт.</div>
                            </div>

                            {/* Раскрытый список заказов */}
                            {isExpanded && (
                              <div style={{ background: "#0f0f11", borderTop: "1px solid #27272a" }}>
                                {(row.ordersList ?? []).length === 0 ? (
                                  <p className="text-sm text-zinc-500 px-8 py-3">Нет заказов</p>
                                ) : (
                                  (row.ordersList ?? []).map((order, oi) => (
                                    <div
                                      key={order.orderId}
                                      style={{ borderBottom: oi < (row.ordersList ?? []).length - 1 ? "1px solid #1f1f23" : "none" }}
                                      className="px-8 py-3"
                                    >
                                      <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-zinc-500">#{String(order.orderId).slice(-6)}</span>
                                          <span className="text-sm text-zinc-300 font-medium">{order.customerName}</span>
                                        </div>
                                        <div className="flex items-center gap-3 flex-shrink-0">
                                          <span className="text-xs text-zinc-500">{order.date}</span>
                                          <span className="text-sm text-white font-semibold">
                                            {(order.total / 100).toLocaleString("ru-RU")} ₽
                                          </span>
                                        </div>
                                      </div>
                                      <div className="space-y-0.5">
                                        {order.items.map((item, ii) => (
                                          <div key={ii} className="flex items-center justify-between">
                                            <span className="text-xs text-zinc-400 truncate max-w-[70%]">{item.qty > 1 ? `${item.qty}× ` : ''}{item.name}</span>
                                            <span className="text-xs text-zinc-500 flex-shrink-0">{(item.price / 100).toLocaleString("ru-RU")} ₽</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Таблица по месяцам */}
          <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
            <div className="px-4 py-3 border-b border-zinc-800">
              <p className="text-sm font-medium text-zinc-400">Данные по месяцам</p>
            </div>
            {chartData.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">Нет данных</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #27272a" }}>
                      <th className="text-left text-xs text-zinc-500 font-medium py-2 px-4">Месяц</th>
                      <th className="text-right text-xs text-zinc-500 font-medium py-2 px-3">Розница (шт.)</th>
                      <th className="text-right text-xs text-zinc-500 font-medium py-2 px-3">Опт (шт.)</th>
                      <th className="text-right text-xs text-zinc-500 font-medium py-2 px-3">Выручка розница</th>
                      <th className="text-right text-xs text-zinc-500 font-medium py-2 px-4">Выручка опт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...chartData].reverse().map((row, i) => (
                      <tr
                        key={row.month}
                        style={{ borderBottom: i < chartData.length - 1 ? "1px solid #1f1f23" : "none" }}
                        className="hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="text-white font-medium py-2.5 px-4">{row.label}</td>
                        <td className="text-right text-zinc-200 py-2.5 px-3">{row.retailCount}</td>
                        <td className="text-right text-zinc-200 py-2.5 px-3">{row.wholesaleCount}</td>
                        <td className="text-right text-zinc-200 py-2.5 px-3">{(row.retailRevenue / 100).toLocaleString("ru-RU")} ₽</td>
                        <td className="text-right text-zinc-200 py-2.5 px-4">{(row.wholesaleRevenue / 100).toLocaleString("ru-RU")} ₽</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, testId }: { icon: ReactNode; label: string; value: string; testId: string }) {
  return (
    <div style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 10, padding: "14px 16px" }}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-white leading-none" data-testid={testId}>{value}</p>
    </div>
  );
}
