// Curated, fixed set of icons for the product "feature badges" row
// (e.g. "100% хлопок", "Сделано в России"). Admin picks an icon by name
// from this list instead of uploading an image — keeps template creation
// fast and visually consistent across the catalog.
import {
  Shirt,
  Flag,
  Palette,
  Layers,
  Sprout,
  ShieldCheck,
  Droplets,
  Award,
  Gem,
  Feather,
  Ruler,
  Leaf,
  Heart,
  Star,
  Sparkles,
  PackageCheck,
  Recycle,
  Sun,
  Snowflake,
  Zap,
  Hand,
  Gauge,
  type LucideIcon,
} from "lucide-react";

export const FEATURE_BADGE_ICONS: { name: string; label: string; Icon: LucideIcon }[] = [
  { name: "Shirt", label: "Ткань / одежда", Icon: Shirt },
  { name: "Flag", label: "Страна / флаг", Icon: Flag },
  { name: "Palette", label: "Принт / дизайн", Icon: Palette },
  { name: "Layers", label: "Плотность / слои", Icon: Layers },
  { name: "Sprout", label: "Натуральность", Icon: Sprout },
  { name: "ShieldCheck", label: "Качество / гарантия", Icon: ShieldCheck },
  { name: "Droplets", label: "Уход / стирка", Icon: Droplets },
  { name: "Award", label: "Награда / премиум", Icon: Award },
  { name: "Gem", label: "Премиум", Icon: Gem },
  { name: "Feather", label: "Лёгкость / мягкость", Icon: Feather },
  { name: "Ruler", label: "Размер / посадка", Icon: Ruler },
  { name: "Leaf", label: "Эко", Icon: Leaf },
  { name: "Heart", label: "Забота / комфорт", Icon: Heart },
  { name: "Star", label: "Отличие", Icon: Star },
  { name: "Sparkles", label: "Особенность", Icon: Sparkles },
  { name: "PackageCheck", label: "Упаковка / доставка", Icon: PackageCheck },
  { name: "Recycle", label: "Переработка", Icon: Recycle },
  { name: "Sun", label: "Лето / жара", Icon: Sun },
  { name: "Snowflake", label: "Зима / холод", Icon: Snowflake },
  { name: "Zap", label: "Прочность", Icon: Zap },
  { name: "Hand", label: "Ручная работа", Icon: Hand },
  { name: "Gauge", label: "Плотность (г/м²)", Icon: Gauge },
];

export const FEATURE_BADGE_ICON_MAP: Record<string, LucideIcon> = FEATURE_BADGE_ICONS.reduce(
  (acc, { name, Icon }) => {
    acc[name] = Icon;
    return acc;
  },
  {} as Record<string, LucideIcon>
);

export function getFeatureBadgeIcon(name: string | undefined | null): LucideIcon {
  return (name && FEATURE_BADGE_ICON_MAP[name]) || Sparkles;
}

export type FeatureBadgeTemplate = {
  id: string;
  icon: string;
  title: string;
  description: string;
};
