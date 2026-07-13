import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useQuery } from "@tanstack/react-query";

const DEFAULT_FAQ_ITEMS = [
  {
    question: "Как оформить заказ?",
    answer: "Выберите понравившиеся товары, добавьте их в корзину, перейдите к оформлению и заполните данные для доставки. После оформления заказа вам придёт уведомление на электронную почту. Отследить статус заказа и местонахождение посылки можно в личном кабинете.",
  },
  {
    question: "Какие способы оплаты доступны?",
    answer: "Мы принимаем оплату банковскими картами через ЮKassa и Т-Банк. Доступны банковские карты (Visa, MasterCard, МИР), СБП (Система быстрых платежей), а также Т-Pay.",
  },
  {
    question: "Сколько стоит доставка?",
    answer: "Доставка по России осуществляется через СДЭК и Яндекс Доставку. Стоимость рассчитывается автоматически при оформлении заказа в зависимости от региона и веса посылки.",
  },
  {
    question: "Сколько времени занимает доставка?",
    answer: "Срок доставки зависит от вашего региона и выбранного способа доставки — обычно от 1 до 10 рабочих дней по России.",
  },
  {
    question: "Можно ли вернуть или обменять товар?",
    answer: "Да, вы можете вернуть или обменять товар в течение 14 дней с момента получения. Товар должен сохранить товарный вид, бирки и упаковку. Подробнее в разделе 'Доставка и возврат' на странице товара.",
  },
  {
    question: "Как подобрать размер?",
    answer: "На странице каждого товара есть таблица размеров с точными замерами. Если у вас остались вопросы, напишите нам в Telegram или на почту — поможем с выбором.",
  },
  {
    question: "Есть ли у вас офлайн-магазин?",
    answer: "Мы работаем онлайн, но наша одежда уже представлена у дистрибьюторов более чем в 40 городах России. Также планируем открытие собственного шоурума — следите за новостями в наших соцсетях!",
  },
  {
    question: "Как связаться с поддержкой?",
    answer: "Напишите нам на info@booomerangs.ru, в Telegram @bmg_booomerangs или в группу ВКонтакте vk.com/bmgbrand. Мы отвечаем в течение 24 часов.",
  },
  {
    question: "Что такое BOOOM AI?",
    answer: "BOOOM AI — это встроенный ИИ-консультант интернет-магазина BOOOMERANGS. Он работает на странице каждого товара и отвечает на вопросы о составе, уходе, наличии и коллаборациях с артистами.",
  },
  {
    question: "Как ИИ-ассистент BOOOM AI помогает подобрать размер?",
    answer: "Достаточно назвать свой рост и обхват груди (или талии/бёдер для низа) — BOOOM AI сравнит их с таблицей замеров конкретного товара и подскажет точный размер с объяснением выбора.",
  },
  {
    question: "Можно ли спросить у BOOOM AI про коллаборацию с артистом?",
    answer: "Да. Если товар выпущен в коллаборации с музыкантом или фестивалем, BOOOM AI расскажет, с кем именно и что это за коллаборация.",
  },
  {
    question: "Сколько стоит использование BOOOM AI?",
    answer: "Бесплатно. Просто откройте карточку товара и нажмите «Подробнее о товаре (BOOOM AI)» — консультация ничего не стоит и доступна без регистрации.",
  },
];

export default function FAQ() {
  const { data: pageSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", "static_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/static_pages");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const rawData = pageSettings?.faq_data;
  const parsed = rawData ? (typeof rawData === "string" ? JSON.parse(rawData) : rawData) : null;
  const faqItems = parsed?.items && parsed.items.length > 0 ? parsed.items : DEFAULT_FAQ_ITEMS;

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Вопросы и ответы"
        description="Часто задаваемые вопросы о заказах, доставке, оплате и возврате в BMGBRAND."
        keywords="FAQ BMGBRAND, доставка, оплата, возврат, вопросы"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": faqItems.map((item: { question: string; answer: string }) => ({
            "@type": "Question",
            "name": item.question,
            "acceptedAnswer": {
              "@type": "Answer",
              "text": item.answer,
            },
          })),
        }}
      />
      <Navbar />
      
      <main className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Часто задаваемые вопросы</h1>
            <p className="text-muted-foreground">
              Ответы на популярные вопросы о заказах, доставке и возврате
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-2">
            {faqItems.map((item: { question: string; answer: string }, index: number) => (
              <AccordionItem 
                key={index} 
                value={`item-${index}`}
                className="border border-border rounded-lg px-4 data-[state=open]:bg-muted/30"
                data-testid={`accordion-faq-${index}`}
              >
                <AccordionTrigger className="text-left hover:no-underline py-4">
                  <span className="text-foreground font-medium">{item.question}</span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground pb-4">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-12 text-center p-6 bg-muted/30 rounded-lg">
            <p className="text-foreground mb-2">Не нашли ответ на свой вопрос?</p>
            <p className="text-muted-foreground text-sm">
              Напишите нам на{" "}
              <a href="mailto:info@booomerangs.ru" className="text-primary hover:underline">
                info@booomerangs.ru
              </a>
              {", в "}
              <a href="https://t.me/bmg_booomerangs" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Telegram
              </a>
              {" или "}
              <a href="https://vk.com/bmgbrand" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                ВКонтакте
              </a>
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
