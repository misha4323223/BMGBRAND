import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useResetPassword } from "@/hooks/use-auth";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CheckCircle, XCircle, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import SEO from "@/components/SEO";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"form" | "success" | "error">("form");
  const [errorMessage, setErrorMessage] = useState("");
  const resetPassword = useResetPassword();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    if (tokenParam) {
      setToken(tokenParam);
    } else {
      setStatus("error");
      setErrorMessage("Токен не найден");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({ title: "Пароли не совпадают", variant: "destructive" });
      return;
    }
    
    if (password.length < 6) {
      toast({ title: "Пароль должен быть не менее 6 символов", variant: "destructive" });
      return;
    }

    try {
      await resetPassword.mutateAsync({ token, password });
      setStatus("success");
    } catch (error: any) {
      setStatus("error");
      setErrorMessage(error?.message || "Ошибка сброса пароля");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Сброс пароля" noindex={true} />
      <Navbar />
      
      <div className="pt-32 pb-16 px-4 max-w-md mx-auto">
        {status === "form" && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-foreground">Новый пароль</h1>
              <p className="text-muted-foreground mt-2">Введите новый пароль для вашего аккаунта</p>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Новый пароль</Label>
                <PasswordInput
                  id="password"
                  placeholder="Минимум 6 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Подтвердите пароль</Label>
                <PasswordInput
                  id="confirm-password"
                  placeholder="Повторите пароль"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  data-testid="input-confirm-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={resetPassword.isPending} data-testid="button-reset-submit">
                {resetPassword.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Сохранить пароль"}
              </Button>
            </form>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">Пароль изменён!</h1>
            <p className="text-muted-foreground">Теперь вы можете войти с новым паролем.</p>
            <Button onClick={() => setLocation("/")} className="mt-4">
              На главную
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">Ошибка</h1>
            <p className="text-muted-foreground">{errorMessage}</p>
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
