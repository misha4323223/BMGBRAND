import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import SEO from "@/components/SEO";
import { Loader2, Handshake, BookOpen, Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { ProgramInfoDialog } from "./partner/ProgramInfoDialog";

export default function PartnerLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [programInfoOpen, setProgramInfoOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function parseApiError(err: any, fallback: string): string {
    let message = err?.message || fallback;
    try {
      const m = message.match(/^\d+:\s*(.*)$/);
      if (m) {
        const parsed = JSON.parse(m[1]);
        message = parsed.error || message;
      }
    } catch {}
    return message;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/partner/login", { email, password });
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Вход выполнен", description: `Добро пожаловать, ${data.user.name || ""}!` });
      setLocation("/partner/profile");
    } catch (err: any) {
      setError(parseApiError(err, "Ошибка входа"));
    } finally {
      setSubmitting(false);
    }
  }

  function openForgot() {
    setForgotEmail(email);
    setForgotSent(false);
    setForgotOpen(true);
  }

  async function onForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotSubmitting(true);
    try {
      // role: "partner" — backend looks up user with role='partner'.
      // The response is intentionally identical whether the email exists or not (anti-enumeration).
      const res = await apiRequest("POST", "/api/auth/forgot-password", {
        email: forgotEmail.trim(),
        role: "partner",
      });
      await res.json().catch(() => ({}));
      setForgotSent(true);
      toast({
        title: "Письмо отправлено",
        description: "Если email зарегистрирован как партнёрский, на него придёт ссылка для сброса пароля.",
      });
    } catch (err: any) {
      toast({
        title: "Ошибка",
        description: parseApiError(err, "Не удалось отправить письмо"),
        variant: "destructive",
      });
    } finally {
      setForgotSubmitting(false);
    }
  }

  return (
    <>
      <SEO title="Вход для партнёров — BMG BRAND" description="Партнёрский кабинет BMG BRAND" noindex />
      <Navbar />
      <main className="container mx-auto px-4 pt-24 sm:pt-28 pb-12 min-h-[70vh] flex items-start justify-center">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6 sm:mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <Handshake className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold mb-2" data-testid="text-partner-login-title">Партнёрская программа</h1>
            <p className="text-sm text-muted-foreground">Войдите в партнёрский кабинет BMG BRAND</p>
          </div>

          <div className="flex gap-2 mb-6">
            <Button variant="default" className="flex-1" data-testid="button-switch-to-login">
              <LogIn className="w-4 h-4 mr-2" />
              Вход
            </Button>
            <Link href="/partner/register" className="flex-1">
              <Button variant="outline" className="w-full" data-testid="button-switch-to-register">
                <UserPlus className="w-4 h-4 mr-2" />
                Регистрация
              </Button>
            </Link>
          </div>

          <Card className="p-5 sm:p-6 shadow-sm">
            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" data-testid="alert-login-error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" autoComplete="email" placeholder="you@example.com" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Пароль</Label>
                  <button
                    type="button"
                    onClick={openForgot}
                    className="text-xs text-primary hover:underline"
                    data-testid="button-forgot-password"
                  >
                    Забыли пароль?
                  </button>
                </div>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" autoComplete="current-password" placeholder="••••••••" className="pr-10" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1} data-testid="button-toggle-password">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full mt-2" disabled={submitting} data-testid="button-submit-login">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Войти
              </Button>
            </form>
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                <span className="bg-card px-2 text-muted-foreground">или</span>
              </div>
            </div>
            <p className="text-sm text-center text-muted-foreground">
              Ещё нет аккаунта?{" "}
              <Link href="/partner/register" className="text-primary font-medium hover:underline" data-testid="link-register">Подать заявку</Link>
            </p>
          <div className="mt-4 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-muted-foreground"
              onClick={() => setProgramInfoOpen(true)}
              data-testid="button-program-info"
            >
              <BookOpen className="w-4 h-4" />
              Ознакомиться с партнёрской программой
            </Button>
          </div>
          </Card>
          <p className="text-center text-[11px] text-muted-foreground mt-4">
            Защищённое соединение · согласие фиксируется по 63-ФЗ
          </p>
        </div>
      </main>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-forgot-password">
          <DialogHeader>
            <DialogTitle>Сброс пароля партнёра</DialogTitle>
            <DialogDescription>
              Укажите email, на который зарегистрирован партнёрский аккаунт. Мы отправим ссылку для смены пароля.
            </DialogDescription>
          </DialogHeader>
          {forgotSent ? (
            <div className="space-y-4 py-2">
              <Alert>
                <AlertDescription>
                  Если такой партнёрский email зарегистрирован, на него отправлено письмо со ссылкой для сброса пароля.
                  Ссылка действует 1 час. Проверьте папку «Спам».
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button onClick={() => setForgotOpen(false)} data-testid="button-forgot-close">
                  Закрыть
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={onForgotSubmit} className="space-y-4">
              <div>
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoComplete="email"
                  data-testid="input-forgot-email"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForgotOpen(false)}
                  disabled={forgotSubmitting}
                  data-testid="button-forgot-cancel"
                >
                  Отмена
                </Button>
                <Button type="submit" disabled={forgotSubmitting} data-testid="button-forgot-submit">
                  {forgotSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Отправить ссылку
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ProgramInfoDialog open={programInfoOpen} onOpenChange={setProgramInfoOpen} />

      <Footer />
    </>
  );
}
