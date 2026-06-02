import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

const CARE_ITEMS = [
  {
    emoji: "🧦",
    title: "Носки",
    color: "from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30",
    border: "border-blue-200 dark:border-blue-800",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30–40°C" },
      { icon: "🔄", text: "Деликатный или ручной режим" },
      { icon: "🚫", text: "Без отбеливателей" },
      { icon: "💨", text: "Сушить в расправленном виде" },
      { icon: "❄️", text: "Не выкручивать" },
      { icon: "✋", text: "Гладить при низкой температуре" },
    ],
    tip: "Стирайте тёмные и светлые носки отдельно, чтобы сохранить яркость цвета.",
  },
  {
    emoji: "👕",
    title: "Футболки",
    color: "from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/30",
    border: "border-green-200 dark:border-green-800",
    badge: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30–40°C" },
      { icon: "🔄", text: "Бережный режим стирки" },
      { icon: "🚫", text: "Без отбеливателей" },
      { icon: "💨", text: "Сушить горизонтально" },
      { icon: "♨️", text: "Гладить при 110–150°C" },
      { icon: "🔁", text: "Стирать наизнанку" },
    ],
    tip: "Стирайте наизнанку — это сохраняет насыщенность принта и продлевает жизнь рисунку.",
  },
  {
    emoji: "🧥",
    title: "Худи",
    color: "from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30",
    border: "border-purple-200 dark:border-purple-800",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30°C" },
      { icon: "🔄", text: "Деликатный режим" },
      { icon: "🚫", text: "Без отбеливателей и сушки в машине" },
      { icon: "💨", text: "Сушить в расправленном виде" },
      { icon: "♨️", text: "Гладить через ткань при 110°C" },
      { icon: "🔁", text: "Стирать наизнанку" },
    ],
    tip: "Не вешайте худи на крючок за капюшон — это деформирует капюшон и швы. Складывайте или используйте плечики.",
  },
  {
    emoji: "🎽",
    title: "Свитшоты",
    color: "from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/30",
    border: "border-orange-200 dark:border-orange-800",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30°C" },
      { icon: "🔄", text: "Деликатный режим" },
      { icon: "🚫", text: "Без отбеливателей" },
      { icon: "💨", text: "Сушить горизонтально" },
      { icon: "♨️", text: "Гладить при 110°C через ткань" },
      { icon: "❄️", text: "Не выкручивать" },
    ],
    tip: "Чтобы ткань не скаталась, используйте мешок для стирки или стирайте наизнанку на деликатном режиме.",
  },
  {
    emoji: "🥼",
    title: "Куртки",
    color: "from-slate-50 to-slate-100 dark:from-slate-950/40 dark:to-slate-900/30",
    border: "border-slate-200 dark:border-slate-700",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30°C или по ярлыку" },
      { icon: "🔄", text: "Деликатный режим" },
      { icon: "🚫", text: "Без отбеливателей" },
      { icon: "💨", text: "Сушить на плечиках" },
      { icon: "♨️", text: "Гладить через ткань или не гладить" },
      { icon: "✋", text: "Застёгивать молнии перед стиркой" },
    ],
    tip: "Всегда проверяйте ярлык на куртке — разные материалы требуют разного ухода. При ручной стирке не трите ткань грубо.",
  },
  {
    emoji: "👖",
    title: "Брюки",
    color: "from-indigo-50 to-indigo-100 dark:from-indigo-950/40 dark:to-indigo-900/30",
    border: "border-indigo-200 dark:border-indigo-800",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30–40°C" },
      { icon: "🔄", text: "Стандартный или деликатный режим" },
      { icon: "🚫", text: "Без агрессивных отбеливателей" },
      { icon: "💨", text: "Сушить в расправленном виде" },
      { icon: "♨️", text: "Гладить при 150°C" },
      { icon: "🔁", text: "Стирать наизнанку" },
    ],
    tip: "Для сохранения формы сушите брюки на вешалке за пояс, а не за штанины.",
  },
  {
    emoji: "🩳",
    title: "Шорты",
    color: "from-yellow-50 to-yellow-100 dark:from-yellow-950/40 dark:to-yellow-900/30",
    border: "border-yellow-200 dark:border-yellow-800",
    badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    rules: [
      { icon: "🌡️", text: "Стирка при 30–40°C" },
      { icon: "🔄", text: "Деликатный режим" },
      { icon: "🚫", text: "Без отбеливателей" },
      { icon: "💨", text: "Сушить горизонтально или на вешалке" },
      { icon: "♨️", text: "Гладить при 110–150°C" },
      { icon: "🔁", text: "Стирать наизнанку" },
    ],
    tip: "Стирайте тёмные шорты с вывернутой стороны и при минимальной температуре — так цвет дольше остаётся насыщенным.",
  },
];

const DEFAULT_CONTENT = null;

function DefaultCarePage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-12">
        <div className="flex items-center justify-center mb-6">
          <img src="/images/boomerangs-logo.webp" alt="BOOOMERANGS" className="h-48 w-auto object-contain" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
          Уход за одеждой
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Правильный уход продлевает жизнь вашей одежде и сохраняет её первоначальный вид. Следуйте нашим рекомендациям, чтобы ваши вещи служили дольше.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {CARE_ITEMS.map((item) => (
          <div
            key={item.title}
            className={`rounded-2xl border ${item.border} bg-gradient-to-br ${item.color} p-6 transition-all`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-extrabold text-foreground">{item.title}</h2>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${item.badge}`}>
                Уход
              </span>
            </div>

            <ul className="grid grid-cols-2 gap-2 mb-4">
              {item.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                  <span className="text-base leading-none mt-0.5 flex-shrink-0">{rule.icon}</span>
                  <span>{rule.text}</span>
                </li>
              ))}
            </ul>

            <div className="border-t border-black/10 dark:border-white/10 pt-3 mt-2">
              <p className="text-xs text-muted-foreground flex gap-2">
                <span className="flex-shrink-0">💡</span>
                <span>{item.tip}</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <h2 className="text-xl font-bold text-foreground mb-4">Общие советы по хранению</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl mb-1">🗂️</span>
            <p className="font-medium text-foreground">Храните правильно</p>
            <p>Складывайте трикотаж горизонтально, вешайте куртки и брюки на плечики</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl mb-1">☀️</span>
            <p className="font-medium text-foreground">Избегайте солнца</p>
            <p>Прямые солнечные лучи выгорают ткань — храните одежду в тёмном месте</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl mb-1">🌬️</span>
            <p className="font-medium text-foreground">Проветривайте</p>
            <p>После носки давайте одежде проветриться — это снижает частоту стирки</p>
          </div>
        </div>
      </div>

      <div className="text-center mt-10">
        <Link href="/products" className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-8 py-4 rounded-2xl text-base hover:opacity-90 transition-opacity" data-testid="button-go-to-products">
          Смотреть все товары →
        </Link>
      </div>
    </div>
  );
}

export default function Care() {
  const { data: pageSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", "static_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/static_pages");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const rawData = pageSettings?.care_data;
  const parsed = rawData ? (typeof rawData === "string" ? JSON.parse(rawData) : rawData) : null;
  const customContent = parsed?.content || DEFAULT_CONTENT;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="Уход за одеждой — BOOOMERANGS"
        description="Рекомендации по уходу за одеждой BOOOMERANGS: носки, футболки, худи, куртки, брюки, свитшоты и шорты."
        noindex={false}
      />
      <Navbar />
      <main className="flex-1 pt-32 pb-24 px-4">
        {customContent ? (
          <div className="max-w-4xl mx-auto prose dark:prose-invert" dangerouslySetInnerHTML={{ __html: customContent }} />
        ) : (
          <DefaultCarePage />
        )}
      </main>
      <Footer />
    </div>
  );
}
