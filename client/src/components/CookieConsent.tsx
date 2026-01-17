import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shirt } from "lucide-react";
import { Button } from "./ui/button";
import { Link } from "wouter";

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
            {/* Modern streetwear-inspired shape container (asymmetric/clipped) */}
            <div className="bg-zinc-950 border border-zinc-800 p-6 shadow-2xl relative overflow-hidden flex flex-col items-start text-left w-64 justify-center"
                 style={{
                   clipPath: "polygon(0% 0%, 100% 0%, 100% 85%, 85% 100%, 0% 100%)",
                   borderRadius: "4px"
                 }}>
              {/* Decorative accent lines/grid */}
              <div className="absolute top-0 right-0 w-24 h-[1px] bg-primary/30" />
              <div className="absolute top-0 right-0 w-[1px] h-24 bg-primary/30" />
              
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-primary/10 p-2 border border-primary/20 rounded-sm">
                  <Shirt className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display text-white uppercase tracking-[0.2em] text-xs font-bold">COOKIE_DATA</h3>
              </div>
              
              <div className="font-mono text-[10px] text-zinc-400 leading-relaxed mb-6">
                <p className="mb-2 opacity-80 border-l border-primary/40 pl-2">
                  МЫ ИСПОЛЬЗУЕМ COOKIE ДЛЯ ОПТИМИЗАЦИИ ВАШЕГО ЭКСПИРИЕНСА В МАГАЗИНЕ.
                </p>
                <Link href="/privacy" className="text-primary hover:text-white transition-colors uppercase text-[9px] tracking-tight underline-offset-4 decoration-primary/30">
                  ПРОЧИТАТЬ ПОЛИТИКУ
                </Link>
              </div>
              
              <Button 
                onClick={handleAccept}
                className="bg-primary text-white hover:bg-white hover:text-black px-6 h-10 font-display text-[10px] uppercase tracking-[0.2em] transition-all w-full rounded-none skew-x-[-10deg]"
              >
                <span className="skew-x-[10deg]">ПОДТВЕРДИТЬ</span>
              </Button>
              
              {/* Technical "Metadata" detail */}
              <div className="absolute bottom-6 right-8 flex flex-col gap-0.5 opacity-30 select-none pointer-events-none">
                <span className="text-[6px] font-mono text-zinc-500">BMG_SYSTEM_V.1.0</span>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="w-1 h-[2px] bg-primary" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
