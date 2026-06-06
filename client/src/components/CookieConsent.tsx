import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie, ShieldCheck, BarChart3, Target, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";
import { Switch } from "./ui/switch";

interface CookieSettings {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
}

export function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<CookieSettings>({
    necessary: true,
    analytics: true,
    marketing: true,
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
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-[100] sm:w-[320px]"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Cookie className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-white text-sm font-semibold">Cookies</span>
              </div>
              <button
                onClick={() => setShowSettings(v => !v)}
                className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors text-[11px]"
                data-testid="button-cookie-toggle-settings"
              >
                Настроить
                {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Text */}
            <p className="px-4 pb-3 text-zinc-400 text-[11px] leading-relaxed">
              Используем cookies для персонализации и аналитики.{" "}
              <Link href="/privacy" className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors">
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
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mx-4 mb-3 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
                    {[
                      { key: "necessary" as const, icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />, label: "Необходимые", sub: "Для работы сайта", disabled: true },
                      { key: "analytics" as const, icon: <BarChart3 className="w-3.5 h-3.5 text-blue-400" />, label: "Аналитика", sub: "Статистика посещений", disabled: false },
                      { key: "marketing" as const, icon: <Target className="w-3.5 h-3.5 text-purple-400" />, label: "Маркетинг", sub: "Персонализация", disabled: false },
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
                            <p className="text-white text-[11px] font-medium leading-none mb-0.5">{label}</p>
                            <p className="text-zinc-600 text-[10px] leading-none">{sub}</p>
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
                onClick={() => saveConsent({ necessary: true, analytics: true, marketing: true })}
                data-testid="button-cookie-accept-all"
                className="flex-1 h-9 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-100 active:scale-[0.97] transition-all"
              >
                Принять все
              </button>
              <button
                onClick={() => saveConsent(settings)}
                data-testid="button-cookie-accept-selected"
                className="flex-1 h-9 rounded-xl border border-zinc-700 text-zinc-300 text-xs hover:border-zinc-500 hover:text-white active:scale-[0.97] transition-all"
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
