import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

const DEFAULT_CONTENT = `
<h1 class="text-3xl font-bold mb-4 uppercase">Политика конфиденциальности</h1>
<p class="text-muted-foreground mb-8">Дата последнего обновления: 01 сентября 2025 г.</p>
<p class="mb-8 text-foreground/80">Настоящая Политика конфиденциальности (далее – «Политика») действует в отношении всей информации, которую сайт booomerangs.ru (далее – «Сайт») может получить о Пользователе во время использования Сайта, его сервисов, программ и продуктов.</p>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">1. Общие положения</h2>
  <div class="space-y-4 text-foreground/80">
    <p>1.1. Настоящая Политика составлена в соответствии с требованиями Федерального закона от 27.07.2006 №152-ФЗ «О персональных данных».</p>
    <p>1.2. Использование Сайта Пользователем означает согласие с настоящей Политикой и условиями обработки персональных данных.</p>
    <p>1.3. В случае несогласия с условиями Политики Пользователь обязан прекратить использование Сайта.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">2. Персональные данные, которые обрабатывает Сайт</h2>
  <ul class="list-disc pl-6 space-y-2 text-foreground/80">
    <li>ФИО (при указании Пользователем);</li>
    <li>контактный телефон, адрес электронной почты;</li>
    <li>данные, автоматически передаваемые при посещении Сайта (IP-адрес, cookies, данные браузера, характеристики устройства и ПО, время доступа, адреса страниц);</li>
    <li>технические cookie (например, cookies used by frames), необходимые для работы функций сайта и сохранения сессий.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">3. Цели обработки персональных данных</h2>
  <ul class="list-disc pl-6 space-y-2 text-foreground/80">
    <li>идентификация Пользователя;</li>
    <li>связь с Пользователем (уведомления, запросы, информация);</li>
    <li>предоставление услуг и улучшение их качества;</li>
    <li>проведение маркетинговых и статистических исследований;</li>
    <li>обеспечение корректной работы Сайта и сохранение пользовательских настроек.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">4. Использование аналитики и cookie</h2>
  <div class="space-y-4 text-foreground/80">
    <p>4.1. На Сайте используется сервис аналитики Яндекс.Метрика (ООО «Яндекс»), который автоматически собирает обезличенные данные о действиях Пользователей с помощью файлов cookie и иных технологий.</p>
    <p>4.2. Технические cookie используются исключительно для корректной работы сайта, сохранения сессий и пользовательских настроек. Эти cookie не передаются третьим лицам и не используются для маркетинга.</p>
    <p>4.3. Сбор и обработка данных осуществляется в целях анализа активности посетителей и улучшения качества сервиса.</p>
    <p>4.4. Пользователь может отключить использование файлов cookie в настройках браузера. Это может повлиять на корректность работы некоторых функций Сайта.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">5. Правовые основания обработки</h2>
  <div class="space-y-4 text-foreground/80">
    <p>5.1. Персональные данные обрабатываются только при их самостоятельном указании Пользователем.</p>
    <p>5.2. Согласие Пользователя выражается:</p>
    <ul class="list-disc pl-6 space-y-2">
      <li>при отправке форм на сайте;</li>
      <li>при установке галочки согласия;</li>
      <li>при нажатии кнопки «Оформить заказ»;</li>
      <li>при нажатии кнопки «Согласен» в баннере cookie.</li>
    </ul>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">6. Условия обработки и хранения</h2>
  <div class="space-y-4 text-foreground/80">
    <p>6.1. Сайт принимает меры для защиты персональных данных от неправомерного или случайного доступа, изменения, блокирования, уничтожения или распространения.</p>
    <p>6.2. Данные хранятся до достижения целей обработки или до отзыва согласия Пользователем.</p>
    <p>6.3. Персональные данные пользователей хранятся на серверах, расположенных на территории Российской Федерации, в соответствии с требованиями ст. 18.1 Федерального закона №152-ФЗ «О персональных данных».</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">7. Передача персональных данных</h2>
  <div class="space-y-4 text-foreground/80">
    <p>7.1. Персональные данные могут передаваться сервисам-партнёрам, привлекаемым для выполнения заказов и обеспечения работы Сайта:</p>
    <ul class="list-disc pl-6 space-y-2">
      <li><strong>ЮKassa (ООО НКО «ЮМани»)</strong> — приём платежей банковскими картами и СБП;</li>
      <li><strong>Т-Банк (АО «ТБанк»)</strong> — приём платежей банковскими картами и Т-Pay;</li>
      <li><strong>СДЭК (ООО «СДЭК-Глобал»)</strong> — организация доставки заказов;</li>
      <li><strong>Яндекс Доставка (ООО «Яндекс»)</strong> — организация доставки заказов;</li>
      <li><strong>Яндекс.Метрика (ООО «Яндекс»)</strong> — сбор обезличенной аналитики посещений Сайта.</li>
    </ul>
    <p>7.2. Указанные сервисы-партнёры обрабатывают данные исключительно в объёме, необходимом для выполнения своих функций, и несут самостоятельную ответственность за их защиту.</p>
    <p>7.3. Данные могут быть переданы государственным органам РФ по законным основаниям.</p>
  </div>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">8. Права Пользователя</h2>
  <ul class="list-disc pl-6 space-y-2 text-foreground/80">
    <li>получать информацию об обработке своих персональных данных;</li>
    <li>требовать уточнения, блокировки или уничтожения данных;</li>
    <li>отозвать согласие на обработку данных, направив письменное уведомление Администрации Сайта.</li>
  </ul>
</section>

<section class="mb-8">
  <h2 class="text-xl font-semibold mb-4">9. Изменение Политики</h2>
  <div class="space-y-4 text-foreground/80">
    <p>9.1. Администрация Сайта вправе изменять Политику без предварительного уведомления.</p>
    <p>9.2. Новая редакция вступает в силу с момента размещения на Сайте. Пользователям рекомендуется периодически проверять актуальную версию Политики.</p>
  </div>
</section>

<section class="mt-12 p-6 border rounded-lg bg-accent/30 text-foreground/80">
  <h2 class="text-xl font-bold mb-4">10. Контакты</h2>
  <p class="mb-4">По всем вопросам, связанным с Политикой и обработкой персональных данных, обращаться:</p>
  <div class="space-y-1 text-sm">
    <p><strong>E-mail:</strong> <a href="mailto:info@booomerangs.ru" class="text-primary hover:underline">info@booomerangs.ru</a></p>
    <p><strong>Телефон:</strong> <a href="tel:+79606000047" class="text-primary hover:underline">+7 (960) 600-00-47</a></p>
    <p><strong>Почтовый адрес:</strong> 301666, Тульская область, г. Новомосковск, ул. Генерала Белова, дом 21 кв 48</p>
  </div>
</section>
`;

export default function Privacy() {
  const { data: pageSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings", "static_pages"],
    queryFn: async () => {
      const res = await fetch("/api/page-settings/static_pages");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const rawData = pageSettings?.privacy_data;
  const parsed = rawData ? (typeof rawData === "string" ? JSON.parse(rawData) : rawData) : null;
  const content = parsed?.content || DEFAULT_CONTENT;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO title="Политика конфиденциальности" description="Политика конфиденциальности и обработки персональных данных BMGBRAND." noindex={true} />
      <Navbar />
      <main className="flex-1 pt-32 pb-24 px-4">
        <div className="max-w-4xl mx-auto prose dark:prose-invert" dangerouslySetInnerHTML={{ __html: content }} />
        <div className="max-w-4xl mx-auto mt-12">
          <Link href="/" className="text-primary hover:underline uppercase font-bold" data-testid="link-back-home">
            Вернуться на главную
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
