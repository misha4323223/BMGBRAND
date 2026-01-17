import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shirt } from "lucide-react";
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
          initial={{ scale: 0.8, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0, y: 50 }}
          className="fixed bottom-6 right-6 z-[100]"
        >
          <div className="relative group">
            {/* T-shirt shape container */}
            <div className="bg-zinc-950 border border-zinc-800 p-4 shadow-2xl relative overflow-hidden flex flex-col items-center text-center w-48 aspect-[3/4] justify-center">
              {/* Decorative elements to suggest clothing/tag shape */}
              <div className="absolute -top-6 -left-6 w-12 h-12 bg-primary rotate-45 opacity-10" />
              <div className="absolute -top-6 -right-6 w-12 h-12 bg-primary -rotate-45 opacity-10" />
              
              <div className="bg-primary/10 p-2 border border-primary/20 mb-3">
                <Shirt className="w-6 h-6 text-primary" />
              </div>
              
              <h3 className="font-display text-white uppercase tracking-wider text-[10px] mb-2">МЫ ИСПОЛЬЗУЕМ COOKIES</h3>
              <p className="font-mono text-[9px] text-zinc-500 leading-tight mb-4 px-2">
                СОБИРАЕМ ДАННЫЕ, ЧТОБЫ УЛУЧШИТЬ ВАШ ОПЫТ. <br/>
                ПРОДОЛЖАЯ, ВЫ СОГЛАСНЫ С ПОЛИТИКОЙ.
              </p>
              
              <Button 
                onClick={handleAccept}
                className="bg-white text-black hover:bg-primary hover:text-white px-4 h-8 font-display text-[9px] uppercase tracking-widest transition-all w-full"
              >
                ПРИНЯТЬ
              </Button>
              
              {/* "Tag" detail */}
              <div className="absolute bottom-2 right-2 flex gap-1 opacity-20">
                <div className="w-1 h-1 bg-zinc-500 rounded-full" />
                <div className="w-1 h-1 bg-zinc-500 rounded-full" />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
