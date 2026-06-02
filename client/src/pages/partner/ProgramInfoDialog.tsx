import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Percent, Clock, Wallet, Link2, BarChart3, Code2,
  Users, CheckCircle, TrendingUp, ExternalLink, Info,
  Globe, Package, Star, Music2, Palette, Megaphone, ShoppingBag,
} from "lucide-react";

interface ProgramInfoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// ─── Диалог для медийных партнёров ───────────────────────────────────────────

const MEDIA_HOW_IT_WORKS = [
  { step: "1", title: "Регистрируетесь", desc: "Подаёте заявку, отмечаете что вы артист или блогер, проходите модерацию — получаете личный кабинет." },
  { step: "2", title: "Настраиваете страницу", desc: "Оформляете персональный лендинг: фото, описание, соцсети, галерея. Ваш адрес: booomerangs.ru/@ваш-slug" },
  { step: "3", title: "Размещаете товары", desc: "Создаёте собственный мерч или выбираете товары из каталога — они появляются на вашей странице." },
  { step: "4", title: "Зарабатываете", desc: "С каждой покупки на вашей странице или по вашей ссылке начисляется комиссия. Ставка — договорная, обсуждается индивидуально." },
];

const MEDIA_FEATURES = [
  { icon: Globe, label: "Своя страница", desc: "Персональный лендинг с галереей, описанием и соцсетями на booomerangs.ru/@ваш-slug" },
  { icon: ShoppingBag, label: "Витрина мерча", desc: "Все товары коллаборации на вашей странице — покупатели приходят напрямую к вам." },
  { icon: Package, label: "Авторский мерч", desc: "Создавайте собственные товары под своим именем — цена, описание, фото, размеры." },
  { icon: Megaphone, label: "Промокод", desc: "Именной промокод со скидкой для ваших подписчиков — отображается прямо на вашей странице." },
  { icon: BarChart3, label: "Аналитика", desc: "Просмотры страницы, заказы, выручка и топ товаров — всё в личном кабинете в реальном времени." },
  { icon: Palette, label: "Дизайн под вас", desc: "Настраиваемые секции: hero с видео, цитата, галерея, видео с YouTube или VK." },
];

const MEDIA_WHO = [
  { icon: Music2, label: "Музыканты и артисты" },
  { icon: Megaphone, label: "Блогеры и инфлюенсеры" },
  { icon: Users, label: "Сообщества и паблики" },
  { icon: Palette, label: "Художники и дизайнеры" },
  { icon: Star, label: "Бренды и медиапроекты" },
];

interface MediaInfoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function MediaInfoDialog({ open, onOpenChange }: MediaInfoDialogProps) {
  const [offerLoading, setOfferLoading] = useState(false);

  async function openOffer() {
    const w = window.open("", "_blank");
    setOfferLoading(true);
    try {
      const res = await fetch("/api/legal-documents/offer");
      if (!res.ok) throw new Error();
      const doc = await res.json();
      if (w) {
        w.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${doc.title}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#111}pre{white-space:pre-wrap;font-family:inherit;font-size:14px}</style></head><body><pre>${doc.body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`);
        w.document.close();
      }
    } catch {
      if (w) w.location.href = "/api/legal-documents/offer";
    } finally {
      setOfferLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-media-info">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Для медийных партнёров</DialogTitle>
          <DialogDescription>
            Своя страница, авторский мерч и витрина коллаборации на BOOOMERANGS
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pb-2">
          {/* Краткое описание */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            Если у вас есть аудитория — артисты, блогеры, сообщества, бренды — вы можете получить
            персональную страницу на BOOOMERANGS, разместить свой мерч и зарабатывать с каждой продажи.
            Процент комиссии обсуждается индивидуально при подключении.
          </p>

          {/* Кто это */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Кто это</p>
            <div className="flex flex-wrap gap-2">
              {MEDIA_WHO.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border bg-card">
                  <Icon className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Как это работает */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Как это работает</p>
            <div className="space-y-3">
              {MEDIA_HOW_IT_WORKS.map((s) => (
                <div key={s.step} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-red-500/10 text-red-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {s.step}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Что вы получаете */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Что вы получаете</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MEDIA_FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.label} className="flex gap-2.5 p-3 rounded-lg border bg-card">
                    <Icon className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{f.label}</p>
                      <p className="text-xs text-muted-foreground leading-snug">{f.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ставка */}
          <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 px-4 py-3.5 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 dark:text-red-300 leading-snug">
              <strong>Ставка комиссии — договорная</strong> и обсуждается индивидуально при подключении,
              в зависимости от формата сотрудничества и вашей аудитории.
            </div>
          </div>

          {/* Подвал */}
          <div className="border-t pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Регистрация означает принятие условий публичной оферты (ст. 437 ГК РФ, 63-ФЗ о ЭП).
            </p>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openOffer}
                disabled={offerLoading}
                data-testid="button-media-open-offer"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                Полный текст оферты
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => onOpenChange(false)}
                data-testid="button-media-dialog-close"
              >
                Понятно, перейти к регистрации
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const HOW_IT_WORKS = [
  { step: "1", title: "Регистрируетесь", desc: "Подаёте заявку, проходите модерацию – получаете личный кабинет." },
  { step: "2", title: "Делитесь ссылкой", desc: "Публикуете реферальную ссылку или промокод у себя в блоге, соцсетях, Telegram, на сайте." },
  { step: "3", title: "Покупатель оформляет заказ", desc: "Заказ фиксируется за вами в течение 30 дней после перехода – даже если купят не сразу." },
  { step: "4", title: "Получаете комиссию", desc: "После 14-дневного холда сумма становится доступна к выводу без ограничений по минимальной сумме. Выплата – в течение 5 рабочих дней после подачи заявки." },
];

const TOOLS = [
  { icon: Link2, label: "Реферальная ссылка", desc: "Личный URL с вашим slug – подходит для любого канала." },
  { icon: Code2, label: "Виджет для сайта", desc: "Встраиваемый HTML-виджет с вашими товарами для размещения на своём ресурсе." },
  { icon: BarChart3, label: "Промокод", desc: "Скидка 5–15% для покупателей – дополнительный стимул к покупке." },
  { icon: Users, label: "Витрина товаров", desc: "Персональная страница booomerangs.ru/r/ваш-slug с выбранными вами товарами." },
];

export function ProgramInfoDialog({ open, onOpenChange }: ProgramInfoDialogProps) {
  const [offerLoading, setOfferLoading] = useState(false);

  async function openOffer() {
    // Открываем окно СИНХРОННО (прямо в обработчике клика) — иначе браузер блокирует попап
    const w = window.open("", "_blank");
    setOfferLoading(true);
    try {
      const res = await fetch("/api/legal-documents/offer");
      if (!res.ok) throw new Error();
      const doc = await res.json();
      if (w) {
        w.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${doc.title}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#111}pre{white-space:pre-wrap;font-family:inherit;font-size:14px}</style></head><body><pre>${doc.body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`);
        w.document.close();
      }
    } catch {
      if (w) w.location.href = "/api/legal-documents/offer";
    } finally {
      setOfferLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-program-info">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Партнёрская программа BOOOMERANGS</DialogTitle>
          <DialogDescription>
            Условия участия, размер вашей комиссии и правила выплат
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pb-2">
          {/* Краткое описание */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            Рекомендуйте BOOOMERANGS в своих каналах и зарабатывайте комиссию с каждого оплаченного заказа.
            Программа открыта для самозанятых, ИП и юридических лиц – с официальными выплатами по договору.
          </p>

          {/* Как это работает */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Как это работает</p>
            <div className="space-y-3">
              {HOW_IT_WORKS.map((s) => (
                <div key={s.step} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {s.step}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Прогрессивная шкала */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5" /> Размер вашей комиссии
            </p>
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground">Оборот за месяц</th>
                    <th className="text-right py-2.5 px-4 text-xs font-medium text-muted-foreground">Ставка</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground">До 10 000 ₽</td>
                    <td className="py-2.5 px-4 text-right">
                      <Badge variant="outline" className="font-semibold">15%</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground">От 10 000 до 19 999 ₽</td>
                    <td className="py-2.5 px-4 text-right">
                      <Badge variant="outline" className="font-semibold text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300">20%</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 text-muted-foreground">От 20 000 ₽ и выше</td>
                    <td className="py-2.5 px-4 text-right">
                      <Badge variant="outline" className="font-semibold text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300">25%</Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              При переходе в следующую ступень ставка применяется ретроактивно – все комиссии текущего месяца пересчитываются. В начале месяца счётчик обнуляется.
            </p>
          </div>

          {/* Ключевые условия */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Ключевые условия</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="rounded-xl border bg-card p-3.5 space-y-1">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-semibold">30 дней</span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">Атрибуционное окно – заказ засчитывается за вами, даже если покупатель вернулся позже (last-click).</p>
              </div>
              <div className="rounded-xl border bg-card p-3.5 space-y-1">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold">14 дней холд</span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">После оплаты заказа комиссия удерживается 14 дней на случай возврата, затем переходит в «Доступно к выплате».</p>
              </div>
              <div className="rounded-xl border bg-card p-3.5 space-y-1">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-semibold">Без минимума</span>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">Минимальной суммы нет – выводить можно любую доступную сумму. На карту или расчётный счёт. Срок – 5 рабочих дней.</p>
              </div>
            </div>
          </div>

          {/* Инструменты */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Ваши инструменты</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                return (
                  <div key={t.label} className="flex gap-2.5 p-3 rounded-lg border bg-card">
                    <Icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{t.label}</p>
                      <p className="text-xs text-muted-foreground leading-snug">{t.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Кто может участвовать */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Кто может участвовать</p>
            <div className="flex flex-wrap gap-2">
              {["Самозанятые (НПД)", "Индивидуальные предприниматели", "ООО и другие юр. лица"].map((s) => (
                <div key={s} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border bg-card">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  {s}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-snug">
              Выплаты производятся официально по договору – на основании чека НПД (самозанятые), акта оказанных услуг (ИП) или полного пакета закрывающих документов (ООО).
            </p>
          </div>

          {/* Подвал */}
          <div className="border-t pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Регистрация означает принятие условий публичной оферты (ст. 437 ГК РФ, 63-ФЗ о ЭП).
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openOffer}
              disabled={offerLoading}
              data-testid="button-open-offer"
              className="shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Полный текст оферты
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
