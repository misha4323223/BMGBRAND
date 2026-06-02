import SEO from "@/components/SEO";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLogin, useForgotPassword } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Loader2, Mail, Lock, User, Building2, FileText, 
  MapPin, Phone, CheckCircle, Briefcase, LogIn, MessageCircle, ExternalLink, ArrowLeft
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SiVk, SiTelegram } from "react-icons/si";
import { DadataAddressInput } from "@/components/DadataAddressInput";
import { DadataInnInput } from "@/components/DadataInnInput";

type ViewMode = "login" | "register" | "forgot-password";

export default function WholesaleRegister() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [success, setSuccess] = useState(false);
  const initialMode: ViewMode = new URLSearchParams(window.location.search).get("mode") === "login" ? "login" : "register";
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const forgotPassword = useForgotPassword();
  
  const [loginData, setLoginData] = useState({
    email: "",
    password: "",
  });
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    companyName: "",
    inn: "",
    kpp: "",
    legalAddress: "",
    storeName: "",
    storeAddress: "",
    contactPerson: "",
    contactPhone: "",
  });

  const login = useLogin();

  const register = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/auth/wholesale/register", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Ошибка регистрации");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess(true);
    },
    onError: (error: Error) => {
      const raw = error.message || "";
      const friendly = raw.includes("exist") || raw.includes("уже")
        ? "Пользователь с таким email уже зарегистрирован"
        : raw.includes("email") 
        ? "Проверьте правильность email"
        : raw || "Не удалось зарегистрироваться. Попробуйте ещё раз.";
      toast({ title: friendly, variant: "destructive" });
    },
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await login.mutateAsync({ ...loginData, role: 'wholesale' });
      if (result.user?.role === 'wholesale') {
        toast({ title: "Добро пожаловать!" });
        setLocation("/wholesale/profile");
      } else {
        toast({ title: "Добро пожаловать!" });
        setLocation("/");
      }
    } catch (error: any) {
      const raw = error?.message || "";
      const friendly = raw.includes("Incorrect") || raw.includes("incorrect") || raw.includes("неверн")
        ? "Неверный email или пароль"
        : raw.includes("not found") || raw.includes("не найден")
        ? "Аккаунт не найден. Проверьте email или зарегистрируйтесь."
        : "Не удалось войти. Попробуйте ещё раз.";
      toast({ title: friendly, variant: "destructive" });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await forgotPassword.mutateAsync({ email: forgotEmail, role: 'wholesale' });
      setForgotSent(true);
    } catch {
      toast({ title: "Ошибка отправки письма. Попробуйте ещё раз.", variant: "destructive" });
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    register.mutate(formData);
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateLoginField = (field: string, value: string) => {
    setLoginData(prev => ({ ...prev, [field]: value }));
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 pb-24 max-w-xl mx-auto px-4">
          <Card className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-semibold mb-4">Заявка отправлена!</h1>
            <p className="text-muted-foreground mb-6">
              Ваша заявка принята! Одобрение заявки в течение 15 минут.
            </p>
            <Button onClick={() => setLocation("/")} data-testid="button-go-home">
              Понятненько
            </Button>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Оптовая регистрация"
        description="Регистрация оптового покупателя BMGBRAND — специальные цены для партнёров."
        keywords="опт BMGBRAND, оптовые цены, партнёрство, оптовый покупатель"
      />
      <Navbar />
      
      <div className="pt-32 pb-24 max-w-2xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold mb-2">Оптовое сотрудничество</h1>
          <p className="text-muted-foreground">
            {viewMode === "forgot-password"
              ? "Введите email — пришлём ссылку для сброса пароля"
              : viewMode === "login"
              ? "Войдите в свой оптовый аккаунт"
              : "Заполните форму для получения доступа к оптовым ценам"}
          </p>
        </div>

        {viewMode !== "forgot-password" && (
          <div className="flex gap-2 mb-6">
            <Button
              variant={viewMode === "login" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setViewMode("login")}
              data-testid="button-switch-to-login"
            >
              <LogIn className="w-4 h-4 mr-2" />
              Вход
            </Button>
            <Button
              variant={viewMode === "register" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setViewMode("register")}
              data-testid="button-switch-to-register"
            >
              <User className="w-4 h-4 mr-2" />
              Регистрация
            </Button>
          </div>
        )}

        {viewMode === "forgot-password" ? (
          <Card className="p-6 sm:p-8">
            {forgotSent ? (
              <div className="text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold">Письмо отправлено</h2>
                <p className="text-muted-foreground text-sm">
                  Если аккаунт с таким email существует, вы получите письмо со ссылкой для сброса пароля.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setViewMode("login")}
                  className="mt-2"
                  data-testid="button-back-to-login"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Вернуться ко входу
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="company@email.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-forgot-email"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={forgotPassword.isPending}
                  data-testid="button-forgot-submit"
                >
                  {forgotPassword.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Отправить письмо"
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => setViewMode("login")}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
                  data-testid="button-back-to-login"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Вернуться ко входу
                </button>
              </form>
            )}
          </Card>
        ) : viewMode === "login" ? (
          <Card className="p-6 sm:p-8">
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="company@email.com"
                      value={loginData.email}
                      onChange={(e) => updateLoginField("email", e.target.value)}
                      className="pl-10"
                      required
                      data-testid="input-wholesale-login-email"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="login-password">Пароль</Label>
                  <PasswordInput
                    id="login-password"
                    placeholder="Введите пароль"
                    value={loginData.password}
                    onChange={(e) => updateLoginField("password", e.target.value)}
                    required
                    data-testid="input-wholesale-login-password"
                  />
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                size="lg"
                disabled={login.isPending}
                data-testid="button-wholesale-login-submit"
              >
                {login.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Войти"
                )}
              </Button>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <button
                  type="button"
                  onClick={() => { setForgotEmail(""); setForgotSent(false); setViewMode("forgot-password"); }}
                  className="hover:text-foreground transition-colors"
                  data-testid="button-wholesale-forgot-password"
                >
                  Забыли пароль?
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("register")}
                  className="hover:text-foreground transition-colors"
                  data-testid="button-go-to-wholesale-register"
                >
                  Нет аккаунта? Зарегистрируйтесь
                </button>
              </div>
            </form>
          </Card>
        ) : (
          <Card className="p-6 sm:p-8">
            <form onSubmit={handleRegister} className="space-y-6">
              <div className="space-y-4">
                <h2 className="font-medium text-lg flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                  Данные компании
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="companyName">Название компании *</Label>
                    <Input
                      id="companyName"
                      placeholder="ООО Компания"
                      value={formData.companyName}
                      onChange={(e) => updateField("companyName", e.target.value)}
                      required
                      data-testid="input-company-name"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="inn">ИНН *</Label>
                    <DadataInnInput
                      id="inn"
                      value={formData.inn}
                      onChange={(v) => updateField("inn", v)}
                      onSelect={({ inn, kpp, companyName, legalAddress }) => {
                        setFormData(prev => ({
                          ...prev,
                          inn,
                          ...(kpp ? { kpp } : {}),
                          ...(companyName && !prev.companyName ? { companyName } : {}),
                          ...(legalAddress && !prev.legalAddress ? { legalAddress } : {}),
                        }));
                      }}
                      placeholder="ИНН или название компании"
                      required
                      data-testid="input-inn"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="kpp">КПП</Label>
                    <Input
                      id="kpp"
                      placeholder="9 цифр (необязательно)"
                      value={formData.kpp}
                      onChange={(e) => updateField("kpp", e.target.value.replace(/\D/g, ""))}
                      maxLength={9}
                      data-testid="input-kpp"
                    />
                  </div>
                  
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="legalAddress">Юридический адрес *</Label>
                    <DadataAddressInput
                      id="legalAddress"
                      value={formData.legalAddress}
                      onChange={(v) => updateField("legalAddress", v)}
                      placeholder="Начните вводить юридический адрес..."
                      required
                      data-testid="input-legal-address"
                    />
                  </div>
                  
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="storeName">Название магазина *</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="storeName"
                        placeholder="Название вашего магазина"
                        value={formData.storeName}
                        onChange={(e) => updateField("storeName", e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-store-name"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="storeAddress">Фактический адрес магазина *</Label>
                    <DadataAddressInput
                      id="storeAddress"
                      value={formData.storeAddress}
                      onChange={(v) => updateField("storeAddress", v)}
                      placeholder="Начните вводить адрес магазина..."
                      required
                      data-testid="input-store-address"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-6 space-y-4">
                <h2 className="font-medium text-lg flex items-center gap-2">
                  <User className="w-5 h-5 text-muted-foreground" />
                  Контактные данные
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contactPerson">Контактное лицо *</Label>
                    <Input
                      id="contactPerson"
                      placeholder="ФИО"
                      value={formData.contactPerson}
                      onChange={(e) => updateField("contactPerson", e.target.value)}
                      required
                      data-testid="input-contact-person"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="contactPhone">Телефон *</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="contactPhone"
                        type="tel"
                        placeholder="+7 (999) 123-45-67"
                        value={formData.contactPhone}
                        onChange={(e) => updateField("contactPhone", e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-contact-phone"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6 space-y-4">
                <h2 className="font-medium text-lg flex items-center gap-2">
                  <Lock className="w-5 h-5 text-muted-foreground" />
                  Данные для входа
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Логин (email) *</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="company@email.com"
                        value={formData.email}
                        onChange={(e) => updateField("email", e.target.value)}
                        className="pl-10"
                        required
                        data-testid="input-email"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="password">Пароль *</Label>
                    <PasswordInput
                      id="password"
                      placeholder="Минимум 6 символов"
                      value={formData.password}
                      onChange={(e) => updateField("password", e.target.value)}
                      minLength={6}
                      required
                      data-testid="input-password"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                <p>Одобрение заявки в течение 15 минут. При одобрении вы получите доступ к специальным оптовым ценам.</p>
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                size="lg"
                disabled={register.isPending}
                data-testid="button-submit-wholesale"
              >
                {register.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Отправить заявку"
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Уже есть аккаунт?{" "}
                <button
                  type="button"
                  onClick={() => setViewMode("login")}
                  className="text-primary hover:underline"
                  data-testid="button-go-to-wholesale-login"
                >
                  Войдите
                </button>
              </p>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full" data-testid="button-contact-managers">
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Связаться с менеджером
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm" aria-describedby="managers-description">
                  <DialogHeader>
                    <DialogTitle>Менеджеры оптового отдела</DialogTitle>
                  </DialogHeader>
                  <div id="managers-description" className="space-y-4">
                    <div className="flex flex-col gap-3 p-4 rounded-md bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-primary" />
                        </div>
                        <p className="font-medium text-foreground" data-testid="text-manager-mikhail-name">Михаил</p>
                      </div>
                      <div className="space-y-2 text-sm">
                        <a href="tel:+79051162902" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-reg-manager-mikhail-phone">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>+7 905-116-29-02</span>
                        </a>
                        <a href="mailto:m.pimashin@booomerangs.ru" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-reg-manager-mikhail-email">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>m.pimashin@booomerangs.ru</span>
                        </a>
                        <a href="https://vk.com/booomerangs_opt" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-reg-manager-mikhail-vk">
                          <SiVk className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>VK</span>
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </a>
                        <a href="https://t.me/BOOOMERANGSOPT" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-foreground transition-colors" data-testid="link-reg-manager-mikhail-tg">
                          <SiTelegram className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>Telegram</span>
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </a>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </form>
          </Card>
        )}
      </div>
      
      <Footer />
    </div>
  );
}
