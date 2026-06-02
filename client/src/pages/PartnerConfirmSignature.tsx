import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";
import { Loader2, CheckCircle, AlertTriangle, Clock, ShieldAlert } from "lucide-react";

type Status = "loading" | "success" | "error";

interface ConfirmResponse {
  ok?: boolean;
  message?: string;
  partnerSlug?: string;
  contactName?: string;
  error?: string;
  code?: "token_not_found" | "expired" | "email_taken" | "slug_taken" | "stale";
  stale?: string;
}

// УНЭП «email-link first» (30.04.2026):
// Эта страница открывается из письма-подтверждения. Она POST-ит token на сервер,
// после чего сервер атомарно создаёт user+partner+consent_signatures и удаляет
// pending-строку (одноразовость). Повторное открытие ссылки даст 404 →
// «уже использована или истекла».
export default function PartnerConfirmSignature() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [httpStatus, setHttpStatus] = useState<number>(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || "";

    if (!token) {
      setHttpStatus(400);
      setResult({ error: "В ссылке отсутствует токен подтверждения." });
      setStatus("error");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/partner/confirm-signature", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as ConfirmResponse;
        if (cancelled) return;
        setHttpStatus(res.status);
        setResult(data || {});
        setStatus(res.ok ? "success" : "error");
      } catch (e) {
        if (cancelled) return;
        setHttpStatus(0);
        setResult({ error: "Не удалось связаться с сервером. Проверьте интернет и обновите страницу." });
        setStatus("error");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <SEO title="Подтверждение подписи — BMG BRAND" />
      <Navbar />
      <main className="container mx-auto px-4 pt-24 pb-12 min-h-[60vh]">
        <div className="max-w-md mx-auto text-center">
          {status === "loading" && (
            <div data-testid="confirm-loading">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
              <h1 className="text-xl font-bold mb-2">Фиксируем вашу подпись…</h1>
              <p className="text-muted-foreground text-sm">
                Сверяем версии документов и записываем юридически значимый журнал согласий.
              </p>
            </div>
          )}

          {status === "success" && (
            <div data-testid="confirm-success">
              <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-600" />
              <h1 className="text-2xl font-bold mb-2" data-testid="text-confirm-success-title">
                Подпись зафиксирована!
              </h1>
              <p className="text-muted-foreground mb-2">
                {result?.message ||
                  "Заявка передана менеджеру на рассмотрение. Мы свяжемся с вами в ближайшее время."}
              </p>
              <p className="text-xs text-muted-foreground mb-6">
                Время и IP-адрес клика записаны в журнал согласий (УНЭП по 63-ФЗ).
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button onClick={() => setLocation("/partner/login")} data-testid="button-go-login">
                  Войти в кабинет
                </Button>
                <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-go-home">
                  На главную
                </Button>
              </div>
            </div>
          )}

          {status === "error" && (
            <div data-testid="confirm-error">
              {(result?.code === "expired" || httpStatus === 410) ? (
                <Clock className="w-16 h-16 mx-auto mb-4 text-amber-600" />
              ) : (result?.code === "stale") ? (
                <ShieldAlert className="w-16 h-16 mx-auto mb-4 text-amber-600" />
              ) : (
                <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-red-600" />
              )}
              <h1 className="text-2xl font-bold mb-2" data-testid="text-confirm-error-title">
                {(result?.code === "expired" || httpStatus === 410)
                  ? "Срок действия ссылки истёк"
                  : (result?.code === "token_not_found" || httpStatus === 404)
                  ? "Ссылка уже использована или недействительна"
                  : (result?.code === "email_taken")
                  ? "Этот email уже зарегистрирован"
                  : (result?.code === "slug_taken")
                  ? "Идентификатор магазина был занят"
                  : (result?.code === "stale")
                  ? "Документы обновились"
                  : "Не удалось подтвердить подпись"}
              </h1>
              <p className="text-muted-foreground mb-6" data-testid="text-confirm-error-msg">
                {result?.error ||
                  "Произошла техническая ошибка. Попробуйте подать заявку заново."}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button onClick={() => setLocation("/partner/register")} data-testid="button-retry-register">
                  Подать заявку заново
                </Button>
                <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-go-home">
                  На главную
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
