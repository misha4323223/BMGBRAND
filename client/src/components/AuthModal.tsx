import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin, useRegister, useForgotPassword } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, Lock, ArrowLeft, CheckCircle, Eye, EyeOff, ArrowRight, Building2, Handshake } from "lucide-react";
import { Link } from "wouter";

type AuthView = "login" | "register" | "forgot-password";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView?: AuthView;
}

export function AuthModal({ open, onOpenChange, initialView = "login" }: AuthModalProps) {
  const [view, setView] = useState<AuthView>(initialView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [patronymic, setPatronymic] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const login = useLogin();
  const register = useRegister();
  const forgotPassword = useForgotPassword();
  const { toast } = useToast();

  const resetForm = () => {
    setEmail(""); setPassword(""); setLastName("");
    setFirstName(""); setPatronymic("");
    setSuccessMessage(""); setShowPassword(false);
  };

  const handleClose = () => {
    resetForm();
    setView("login");
    onOpenChange(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login.mutateAsync({ email, password });
      toast({ title: "Добро пожаловать!" });
      handleClose();
    } catch (error: any) {
      toast({ title: error?.message || "Ошибка входа", variant: "destructive" });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const name = [lastName, firstName, patronymic].filter(Boolean).join(' ');
      const result = await register.mutateAsync({ email, password, name });
      if (result.requiresVerification) {
        setSuccessMessage("Регистрация успешна! Проверьте почту для подтверждения.");
      } else {
        toast({ title: "Регистрация успешна!" });
        handleClose();
      }
    } catch (error: any) {
      toast({ title: error?.message || "Ошибка регистрации", variant: "destructive" });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await forgotPassword.mutateAsync({ email });
      setSuccessMessage("Если email зарегистрирован, вы получите письмо со ссылкой для сброса пароля.");
    } catch {
      toast({ title: "Ошибка отправки", variant: "destructive" });
    }
  };

  const isLoading = login.isPending || register.isPending || forgotPassword.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0 border-0">

        {/* ── Logo ── */}
        <div className="flex flex-col items-center pt-6 pb-3 px-6">
          <img src="/images/boomerangs-logo.webp" alt="BOOOMERANGS" className="h-32 object-contain mb-2" />
          <p className="text-xs text-muted-foreground tracking-widest uppercase">войдите в аккаунт</p>
        </div>

        {/* ── Main form ── */}
        <div className="px-6 pb-4">
          {successMessage ? (
            <div className="py-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">{successMessage}</p>
              <Button className="mt-4" onClick={handleClose} data-testid="button-success-close">
                Понятненько
              </Button>
            </div>
          ) : (
            <>
              {view !== "login" && (
                <p className="text-base font-semibold text-center mb-4">
                  {view === "register" && "Регистрация"}
                  {view === "forgot-password" && "Восстановление пароля"}
                </p>
              )}

              {view === "login" && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <a
                    href="/api/auth/yandex"
                    target="_top"
                    className="relative flex items-center w-full h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 transition-colors text-white font-semibold text-[15px] select-none shadow-sm"
                    data-testid="button-yandex-login"
                  >
                    <span className="absolute left-1.5 flex items-center justify-center w-8 h-8 rounded-lg bg-white">
                      <svg width="15" height="18" viewBox="0 0 18 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10.78 21H13.78V1H9.58C5.18 1 2.78 3.28 2.78 6.88C2.78 9.76 4.22 11.48 6.74 13.12L2.5 21H5.68L10.22 12.76L8.46 11.66C6.38 10.36 5.38 9.12 5.38 6.72C5.38 4.56 6.9 3.16 9.6 3.16H10.78V21Z" fill="#FC3F1D"/>
                      </svg>
                    </span>
                    <span className="flex-1 text-center">Войти с Яндекс ID</span>
                  </a>
                  <div className="relative flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs font-medium text-foreground/60 shrink-0 bg-muted px-2.5 py-1 rounded-full">или по email</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="login-email" type="email" placeholder="your@email.com" value={email}
                        onChange={(e) => setEmail(e.target.value)} className="pl-10" required data-testid="input-login-email" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Пароль</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="login-password" type={showPassword ? "text" : "password"} placeholder="Введите пароль"
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10" required data-testid="input-login-password" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1} data-testid="button-toggle-login-password">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={isLoading} data-testid="button-login-submit">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Войти"}
                  </Button>
                  <div className="flex justify-between text-sm">
                    <button type="button" onClick={() => setView("forgot-password")}
                      className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-forgot-password">
                      Забыли пароль?
                    </button>
                    <button type="button" onClick={() => setView("register")}
                      className="text-primary hover:underline" data-testid="button-go-to-register">
                      Регистрация
                    </button>
                  </div>
                </form>
              )}

              {view === "register" && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="register-lastName">Фамилия</Label>
                      <Input id="register-lastName" type="text" placeholder="Иванов" value={lastName}
                        onChange={(e) => setLastName(e.target.value)} required data-testid="input-register-lastName" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-firstName">Имя</Label>
                      <Input id="register-firstName" type="text" placeholder="Иван" value={firstName}
                        onChange={(e) => setFirstName(e.target.value)} required data-testid="input-register-firstName" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-patronymic">Отчество</Label>
                      <Input id="register-patronymic" type="text" placeholder="Иванович" value={patronymic}
                        onChange={(e) => setPatronymic(e.target.value)} required data-testid="input-register-patronymic" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="register-email" type="email" placeholder="your@email.com" value={email}
                        onChange={(e) => setEmail(e.target.value)} className="pl-10" required data-testid="input-register-email" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Пароль</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="register-password" type={showPassword ? "text" : "password"} placeholder="Минимум 6 символов"
                        value={password} onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 pr-10" minLength={6} required data-testid="input-register-password" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1} data-testid="button-toggle-register-password">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={isLoading} data-testid="button-register-submit">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зарегистрироваться"}
                  </Button>
                  <div className="text-center text-sm">
                    <span className="text-muted-foreground">Уже есть аккаунт? </span>
                    <button type="button" onClick={() => setView("login")} className="text-primary hover:underline" data-testid="button-go-to-login">
                      Войти
                    </button>
                  </div>
                </form>
              )}

              {view === "forgot-password" && (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <p className="text-sm text-muted-foreground text-center">Введите email, указанный при регистрации</p>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input id="forgot-email" type="email" placeholder="your@email.com" value={email}
                        onChange={(e) => setEmail(e.target.value)} className="pl-10" required data-testid="input-forgot-email" />
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={isLoading} data-testid="button-forgot-submit">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Отправить ссылку"}
                  </Button>
                  <button type="button" onClick={() => setView("login")}
                    className="flex items-center justify-center gap-1 w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-back-to-login">
                    <ArrowLeft className="w-4 h-4" />
                    Вернуться ко входу
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* ── B2B entries (compact) ── */}
        <div className="mx-4 mb-4 grid grid-cols-2 gap-2">
          <Link href="/wholesale/register?mode=login" onClick={handleClose} data-testid="link-wholesale-login">
            <div className="relative overflow-hidden rounded-xl bg-zinc-900 dark:bg-zinc-800 cursor-pointer group h-full border border-white/5 hover:border-primary/40 transition-colors">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative flex items-center gap-2 pl-2.5 pr-2 py-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white leading-tight truncate">Опт</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug line-clamp-2">Для оптовиков</p>
                </div>
                <ArrowRight className="w-3 h-3 text-zinc-500 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0" />
              </div>
            </div>
          </Link>

          <Link href="/partner/login" onClick={handleClose} data-testid="link-partner-login">
            <div className="relative overflow-hidden rounded-xl bg-zinc-900 dark:bg-zinc-800 cursor-pointer group h-full border border-white/5 hover:border-primary/40 transition-colors">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative flex items-center gap-2 pl-2.5 pr-2 py-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Handshake className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white leading-tight truncate">Партнёр</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5 leading-snug line-clamp-2">Зарабатывайте с нами</p>
                </div>
                <ArrowRight className="w-3 h-3 text-zinc-500 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0" />
              </div>
            </div>
          </Link>
        </div>

        <div className="mx-4 mb-4 -mt-2 text-center">
          <Link href="/partner/register" onClick={handleClose} data-testid="link-partner-register">
            <button className="text-[11px] text-zinc-500 hover:text-primary transition-colors">
              Стать партнёром →
            </button>
          </Link>
        </div>

      </DialogContent>
    </Dialog>
  );
}
