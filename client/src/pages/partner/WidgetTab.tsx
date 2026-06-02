import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Code2, Globe, Link as LinkIcon, Monitor, ChevronDown } from "lucide-react";
import { SiWordpress, SiTelegram, SiVk } from "react-icons/si";

interface WidgetTabProps {
  slug: string;
}

const platforms = [
  {
    name: "Tilda",
    icon: <Globe className="w-4 h-4" />,
    badge: "виджет",
    steps: [
      "Откройте редактор нужной страницы в Tilda.",
      "Нажмите «+» для добавления блока, перейдите в раздел «Другое» и выберите блок «HTML» (T123).",
      "Кликните на блок → «Контент» и вставьте код виджета в текстовое поле.",
      "Нажмите «Сохранить и закрыть», затем опубликуйте страницу.",
    ],
  },
  {
    name: "WordPress",
    icon: <SiWordpress className="w-4 h-4" />,
    badge: "виджет",
    steps: [
      "Откройте нужную страницу или запись в редакторе Gutenberg.",
      "Нажмите «+» (добавить блок) и найдите блок «Пользовательский HTML».",
      "Вставьте код виджета в поле блока.",
      "Нажмите «Обновить» или «Опубликовать».",
    ],
  },
  {
    name: "Taplink / Linktree",
    icon: <LinkIcon className="w-4 h-4" />,
    badge: "ссылка",
    steps: [
      "Iframe-встраивание на этих платформах не поддерживается.",
      "Создайте новую кнопку с типом «Ссылка».",
      "Вставьте адрес вашей публичной страницы (скопируйте выше) в поле URL.",
      "Сохраните — посетители будут переходить сразу к вашей подборке.",
    ],
  },
  {
    name: "Telegram",
    icon: <SiTelegram className="w-4 h-4" />,
    badge: "ссылка",
    steps: [
      "Для поста: вставьте ссылку на публичную страницу в текст — Telegram автоматически покажет превью.",
      "Для канала: закрепите пост со ссылкой или добавьте её в описание («Управление каналом → Описание»).",
      "Для бота: используйте кнопку типа InlineKeyboardButton с вашей ссылкой (для разработчика).",
    ],
  },
  {
    name: "ВКонтакте",
    icon: <SiVk className="w-4 h-4" />,
    badge: "ссылка",
    steps: [
      "Для группы: перейдите в «Управление → Информация → Ссылки» и добавьте публичную страницу.",
      "Для поста: нажмите скрепку под полем записи → «Ссылка» и вставьте адрес.",
      "ВКонтакте автоматически покажет превью карточки с названием и изображением.",
    ],
  },
  {
    name: "Свой сайт",
    icon: <Monitor className="w-4 h-4" />,
    badge: "виджет",
    steps: [
      "Скопируйте код виджета из блока выше.",
      "Откройте HTML-файл страницы в редакторе и найдите место, куда хотите вставить виджет.",
      "Вставьте код внутри тега <body> в нужном месте.",
      "Если нужно изменить высоту — отредактируйте значение height в коде (или используйте регулятор выше).",
      "Сохраните файл и загрузите на сервер.",
    ],
  },
];

export function WidgetTab({ slug }: WidgetTabProps) {
  const { toast } = useToast();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://booomerangs.ru";
  const [iframeHeight, setIframeHeight] = useState(700);
  const [openPlatform, setOpenPlatform] = useState<string | null>(null);

  const publicUrl = `${origin}/partner/${slug}`;
  const widgetUrl = `${origin}/partner/${slug}/widget`;

  const iframeSnippet = useMemo(
    () =>
      `<iframe src="${widgetUrl}" width="100%" height="${iframeHeight}" frameborder="0" loading="lazy" style="border:0;display:block;width:100%;max-width:100%;"></iframe>`,
    [widgetUrl, iframeHeight],
  );

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Скопировано", description: label }),
      () => toast({ title: "Ошибка", description: "Не удалось скопировать", variant: "destructive" }),
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">Публичная страница</p>
            <p className="text-sm text-muted-foreground mb-3">
              Каталог выбранных вами товаров в стиле BMGBRAND. Делитесь ссылкой с аудиторией —
              переходы автоматически закрепляются за вами.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                readOnly
                value={publicUrl}
                className="font-mono text-xs"
                data-testid="input-partner-public-url"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(publicUrl, "Ссылка на публичную страницу")}
                  className="flex-1 sm:flex-none"
                  data-testid="button-copy-partner-public-url"
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Копировать
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  data-testid="button-open-partner-public"
                >
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-1" />
                    Открыть
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Code2 className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">Виджет для встраивания</p>
            <p className="text-sm text-muted-foreground mb-3">
              Вставьте этот код на свой сайт — посетители увидят ваши товары прямо там и при
              нажатии «Купить» перейдут к оплате на BMGBRAND с уже привязанным реферальным
              cookie.
            </p>

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <Badge variant="secondary">URL виджета</Badge>
              <code className="text-xs font-mono break-all">{widgetUrl}</code>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm text-muted-foreground" htmlFor="widget-height">
                Высота, px:
              </label>
              <Input
                id="widget-height"
                type="number"
                min={300}
                max={2000}
                value={iframeHeight}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 300 && v <= 2000) setIframeHeight(v);
                }}
                className="w-24 h-8"
                data-testid="input-widget-height"
              />
            </div>

            <Textarea
              readOnly
              value={iframeSnippet}
              rows={3}
              className="font-mono text-xs"
              data-testid="textarea-widget-snippet"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2 mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy(iframeSnippet, "Код виджета скопирован")}
                data-testid="button-copy-widget-snippet"
              >
                <Copy className="w-4 h-4 mr-1" />
                Копировать код
              </Button>
              <Button
                asChild
                type="button"
                variant="outline"
                size="sm"
                data-testid="button-preview-widget"
              >
                <a href={widgetUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-1" />
                  Предпросмотр
                </a>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <p className="font-medium text-foreground mb-1">Как разместить</p>
        <p className="text-sm text-muted-foreground mb-4">Нажмите на платформу, чтобы увидеть инструкцию.</p>
        <div className="divide-y">
          {platforms.map((p) => {
            const isOpen = openPlatform === p.name;
            return (
              <div key={p.name} className="first:pt-0 last:pb-0">
                <button
                  type="button"
                  onClick={() => setOpenPlatform(isOpen ? null : p.name)}
                  className="w-full flex items-center gap-3 py-3 text-left group"
                >
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                    {p.icon}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">{p.badge}</Badge>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <ol className="mb-3 ml-10 space-y-1.5 list-decimal list-outside">
                    {p.steps.map((step, i) => (
                      <li key={i} className="text-xs text-muted-foreground leading-snug pl-1">
                        {step}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <p className="font-medium text-foreground mb-2">Живой предпросмотр</p>
        <p className="text-sm text-muted-foreground mb-3">
          Так виджет будет выглядеть на вашем сайте.
        </p>
        <div className="border rounded-md overflow-hidden bg-background">
          <iframe
            src={widgetUrl}
            title="Партнёрский виджет — предпросмотр"
            className="w-full"
            style={{ height: iframeHeight, border: 0 }}
            loading="lazy"
            data-testid="iframe-widget-preview"
          />
        </div>
      </Card>
    </div>
  );
}
