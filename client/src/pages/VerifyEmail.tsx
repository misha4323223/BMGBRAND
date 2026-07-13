import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useVerifyEmail } from "@/hooks/use-auth";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CheckCircle, XCircle } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { Button } from "@/components/ui/button";
import SEO from "@/components/SEO";

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const verifyEmail = useVerifyEmail();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setMessage("Токен не найден");
      return;
    }

    verifyEmail.mutateAsync(token)
      .then(() => {
        setStatus("success");
        setMessage("Email успешно подтверждён!");
      })
      .catch((error: any) => {
        setStatus("error");
        setMessage(error?.message || "Недействительный или истёкший токен");
      });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Подтверждение email" noindex={true} />
      <Navbar />
      
      <div className="pt-32 pb-16 px-4 max-w-md mx-auto text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <BrandLoader size="lg" />
            <p className="text-muted-foreground">Подтверждаем email...</p>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">{message}</h1>
            <p className="text-muted-foreground">Теперь вы можете пользоваться всеми функциями сайта.</p>
            <Button onClick={() => setLocation("/")} className="mt-4">
              На главную
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">Ошибка</h1>
            <p className="text-muted-foreground">{message}</p>
            <Button onClick={() => setLocation("/")} variant="outline" className="mt-4">
              На главную
            </Button>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
