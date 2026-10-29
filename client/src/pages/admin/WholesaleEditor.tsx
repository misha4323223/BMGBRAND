import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { adminFetch } from "@/lib/admin-fetch";
import { ArrowDown, ArrowUp, ExternalLink, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  DEFAULT_WHOLESALE_CONTENT,
  mergeWholesaleContent,
} from "@/lib/wholesale-content";
import type {
  WholesaleAdvantage,
  WholesaleCondition,
  WholesaleContent,
  WholesaleIconKey,
} from "@/lib/wholesale-content";

const PAGE_NAME = "wholesale";
const SECTION_ID = "content";

const ICON_OPTIONS: { value: WholesaleIconKey; label: string }[] = [
  { value: "boxes", label: "Коробки" },
  { value: "shield", label: "Гарантия / маркировка" },
  { value: "truck", label: "Доставка" },
  { value: "factory", label: "Производство" },
  { value: "shirt", label: "Одежда" },
  { value: "badge", label: "Мерч / качество" },
  { value: "wallet", label: "Цены / кабинет" },
];

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function IconSelect({ value, onChange }: { value: WholesaleIconKey; onChange: (value: WholesaleIconKey) => void }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">Иконка</Label>
      <Select value={value} onValueChange={(v) => onChange(v as WholesaleIconKey)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ICON_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function WholesaleEditor({ apiKey }: { apiKey: string }) {
  const { toast } = useToast();
  const [content, setContent] = useState<WholesaleContent>(DEFAULT_WHOLESALE_CONTENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/page-settings/${PAGE_NAME}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setContent(mergeWholesaleContent(data?.[SECTION_ID]));
      } catch {
        /* нет сохранённых настроек — остаются дефолты */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    try {
      setSaving(true);
      await adminFetch(`/api/admin/page-settings/${PAGE_NAME}/${SECTION_ID}`, apiKey, {
        method: "POST",
        body: JSON.stringify(content),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/page-settings/${PAGE_NAME}`] });
      toast({ title: "Страница оптовых партнёров сохранена" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setContent(DEFAULT_WHOLESALE_CONTENT);
    toast({ title: "Форма сброшена к тексту по умолчанию", description: "Нажмите «Сохранить», чтобы применить." });
  }

  function updateCondition(index: number, patch: Partial<WholesaleCondition>) {
    setContent((prev) => ({
      ...prev,
      conditions: {
        ...prev.conditions,
        items: prev.conditions.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      },
    }));
  }

  function updateAdvantage(index: number, patch: Partial<WholesaleAdvantage>) {
    setContent((prev) => ({
      ...prev,
      advantages: {
        ...prev.advantages,
        items: prev.advantages.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      },
    }));
  }

  function moveFaq(index: number, direction: -1 | 1) {
    setContent((prev) => {
      const items = [...prev.faq.items];
      const target = index + direction;
      if (target < 0 || target >= items.length) return prev;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...prev, faq: { ...prev.faq, items } };
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-medium">Страница оптовых партнёров</h3>
          <p className="text-xs text-muted-foreground">/wholesale — заголовки, условия, контакты и FAQ</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" asChild>
            <a href="/wholesale" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-1" />
              Открыть
            </a>
          </Button>
          <Button size="sm" variant="outline" onClick={reset} data-testid="button-wholesale-reset">
            <RotateCcw className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
          <Button size="sm" onClick={save} disabled={saving} data-testid="button-wholesale-save">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Сохранить
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Первый экран</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Надзаголовок"
            value={content.hero.eyebrow}
            onChange={(v) => setContent((prev) => ({ ...prev, hero: { ...prev.hero, eyebrow: v } }))}
          />
          <Field
            label="Заголовок (H1)"
            value={content.hero.title}
            onChange={(v) => setContent((prev) => ({ ...prev, hero: { ...prev.hero, title: v } }))}
          />
          <div className="md:col-span-2">
            <Area
              label="Подзаголовок"
              value={content.hero.subtitle}
              onChange={(v) => setContent((prev) => ({ ...prev, hero: { ...prev.hero, subtitle: v } }))}
            />
          </div>
          <Field
            label="Кнопка «заявка»"
            value={content.hero.primaryCta}
            onChange={(v) => setContent((prev) => ({ ...prev, hero: { ...prev.hero, primaryCta: v } }))}
          />
          <Field
            label="Кнопка «условия»"
            value={content.hero.secondaryCta}
            onChange={(v) => setContent((prev) => ({ ...prev, hero: { ...prev.hero, secondaryCta: v } }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Цифры под первым экраном</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {content.stats.map((stat, index) => (
            <div key={index} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label={`Значение ${index + 1}`}
                value={stat.value}
                onChange={(v) =>
                  setContent((prev) => ({
                    ...prev,
                    stats: prev.stats.map((s, i) => (i === index ? { ...s, value: v } : s)),
                  }))
                }
              />
              <Field
                label={`Подпись ${index + 1}`}
                value={stat.label}
                onChange={(v) =>
                  setContent((prev) => ({
                    ...prev,
                    stats: prev.stats.map((s, i) => (i === index ? { ...s, label: v } : s)),
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Условия сотрудничества</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Надзаголовок"
              value={content.conditions.eyebrow}
              onChange={(v) => setContent((prev) => ({ ...prev, conditions: { ...prev.conditions, eyebrow: v } }))}
            />
            <Field
              label="Заголовок раздела"
              value={content.conditions.title}
              onChange={(v) => setContent((prev) => ({ ...prev, conditions: { ...prev.conditions, title: v } }))}
            />
          </div>

          {content.conditions.items.map((item, index) => (
            <div key={index} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Блок {index + 1}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field
                  label="Заголовок"
                  value={item.title}
                  onChange={(v) => updateCondition(index, { title: v })}
                />
                <IconSelect value={item.icon} onChange={(v) => updateCondition(index, { icon: v })} />
              </div>
              <Area
                label="Пункты"
                value={item.points.join("\n")}
                rows={4}
                hint="Один пункт — одна строка"
                onChange={(v) => updateCondition(index, { points: v.split("\n") })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Почему BOOOMERANGS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Надзаголовок"
              value={content.advantages.eyebrow}
              onChange={(v) => setContent((prev) => ({ ...prev, advantages: { ...prev.advantages, eyebrow: v } }))}
            />
            <Field
              label="Заголовок раздела"
              value={content.advantages.title}
              onChange={(v) => setContent((prev) => ({ ...prev, advantages: { ...prev.advantages, title: v } }))}
            />
          </div>

          {content.advantages.items.map((item, index) => (
            <div key={index} className="rounded-md border p-3 space-y-3">
              <span className="text-xs font-medium text-muted-foreground">Блок {index + 1}</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field
                  label="Заголовок"
                  value={item.title}
                  onChange={(v) => updateAdvantage(index, { title: v })}
                />
                <IconSelect value={item.icon} onChange={(v) => updateAdvantage(index, { icon: v })} />
              </div>
              <Area
                label="Описание"
                value={item.desc}
                onChange={(v) => updateAdvantage(index, { desc: v })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Как начать</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Заголовок раздела"
              value={content.steps.title}
              onChange={(v) => setContent((prev) => ({ ...prev, steps: { ...prev.steps, title: v } }))}
            />
            <Field
              label="Текст кнопки заявки"
              value={content.steps.ctaLabel}
              onChange={(v) => setContent((prev) => ({ ...prev, steps: { ...prev.steps, ctaLabel: v } }))}
            />
          </div>

          {content.steps.items.map((step, index) => (
            <div key={index} className="rounded-md border p-3 space-y-3">
              <span className="text-xs font-medium text-muted-foreground">Шаг {index + 1}</span>
              <Field
                label="Заголовок шага"
                value={step.title}
                onChange={(v) =>
                  setContent((prev) => ({
                    ...prev,
                    steps: {
                      ...prev.steps,
                      items: prev.steps.items.map((s, i) => (i === index ? { ...s, title: v } : s)),
                    },
                  }))
                }
              />
              <Area
                label="Описание шага"
                value={step.desc}
                onChange={(v) =>
                  setContent((prev) => ({
                    ...prev,
                    steps: {
                      ...prev.steps,
                      items: prev.steps.items.map((s, i) => (i === index ? { ...s, desc: v } : s)),
                    },
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Контакты</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Телефон менеджера"
            value={content.contacts.managerPhone}
            onChange={(v) => setContent((prev) => ({ ...prev, contacts: { ...prev.contacts, managerPhone: v } }))}
            placeholder="+7 905 116-29-02"
          />
          <Field
            label="Телефон отдела продаж"
            value={content.contacts.salesPhone}
            onChange={(v) => setContent((prev) => ({ ...prev, contacts: { ...prev.contacts, salesPhone: v } }))}
            placeholder="8 960 600 00 47"
          />
          <Field
            label="E-mail"
            value={content.contacts.email}
            onChange={(v) => setContent((prev) => ({ ...prev, contacts: { ...prev.contacts, email: v } }))}
            placeholder="info@booomerangs.ru"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Частые вопросы</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setContent((prev) => ({
                  ...prev,
                  faq: { ...prev.faq, items: [...prev.faq.items, { q: "", a: "" }] },
                }))
              }
              data-testid="button-wholesale-faq-add"
            >
              <Plus className="w-4 h-4 mr-1" />
              Добавить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="Заголовок раздела"
            value={content.faq.title}
            onChange={(v) => setContent((prev) => ({ ...prev, faq: { ...prev.faq, title: v } }))}
          />

          {content.faq.items.map((item, index) => (
            <div key={index} className="rounded-md border p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-3">
                  <Field
                    label="Вопрос"
                    value={item.q}
                    onChange={(v) =>
                      setContent((prev) => ({
                        ...prev,
                        faq: {
                          ...prev.faq,
                          items: prev.faq.items.map((f, i) => (i === index ? { ...f, q: v } : f)),
                        },
                      }))
                    }
                  />
                  <Area
                    label="Ответ"
                    value={item.a}
                    onChange={(v) =>
                      setContent((prev) => ({
                        ...prev,
                        faq: {
                          ...prev.faq,
                          items: prev.faq.items.map((f, i) => (i === index ? { ...f, a: v } : f)),
                        },
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1 pt-5">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveFaq(index, -1)}
                    data-testid={`button-wholesale-faq-up-${index}`}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={index === content.faq.items.length - 1}
                    onClick={() => moveFaq(index, 1)}
                    data-testid={`button-wholesale-faq-down-${index}`}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    disabled={content.faq.items.length === 1}
                    onClick={() =>
                      setContent((prev) => ({
                        ...prev,
                        faq: { ...prev.faq, items: prev.faq.items.filter((_, i) => i !== index) },
                      }))
                    }
                    data-testid={`button-wholesale-faq-delete-${index}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} data-testid="button-wholesale-save-bottom">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Сохранить
        </Button>
      </div>
    </div>
  );
}
