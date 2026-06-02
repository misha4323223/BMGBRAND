import SEO from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

function VkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#0077FF"/>
      <path d="M25.54 34.58c-10.94 0-17.18-7.5-17.44-19.98h5.48c.18 9.12 4.2 12.98 7.38 13.78V14.6h5.16v7.86c3.14-.34 6.44-3.92 7.56-7.86h5.16c-.86 4.86-4.46 8.44-7.02 9.92 2.56 1.18 6.66 4.32 8.22 10.06h-5.68c-1.22-3.82-4.28-6.78-8.24-7.18v7.18h-.58Z" fill="#fff"/>
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFC107"/>
          <stop offset="30%" stopColor="#F44336"/>
          <stop offset="60%" stopColor="#E040FB"/>
          <stop offset="100%" stopColor="#7B1FA2"/>
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#ig-grad)"/>
      <rect x="12" y="12" width="24" height="24" rx="7" stroke="#fff" strokeWidth="2.5" fill="none"/>
      <circle cx="24" cy="24" r="5.5" stroke="#fff" strokeWidth="2.5" fill="none"/>
      <circle cx="31.5" cy="16.5" r="1.8" fill="#fff"/>
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#26A5E4"/>
      <path d="M10.8 23.4l24.6-9.6c1.1-.4 2 .3 1.7 1.6l-4.2 19.8c-.3 1.3-1.1 1.6-2.2 1l-6.2-4.6-3 2.9c-.3.3-.6.6-1.3.6l.4-6.2 11.2-10.1c.5-.4-.1-.7-.8-.3L17.6 26l-6-1.9c-1.3-.4-1.3-1.3.3-1.9l-.1.2Z" fill="#fff"/>
    </svg>
  );
}

function WbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#CB11AB"/>
      <text x="24" y="28" textAnchor="middle" fill="#fff" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="16">WB</text>
    </svg>
  );
}

function YandexMarketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#FFCC00"/>
      <text x="24" y="30" textAnchor="middle" fill="#000" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="22">Я</text>
    </svg>
  );
}

function OzonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#005BFF"/>
      <text x="24" y="28" textAnchor="middle" fill="#fff" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="11">OZON</text>
    </svg>
  );
}

const SOCIAL_LINKS = [
  {
    name: "ВКонтакте",
    description: "общайтесь и следите за обновлениями",
    url: "https://vk.com/bmgbrand",
    Icon: VkIcon,
  },
  {
    name: "Instagram",
    description: "свежие фото и сторис",
    url: "https://www.instagram.com/bmgbrand/",
    Icon: InstagramIcon,
  },
  {
    name: "Telegram",
    description: "быстрые новости и обратная связь",
    url: "https://t.me/bmg_booomerangs",
    Icon: TelegramIcon,
  },
];

const MARKETPLACE_LINKS = [
  {
    name: "Wildberries",
    description: "удобный выбор и быстрая доставка",
    url: "https://www.wildberries.ru/brands/booomerangs",
    Icon: WbIcon,
  },
  {
    name: "Яндекс Маркет",
    description: "заказывайте с доставкой по всей России",
    url: "https://market.yandex.ru/business--booomerangs/1223609?generalContext=t%3DshopInShop%3Bi%3D1%3Bbi%3D1223609%3B&rs=eJwBPQDC_zI76AEB8gE1CAEQocIFGAAo8Y2sICjkj9ogKOCApSEo4uOoICi0mKghKNfCjCEoxJSgISjCg6EhKOfhrSHawxn8&searchContext=sins_ctx",
    Icon: YandexMarketIcon,
  },
  {
    name: "Ozon",
    description: "выгодные предложения и акции",
    url: "https://www.ozon.ru/seller/booomerangs-159324/?miniapp=seller_159324",
    Icon: OzonIcon,
  },
];

export default function Links() {
  return (
    <>
      <SEO
        title="Ссылки — BMGBRAND"
        description="Все важные ссылки BMGBRAND: соцсети и маркетплейсы"
        noindex={true}
      />
      <Navbar />
      <main className="min-h-screen bg-background pt-24 pb-16 px-4">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            <h1 className="text-2xl sm:text-3xl font-bold uppercase leading-tight" data-testid="text-links-title">
              Здесь вы найдете все важные ссылки
              <br />
              для связи и покупок наших товаров
            </h1>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <h2 className="text-lg font-semibold text-center mb-4" data-testid="text-social-heading">
                Подписывайтесь на нас
                <br />
                <span className="text-muted-foreground font-normal text-base">в социальных сетях</span>
              </h2>
              <div className="space-y-3">
                {SOCIAL_LINKS.map((link) => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 p-4 rounded-md border border-border bg-card hover-elevate active-elevate-2 transition-colors"
                    data-testid={`link-social-${link.name.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    <link.Icon className="w-10 h-10 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{link.name}</div>
                      <div className="text-xs text-muted-foreground">{link.description}</div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </a>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <h2 className="text-lg font-semibold text-center mb-4" data-testid="text-marketplace-heading">
                Выбирайте удобную
                <br />
                <span className="text-muted-foreground font-normal text-base">площадку для заказа!</span>
              </h2>
              <div className="space-y-3">
                {MARKETPLACE_LINKS.map((link) => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 p-4 rounded-md border border-border bg-card hover-elevate active-elevate-2 transition-colors"
                    data-testid={`link-marketplace-${link.name.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    <link.Icon className="w-10 h-10 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{link.name}</div>
                      <div className="text-xs text-muted-foreground">{link.description}</div>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </a>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
