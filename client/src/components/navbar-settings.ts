export interface NavbarLink {
  label: string;
  href: string;
  visible: boolean;
}

export interface NavbarSettings {
  logoText: string;
  logoAccentText: string;
  links: NavbarLink[];
  style: "pill" | "classic" | "transparent" | "minimal";
  showSearch: boolean;
  showCart: boolean;
  showUser: boolean;
  showBackButton: boolean;
  maxWidth: string;
  position: "floating" | "fixed-top";
}

export const DEFAULT_NAVBAR_SETTINGS: NavbarSettings = {
  logoText: "BMG",
  logoAccentText: "BRAND",
  links: [
    { label: "Главная", href: "/", visible: true },
    { label: "Товары", href: "/products", visible: true },
    { label: "Pre-drop", href: "/concept", visible: true },
    { label: "Подарочные карты", href: "/gift-cards", visible: true },
    { label: "О нас", href: "/about", visible: true },
  ],
  style: "pill",
  showSearch: true,
  showCart: true,
  showUser: true,
  showBackButton: true,
  maxWidth: "max-w-4xl",
  position: "floating",
};
