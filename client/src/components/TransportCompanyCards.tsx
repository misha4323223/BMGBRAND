import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { TRANSPORT_COMPANIES } from "@shared/transport-companies";

interface TransportCompanyCardsProps {
  value: string;
  onChange: (value: string) => void;
  /** Префикс test-id, чтобы разные страницы не конфликтовали (по умолчанию "tc"). */
  testIdPrefix?: string;
}

/**
 * Выбор транспортной компании — премиум-карточки в фирменных цветах.
 * Один клик = выбор ТК, ниже пользователь просто пишет адрес доставки.
 * Используется в Checkout (опт), WholesalePreorder и PreorderCheckout.
 */
export function TransportCompanyCards({
  value,
  onChange,
  testIdPrefix = "tc",
}: TransportCompanyCardsProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Транспортная компания"
      className="grid grid-cols-2 sm:grid-cols-3 gap-3"
    >
      {TRANSPORT_COMPANIES.map((tc) => {
        const isSelected = value === tc.id;
        return (
          <motion.button
            key={tc.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(tc.id)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            className={`relative w-full text-left rounded-2xl border-2 p-4 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 transition-colors ${
              isSelected ? "" : "border-border bg-card hover:bg-muted/40"
            }`}
            style={
              isSelected
                ? {
                    borderColor: tc.color,
                    backgroundColor: tc.color,
                    boxShadow: `0 12px 32px -12px ${tc.color}cc`,
                  }
                : undefined
            }
            data-testid={`card-${testIdPrefix}-${tc.id}`}
          >
            <span className="sr-only">{tc.name}</span>
            <div className="flex items-start justify-between">
              <div
                className={`h-10 w-10 rounded-xl flex items-center justify-center font-extrabold text-xs tracking-wide ${
                  isSelected ? "bg-white/20 text-white" : "text-white shadow-sm"
                }`}
                style={
                  isSelected
                    ? undefined
                    : {
                        background: `linear-gradient(135deg, ${tc.color}, ${tc.color}bb)`,
                        boxShadow: `inset 0 -2px 4px ${tc.color}66, 0 2px 6px ${tc.color}33`,
                      }
                }
              >
                {tc.abbr}
              </div>
              <AnimatePresence>
                {isSelected && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0, rotate: -90 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    className="h-5 w-5 rounded-full bg-white flex items-center justify-center shrink-0"
                  >
                    <Check className="h-3 w-3" strokeWidth={3.5} style={{ color: tc.color }} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <div className="mt-3">
              <div className={`font-bold text-sm leading-tight ${isSelected ? "text-white" : ""}`}>
                {tc.name}
              </div>
              <div
                className={`text-[11px] mt-1 leading-snug ${
                  isSelected ? "text-white/80" : "text-muted-foreground"
                }`}
              >
                {tc.desc}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
