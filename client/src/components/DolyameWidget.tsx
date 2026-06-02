import { useState } from "react";
import { createPortal } from "react-dom";

interface DolyameWidgetProps {
  price: number;
  isDark?: boolean;
  isMinta?: boolean;
  productId: number;
  onOpenChange?: (open: boolean) => void;
}

export function DolyameLogo({ size = 16, white = false }: { size?: number; white?: boolean }) {
  const color = white ? "#fff" : "#1C1C1C";
  const bars = [0.45, 0.65, 0.82, 1.0];
  return (
    <svg width={size * 1.1} height={size} viewBox="0 0 22 16" fill="none" style={{ flexShrink: 0 }}>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 5.5}
          y={16 * (1 - h)}
          width={3.5}
          height={16 * h}
          rx={1}
          fill={color}
        />
      ))}
    </svg>
  );
}

function getPaymentDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
  for (let i = 0; i < 4; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i * 14);
    dates.push(fmt.format(d));
  }
  return dates;
}

export function DolyameWidget({ price, isDark = false, isMinta = false, productId, onOpenChange }: DolyameWidgetProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = (val: boolean) => {
    setOpen(val);
    onOpenChange?.(val);
  };

  const installment = Math.round(price / 4 / 100);
  const totalRub = Math.round(price / 100);
  const fmt = new Intl.NumberFormat("ru-RU");
  const dates = getPaymentDates();

  const badgeBg = isDark ? "bg-white" : "bg-[#1C1C1C]";
  const badgeText = isDark ? "text-[#1C1C1C]" : "text-white";
  const subtitleColor = isDark ? "text-white/70" : isMinta ? "text-[#2e2e2e]" : "text-[#1C1C1C]";

  const modal = open ? createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { e.stopPropagation(); handleOpen(false); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full sm:w-[360px] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#1C1C1C] px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 mb-2">
            <DolyameLogo size={18} white />
            <span className="text-white text-[17px] sm:text-[19px] font-black tracking-widest uppercase">Долями</span>
          </div>
          <p className="text-white/60 text-[11px] sm:text-[12px] font-medium">
            {fmt.format(totalRub)} ₽ · 4 платежа · без процентов
          </p>
        </div>

        <div className="px-4 sm:px-5 py-3 sm:py-4 space-y-2 sm:space-y-3 bg-white">
          {dates.map((date, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border-2 flex-shrink-0 ${i === 0 ? "bg-[#1C1C1C] border-[#1C1C1C]" : "bg-white border-gray-200"}`}>
                  <span className={`text-[10px] font-black ${i === 0 ? "text-white" : "text-gray-400"}`}>{i + 1}</span>
                </div>
                <div>
                  <p className="text-[12px] sm:text-[13px] font-semibold text-gray-900 leading-tight">
                    {i === 0 ? "Сегодня" : date}
                  </p>
                  {i === 0 && (
                    <p className="text-[10px] text-gray-400 leading-tight">При оформлении</p>
                  )}
                </div>
              </div>
              <span className="text-[14px] sm:text-[15px] font-bold text-gray-900 tabular-nums">
                {fmt.format(installment)} ₽
              </span>
            </div>
          ))}
        </div>

        <div className="px-4 sm:px-5 pb-4 sm:pb-5 bg-white">
          <div className="h-px bg-gray-100 mb-3" />
          <p className="text-[10px] sm:text-[11px] text-gray-400 leading-relaxed mb-3">
            Сервис «Долями» от Т-Банка. Без переплат и скрытых комиссий. Итого: <strong className="text-gray-600">{fmt.format(totalRub)} ₽</strong>
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleOpen(false); }}
            className="w-full h-10 sm:h-11 bg-[#1C1C1C] text-white font-bold text-[13px] tracking-widest uppercase rounded-none hover:bg-black transition-colors active:scale-[0.98]"
            data-testid="dolyame-modal-ok"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleOpen(true); }}
        className={`flex items-center gap-2 mt-1.5 w-fit group transition-opacity duration-150 ${open ? 'opacity-0 pointer-events-none' : ''}`}
        data-testid={`dolyame-badge-${productId}`}
      >
        <span className={`flex items-center gap-1 ${badgeBg} ${badgeText} px-1.5 py-0.5 leading-none transition-opacity group-hover:opacity-75`}>
          <DolyameLogo size={9} white={!isDark} />
          <span className="text-[9px] font-extrabold tracking-widest uppercase">Долями</span>
        </span>
        <span className={`text-[10px] font-medium ${subtitleColor} group-hover:underline underline-offset-2`}>
          4 × {fmt.format(installment)} ₽
        </span>
      </button>
      {modal}
    </>
  );
}
