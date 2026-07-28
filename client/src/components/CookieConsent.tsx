import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie, ShieldCheck, BarChart3, Target, Bell, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";
import { Switch } from "./ui/switch";

interface CookieSettings {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  push: boolean;
}

export function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<CookieSettings>({
    necessary: true,
    analytics: true,
    marketing: true,
    push: true,
  });

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      const timer = setTimeout(() => setIsVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const saveConsent = (finalSettings: CookieSettings) => {
    setIsExiting(true);
    setTimeout(() => {
      localStorage.setItem("cookie-consent", JSON.stringify(finalSettings));
      setIsVisible(false);
    }, 350);
  };

  const toggleSetting = (key: keyof CookieSettings) => {
    if (key === "necessary") return;
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? 24 : 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 400, damping: 32, mass: 0.7 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-[100] sm:w-[310px]"
        >
          <div className="bg-card/75 backdrop-blur-md border border-border/60 rounded-2xl shadow-sm overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
              <div className="flex items-center gap-2">
                <Cookie className="w-4 h-4 text-primary shrink-0" />
                <span className="text-foreground text-sm font-semibold tracking-tight">Cookies</span>
              </div>
              <button
                onClick={() => setShowSettings(v => !v)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-[11px] font-medium"
                data-testid="button-cookie-toggle-settings"
              >
                Настроить
                {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Divider */}
            <div className="h-px bg-border mx-4" />

            {/* Text */}
            <p className="px-4 pt-2.5 pb-3 text-foreground/80 text-[11px] leading-relaxed">
              Используем cookies для персонализации и аналитики.{" "}
              <Link href="/privacy" className="text-foreground/60 hover:text-foreground underline underline-offset-2 transition-colors">
                Подробнее
              </Link>
            </p>

            {/* Settings panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="mx-4 mb-3 rounded-xl border border-border divide-y divide-border bg-background">
                    {[
                      { key: "necessary" as const, icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />, label: "Необходимые", sub: "Для работы сайта", disabled: true },
                      { key: "analytics" as const, icon: <BarChart3 className="w-3.5 h-3.5 text-blue-500" />, label: "Аналитика", sub: "Статистика посещений", disabled: false },
                      { key: "marketing" as const, icon: <Target className="w-3.5 h-3.5 text-purple-500" />, label: "Маркетинг", sub: "Персонализация", disabled: false },
                      { key: "push" as const, icon: <Bell className="w-3.5 h-3.5 text-orange-500" />, label: "Пуш-уведомления", sub: "Новинки и акции", disabled: false },
                    ].map(({ key, icon, label, sub, disabled }) => (
                      <div
                        key={key}
                        className="flex items-center justify-between px-3 py-2.5 gap-3"
                        onClick={() => !disabled && toggleSetting(key)}
                        style={{ cursor: disabled ? "default" : "pointer" }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {icon}
                          <div>
                            <p className="text-foreground text-[11px] font-medium leading-none mb-0.5">{label}</p>
                            <p className="text-muted-foreground text-[10px] leading-none">{sub}</p>
                          </div>
                        </div>
                        <Switch
                          checked={settings[key]}
                          disabled={disabled}
                          onCheckedChange={() => !disabled && toggleSetting(key)}
                          className="shrink-0 scale-90"
                        />
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Buttons */}
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={() => saveConsent({ necessary: true, analytics: true, marketing: true, push: true })}
                data-testid="button-cookie-accept-all"
                className="flex-1 h-9 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 active:scale-[0.97] transition-all"
              >
                Принять все
              </button>
              <button
                onClick={() => saveConsent(settings)}
                data-testid="button-cookie-accept-selected"
                className="flex-1 h-9 rounded-xl border border-border text-foreground text-xs font-medium hover:bg-muted active:scale-[0.97] transition-all"
              >
                Выбранные
              </button>
            </div>

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
