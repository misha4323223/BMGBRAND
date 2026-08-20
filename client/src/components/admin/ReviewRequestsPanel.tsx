import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Send, Mail, Users, RefreshCw, Loader2, CheckSquare, Square, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const adminFetch = async (url: string, apiKey: string, options: RequestInit = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { "x-api-key": apiKey, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
};

interface Props {
  apiKey: string;
  isActive: boolean;
}

interface Candidate {
  orderId: number;
  customerName: string;
  customerEmail: string;
  status: string;
  createdAt?: string | null;
  items: { productId: number; name: string; url: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  delivered: "Доставлен",
  ready_for_pickup: "Готов к выдаче",
};

const DEFAULT_REVIEW_REQUEST_SUBJECT = "Понравилась покупка? Оставьте отзыв ⭐";
const DEFAULT_REVIEW_REQUEST_BODY =
  "Привет, {name}! Надеемся, ваш заказ уже радует. Поделитесь впечатлением — это займёт минуту и поможет другим покупателям.";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export default function ReviewRequestsPanel({ apiKey, isActive }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [previewEmail, setPreviewEmail] = useState("");
  const [reviewSubject, setReviewSubject] = useState(DEFAULT_REVIEW_REQUEST_SUBJECT);
  const [reviewBody, setReviewBody] = useState(DEFAULT_REVIEW_REQUEST_BODY);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const candidatesQuery = useQuery<{ candidates: Candidate[]; count: number }>({
    queryKey: ["/api/admin/review-requests/candidates"],
    queryFn: () => adminFetch("/api/admin/review-requests/candidates", apiKey),
    enabled: !!apiKey && isActive,
  });

  const sendMutation = useMutation({
    mutationFn: (payload: { orderIds: number[]; subject: string; body: string }) =>
      adminFetch("/api/admin/review-requests/send", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data: any) => {
      toast({
        title: `✅ Письма отправлены: ${data.sent} из ${data.total}`,
        description: data.failed > 0 ? `Ошибок: ${data.failed}` : undefined,
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/review-requests/candidates"] });
    },
    onError: (err: any) =>
      toast({ title: "Ошибка отправки", description: err.message, variant: "destructive" }),
  });

  const previewMutation = useMutation({
    mutationFn: (payload: { email: string; subject: string; body: string }) =>
      adminFetch("/api/admin/review-requests/preview", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (data: any) => {
      toast({
        title: `📨 Превью отправлено на ${data.sentTo}`,
        description: data.success ? "Проверьте почту" : "Не удалось отправить",
      });
    },
    onError: (err: any) =>
      toast({ title: "Ошибка превью", description: err.message, variant: "destructive" }),
  });

  const draftMutation = useMutation({
    mutationFn: () =>
      adminFetch("/api/admin/review-requests/generate", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    onSuccess: (data: any) => {
      if (typeof data.text === "string" && data.text.trim()) {
        setReviewBody(data.text.trim());
        toast({ title: "Черновик сгенерирован", description: "Проверьте и отредактируйте текст перед отправкой." });
      }
    },
    onError: (err: any) =>
      toast({ title: "Не удалось сгенерировать текст", description: err.message, variant: "destructive" }),
  });

  const candidates = candidatesQuery.data?.candidates ?? [];
  const count = candidatesQuery.data?.count ?? candidates.length;

  const selectedCount = candidates.filter((c) => selected.has(c.orderId)).length;
  const allSelected = candidates.length > 0 && selectedCount === candidates.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.orderId)));
  };

  const toggleOne = (orderId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const handleSendSelected = () => {
    const ids = candidates.filter((c) => selected.has(c.orderId)).map((c) => c.orderId);
    if (ids.length === 0) return;
    const subject = reviewSubject.trim();
    const body = reviewBody.trim();
    if (!subject || !body) {
      toast({ title: "Заполните тему и текст письма", variant: "destructive" });
      return;
    }
    if (!confirm(`Отправить запрос на отзыв ${ids.length} покупателям?`)) return;
    sendMutation.mutate({ orderIds: ids, subject, body });
  };

  const handlePreview = () => {
    const email = previewEmail.trim();
    if (!email) {
      toast({ title: "Введите email для превью", variant: "destructive" });
      return;
    }
    const subject = reviewSubject.trim();
    const body = reviewBody.trim();
    if (!subject || !body) {
      toast({ title: "Заполните тему и текст письма", variant: "destructive" });
      return;
    }
    previewMutation.mutate({ email, subject, body });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="w-4 h-4" />
          Запрос отзыва у покупателей
        </CardTitle>
        <CardDescription>
          Ручная рассылка «Оставьте отзыв» клиентам, чей заказ доставлен или готов к выдаче.
          Отметьте галочками нужных покупателей. Каждому письмо уходит один раз.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Кандидатов:</span>
            <span className="text-lg font-bold" data-testid="text-review-request-count">
              {candidatesQuery.isLoading ? "…" : count}
            </span>
          </div>
          {!candidatesQuery.isLoading && candidates.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <span className="text-sm text-muted-foreground">Выбрано:</span>
              <span className="text-lg font-bold">{selectedCount}</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => candidatesQuery.refetch()}
            disabled={candidatesQuery.isLoading}
            data-testid="button-refresh-review-requests"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${candidatesQuery.isLoading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>

        <Separator />

        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Содержание письма</p>
            <p className="text-xs text-muted-foreground mt-1">
              Изменения применятся только к этой отправке и не затронут стандартный шаблон.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block" htmlFor="review-request-subject">
              Тема письма
            </label>
            <Input
              id="review-request-subject"
              value={reviewSubject}
              onChange={(e) => setReviewSubject(e.target.value)}
              maxLength={200}
              data-testid="input-review-request-subject"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-sm font-medium" htmlFor="review-request-body">
                Текст письма
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => draftMutation.mutate()}
                  disabled={draftMutation.isPending}
                  data-testid="button-review-request-generate"
                >
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  {draftMutation.isPending ? "Генерирую…" : "Сгенерировать ИИ"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReviewSubject(DEFAULT_REVIEW_REQUEST_SUBJECT);
                    setReviewBody(DEFAULT_REVIEW_REQUEST_BODY);
                  }}
                  disabled={draftMutation.isPending}
                  data-testid="button-review-request-reset-message"
                >
                  Сбросить
                </Button>
              </div>
            </div>
            <Textarea
              id="review-request-body"
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              maxLength={5000}
              rows={6}
              placeholder="Введите текст письма…"
              data-testid="textarea-review-request-body"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Плейсхолдер <code>{"{name}"}</code> автоматически заменится именем покупателя. Ссылки на товары добавляются ниже письма.
            </p>
          </div>
        </div>

        {candidatesQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Нет покупателей, которым нужно отправить запрос (все доставленные заказы уже обработаны или доставленных заказов нет).
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              data-testid="button-review-request-select-all"
            >
              {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allSelected ? "Снять выбор со всех" : "Выбрать всех"}
            </button>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {candidates.map((c) => (
                <div
                  key={c.orderId}
                  className={`flex items-start gap-3 border rounded-lg p-3 text-sm transition-colors ${
                    selected.has(c.orderId) ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <Checkbox
                    checked={selected.has(c.orderId)}
                    onCheckedChange={() => toggleOne(c.orderId)}
                    className="mt-0.5"
                    aria-label={`Выбрать ${c.customerName || c.customerEmail}`}
                    data-testid={`checkbox-review-request-${c.orderId}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {c.customerName || "Без имени"}{" "}
                          <span className="text-muted-foreground font-normal">· заказ #{c.orderId}</span>
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{c.customerEmail}</p>
                        {formatDate(c.createdAt) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Дата заказа: {formatDate(c.createdAt)}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {STATUS_LABEL[c.status] || c.status}
                      </Badge>
                    </div>

                    <div className="mt-2 space-y-1">
                      {c.items.map((it) => (
                        <p key={it.productId} className="text-xs text-muted-foreground flex gap-1.5">
                          <span className="text-muted-foreground/60 shrink-0">•</span>
                          <span className="truncate">{it.name}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div className="flex-1 min-w-[220px]">
            <label className="text-sm font-medium mb-1 block">Email для превью</label>
            <Input
              type="email"
              value={previewEmail}
              onChange={(e) => setPreviewEmail(e.target.value)}
              placeholder="you@example.com"
              data-testid="input-review-request-preview-email"
            />
          </div>
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={previewMutation.isPending}
            data-testid="button-review-request-preview"
          >
            <Mail className="w-4 h-4 mr-2" />
            {previewMutation.isPending ? "Отправка…" : "Превью на email"}
          </Button>
          <Button
            onClick={handleSendSelected}
            disabled={selectedCount === 0 || sendMutation.isPending || candidatesQuery.isLoading}
            data-testid="button-review-request-send"
          >
            <Send className="w-4 h-4 mr-2" />
            {sendMutation.isPending ? "Отправка…" : `Отправить выбранным (${selectedCount})`}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Письма уходят пачками с паузой, прогресс сохраняется. Отправка только по кнопке — автоматики нет.
        </p>
      </CardContent>
    </Card>
  );
}
