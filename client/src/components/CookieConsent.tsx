import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie, X, ChevronDown, ChevronUp, ShieldCheck, BarChart3, Target } from "lucide-react";
import { Button } from "./ui/button";
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
    }, 400);
  };

  const handleAcceptAll = () => {
    saveConsent({ necessary: true, analytics: true, marketing: true });
  };

  const handleAcceptSelected = () => {
    saveConsent(settings);
  };

  const toggleSetting = (key: keyof CookieSettings) => {
    if (key === 'necessary') return;
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100, scale: 0.9 }}
          animate={{ 
            opacity: isExiting ? 0 : 1, 
            y: isExiting ? 100 : 0, 
            scale: isExiting ? 0.9 : 1 
          }}
          exit={{ opacity: 0, y: 100, scale: 0.9 }}
          transition={{ 
            type: "spring", 
            stiffness: 300, 
            damping: 30,
            mass: 0.8
          }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[100] sm:max-w-md w-auto"
        >
          <div className="relative backdrop-blur-xl bg-zinc-900/95 border border-zinc-700/50 rounded-2xl p-5 shadow-2xl shadow-black/50">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30">
                    <Cookie className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-sm">Настройки Cookies</h3>
                    <p className="text-zinc-500 text-[10px] uppercase tracking-wider">Конфиденциальность</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSettings(!showSettings)}
                  className="text-zinc-400 hover:text-white h-8 px-2"
                >
                  {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
              
              <p className="text-zinc-400 text-xs leading-relaxed mb-4">
                Мы используем файлы cookie для персонализации контента и анализа трафика. Вы можете выбрать, какие типы данных разрешить.
              </p>

              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-3 mb-4"
                  >
                    <div className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex gap-3">
                          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-white text-xs font-medium">Необходимые</p>
                            <p className="text-zinc-500 text-[10px]">Для работы сайта</p>
                          </div>
                        </div>
                        <Switch checked={true} disabled className="data-[state=checked]:bg-emerald-500" />
                      </div>

                      <div className="flex items-center justify-between gap-4 cursor-pointer" onClick={() => toggleSetting('analytics')}>
                        <div className="flex gap-3">
                          <BarChart3 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-white text-xs font-medium">Аналитика</p>
                            <p className="text-zinc-500 text-[10px]">Статистика посещений</p>
                          </div>
                        </div>
                        <Switch 
                          checked={settings.analytics} 
                          onCheckedChange={() => toggleSetting('analytics')}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4 cursor-pointer" onClick={() => toggleSetting('marketing')}>
                        <div className="flex gap-3">
                          <Target className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-white text-xs font-medium">Маркетинг</p>
                            <p className="text-zinc-500 text-[10px]">Персонализация рекламы</p>
                          </div>
                        </div>
                        <Switch 
                          checked={settings.marketing} 
                          onCheckedChange={() => toggleSetting('marketing')}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="flex flex-col gap-2">
                <Button 
                  onClick={handleAcceptAll}
                  className="w-full bg-white text-black hover:bg-zinc-200 h-10 text-xs font-bold rounded-xl transition-all"
                  data-testid="button-cookie-accept-all"
                >
                  Принять все
                </Button>
                <div className="flex gap-2">
                  <Button 
                    onClick={handleAcceptSelected}
                    variant="outline"
                    className="flex-1 border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 h-9 text-[11px] rounded-xl"
                    data-testid="button-cookie-accept-selected"
                  >
                    Принять выбранные
                  </Button>
                  {!showSettings && (
                    <Button 
                      onClick={() => setShowSettings(true)}
                      variant="ghost"
                      className="flex-1 text-zinc-500 hover:text-zinc-300 text-[11px] h-9"
                    >
                      Настроить
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 text-center">
                <Link 
                  href="/privacy" 
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Политика конфиденциальности
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
