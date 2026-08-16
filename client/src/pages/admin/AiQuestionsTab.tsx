import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Sparkles, Save, Trash2, MessageSquare, CheckCircle2, Plus } from "lucide-react";

interface AiQuestionRow {
  question: string;
  originalText: string;
  count: number;
  firstAsked: number;
  lastAsked: number;
  draftAnswer: string;
  status: string; // "" | "draft" | "published"
}

interface AiQuestionsData {
  questions: AiQuestionRow[];
  faq: Array<{ question: string; answer: string }>;
}

interface AiQuestionsTabProps {
  apiKey: string;
  adminFetch: (url: string, apiKey: string, options?: RequestInit) => Promise<any>;
}

function fmtDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AiQuestionsTab({ apiKey, adminFetch }: AiQuestionsTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string>>({}); // question → action
  const [pruneBusy, setPruneBusy] = useState<"old" | "all" | null>(null);
  const [minCount, setMinCount] = useState(1);

  const { data, isLoading, error, refetch } = useQuery<AiQuestionsData>({
    queryKey: ["/api/admin/ai-questions"],
    queryFn: () => adminFetch("/api/admin/ai-questions", apiKey),
    enabled: !!apiKey,
  });

  const faqSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of data?.faq ?? []) {
      s.add(f.question.trim().toLowerCase().replace(/\s+/g, " "));
    }
    return s;
  }, [data?.faq]);

  const questions = useMemo(() => {
    const list = (data?.questions ?? []).filter(q => q.count >= minCount);
    return list;
  }, [data?.questions, minCount]);

  function getDraft(q: AiQuestionRow): string {
    if (q.question in drafts) return drafts[q.question];
    return q.draftAnswer || "";
  }

  function isInFaq(q: AiQuestionRow): boolean {
    const n = q.question.trim().toLowerCase().replace(/\s+/g, " ");
    return faqSet.has(n) || faqSet.has((q.originalText || "").trim().toLowerCase().replace(/\s+/g, " "));
  }

  async function handleGenerate(q: AiQuestionRow) {
    setBusy(prev => ({ ...prev, [q.question]: "generate" }));
    try {
      const res = await adminFetch(
        `/api/admin/ai-questions/${encodeURIComponent(q.question)}/regenerate`,
        apiKey,
        { method: "POST" }
      );
      setDrafts(prev => ({ ...prev, [q.question]: res.draft || "" }));
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-questions"] });
      toast({ title: "Черновик сгенерирован", description: "Проверьте текст и добавьте в FAQ или сохраните." });
    } catch (e: any) {
      toast({ title: "AI недоступен", description: e.message || "Ошибка генерации", variant: "destructive" });
    } finally {
      setBusy(prev => { const n = { ...prev }; delete n[q.question]; return n; });
    }
  }

  async function handleSaveDraft(q: AiQuestionRow) {
    const answer = getDraft(q).trim();
    if (!answer) {
      toast({ title: "Пустой ответ", description: "Сначала введите или сгенерируйте текст.", variant: "destructive" });
      return;
    }
    setBusy(prev => ({ ...prev, [q.question]: "save" }));
    try {
      await adminFetch(
        `/api/admin/ai-questions/${encodeURIComponent(q.question)}/draft`,
        apiKey,
        { method: "POST", body: JSON.stringify({ answer, status: "draft" }) }
      );
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-questions"] });
      toast({ title: "Черновик сохранён" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setBusy(prev => { const n = { ...prev }; delete n[q.question]; return n; });
    }
  }

  async function handleAddToFaq(q: AiQuestionRow) {
    const answer = getDraft(q).trim();
    if (!answer) {
      toast({ title: "Пустой ответ", description: "Сначала сгенерируйте или введите ответ.", variant: "destructive" });
      return;
    }
    setBusy(prev => ({ ...prev, [q.question]: "faq" }));
    try {
      const res = await adminFetch(
        `/api/admin/ai-questions/${encodeURIComponent(q.question)}/add-to-faq`,
        apiKey,
        { method: "POST", body: JSON.stringify({ answer }) }
      );
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-questions"] });
      if (res.added) {
        toast({ title: "Добавлено в FAQ", description: `Теперь в FAQ ${res.faqCount} вопросов. Страница /faq обновилась.` });
      } else {
        toast({ title: "Уже есть в FAQ", description: res.message || "Такой вопрос уже присутствует на странице." });
      }
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setBusy(prev => { const n = { ...prev }; delete n[q.question]; return n; });
    }
  }

  async function handlePruneOld() {
    const count = (data?.questions ?? []).filter(q => q.count <= 1).length;
    if (count === 0) {
      toast({ title: "Нечего чистить", description: "Одиночных вопросов в копилке нет." });
      return;
    }
    if (!window.confirm(`Удалить ${count} вопрос(ов), которые спрашивали только 1 раз и не повторялись 30+ дней? Страницу FAQ это не тронет.`)) return;
    setPruneBusy("old");
    try {
      const res = await adminFetch("/api/admin/ai-questions/prune", apiKey, {
        method: "POST",
        body: JSON.stringify({ olderThanDays: 30, maxCount: 1 }),
      });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-questions"] });
      toast({ title: "Готово", description: `Удалено: ${res.deleted ?? 0}` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setPruneBusy(null);
    }
  }

  async function handleClearAll() {
    const count = data?.questions?.length ?? 0;
    if (count === 0) {
      toast({ title: "Копилка пуста" });
      return;
    }
    if (!window.confirm(`Удалить ВСЕ ${count} вопрос(ов) из копилки? Действие необратимо. Страницу FAQ это не тронет.`)) return;
    setPruneBusy("all");
    try {
      const res = await adminFetch("/api/admin/ai-questions/prune", apiKey, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-questions"] });
      toast({ title: "Готово", description: `Удалено: ${res.deleted ?? 0}` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setPruneBusy(null);
    }
  }

  async function handleDelete(q: AiQuestionRow) {
    if (!window.confirm(`Удалить вопрос «${q.originalText || q.question}» из копилки? Страницу FAQ это не тронет.`)) return;
    setBusy(prev => ({ ...prev, [q.question]: "delete" }));
    try {
      await adminFetch(`/api/admin/ai-questions/${encodeURIComponent(q.question)}`, apiKey, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["/api/admin/ai-questions"] });
      toast({ title: "Удалено" });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setBusy(prev => { const n = { ...prev }; delete n[q.question]; return n; });
    }
  }

  const totalCount = (data?.questions ?? []).reduce((s, q) => s + q.count, 0);

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Вопросы из AI-чата → FAQ
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Вопросы, которые посетители задают BOOOM AI. Сгенерируйте ответ, проверьте и добавьте на страницу /faq.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={minCount}
            onChange={e => setMinCount(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            data-testid="select-ai-questions-mincount"
          >
            <option value={1}>Все вопросы</option>
            <option value={2}>Повторялись 2+ раза</option>
            <option value={3}>Повторялись 3+ раза</option>
            <option value={5}>Повторялись 5+ раз</option>
          </select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-amber-600 hover:text-amber-700"
            onClick={handlePruneOld}
            disabled={!!pruneBusy || (data?.questions?.length ?? 0) === 0}
            data-testid="button-ai-questions-prune-old"
          >
            {pruneBusy === "old" ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
            Старые (1×, 30+ дн)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-destructive hover:text-destructive"
            onClick={handleClearAll}
            disabled={!!pruneBusy || (data?.questions?.length ?? 0) === 0}
            data-testid="button-ai-questions-clear-all"
          >
            {pruneBusy === "all" ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
            Очистить всё
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-ai-questions-refresh">
            <RefreshCw className="w-4 h-4 mr-1" />
            Обновить
          </Button>
        </div>
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground bg-muted/40 border rounded-lg p-3">
        <p className="font-medium text-foreground mb-1">Как это работает:</p>
        <p>• Каждый вопрос из виджета BOOOM AI сохраняется в базу (уникальные вопросы — со счётчиком повторов)</p>
        <p>• Кнопка «Сгенерировать» — Groq пишет черновик ответа на основе знаний бренда и текущего FAQ</p>
        <p>• «В FAQ» — добавляет вопрос с ответом на публичную страницу /faq (sitemap и SSR обновятся автоматически)</p>
        <p>• Публикуется только то, что вы добавили в FAQ — черновики нигде не видны посетителям</p>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">
          Всего уникальных вопросов: <b className="text-foreground">{data?.questions?.length ?? 0}</b>
        </span>
        <span className="text-muted-foreground">
          Повторов: <b className="text-foreground">{totalCount}</b>
        </span>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Загрузка вопросов...</div>}
      {error && <div className="text-destructive text-sm">Ошибка загрузки: {(error as Error).message}</div>}

      {!isLoading && !error && questions.length === 0 && (
        <div className="text-center text-muted-foreground text-sm py-10 border rounded-lg bg-muted/20">
          Пока нет вопросов. Они появятся здесь, когда посетители начнут общаться с BOOOM AI.
        </div>
      )}

      {questions.map(q => {
        const inFaq = isInFaq(q);
        const isBusy = busy[q.question];
        return (
          <Card key={q.question}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-start gap-2 min-w-0">
                  <div className="text-sm font-medium text-foreground break-words">
                    {q.originalText || q.question}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                  <Badge variant="secondary" className="text-xs">{q.count}×</Badge>
                  {inFaq ? (
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-400">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> В FAQ
                    </Badge>
                  ) : q.status === "published" ? (
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-400">Опубликован</Badge>
                  ) : q.draftAnswer ? (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">Черновик</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{fmtDate(q.lastAsked)}</span>
                </div>
              </div>

              <Textarea
                value={getDraft(q)}
                onChange={e => setDrafts(prev => ({ ...prev, [q.question]: e.target.value }))}
                rows={3}
                className="text-sm resize-y"
                placeholder="Ответ для FAQ — сгенерируйте или введите вручную..."
                data-testid={`textarea-ai-question-${q.question.slice(0, 24)}`}
              />

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleGenerate(q)}
                  disabled={!!isBusy || inFaq}
                  data-testid={`button-ai-question-generate-${q.question.slice(0, 24)}`}
                >
                  {isBusy === "generate" ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                  Сгенерировать
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleSaveDraft(q)}
                  disabled={!!isBusy}
                  data-testid={`button-ai-question-save-${q.question.slice(0, 24)}`}
                >
                  {isBusy === "save" ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                  Сохранить черновик
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleAddToFaq(q)}
                  disabled={!!isBusy || inFaq}
                  data-testid={`button-ai-question-faq-${q.question.slice(0, 24)}`}
                >
                  {isBusy === "faq" ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                  В FAQ
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive ml-auto"
                  onClick={() => handleDelete(q)}
                  disabled={!!isBusy}
                  data-testid={`button-ai-question-delete-${q.question.slice(0, 24)}`}
                >
                  {isBusy === "delete" ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                  Удалить
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
