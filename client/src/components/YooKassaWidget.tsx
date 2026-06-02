import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, X } from "lucide-react";

declare global {
  interface Window {
    YooMoneyCheckoutWidget: any;
  }
}

interface YooKassaWidgetProps {
  confirmationToken: string;
  returnUrl: string;
  onSuccess?: () => void;
  onFail?: () => void;
  onClose?: () => void;
}

let scriptLoaded = false;
let scriptLoading = false;

export function loadWidgetScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoading) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (scriptLoaded) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  scriptLoading = true;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://yookassa.ru/checkout-widget/v1/checkout-widget.js";
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
    };
    script.onerror = () => {
      scriptLoading = false;
      reject(new Error("Failed to load YooKassa widget script"));
    };
    document.head.appendChild(script);
  });
}

export default function YooKassaWidget({
  confirmationToken,
  returnUrl,
  onSuccess,
  onFail,
  onClose,
}: YooKassaWidgetProps) {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const widgetRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (widgetRef.current) {
      try {
        widgetRef.current.destroy();
      } catch (e) {}
      widgetRef.current = null;
    }
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!confirmationToken || !open) return;

    let destroyed = false;

    const init = async () => {
      try {
        await loadWidgetScript();

        if (destroyed || !containerRef.current) return;

        const checkout = new window.YooMoneyCheckoutWidget({
          confirmation_token: confirmationToken,
          return_url: returnUrl,
          customization: {
            modal: false,
            colors: {
              control_primary: "#E11D48",
              background: "#FFFFFF",
              control_primary_content: "#FFFFFF",
            },
          },
          error_callback: (err: any) => {
            console.error("[YooKassa Widget] Error:", err);
            setError("Ошибка инициализации платёжной формы");
            setLoading(false);
          },
        });

        widgetRef.current = checkout;

        checkout.on("success", () => {
          onSuccess?.();
          handleClose();
        });

        checkout.on("fail", () => {
          onFail?.();
          handleClose();
        });

        if (!destroyed && containerRef.current) {
          await checkout.render("yookassa-widget-container");
          setLoading(false);
        }
      } catch (err) {
        console.error("[YooKassa Widget] Init error:", err);
        setError("Не удалось загрузить форму оплаты");
        setLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (widgetRef.current) {
        try {
          widgetRef.current.destroy();
        } catch (e) {}
        widgetRef.current = null;
      }
    };
  }, [confirmationToken, returnUrl, open, onSuccess, onFail, handleClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="dialog-yookassa-widget"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={handleClose}
      />
      <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Оплата заказа</h2>
            <button
              onClick={handleClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              data-testid="button-yookassa-close"
              aria-label="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loading && !error && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Загрузка формы оплаты...</span>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <p className="text-destructive mb-4">{error}</p>
              <button
                className="text-sm underline text-primary"
                onClick={() => handleClose()}
                data-testid="button-yookassa-fallback"
              >
                Закрыть и попробовать снова
              </button>
            </div>
          )}

          <div
            id="yookassa-widget-container"
            ref={containerRef}
            style={{ minWidth: 288, display: loading || error ? "none" : "block" }}
          />
        </div>
      </div>
    </div>
  );
}
