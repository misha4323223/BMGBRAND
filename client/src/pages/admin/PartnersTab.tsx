import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Loader2, Search, CheckCircle, XCircle, Ban, RotateCcw,
  Users, BadgeDollarSign, Settings as SettingsIcon, Wallet, Copy,
  Clock, History, ChevronDown, ChevronRight, FileText, Download, ShieldCheck, Trash2, UserPlus,
} from "lucide-react";

interface PartnerStats {
  clicks: number;
  ordersCount: number;
  ordersTotal: number;
  awaitingPaymentAmount: number;
  holdAmount: number;
  pendingAmount: number;
  confirmedAmount: number;
  paidAmount: number;
  readyToConfirmAmount: number;
}
interface AdminPartner {
  id: number;
  userId: number;
  partnerSlug: string;
  storeName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  status: "pending" | "approved" | "rejected" | "blocked";
  commissionOverride: number | null;
  totalEarned: number;
  payoutRequested: boolean;
  createdAt: string | null;
  approvedAt: string | null;
  stats: PartnerStats | null;
  emailVerified?: boolean | null;
  isArtist?: boolean;
  artistRate?: number | null;
  // Юр. данные
  legalStatus?: "self_employed" | "ip" | "ooo" | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  inn?: string | null;
  birthDate?: string | null;
  citizenship?: string | null;
  companyName?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  signerPosition?: string | null;
  signerBasis?: string | null;
  bankName?: string | null;
  bankBik?: string | null;
  bankAccount?: string | null;
  bankCorrAccount?: string | null;
  consentSignedAt?: string | null;
  consentIp?: string | null;
  consentRemoteIp?: string | null;
  consentCountry?: string | null;
  consentRegion?: string | null;
  consentCity?: string | null;
  // Авто-проверка remote_ip на принадлежность диапазонам Yandex Cloud
  // (true — норма, false — подозрение на обход API Gateway, null — нет данных)
  consentRemoteIpInYandex?: boolean | null;
}

interface ConsentSignature {
  id: string;
  partnerId: number;
  documentId: string;
  documentSlug: string;
  documentVersion: string;
  documentHash: string;
  signedAt: string;
  ip: string | null;
  remoteIp?: string | null;
  remoteIpInYandex?: boolean | null;
  consentCountry?: string | null;
  consentRegion?: string | null;
  consentCity?: string | null;
  userAgent: string | null;
  method: string | null;
}

const LEGAL_STATUS_LABELS: Record<string, string> = {
  self_employed: "Самозанятый",
  ip: "ИП",
  ooo: "Юр. лицо",
};

interface AdminCommission {
  id: number;
  orderId: number;
  partnerId: number;
  orderItemsTotal: number;
  commissionPercent: number;
  commissionAmount: number;
  status: "pending" | "confirmed" | "cancelled" | "paid";
  holdUntil: string | null;
  createdAt: string | null;
}

interface AdminPayout {
  id: number;
  partnerId: number;
  amount: number;
  commissionCount: number;
  commissionIds: number[];
  method: string;
  recipientName: string;
  recipientDetails: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string | null;
  status: "awaiting_invoice" | "invoice_uploaded" | "paid_pending_receipt" | "paid_pending_act" | "completed" | "rejected";
  invoiceUrl: string | null;
  invoiceUploadedAt: string | null;
  invoiceNumber: string | null;
  paidAt: string | null;
  paidReference: string | null;
  receiptUrl: string | null;
  receiptUploadedAt: string | null;
  receiptNumber: string | null;
  actUrl: string | null;
  actUploadedAt: string | null;
  actNumber: string | null;
  completedAt: string | null;
  rejectedReason: string | null;
}

const PAYOUT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  awaiting_invoice: { label: "Ждём счёт", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  invoice_uploaded: { label: "Счёт получен", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200" },
  paid_pending_receipt: { label: "Оплачено, ждём чек", cls: "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200" },
  paid_pending_act: { label: "Оплачено, ждём акт", cls: "bg-purple-100 text-purple-900 dark:bg-purple-950/40 dark:text-purple-200" },
  completed: { label: "Завершено", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" },
  rejected: { label: "Отклонено", cls: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200" },
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "На модерации", cls: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-200" },
  approved: { label: "Одобрен", cls: "bg-green-100 text-green-900 dark:bg-green-950/40 dark:text-green-200" },
  rejected: { label: "Отклонён", cls: "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200" },
  blocked: { label: "Заблокирован", cls: "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-200" },
};

function fmtRub(k: number) {
  return (k / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("ru-RU"); } catch { return s; }
}
function fmtDateTime(s: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("ru-RU"); } catch { return s; }
}

function commissionStateBadge(c: AdminCommission): { label: string; cls: string } {
  if (c.status === "paid") return { label: "Выплачено", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950/40" };
  if (c.status === "cancelled") return { label: "Отменено", cls: "bg-red-100 text-red-900 dark:bg-red-950/40" };
  if (c.status === "confirmed") return { label: "Готово к выплате", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40" };
  // pending
  if (!c.holdUntil) return { label: "Ожидает оплаты", cls: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40" };
  const holdMs = new Date(c.holdUntil).getTime();
  if (holdMs > Date.now()) return { label: `На удержании до ${fmtDate(c.holdUntil)}`, cls: "bg-orange-100 text-orange-900 dark:bg-orange-950/40" };
  return { label: "Готово к подтверждению", cls: "bg-purple-100 text-purple-900 dark:bg-purple-950/40" };
}

function adminFetch(url: string, apiKey: string): Promise<any> {
  return fetch(url, { credentials: "include", headers: { "x-api-key": apiKey } })
    .then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}: ${(await r.text()) || r.statusText}`);
      return r.json();
    });
}

async function adminMutate(method: string, url: string, body: unknown, apiKey: string) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

type SubTab = "partners" | "commissions" | "payouts" | "settings";

export function PartnersTab({ apiKey }: { apiKey: string }) {
  const [subTab, setSubTab] = useState<SubTab>("partners");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b pb-2">
        <Button size="sm" variant={subTab === "partners" ? "secondary" : "ghost"} onClick={() => setSubTab("partners")} data-testid="subtab-partners">
          <Users className="w-4 h-4 mr-2" /> Партнёры
        </Button>
        <Button size="sm" variant={subTab === "commissions" ? "secondary" : "ghost"} onClick={() => setSubTab("commissions")} data-testid="subtab-commissions">
          <BadgeDollarSign className="w-4 h-4 mr-2" /> Комиссии
        </Button>
        <Button size="sm" variant={subTab === "payouts" ? "secondary" : "ghost"} onClick={() => setSubTab("payouts")} data-testid="subtab-payouts">
          <History className="w-4 h-4 mr-2" /> Выплаты
        </Button>
        <Button size="sm" variant={subTab === "settings" ? "secondary" : "ghost"} onClick={() => setSubTab("settings")} data-testid="subtab-settings">
          <SettingsIcon className="w-4 h-4 mr-2" /> Настройки
        </Button>
      </div>
      {subTab === "partners" && <PartnersList apiKey={apiKey} />}
      {subTab === "commissions" && <CommissionsList apiKey={apiKey} />}
      {subTab === "payouts" && <PayoutsList apiKey={apiKey} />}
      {subTab === "settings" && <GlobalSettings apiKey={apiKey} />}
    </div>
  );
}

function PartnersList({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const partnersKey = ["/api/admin/partners", statusFilter] as const;
  const partnersQuery = useQuery<{ partners: AdminPartner[] }>({
    queryKey: partnersKey,
    queryFn: () => adminFetch(
      statusFilter === "all" ? "/api/admin/partners" : `/api/admin/partners?status=${statusFilter}`,
      apiKey,
    ),
  });

  const filtered = useMemo(() => {
    const list = partnersQuery.data?.partners || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter((p) =>
      p.contactEmail.toLowerCase().includes(q)
      || p.partnerSlug.toLowerCase().includes(q)
      || p.storeName.toLowerCase().includes(q)
      || p.contactName.toLowerCase().includes(q),
    );
  }, [partnersQuery.data, search]);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      adminMutate("PATCH", `/api/admin/partners/${id}/status`, { status }, apiKey),
    onSuccess: () => {
      toast({ title: "Готово", description: "Статус обновлён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const commissionMutation = useMutation({
    mutationFn: ({ id, percent }: { id: number; percent: number | null }) =>
      adminMutate("PATCH", `/api/admin/partners/${id}/commission`, { percent }, apiKey),
    onSuccess: () => {
      toast({ title: "Готово", description: "Процент обновлён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const artistRateMutation = useMutation({
    mutationFn: ({ id, rate }: { id: number; rate: number | null }) =>
      adminMutate("PATCH", `/api/admin/partners/${id}/artist-rate`, { rate }, apiKey),
    onSuccess: () => {
      toast({ title: "Готово", description: "% артиста обновлён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const [deleteCandidate, setDeleteCandidate] = useState<AdminPartner | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminMutate("DELETE", `/api/admin/partners/${id}`, undefined, apiKey),
    onSuccess: () => {
      toast({ title: "Удалено", description: "Партнёр полностью удалён из базы" });
      setDeleteCandidate(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err?.message || "Не удалось удалить", variant: "destructive" });
      setDeleteCandidate(null);
    },
  });

  // --- Создание артиста вручную ---
  const [showCreateArtist, setShowCreateArtist] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "", email: "", password: "", slug: "", artistRate: "", commissionOverride: "",
  });
  const createArtistMutation = useMutation({
    mutationFn: (data: typeof createForm) =>
      adminMutate("POST", "/api/admin/partners/create-artist", {
        name: data.name,
        email: data.email,
        password: data.password,
        slug: data.slug,
        artistRate: data.artistRate !== "" ? Number(data.artistRate) : undefined,
        commissionOverride: data.commissionOverride !== "" ? Number(data.commissionOverride) : undefined,
      }, apiKey),
    onSuccess: () => {
      toast({ title: "Готово", description: "Артист создан и аккаунт активирован" });
      setShowCreateArtist(false);
      setCreateForm({ name: "", email: "", password: "", slug: "", artistRate: "", commissionOverride: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось создать", variant: "destructive" }),
  });

  const filters = [
    { key: "all", label: "Все" },
    { key: "pending", label: "На модерации" },
    { key: "approved", label: "Одобрены" },
    { key: "rejected", label: "Отклонены" },
    { key: "blocked", label: "Заблокированы" },
  ];

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap gap-2 items-center mb-4">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={statusFilter === f.key ? "secondary" : "outline"}
            onClick={() => setStatusFilter(f.key)}
            data-testid={`filter-status-${f.key}`}
          >
            {f.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCreateArtist(true)}
            data-testid="button-create-artist"
          >
            <UserPlus className="w-4 h-4 mr-2" /> Создать артиста
          </Button>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="pl-8 w-64"
              data-testid="input-search-partners"
            />
          </div>
        </div>
      </div>

      {partnersQuery.isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !filtered.length ? (
        <p className="text-center text-muted-foreground py-12">Нет партнёров</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">Партнёр</th>
                <th className="py-2 pr-3">Slug</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Статус</th>
                <th className="py-2 pr-3">Клики</th>
                <th className="py-2 pr-3">Заказы</th>
                <th className="py-2 pr-3 text-right">К выплате</th>
                <th className="py-2 pr-3">% комиссии</th>
                <th className="py-2 pr-3">% артиста</th>
                <th className="py-2 pr-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <Fragment key={p.id}>
                <tr className={`border-b last:border-0 align-top${p.status === "pending" && p.emailVerified === false ? " bg-amber-50/60 dark:bg-amber-950/15" : ""}`} data-testid={`row-partner-${p.id}`}>
                  <td className="py-2 pr-3">
                    <div className="flex items-start gap-1">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(p.id)}
                        className="mt-0.5 p-0.5 hover:bg-accent rounded"
                        data-testid={`btn-expand-${p.id}`}
                        aria-label="Подробнее"
                      >
                        {expanded.has(p.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {p.storeName}
                          {p.legalStatus && (
                            <Badge variant="outline" className="text-xs">{LEGAL_STATUS_LABELS[p.legalStatus] || p.legalStatus}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.contactName}{p.payoutRequested && <Badge className="ml-2 bg-purple-100 text-purple-900 dark:bg-purple-950/40">Запрос выплаты</Badge>}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3"><code className="text-xs">{p.partnerSlug}</code></td>
                  <td className="py-2 pr-3 text-xs">
                    <div>{p.contactEmail}</div>
                    {p.emailVerified === false && (
                      <span className="inline-flex items-center gap-0.5 mt-0.5 px-1 py-0 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" title="Партнёр ещё не перешёл по ссылке подтверждения email">
                        ⚠ не подтверждён
                      </span>
                    )}
                    {p.emailVerified === true && (
                      <span className="inline-flex items-center gap-0.5 mt-0.5 px-1 py-0 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" title="Email подтверждён партнёром">
                        ✓ подтверждён
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3"><Badge className={STATUS_LABELS[p.status]?.cls}>{STATUS_LABELS[p.status]?.label || p.status}</Badge></td>
                  <td className="py-2 pr-3">{p.stats?.clicks ?? 0}</td>
                  <td className="py-2 pr-3">{p.stats?.ordersCount ?? 0}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtRub(p.stats?.confirmedAmount ?? 0)}</td>
                  <td className="py-2 pr-3">
                    <CommissionInput partnerId={p.id} value={p.commissionOverride} onSave={(v) => commissionMutation.mutate({ id: p.id, percent: v })} disabled={commissionMutation.isPending} />
                  </td>
                  <td className="py-2 pr-3">
                    {p.isArtist ? (
                      <ArtistRateInput partnerId={p.id} value={p.artistRate ?? null} onSave={(v) => artistRateMutation.mutate({ id: p.id, rate: v })} disabled={artistRateMutation.isPending} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {p.status !== "approved" && (
                        <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: p.id, status: "approved" })} data-testid={`btn-approve-${p.id}`}>
                          <CheckCircle className="w-3 h-3 mr-1" />Одобрить
                        </Button>
                      )}
                      {p.status !== "rejected" && p.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: p.id, status: "rejected" })} data-testid={`btn-reject-${p.id}`}>
                          <XCircle className="w-3 h-3 mr-1" />Отклонить
                        </Button>
                      )}
                      {p.status !== "blocked" && p.status !== "pending" && p.status !== "rejected" && (
                        <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: p.id, status: "blocked" })} data-testid={`btn-block-${p.id}`}>
                          <Ban className="w-3 h-3 mr-1" />Заблокировать
                        </Button>
                      )}
                      {(p.status === "blocked" || p.status === "rejected") && (
                        <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: p.id, status: "pending" })} data-testid={`btn-reset-${p.id}`}>
                          <RotateCcw className="w-3 h-3 mr-1" />Сбросить
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                        onClick={() => setDeleteCandidate(p)}
                        data-testid={`btn-delete-partner-${p.id}`}
                      >
                        <Trash2 className="w-3 h-3 mr-1" />Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
                {expanded.has(p.id) && (
                  <tr className="border-b last:border-0 bg-muted/30">
                    <td colSpan={10} className="p-4">
                      <PartnerLegalDetails partner={p} apiKey={apiKey} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Диалог подтверждения удаления */}
      <Dialog open={!!deleteCandidate} onOpenChange={(open) => { if (!open) setDeleteCandidate(null); }}>
        <DialogContent data-testid="dialog-delete-partner">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" /> Удалить партнёра?
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">
                Вы собираетесь <strong>безвозвратно удалить</strong> партнёра из базы данных:
              </span>
              {deleteCandidate && (
                <span className="block rounded bg-muted px-3 py-2 text-sm font-mono">
                  {deleteCandidate.contactName} · {deleteCandidate.contactEmail}<br />
                  slug: {deleteCandidate.partnerSlug}
                </span>
              )}
              <span className="block text-sm">
                Будут удалены: все комиссии, выплаты, промокоды, подписанные документы и связанные товары.
                Заказы <strong>не удаляются</strong> — у них просто обнулится ссылка на партнёра.
              </span>
              <span className="block text-sm font-semibold text-destructive">
                Это действие нельзя отменить.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteCandidate(null)}
              disabled={deleteMutation.isPending}
              data-testid="btn-delete-cancel"
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteCandidate && deleteMutation.mutate(deleteCandidate.id)}
              disabled={deleteMutation.isPending}
              data-testid="btn-delete-confirm"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Удалить навсегда
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог создания артиста вручную */}
      <Dialog open={showCreateArtist} onOpenChange={(open) => { if (!open) { setShowCreateArtist(false); setCreateForm({ name: "", email: "", password: "", slug: "", artistRate: "", commissionOverride: "" }); } }}>
        <DialogContent data-testid="dialog-create-artist">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" /> Создать артиста вручную
            </DialogTitle>
            <DialogDescription>
              Аккаунт создаётся сразу активным. Артист сможет войти на <code>/partner/login</code> с указанными данными.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="ca-name">Имя артиста *</Label>
              <Input
                id="ca-name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Например: ГУДТАЙМС"
                data-testid="input-ca-name"
              />
            </div>
            <div>
              <Label htmlFor="ca-slug">Slug (латиницей) *</Label>
              <Input
                id="ca-slug"
                value={createForm.slug}
                onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                placeholder="Например: goodtimes"
                data-testid="input-ca-slug"
              />
              <p className="text-xs text-muted-foreground mt-1">Должен совпадать с <code>artist_slug</code> на товарах в каталоге</p>
            </div>
            <div>
              <Label htmlFor="ca-email">Email (логин) *</Label>
              <Input
                id="ca-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="artist@example.com"
                data-testid="input-ca-email"
              />
            </div>
            <div>
              <Label htmlFor="ca-password">Пароль * (минимум 6 символов)</Label>
              <Input
                id="ca-password"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                data-testid="input-ca-password"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="ca-artist-rate">% артиста от продаж</Label>
                <Input
                  id="ca-artist-rate"
                  type="number"
                  min={0}
                  max={100}
                  value={createForm.artistRate}
                  onChange={(e) => setCreateForm((f) => ({ ...f, artistRate: e.target.value }))}
                  placeholder="0"
                  data-testid="input-ca-artist-rate"
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="ca-commission">% реф. комиссии</Label>
                <Input
                  id="ca-commission"
                  type="number"
                  min={0}
                  max={100}
                  value={createForm.commissionOverride}
                  onChange={(e) => setCreateForm((f) => ({ ...f, commissionOverride: e.target.value }))}
                  placeholder="глобальный"
                  data-testid="input-ca-commission"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => { setShowCreateArtist(false); setCreateForm({ name: "", email: "", password: "", slug: "", artistRate: "", commissionOverride: "" }); }}
              disabled={createArtistMutation.isPending}
              data-testid="btn-ca-cancel"
            >
              Отмена
            </Button>
            <Button
              onClick={() => createArtistMutation.mutate(createForm)}
              disabled={createArtistMutation.isPending || !createForm.name || !createForm.email || !createForm.password || !createForm.slug}
              data-testid="btn-ca-submit"
            >
              {createArtistMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Создать аккаунт
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CommissionInput({ partnerId, value, onSave, disabled }: { partnerId: number; value: number | null; onSave: (v: number | null) => void; disabled?: boolean }) {
  const [v, setV] = useState<string>(value === null ? "" : String(value));
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        max={100}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="—"
        className="w-16 h-8"
        data-testid={`input-commission-${partnerId}`}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSave(v.trim() === "" ? null : Number(v))}
        disabled={disabled}
        data-testid={`btn-save-commission-${partnerId}`}
      >
        OK
      </Button>
    </div>
  );
}

function ArtistRateInput({ partnerId, value, onSave, disabled }: { partnerId: number; value: number | null; onSave: (v: number | null) => void; disabled?: boolean }) {
  const [v, setV] = useState<string>(value === null || value === 0 ? "" : String(value));
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="—"
        className="w-16 h-8"
        data-testid={`input-artist-rate-${partnerId}`}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSave(v.trim() === "" ? null : Number(v))}
        disabled={disabled}
        data-testid={`btn-save-artist-rate-${partnerId}`}
      >
        OK
      </Button>
    </div>
  );
}

function PartnerLegalDetails({ partner: p, apiKey }: { partner: AdminPartner; apiKey: string }) {
  const { toast } = useToast();
  const sigsQuery = useQuery<{ signatures: ConsentSignature[] }>({
    queryKey: ["/api/admin/partners", p.id, "consent-signatures"],
    queryFn: () => adminFetch(`/api/admin/partners/${p.id}/consent-signatures`, apiKey),
  });

  function downloadPdf() {
    // Открываем PDF в новой вкладке — iframe-превью Replit блокирует blob+download,
    // а прямая ссылка с api-key в query параметре работает и в iframe, и обычно в браузере
    const url = `/api/admin/partners/${p.id}/legal-pdf?key=${encodeURIComponent(apiKey)}`;
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) {
      toast({
        title: "Браузер заблокировал открытие PDF",
        description: "Разрешите всплывающие окна для этого сайта и попробуйте снова",
        variant: "destructive",
      });
    }
  }

  const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleString("ru-RU") : "—";
  const isLegacy = !p.legalStatus;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      <div className="space-y-2">
        <div className="font-semibold text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Юридический статус
        </div>
        {isLegacy ? (
          <div className="text-muted-foreground italic">Legacy-партнёр (зарегистрирован до внедрения KYC). Юр. данные не собирались.</div>
        ) : (
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 gap-x-2">
            <dt className="text-muted-foreground">Статус:</dt><dd><Badge variant="outline">{LEGAL_STATUS_LABELS[p.legalStatus!] || p.legalStatus}</Badge></dd>
            {p.companyName && (<><dt className="text-muted-foreground">Наименование:</dt><dd>{p.companyName}</dd></>)}
            {(p.lastName || p.firstName) && (
              <><dt className="text-muted-foreground">{p.legalStatus === "ooo" ? "Подписант:" : "ФИО:"}</dt>
                <dd>{[p.lastName, p.firstName, p.middleName].filter(Boolean).join(" ")}</dd></>
            )}
            {p.signerPosition && (<><dt className="text-muted-foreground">Должность:</dt><dd>{p.signerPosition}</dd></>)}
            {p.signerBasis && (<><dt className="text-muted-foreground">Основание:</dt><dd>{p.signerBasis}</dd></>)}
            {p.inn && (<><dt className="text-muted-foreground">ИНН:</dt><dd><code>{p.inn}</code></dd></>)}
            {p.kpp && (<><dt className="text-muted-foreground">КПП:</dt><dd><code>{p.kpp}</code></dd></>)}
            {p.ogrn && (<><dt className="text-muted-foreground">{p.ogrn.length === 15 ? "ОГРНИП:" : "ОГРН:"}</dt><dd><code>{p.ogrn}</code></dd></>)}
            {p.legalAddress && (<><dt className="text-muted-foreground">Адрес:</dt><dd>{p.legalAddress}</dd></>)}
            {p.birthDate && (<><dt className="text-muted-foreground">Дата рождения:</dt><dd>{fmtDate(p.birthDate)}</dd></>)}
            {p.citizenship && (<><dt className="text-muted-foreground">Гражданство:</dt><dd>{p.citizenship}</dd></>)}
            {p.consentSignedAt && (
              <>
                <dt className="text-muted-foreground">Подписано:</dt>
                <dd>
                  {fmtDate(p.consentSignedAt)}
                  {p.consentIp && (
                    <span title="IP клиента из заголовка X-Forwarded-For (после доверенного хопа Yandex Cloud Gateway)">
                      {" · IP "}<code>{p.consentIp}</code>
                    </span>
                  )}
                  {p.consentRemoteIp && (
                    <span
                      className="text-muted-foreground"
                      title="Реальный IP TCP-сокета (req.socket.remoteAddress) — нельзя подделать. Должен принадлежать диапазонам Yandex Cloud Gateway. Если не совпадает — попытка обхода."
                    >
                      {" · сокет "}<code>{p.consentRemoteIp}</code>
                      {p.consentRemoteIpInYandex === false && (
                        <Badge
                          variant="destructive"
                          className="ml-1 text-[10px] py-0 px-1.5 align-middle"
                          title="IP TCP-сокета не входит в публичные диапазоны Yandex Cloud и не относится к приватным сетям. Это значит, что регистрация могла прийти НЕ через API Gateway — возможна попытка обхода форензики ПЭП. Проверьте остальные подписи и обстоятельства."
                          data-testid={`badge-remote-ip-suspicious-partner-${p.id}`}
                        >
                          ⚠ вне YC
                        </Badge>
                      )}
                      {p.consentRemoteIpInYandex === true && (
                        <span
                          className="ml-1 text-[10px] text-green-700 dark:text-green-400 align-middle"
                          title="IP TCP-сокета принадлежит доверенным диапазонам Yandex Cloud / приватным сетям — норма."
                          data-testid={`badge-remote-ip-ok-partner-${p.id}`}
                        >
                          ✓
                        </span>
                      )}
                    </span>
                  )}
                  {(p.consentCountry || p.consentRegion || p.consentCity) && (
                    <span
                      className="text-muted-foreground"
                      title="Геолокация по IP на момент подписания (ip-api.com). Фиксируется для установления юрисдикции."
                    >
                      {" · "}
                      {[p.consentCity, p.consentRegion, p.consentCountry].filter(Boolean).join(", ")}
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>
        )}

        <div className="font-semibold text-sm pt-3 flex items-center gap-2">
          <Wallet className="w-4 h-4" /> Реквизиты для выплат
        </div>
        {p.bankAccount ? (
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 gap-x-2">
            {p.bankName && (<><dt className="text-muted-foreground">Банк:</dt><dd>{p.bankName}</dd></>)}
            {p.bankBik && (<><dt className="text-muted-foreground">БИК:</dt><dd><code>{p.bankBik}</code></dd></>)}
            {p.bankCorrAccount && (<><dt className="text-muted-foreground">Корр. счёт:</dt><dd><code>{p.bankCorrAccount}</code></dd></>)}
            <dt className="text-muted-foreground">Расч. счёт:</dt><dd><code>{p.bankAccount}</code></dd>
          </dl>
        ) : (
          <div className="text-muted-foreground italic">Не указаны</div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" /> Подписанные документы
          </div>
          {!isLegacy && (
            <Button size="sm" variant="outline" onClick={downloadPdf} data-testid={`btn-download-pdf-${p.id}`}>
              <Download className="w-3 h-3 mr-1" /> PDF
            </Button>
          )}
        </div>

        {sigsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Загрузка подписей…</div>
        ) : !sigsQuery.data?.signatures?.length ? (
          <div className="text-muted-foreground italic">Записей о подписании нет</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left border-b">
                  <th className="py-1 pr-2">Документ</th>
                  <th className="py-1 pr-2">Версия</th>
                  <th className="py-1 pr-2">Дата</th>
                  <th className="py-1 pr-2" title="IP клиента (X-Forwarded-For после доверенного хопа Gateway)">IP</th>
                  <th className="py-1 pr-2" title="Реальный IP TCP-сокета (нельзя подделать)">Сокет</th>
                  <th className="py-1 pr-2" title="Геолокация по IP на момент подписания (ip-api.com)">Гео</th>
                  <th className="py-1 pr-2">Хэш</th>
                </tr>
              </thead>
              <tbody>
                {sigsQuery.data!.signatures.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" data-testid={`row-signature-${s.id}`}>
                    <td className="py-1 pr-2"><Badge variant="outline" className="text-[10px]">{s.documentSlug}</Badge></td>
                    <td className="py-1 pr-2">v{s.documentVersion}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{fmtDate(s.signedAt)}</td>
                    <td className="py-1 pr-2" data-testid={`text-sig-ip-${s.id}`}><code>{s.ip || "—"}</code></td>
                    <td
                      className="py-1 pr-2"
                      title="Реальный IP TCP-сокета (req.socket.remoteAddress). Должен быть в диапазонах Yandex Cloud Gateway — иначе попытка обхода."
                      data-testid={`text-sig-remote-ip-${s.id}`}
                    >
                      <code className={s.remoteIpInYandex === false ? "text-destructive font-semibold" : "text-muted-foreground"}>
                        {s.remoteIp || "—"}
                      </code>
                      {s.remoteIpInYandex === false && (
                        <Badge
                          variant="destructive"
                          className="ml-1 text-[10px] py-0 px-1.5 align-middle"
                          title="IP TCP-сокета подписи не из диапазонов Yandex Cloud / приватных сетей — возможен обход API Gateway. Эта строка требует проверки!"
                          data-testid={`badge-sig-remote-ip-suspicious-${s.id}`}
                        >
                          ⚠
                        </Badge>
                      )}
                      {s.remoteIpInYandex === true && (
                        <span
                          className="ml-1 text-[10px] text-green-700 dark:text-green-400 align-middle"
                          title="IP в доверенных диапазонах — норма."
                          data-testid={`badge-sig-remote-ip-ok-${s.id}`}
                        >
                          ✓
                        </span>
                      )}
                    </td>
                    <td
                      className="py-1 pr-2"
                      title="Геолокация по IP (ip-api.com): город, регион, страна"
                      data-testid={`text-sig-geo-${s.id}`}
                    >
                      <span className="text-muted-foreground">
                        {[s.consentCity, s.consentCountry].filter(Boolean).join(", ") || "—"}
                      </span>
                    </td>
                    <td className="py-1 pr-2"><code className="text-[10px]" title={s.documentHash}>{s.documentHash.slice(0, 12)}…</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type CommGroup = "all" | "awaiting_payment" | "in_hold" | "ready_to_confirm" | "confirmed" | "paid" | "cancelled";

function CommissionsList({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [group, setGroup] = useState<CommGroup>("ready_to_confirm");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [payoutPartnerId, setPayoutPartnerId] = useState<number | null>(null);

  // Fetch by underlying status (pending or confirmed/paid/cancelled)
  const fetchStatus = group === "confirmed" || group === "paid" || group === "cancelled" ? group : (group === "all" ? "all" : "pending");
  const commissionsQuery = useQuery<{ commissions: AdminCommission[] }>({
    queryKey: ["/api/admin/partner-commissions", fetchStatus],
    queryFn: () => adminFetch(
      fetchStatus === "all" ? "/api/admin/partner-commissions" : `/api/admin/partner-commissions?status=${fetchStatus}`,
      apiKey,
    ),
  });

  const partnersQuery = useQuery<{ partners: AdminPartner[] }>({
    queryKey: ["/api/admin/partners", "all"],
    queryFn: () => adminFetch("/api/admin/partners", apiKey),
  });
  const partnerById = useMemo(() => {
    const m = new Map<number, AdminPartner>();
    (partnersQuery.data?.partners || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [partnersQuery.data]);

  const confirmMutation = useMutation({
    mutationFn: (ids: number[]) => adminMutate("POST", "/api/admin/partner-commissions/confirm", { ids }, apiKey),
    onSuccess: (data: any) => {
      toast({ title: "Готово", description: `Подтверждено: ${data?.count ?? 0}` });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-commissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => adminMutate("POST", `/api/admin/partner-commissions/${id}/cancel`, null, apiKey),
    onSuccess: () => {
      toast({ title: "Отменено" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-commissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const deleteCommissionMutation = useMutation({
    mutationFn: (id: number) => adminMutate("DELETE", `/api/admin/partner-commissions/${id}`, null, apiKey),
    onSuccess: () => {
      toast({ title: "Комиссия удалена" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-commissions"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const filters: { key: CommGroup; label: string }[] = [
    { key: "ready_to_confirm", label: "Готовы к подтверждению" },
    { key: "in_hold", label: "На удержании" },
    { key: "awaiting_payment", label: "Ждут оплату" },
    { key: "confirmed", label: "К выплате" },
    { key: "paid", label: "Выплаченные" },
    { key: "cancelled", label: "Отменённые" },
    { key: "all", label: "Все" },
  ];

  const rawList = commissionsQuery.data?.commissions || [];
  const now = Date.now();
  const list = useMemo(() => {
    if (group === "awaiting_payment") return rawList.filter(c => c.status === "pending" && !c.holdUntil);
    if (group === "in_hold") return rawList.filter(c => c.status === "pending" && c.holdUntil && new Date(c.holdUntil).getTime() > now);
    if (group === "ready_to_confirm") return rawList.filter(c => c.status === "pending" && c.holdUntil && new Date(c.holdUntil).getTime() <= now);
    return rawList;
  }, [rawList, group]);

  // Selection only valid for ready_to_confirm or confirmed
  const canSelectStatus = (c: AdminCommission) => {
    if (group === "ready_to_confirm") return c.status === "pending" && !!c.holdUntil && new Date(c.holdUntil).getTime() <= now;
    if (group === "confirmed") return c.status === "confirmed";
    return false;
  };
  const selectedTotal = list.filter(c => selected.has(c.id) && canSelectStatus(c)).reduce((s, c) => s + c.commissionAmount, 0);

  // For confirmed group, all selected must belong to single partner for payout
  const selectedConfirmed = group === "confirmed" ? list.filter(c => selected.has(c.id) && c.status === "confirmed") : [];
  const selectedConfirmedPartnerIds = Array.from(new Set(selectedConfirmed.map(c => c.partnerId)));
  const canPayout = group === "confirmed" && selectedConfirmed.length > 0 && selectedConfirmedPartnerIds.length === 1;

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    const eligible = list.filter(canSelectStatus);
    if (selected.size === eligible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map(c => c.id)));
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap gap-2 items-center mb-4">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={group === f.key ? "secondary" : "outline"}
            onClick={() => { setGroup(f.key); setSelected(new Set()); }}
            data-testid={`filter-comm-${f.key}`}
          >
            {f.label}
          </Button>
        ))}
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Выбрано: {selected.size} · Сумма: <strong>{fmtRub(selectedTotal)}</strong>
            </span>
            {group === "ready_to_confirm" && (
              <Button
                size="sm"
                onClick={() => confirmMutation.mutate(Array.from(selected))}
                disabled={confirmMutation.isPending}
                data-testid="btn-bulk-confirm"
              >
                {confirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                Подтвердить
              </Button>
            )}
            {group === "confirmed" && (
              <Button
                size="sm"
                onClick={() => canPayout && setPayoutPartnerId(selectedConfirmedPartnerIds[0])}
                disabled={!canPayout}
                data-testid="btn-create-payout"
                title={!canPayout ? "Все выбранные комиссии должны быть у одного партнёра" : undefined}
              >
                <Wallet className="w-4 h-4 mr-2" />
                Выплатить
              </Button>
            )}
          </div>
        )}
      </div>

      {commissionsQuery.isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !list.length ? (
        <p className="text-center text-muted-foreground py-12">Нет комиссий</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3 w-8">
                  {(group === "ready_to_confirm" || group === "confirmed") && (
                    <input
                      type="checkbox"
                      onChange={toggleAll}
                      checked={list.filter(canSelectStatus).length > 0 && selected.size === list.filter(canSelectStatus).length}
                      data-testid="check-all-commissions"
                    />
                  )}
                </th>
                <th className="py-2 pr-3">Дата</th>
                <th className="py-2 pr-3">Партнёр</th>
                <th className="py-2 pr-3">Заказ</th>
                <th className="py-2 pr-3 text-right">База</th>
                <th className="py-2 pr-3 text-right">%</th>
                <th className="py-2 pr-3 text-right">Сумма</th>
                <th className="py-2 pr-3">Состояние</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const s = commissionStateBadge(c);
                const partner = partnerById.get(c.partnerId);
                const canSel = canSelectStatus(c);
                return (
                  <tr key={c.id} className="border-b last:border-0" data-testid={`row-admin-commission-${c.id}`}>
                    <td className="py-2 pr-3">
                      {canSel && (
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          data-testid={`check-commission-${c.id}`}
                        />
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                    <td className="py-2 pr-3">{partner?.storeName || `#${c.partnerId}`}</td>
                    <td className="py-2 pr-3">#{c.orderId}</td>
                    <td className="py-2 pr-3 text-right">{fmtRub(c.orderItemsTotal)}</td>
                    <td className="py-2 pr-3 text-right">{c.commissionPercent}%</td>
                    <td className="py-2 pr-3 text-right font-semibold">{fmtRub(c.commissionAmount)}</td>
                    <td className="py-2 pr-3"><Badge className={s.cls}>{s.label}</Badge></td>
                    <td className="py-2 pr-3">
                      {(c.status === "pending" || c.status === "confirmed") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { if (confirm(`Отменить комиссию #${c.id}?`)) cancelMutation.mutate(c.id); }}
                          data-testid={`btn-cancel-comm-${c.id}`}
                        >
                          <XCircle className="w-3 h-3 mr-1" />Отменить
                        </Button>
                      )}
                      {c.status === "cancelled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { if (confirm(`Удалить комиссию #${c.id} навсегда?`)) deleteCommissionMutation.mutate(c.id); }}
                          disabled={deleteCommissionMutation.isPending}
                          data-testid={`btn-delete-comm-${c.id}`}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />Удалить
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {payoutPartnerId !== null && (
        <PayoutDialog
          apiKey={apiKey}
          partner={partnerById.get(payoutPartnerId)!}
          commissions={selectedConfirmed}
          onClose={() => setPayoutPartnerId(null)}
          onSuccess={() => {
            setPayoutPartnerId(null);
            setSelected(new Set());
          }}
        />
      )}
    </Card>
  );
}

function PayoutDialog({
  apiKey, partner, commissions, onClose, onSuccess,
}: {
  apiKey: string;
  partner: AdminPartner;
  commissions: AdminCommission[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [method, setMethod] = useState<string>("bank_card");
  const [recipientName, setRecipientName] = useState<string>(partner.contactName || "");
  const [recipientDetails, setRecipientDetails] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const total = commissions.reduce((s, c) => s + c.commissionAmount, 0);

  const payoutMutation = useMutation({
    mutationFn: () => adminMutate("POST", "/api/admin/partner-commissions/payout", {
      partnerId: partner.id,
      commissionIds: commissions.map(c => c.id),
      method,
      recipientName: recipientName.trim(),
      recipientDetails: recipientDetails.trim(),
      note: note.trim() || undefined,
    }, apiKey),
    onSuccess: () => {
      toast({ title: "Выплата создана", description: `${fmtRub(total)} → ${partner.storeName}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-commissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-payouts"] });
      onSuccess();
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  function copyDetails() {
    const text = `Получатель: ${recipientName}\nСпособ: ${method}\nРеквизиты: ${recipientDetails}\nСумма: ${fmtRub(total)}\nКомиссий: ${commissions.length}`;
    navigator.clipboard.writeText(text).then(() => toast({ title: "Скопировано" }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-payout">
        <DialogHeader>
          <DialogTitle>Выплата партнёру</DialogTitle>
          <DialogDescription>
            {partner.storeName} ({partner.contactEmail}) · Комиссий: {commissions.length} · Сумма: <strong>{fmtRub(total)}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Способ выплаты</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-payout-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_card">Банковская карта</SelectItem>
                <SelectItem value="sbp">СБП (по номеру телефона)</SelectItem>
                <SelectItem value="bank_account">Расчётный счёт</SelectItem>
                <SelectItem value="yoomoney">ЮMoney</SelectItem>
                <SelectItem value="other">Иное</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>ФИО получателя</Label>
            <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} data-testid="input-payout-name" />
          </div>
          <div>
            <Label>Реквизиты (номер карты / счёта / телефона)</Label>
            <Textarea value={recipientDetails} onChange={(e) => setRecipientDetails(e.target.value)} rows={2} data-testid="input-payout-details" />
          </div>
          <div>
            <Label>Комментарий (необязательно)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid="input-payout-note" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copyDetails} data-testid="btn-copy-payout">
            <Copy className="w-4 h-4 mr-2" />Копировать
          </Button>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => payoutMutation.mutate()}
            disabled={payoutMutation.isPending || !recipientName.trim() || !recipientDetails.trim()}
            data-testid="btn-confirm-payout"
          >
            {payoutMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
            Подтвердить выплату
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PAYOUT_METHOD_LABELS: Record<string, string> = {
  bank_card: "Банковская карта",
  sbp: "СБП",
  bank_account: "Расчётный счёт",
  yoomoney: "ЮMoney",
  other: "Иное",
};

function PayoutsList({ apiKey }: { apiKey: string }) {
  const payoutsQuery = useQuery<{ payouts: AdminPayout[] }>({
    queryKey: ["/api/admin/partner-payouts"],
    queryFn: () => adminFetch("/api/admin/partner-payouts", apiKey),
  });
  const partnersQuery = useQuery<{ partners: AdminPartner[] }>({
    queryKey: ["/api/admin/partners", "all"],
    queryFn: () => adminFetch("/api/admin/partners", apiKey),
  });
  const partnerNameById = useMemo(() => {
    const m = new Map<number, string>();
    (partnersQuery.data?.partners || []).forEach((p) => m.set(p.id, p.storeName || p.partnerSlug));
    return m;
  }, [partnersQuery.data]);

  const list = payoutsQuery.data?.payouts || [];
  const active = list.filter((p) => p.status !== "completed" && p.status !== "rejected");
  const archive = list.filter((p) => p.status === "completed" || p.status === "rejected");

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">Активные выплаты ({active.length})</h3>
        {payoutsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : active.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Активных выплат нет</p>
        ) : (
          <div className="space-y-4">
            {active.map((p) => (
              <AdminPayoutCard
                key={p.id}
                payout={p}
                apiKey={apiKey}
                partnerName={partnerNameById.get(p.partnerId) || `#${p.partnerId}`}
              />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-6">
        <h3 className="text-lg font-semibold mb-4">Архив выплат ({archive.length})</h3>
        {archive.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Завершённых выплат пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Партнёр</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Способ</th>
                  <th className="py-2 pr-3 text-right">Сумма</th>
                  <th className="py-2 pr-3">Документы</th>
                  <th className="py-2 pr-3">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {archive.map((p) => {
                  const st = PAYOUT_STATUS_LABELS[p.status] || { label: p.status, cls: "" };
                  return (
                    <tr key={p.id} className="border-b last:border-0 align-top" data-testid={`row-payout-${p.id}`}>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                      <td className="py-2 pr-3">{partnerNameById.get(p.partnerId) || `#${p.partnerId}`}</td>
                      <td className="py-2 pr-3"><Badge className={st.cls}>{st.label}</Badge></td>
                      <td className="py-2 pr-3">{PAYOUT_METHOD_LABELS[p.method] || p.method}</td>
                      <td className="py-2 pr-3 text-right font-semibold">{fmtRub(p.amount)}</td>
                      <td className="py-2 pr-3 text-xs space-y-1">
                        {p.invoiceUrl && (
                          <a
                            href={`/api/admin/partner-payouts/${p.id}/invoice?key=${encodeURIComponent(apiKey)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline block"
                            data-testid={`link-archive-invoice-${p.id}`}
                          >
                            Счёт{p.invoiceNumber ? ` №${p.invoiceNumber}` : ""}
                          </a>
                        )}
                        {p.receiptUrl && (
                          <a
                            href={`/api/admin/partner-payouts/${p.id}/receipt?key=${encodeURIComponent(apiKey)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline block"
                            data-testid={`link-archive-receipt-${p.id}`}
                          >
                            Чек{p.receiptNumber ? ` №${p.receiptNumber}` : ""}
                          </a>
                        )}
                        {p.actUrl && (
                          <a
                            href={`/api/admin/partner-payouts/${p.id}/act?key=${encodeURIComponent(apiKey)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline block"
                            data-testid={`link-archive-act-${p.id}`}
                          >
                            Акт{p.actNumber ? ` №${p.actNumber}` : ""}
                          </a>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs max-w-xs break-words">
                        {p.status === "rejected" && p.rejectedReason
                          ? <span className="text-red-700 dark:text-red-300">Причина: {p.rejectedReason}</span>
                          : (p.note || "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AdminPayoutCard({ payout, apiKey, partnerName }: { payout: AdminPayout; apiKey: string; partnerName: string }) {
  const { toast } = useToast();
  const [paidReference, setPaidReference] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  // Подтверждение reject для статуса paid_pending_receipt
  // (деньги уже отправлены — комиссии не вернутся)
  const [paidExternallyConfirmOpen, setPaidExternallyConfirmOpen] = useState(false);
  const [pendingRejectReason, setPendingRejectReason] = useState("");

  const adminMutation = useMutation({
    mutationFn: async ({ kind, body }: { kind: "mark-paid" | "complete" | "reject"; body?: any }) => {
      const res = await fetch(`/api/admin/partner-payouts/${payout.id}/${kind}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Admin-Key": apiKey },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(data?.error || `Ошибка ${res.status}`);
        err.status = res.status;
        err.code = data?.code;
        throw err;
      }
      return data;
    },
    onSuccess: (data: any, vars) => {
      let title = "Готово";
      let description: string | undefined;
      if (vars.kind === "mark-paid") {
        title = "Помечено как оплаченное";
      } else if (vars.kind === "complete") {
        title = "Выплата завершена";
      } else if (vars.kind === "reject") {
        title = "Выплата отклонена";
        const reverted = Number(data?.revertedCommissions || 0);
        if (reverted > 0) {
          description = `Возвращено комиссий партнёру: ${reverted}. Они снова доступны к выплате.`;
        } else if (data?.moneyAlreadySent) {
          description = "Деньги уже были переведены — комиссии остались со статусом «Выплачено».";
        }
      }
      toast({ title, description });
      setPaidReference("");
      setRejectReason("");
      setShowReject(false);
      setPaidExternallyConfirmOpen(false);
      setPendingRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-commissions"] });
    },
    onError: (err: any, vars) => {
      // Особая обработка: статус paid_pending_receipt — нужен явный confirm
      if (vars.kind === "reject" && err?.status === 409 && err?.code === "PAID_EXTERNALLY_CONFIRMATION_REQUIRED") {
        setPendingRejectReason(rejectReason);
        setPaidExternallyConfirmOpen(true);
        return;
      }
      toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" });
    },
  });

  // Текст-предупреждение под формой reject — что произойдёт с комиссиями.
  const moneyAlreadySent =
    payout.status === "paid_pending_receipt" || payout.status === "paid_pending_act";
  const rejectImpactText = moneyAlreadySent
    ? "Деньги уже переведены партнёру. Комиссии НЕ вернутся в «Доступно к выплате»."
    : `Все ${payout.commissionCount} комиссий вернутся партнёру в «Доступно к выплате».`;

  const st = PAYOUT_STATUS_LABELS[payout.status] || { label: payout.status, cls: "" };
  const invoiceLink = `/api/admin/partner-payouts/${payout.id}/invoice?key=${encodeURIComponent(apiKey)}`;
  const receiptLink = `/api/admin/partner-payouts/${payout.id}/receipt?key=${encodeURIComponent(apiKey)}`;
  const actLink = `/api/admin/partner-payouts/${payout.id}/act?key=${encodeURIComponent(apiKey)}`;

  return (
    <Card className="p-4 space-y-3 border-l-4 border-l-primary/40" data-testid={`card-admin-payout-${payout.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">#{payout.id} · {partnerName}</span>
            <Badge className={st.cls} data-testid={`badge-admin-payout-status-${payout.id}`}>{st.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Создана {fmtDateTime(payout.createdAt)} · {PAYOUT_METHOD_LABELS[payout.method] || payout.method} · {payout.commissionCount} комиссий
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">{fmtRub(payout.amount)}</p>
          <p className="text-xs text-muted-foreground">{payout.recipientName}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Реквизиты</p>
          <p className="break-words whitespace-pre-line">{payout.recipientDetails || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Комментарий</p>
          <p className="break-words whitespace-pre-line">{payout.note || "—"}</p>
        </div>
      </div>

      {/* Документы */}
      <div className="flex flex-wrap gap-3 text-sm border-t pt-3">
        {payout.invoiceUrl ? (
          <a
            href={invoiceLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline"
            data-testid={`link-invoice-${payout.id}`}
          >
            <Download className="w-3 h-3" /> Счёт{payout.invoiceNumber ? ` №${payout.invoiceNumber}` : ""}
            {payout.invoiceNumber?.startsWith("АВТ-") && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1">(авто)</span>
            )}
            <span className="text-xs text-muted-foreground ml-1">({fmtDateTime(payout.invoiceUploadedAt)})</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">Счёт ещё не загружен</span>
        )}
        {payout.receiptUrl ? (
          <a
            href={receiptLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline"
            data-testid={`link-receipt-${payout.id}`}
          >
            <Download className="w-3 h-3" /> Чек{payout.receiptNumber ? ` №${payout.receiptNumber}` : ""}
            <span className="text-xs text-muted-foreground ml-1">({fmtDateTime(payout.receiptUploadedAt)})</span>
          </a>
        ) : payout.status === "paid_pending_receipt" ? (
          <span className="text-xs text-muted-foreground">Чек ещё не загружен партнёром</span>
        ) : null}
        {payout.actUrl ? (
          <a
            href={actLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline"
            data-testid={`link-act-${payout.id}`}
          >
            <Download className="w-3 h-3" /> Акт{payout.actNumber ? ` №${payout.actNumber}` : ""}
            <span className="text-xs text-muted-foreground ml-1">({fmtDateTime(payout.actUploadedAt)})</span>
          </a>
        ) : payout.status === "paid_pending_act" ? (
          <span className="text-xs text-muted-foreground">Акт ещё не загружен партнёром</span>
        ) : null}
        {payout.paidAt && (
          <span className="text-xs text-muted-foreground">
            Оплачено {fmtDateTime(payout.paidAt)}{payout.paidReference ? ` · ${payout.paidReference}` : ""}
          </span>
        )}
      </div>

      {/* Действия */}
      <div className="border-t pt-3 space-y-3">
        {payout.status === "awaiting_invoice" && (
          <p className="text-xs text-muted-foreground">Ожидаем, пока партнёр приложит счёт из «Мой налог».</p>
        )}

        {payout.status === "invoice_uploaded" && (
          <div className="space-y-2">
            <Label htmlFor={`paidref-${payout.id}`} className="text-xs">Референс платежа (необязательно)</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`paidref-${payout.id}`}
                value={paidReference}
                onChange={(e) => setPaidReference(e.target.value)}
                placeholder="например, № платёжного поручения"
                maxLength={128}
                className="max-w-xs"
                data-testid={`input-paid-reference-${payout.id}`}
              />
              <Button
                onClick={() => adminMutation.mutate({ kind: "mark-paid", body: { paidReference: paidReference || undefined } })}
                disabled={adminMutation.isPending}
                data-testid={`btn-mark-paid-${payout.id}`}
              >
                {adminMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Я оплатил
              </Button>
            </div>
          </div>
        )}

        {payout.status === "paid_pending_receipt" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => adminMutation.mutate({ kind: "complete" })}
              disabled={!payout.receiptUrl || adminMutation.isPending}
              data-testid={`btn-complete-${payout.id}`}
            >
              {adminMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Завершить выплату
            </Button>
            {!payout.receiptUrl && (
              <span className="text-xs text-muted-foreground">Доступно после загрузки чека партнёром</span>
            )}
          </div>
        )}

        {payout.status === "paid_pending_act" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => adminMutation.mutate({ kind: "complete" })}
              disabled={!payout.actUrl || adminMutation.isPending}
              data-testid={`btn-complete-${payout.id}`}
            >
              {adminMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Завершить выплату
            </Button>
            {!payout.actUrl && (
              <span className="text-xs text-muted-foreground">Доступно после загрузки акта партнёром</span>
            )}
          </div>
        )}

        {/* Reject — доступен на любом активном этапе */}
        {!showReject ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReject(true)}
            data-testid={`btn-show-reject-${payout.id}`}
          >
            Отклонить
          </Button>
        ) : (
          <div className="space-y-2 border rounded p-3 bg-muted/30">
            <Label htmlFor={`reject-${payout.id}`} className="text-xs">Причина отклонения (3–500 символов)</Label>
            <Textarea
              id={`reject-${payout.id}`}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={500}
              rows={2}
              data-testid={`input-reject-reason-${payout.id}`}
            />
            <p
              className={`text-xs ${
                moneyAlreadySent
                  ? "text-red-700 dark:text-red-300"
                  : "text-muted-foreground"
              }`}
              data-testid={`text-reject-impact-${payout.id}`}
            >
              {rejectImpactText}
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => adminMutation.mutate({ kind: "reject", body: { reason: rejectReason } })}
                disabled={rejectReason.trim().length < 3 || adminMutation.isPending}
                data-testid={`btn-confirm-reject-${payout.id}`}
              >
                {adminMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Подтвердить отклонение
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowReject(false); setRejectReason(""); }}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm-диалог для reject из статуса «Оплачено, ждём чек» */}
      <Dialog open={paidExternallyConfirmOpen} onOpenChange={setPaidExternallyConfirmOpen}>
        <DialogContent data-testid={`dialog-paid-externally-${payout.id}`}>
          <DialogHeader>
            <DialogTitle>Подтвердите отклонение оплаченной выплаты</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <span className="block">
                По выплате <strong>#{payout.id}</strong> на сумму <strong>{fmtRub(payout.amount)}</strong> вы уже
                нажимали «Я оплатил». Считается, что деньги переведены партнёру.
              </span>
              <span className="block text-red-700 dark:text-red-300 font-medium">
                Если отклонить, {payout.commissionCount} комиссий НЕ вернутся в «Доступно к выплате» —
                они останутся со статусом «Выплачено», и партнёр не сможет вывести их повторно.
              </span>
              <span className="block">
                Отклоняйте только если по факту платёж не дошёл / был возвращён партнёром.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setPaidExternallyConfirmOpen(false); setPendingRejectReason(""); }}
              data-testid={`btn-cancel-paid-externally-${payout.id}`}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                adminMutation.mutate({
                  kind: "reject",
                  body: { reason: pendingRejectReason || rejectReason, confirmPaidExternally: true },
                })
              }
              disabled={adminMutation.isPending}
              data-testid={`btn-confirm-paid-externally-${payout.id}`}
            >
              {adminMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Да, всё равно отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function GlobalSettings({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const settingsQuery = useQuery<{ globalPercent: number; holdDays: number }>({
    queryKey: ["/api/admin/partner-settings"],
    queryFn: () => adminFetch("/api/admin/partner-settings", apiKey),
  });
  const [percent, setPercent] = useState<string>("");
  const [holdDays, setHoldDays] = useState<string>("");

  const saveMutation = useMutation({
    mutationFn: (body: { globalPercent?: number; holdDays?: number }) =>
      adminMutate("PATCH", "/api/admin/partner-settings", body, apiKey),
    onSuccess: () => {
      toast({ title: "Сохранено" });
      setPercent("");
      setHoldDays("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-settings"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err?.message || "Не удалось", variant: "destructive" }),
  });

  const currentPercent = settingsQuery.data?.globalPercent;
  const currentHoldDays = settingsQuery.data?.holdDays;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2"><BadgeDollarSign className="w-5 h-5" />Глобальный процент комиссии</h3>
        <p className="text-sm text-muted-foreground">
          Применяется ко всем партнёрам без персонального процента.
        </p>
        {settingsQuery.isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <p className="text-sm">Текущий: <strong data-testid="text-current-percent">{currentPercent}%</strong></p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="globalPercent">Новое значение (0–100)</Label>
                <Input
                  id="globalPercent"
                  type="number"
                  min={0}
                  max={100}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder={String(currentPercent ?? "")}
                  data-testid="input-global-percent"
                />
              </div>
              <Button
                onClick={() => {
                  const n = Number(percent);
                  if (!Number.isFinite(n)) return;
                  saveMutation.mutate({ globalPercent: n });
                }}
                disabled={saveMutation.isPending || percent.trim() === ""}
                data-testid="btn-save-global-percent"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2"><Clock className="w-5 h-5" />Период удержания комиссий</h3>
        <p className="text-sm text-muted-foreground">
          Сколько дней комиссия находится «на удержании» после оплаты заказа. Применяется к новым комиссиям. Старые сохраняют свою дату удержания.
        </p>
        {settingsQuery.isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <p className="text-sm">Текущий: <strong data-testid="text-current-hold">{currentHoldDays} дней</strong></p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="holdDays">Новое значение (0–365)</Label>
                <Input
                  id="holdDays"
                  type="number"
                  min={0}
                  max={365}
                  value={holdDays}
                  onChange={(e) => setHoldDays(e.target.value)}
                  placeholder={String(currentHoldDays ?? "")}
                  data-testid="input-hold-days"
                />
              </div>
              <Button
                onClick={() => {
                  const n = Number(holdDays);
                  if (!Number.isFinite(n)) return;
                  saveMutation.mutate({ holdDays: n });
                }}
                disabled={saveMutation.isPending || holdDays.trim() === ""}
                data-testid="btn-save-hold-days"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
