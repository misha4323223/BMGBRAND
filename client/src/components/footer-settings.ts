export interface FooterSocialLink {
  platform: string;
  url: string;
  visible: boolean;
}

export interface FooterNavLink {
  label: string;
  href: string;
  visible: boolean;
}

export interface FooterNavColumn {
  title: string;
  visible: boolean;
  links: FooterNavLink[];
}

export interface FooterSettings {
  style: "classic" | "minimal" | "centered";
  colorScheme: "dark" | "light" | "brand";
  logoText: string;
  logoAccentText: string;
  description: string;
  socialLinks: FooterSocialLink[];
  columns: FooterNavColumn[];
  copyrightText: string;
  creditText: string;
  creditUrl: string;
  showPrivacyLink: boolean;
  showTermsLink: boolean;
  privacyLinkText: string;
  termsLinkText: string;
}

export const DEFAULT_FOOTER_SETTINGS: FooterSettings = {
  style: "classic",
  colorScheme: "dark",
  logoText: "BMG",
  logoAccentText: "BRAND",
  description: "Российский бренд одежды с авторскими принтами. Смелые дизайны. Качественные материалы. Мы создаем то, что носим сами. Из Тулы с любовью.",
  socialLinks: [
    { platform: "vk", url: "https://vk.com/bmgbrand", visible: true },
    { platform: "telegram", url: "https://t.me/bmg_booomerangs", visible: true },
    { platform: "instagram", url: "https://www.instagram.com/bmgbrand/", visible: true },
  ],
  columns: [
    {
      title: "Каталог",
      visible: true,
      links: [
        { label: "Все товары", href: "/products", visible: true },
        { label: "Одежда", href: "/products/clothing", visible: true },
        { label: "Носки", href: "/products/socks", visible: true },
        { label: "Аксессуары", href: "/products/accessories", visible: true },
      ],
    },
    {
      title: "Информация",
      visible: true,
      links: [
        { label: "Россия, Тула", href: "", visible: true },
        { label: "info@booomerangs.ru", href: "mailto:info@booomerangs.ru", visible: true },
        { label: "О бренде", href: "/about", visible: true },
        { label: "Частые вопросы", href: "/faq", visible: true },
        { label: "Подарочные карты", href: "/gift-cards", visible: true },
        { label: "Оптовым клиентам", href: "/wholesale", visible: true },
        { label: "Партнёрам", href: "/partner", visible: true },
        { label: "Вакансии", href: "/vacancies", visible: true },
      ],
    },
  ],
  copyrightText: "Booomerangs",
  creditText: "",
  creditUrl: "",
  showPrivacyLink: true,
  showTermsLink: true,
  privacyLinkText: "Политика конфиденциальности",
  termsLinkText: "Публичная оферта",
};
