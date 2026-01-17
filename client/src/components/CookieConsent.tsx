import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie } from "lucide-react";
import { Button } from "./ui/button";

export function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      const timer = setTimeout(() => setIsVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookie-consent", "true");
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-6 left-6 right-6 md:left-auto md:right-6 md:max-w-md z-[100]"
        >
          <div className="bg-zinc-950 border border-zinc-800 p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-2 border border-primary/20">
                <Cookie className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-white uppercase tracking-wider mb-2">Куки-файлы</h3>
                <p className="font-mono text-xs text-zinc-400 leading-relaxed mb-4">
                  Мы используем куки для улучшения работы сайта и вашего удобства. 
                  Оставаясь на сайте, вы соглашаетесь с нашей политикой конфиденциальности.
                </p>
                <div className="flex justify-end">
                  <Button 
                    onClick={handleAccept}
                    className="bg-white text-black hover:bg-primary hover:text-white px-8 h-10 font-display text-xs uppercase tracking-widest transition-all"
                  >
                    Принять
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
