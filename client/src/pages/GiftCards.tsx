import SEO from "@/components/SEO";
import YooKassaWidget from "@/components/YooKassaWidget";
import { useState, useMemo, useCallback, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ArrowLeft, Loader2, Landmark, Sparkles, Gift, Mail, User, MessageSquare, CreditCard, ShoppingBag, Minus, Plus } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from "framer-motion";
const bmgLogo = "/images/boomerangs-logo.webp";

interface GiftCardAmount { value: number; label: string; }
interface PaymentMethod { id: string; name: string; description: string; }

const cardThemes = [
  {
    id: "black",
    name: "Midnight",
    bg: "from-[#0a0a0a] via-[#1a1a2e] to-[#16213e]",
    shine: "from-white/0 via-white/10 to-white/0",
    accent: "#4f46e5",
    textColor: "text-indigo-300",
    dot: "bg-indigo-500",
  },
  {
    id: "red",
    name: "Crimson",
    bg: "from-[#7f1d1d] via-[#b91c1c] to-[#450a0a]",
    shine: "from-white/0 via-white/15 to-white/0",
    accent: "#fca5a5",
    textColor: "text-red-200",
    dot: "bg-red-400",
  },
  {
    id: "gold",
    name: "Gold",
    bg: "from-[#78350f] via-[#d97706] to-[#92400e]",
    shine: "from-white/0 via-white/20 to-white/0",
    accent: "#fde68a",
    textColor: "text-amber-200",
    dot: "bg-amber-400",
  },
  {
    id: "purple",
    name: "Velvet",
    bg: "from-[#2e1065] via-[#6d28d9] to-[#1e1b4b]",
    shine: "from-white/0 via-white/12 to-white/0",
    accent: "#c4b5fd",
    textColor: "text-violet-300",
    dot: "bg-violet-400",
  },
  {
    id: "emerald",
    name: "Forest",
    bg: "from-[#022c22] via-[#065f46] to-[#064e3b]",
    shine: "from-white/0 via-white/12 to-white/0",
    accent: "#6ee7b7",
    textColor: "text-emerald-300",
    dot: "bg-emerald-400",
  },
];

const GiftCardVisual = memo(function GiftCardVisual({ theme, amount, quantity }: { theme: typeof cardThemes[0]; amount: number | null; quantity: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [12, -12]), { stiffness: 180, damping: 22 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-12, 12]), { stiffness: 180, damping: 22 });
  const shineX = useTransform(x, [-0.5, 0.5], ["-30%", "130%"]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [x, y]);

  const handleMouseLeave = useCallback(() => { x.set(0); y.set(0); }, [x, y]);

  const totalAmount = amount ? (amount * quantity) / 100 : null;

  return (
    <div
      className="w-full"
      style={{ perspective: "1000px" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        style={{ rotateX, rotateY, transformStyle: "preserve-3d", willChange: "transform" }}
        className={`relative w-full aspect-[1.586/1] rounded-2xl bg-gradient-to-br ${theme.bg} shadow-[0_20px_50px_rgba(0,0,0,0.45)] overflow-hidden cursor-pointer select-none`}
      >
        {/* Grid pattern (CSS only, no SVG filter) */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }} />

        {/* Shine layer — GPU-composited via transform */}
        <motion.div
          style={{ left: shineX, willChange: "left" }}
          className={`absolute top-0 bottom-0 w-1/3 bg-gradient-to-r ${theme.shine} skew-x-12 pointer-events-none`}
        />

        {/* Top accent strip */}
        <div className="absolute top-0 left-0 right-0 h-px opacity-30" style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }} />

        {/* Amount badge */}
        <div className="absolute top-5 right-5 text-right">
          <p className="text-white/40 text-[9px] font-mono tracking-[0.2em] uppercase mb-0.5">Номинал</p>
          <p className="text-white font-bold text-xl leading-none tracking-tight">
            {totalAmount ? `${totalAmount.toLocaleString()} ₽` : "— ₽"}
          </p>
          {quantity > 1 && amount && (
            <p className="text-white/50 text-[9px] font-mono mt-0.5">{quantity} × {(amount / 100).toLocaleString()} ₽</p>
          )}
        </div>

        {/* Chip (no backdrop-blur — saves compositing layer) */}
        <div className="absolute top-5 left-5">
          <div className="w-8 h-6 rounded-sm border border-white/20 bg-white/10 grid grid-cols-2 gap-px p-1">
            {[0,1,2,3].map((i) => (
              <div key={i} className="rounded-[1px] bg-white/10" />
            ))}
          </div>
        </div>

        {/* Logo — lazy since it's below the fold on mobile */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={bmgLogo} alt="BOOOMERANGS" loading="lazy" decoding="async" className="w-2/3 max-w-[200px] opacity-85" />
        </div>

        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-4 pt-8 bg-gradient-to-t from-black/60 via-black/20 to-transparent">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-white/40 text-[7px] font-mono tracking-[0.25em] uppercase mb-1">Подарочный сертификат</p>
              <p className="text-white/70 text-[10px] font-mono tracking-[0.15em]">BOOO·XXXX·XXXX·XXXX</p>
            </div>
            <div className="text-right">
              <p className="text-white/40 text-[7px] font-mono tracking-widest uppercase">BOOOMERANGS</p>
            </div>
          </div>
        </div>

        {/* Corner glow — translate3d forces GPU layer */}
        <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-2xl" style={{ background: theme.accent, transform: "translate3d(0,0,0)" }} />
        <div className="absolute -top-10 -left-10 w-24 h-24 rounded-full opacity-10 blur-2xl" style={{ background: theme.accent, transform: "translate3d(0,0,0)" }} />
      </motion.div>
    </div>
  );
});

export default function GiftCards() {
  const { toast } = useToast();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("yookassa");
  const [selectedTheme, setSelectedTheme] = useState<string>("black");
  const [gcWidgetToken, setGcWidgetToken] = useState<string | null>(null);
  const [gcWidgetCardId, setGcWidgetCardId] = useState<number | null>(null);
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [purchaserName, setPurchaserName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [isForSelf, setIsForSelf] = useState(false);
  const [agreeOffer, setAgreeOffer] = useState(false);
  const [agreePolicy, setAgreePolicy] = useState(false);

  const { data: amounts = [] } = useQuery<GiftCardAmount[]>({ queryKey: ["/api/gift-cards/amounts"] });
  const { data: paymentMethodsResponse } = useQuery<{ methods: PaymentMethod[]; enabled: boolean }>({ queryKey: ["/api/payment-methods"] });
  const paymentMethods = paymentMethodsResponse?.methods || [];

  const currentTheme = useMemo(() => cardThemes.find(t => t.id === selectedTheme) || cardThemes[0], [selectedTheme]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/gift-cards", {
        ...data,
        quantity,
        paymentMethod: selectedPaymentMethod,
        cardColor: selectedTheme,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.confirmationToken) {
        setGcWidgetToken(data.confirmationToken);
        setGcWidgetCardId(data.giftCard?.id || null);
      } else if (data.paymentUrl) {
        toast({ title: "Перенаправление на оплату...", description: "Сейчас вы будете перенаправлены на страницу оплаты" });
        setTimeout(() => { window.location.href = data.paymentUrl; }, 1000);
      } else {
        toast({ title: "Подарочная карта создана!", description: data.message || `Код: ${data.giftCard?.code}. Ожидает оплаты.` });
      }
    },
    onError: (error: any) => {
      const raw = error.message || "";
      const friendly = raw.includes("payment") || raw.includes("оплат")
        ? "Не удалось инициировать оплату. Попробуйте другой способ или повторите позже."
        : raw.includes("валидац") || raw.includes("Zod")
        ? "Проверьте правильность заполнения всех полей."
        : raw || "Не удалось создать подарочную карту. Попробуйте ещё раз.";
      toast({ title: "Не удалось оформить карту", description: friendly, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAmount) { toast({ title: "Выберите номинал", variant: "destructive" }); return; }
    if (!purchaserEmail || !purchaserName) { toast({ title: "Заполните ваши данные", variant: "destructive" }); return; }
    createMutation.mutate({
      amount: selectedAmount,
      purchaserEmail,
      purchaserName,
      recipientEmail: isForSelf ? "" : recipientEmail,
      recipientName: isForSelf ? "" : recipientName,
      message: message || undefined,
    });
  };

  const gcReturnUrl = gcWidgetCardId ? `${window.location.origin}/gift-cards/success?id=${gcWidgetCardId}` : window.location.origin;
  const total = selectedAmount ? ((selectedAmount * quantity) / 100) : 0;
  const canSubmit = selectedAmount && purchaserEmail && purchaserName && selectedPaymentMethod && (isForSelf || recipientEmail) && agreeOffer && agreePolicy && !createMutation.isPending;

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      <SEO
        title="Подарочные сертификаты"
        description="Подарочные сертификаты BMGBRAND — идеальный подарок от российского бренда одежды и аксессуаров. Различные номиналы, доставка на email."
        keywords="подарочная карта BMGBRAND, подарок, сертификат, российский бренд одежды"
      />

      {gcWidgetToken && (
        <YooKassaWidget
          confirmationToken={gcWidgetToken}
          returnUrl={gcReturnUrl}
          onSuccess={() => { setGcWidgetToken(null); window.location.href = gcReturnUrl; }}
          onFail={() => { setGcWidgetToken(null); toast({ variant: "destructive", title: "Оплата не прошла", description: "Попробуйте ещё раз или выберите другой способ оплаты" }); }}
          onClose={() => setGcWidgetToken(null)}
        />
      )}

      {/* ── HERO ── */}
      <div className="relative lg:min-h-[70vh] flex items-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(220,38,38,0.08),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_30%,rgba(99,102,241,0.07),transparent_60%)]" />
          <div className="absolute inset-0" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
          }} />
        </div>

        <div className="container mx-auto px-4 max-w-6xl relative z-10 py-8 sm:py-12 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Text */}
            <div>
              <div className="mb-10 lg:mb-16">
                <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-zinc-400 hover:text-zinc-200 transition-all duration-300 text-xs tracking-widest uppercase font-mono group backdrop-blur-sm">
                  <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
                  На главную
                </Link>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-zinc-400 text-xs tracking-widest uppercase font-mono mb-4 lg:mb-6"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Идеальный подарок
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="font-['Oswald',sans-serif] text-4xl sm:text-6xl lg:text-7xl font-bold text-white leading-[0.95] uppercase tracking-tight mb-4 lg:mb-6"
              >
                Подарочные<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">сертификаты</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-zinc-400 text-base leading-relaxed max-w-md mb-5 lg:mb-10"
              >
                Подарите возможность выбора — пусть человек сам выберет то, что ему нравится.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="flex flex-wrap gap-4"
              >
                {[
                  { icon: <Mail className="w-4 h-4" />, text: "Доставка на email" },
                  { icon: <Gift className="w-4 h-4" />, text: "5 дизайнов" },
                  { icon: <ShoppingBag className="w-4 h-4" />, text: "Любые товары" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="text-zinc-600">{item.icon}</span>
                    {item.text}
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Floating card preview */}
            <motion.div
              initial={{ opacity: 0, x: 40, rotateY: -15 }}
              animate={{ opacity: 1, x: 0, rotateY: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease: "easeOut" }}
              className="hidden lg:block"
            >
              <GiftCardVisual theme={currentTheme} amount={selectedAmount} quantity={quantity} />
              <p className="text-center text-zinc-600 text-xs font-mono mt-4 tracking-widest uppercase">Наведите для 3D-эффекта</p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* ── FORM ── */}
      <div className="bg-background">
        <div className="container mx-auto px-4 py-16 max-w-6xl">
          <div className="grid lg:grid-cols-5 gap-8 lg:gap-12">

            {/* Left: Config */}
            <div className="lg:col-span-3 space-y-4">

              {/* Step 1: Amount */}
              <Section label="01" title="Номинал">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {amounts.map((amount) => (
                    <motion.button
                      key={amount.value}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedAmount(amount.value)}
                      data-testid={`amount-${amount.value}`}
                      className={`relative h-[72px] rounded-xl border font-bold text-xl tracking-tight transition-all duration-200 ${
                        selectedAmount === amount.value
                          ? "border-primary bg-primary text-white shadow-[0_0_20px_rgba(220,38,38,0.3)]"
                          : "border-border bg-card hover:border-zinc-600 text-foreground"
                      }`}
                    >
                      {selectedAmount === amount.value && (
                        <motion.div layoutId="amountSelected" className="absolute top-2 right-2">
                          <Check className="w-4 h-4 text-white/70" />
                        </motion.div>
                      )}
                      {amount.label}
                    </motion.button>
                  ))}
                </div>

                {/* Quantity */}
                <div className="flex items-center justify-between pt-5 mt-5 border-t border-border">
                  <div>
                    <p className="text-sm font-medium">Количество карт</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Можно заказать сразу несколько</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      disabled={quantity <= 1}
                      className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-zinc-600 disabled:opacity-30 transition-all"
                      data-testid="btn-qty-minus"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-2xl font-bold w-8 text-center tabular-nums">{quantity}</span>
                    <button
                      onClick={() => setQuantity(Math.min(10, quantity + 1))}
                      disabled={quantity >= 10}
                      className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-zinc-600 disabled:opacity-30 transition-all"
                      data-testid="btn-qty-plus"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Section>

              {/* Step 2: Design */}
              <Section label="02" title="Дизайн">
                <div className="grid grid-cols-5 gap-3">
                  {cardThemes.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedTheme(theme.id)}
                      data-testid={`color-${theme.id}`}
                      className={`group focus:outline-none transition-all duration-200 ${selectedTheme !== theme.id ? "opacity-50 hover:opacity-80" : ""}`}
                    >
                      <div className={`relative aspect-[1.586/1] rounded-lg bg-gradient-to-br ${theme.bg} overflow-hidden ${
                        selectedTheme === theme.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_15px_rgba(220,38,38,0.3)]" : ""
                      }`}>
                        <div className="absolute inset-0" style={{
                          backgroundImage: `linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)`,
                          backgroundSize: "10px 10px",
                        }} />
                        {selectedTheme === theme.id && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 h-px opacity-50" style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }} />
                      </div>
                      <p className={`text-center text-[10px] mt-1.5 leading-tight transition-colors ${selectedTheme === theme.id ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                        {theme.name}
                      </p>
                    </button>
                  ))}
                </div>
              </Section>

              {/* Step 3: Recipient */}
              <Section label="03" title="Получатель">
                <div className="flex gap-2 mb-5">
                  {[
                    { val: false, label: "Другому человеку" },
                    { val: true, label: "Себе" },
                  ].map(({ val, label }) => (
                    <button
                      key={String(val)}
                      onClick={() => setIsForSelf(val)}
                      data-testid={`btn-for-${val ? "self" : "other"}`}
                      className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-all duration-200 ${
                        isForSelf === val
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-zinc-600 hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {!isForSelf ? (
                    <motion.div
                      key="recipient"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4"
                    >
                      <div className="grid sm:grid-cols-2 gap-4">
                        <FormField icon={<User className="w-4 h-4" />} label="ФИО получателя">
                          <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Иванова Анна Петровна" data-testid="input-recipient-name" />
                        </FormField>
                        <FormField icon={<Mail className="w-4 h-4" />} label="Email получателя">
                          <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="anna@example.com" data-testid="input-recipient-email" />
                        </FormField>
                      </div>
                      <FormField icon={<MessageSquare className="w-4 h-4" />} label="Личное сообщение">
                        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="С днём рождения! Выбери что-нибудь классное 🎉" className="resize-none" rows={3} data-testid="input-message" />
                      </FormField>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="self"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-3 py-4 px-4 rounded-xl bg-muted/50 border border-border"
                    >
                      <Mail className="w-5 h-5 text-muted-foreground shrink-0" />
                      <p className="text-sm text-muted-foreground">Код сертификата придёт на ваш email сразу после оплаты.</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Section>

              {/* Step 4: Payment */}
              <Section label="04" title="Способ оплаты">
                <RadioGroup value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod} className="space-y-2">
                  {paymentMethods.map((method) => (
                    <motion.div
                      key={method.id}
                      whileHover={{ scale: 1.01 }}
                      onClick={() => setSelectedPaymentMethod(method.id)}
                      className={`flex items-center gap-4 p-4 border rounded-xl cursor-pointer transition-all ${
                        selectedPaymentMethod === method.id ? "border-primary/50 bg-primary/5" : "border-border hover:border-zinc-600"
                      }`}
                    >
                      <RadioGroupItem value={method.id} id={`pay-${method.id}`} />
                      <Label htmlFor={`pay-${method.id}`} className="flex-1 cursor-pointer">
                        <span className="font-medium text-sm">{method.name}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{method.description}</p>
                      </Label>
                      {method.id === "tbank" ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#FFDD2D]/10 border border-[#FFDD2D]/20">
                          <Landmark className="w-4 h-4 text-[#FFDD2D]" />
                          <span className="text-xs font-bold text-[#FFDD2D]">T</span>
                        </div>
                      ) : (
                        <div className="w-9 h-7 bg-[#8000FF] rounded-md flex items-center justify-center text-white font-bold text-[10px] tracking-tight">ЮК</div>
                      )}
                    </motion.div>
                  ))}
                </RadioGroup>
              </Section>
            </div>

            {/* Right: Sticky Preview + Checkout */}
            <div className="lg:col-span-2">
              <div className="sticky top-6 space-y-4">

                {/* Preview */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
                  <p className="text-xs font-mono tracking-widest text-zinc-600 uppercase mb-4">Превью · {currentTheme.name}</p>
                  <GiftCardVisual theme={currentTheme} amount={selectedAmount} quantity={quantity} />
                </div>

                {/* Buyer info */}
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                  <p className="text-sm font-semibold">Ваши данные</p>
                  <FormField icon={<User className="w-4 h-4" />} label="ФИО">
                    <Input value={purchaserName} onChange={(e) => setPurchaserName(e.target.value)} placeholder="Иванов Иван Иванович" data-testid="input-purchaser-name" />
                  </FormField>
                  <FormField icon={<Mail className="w-4 h-4" />} label="Email">
                    <Input type="email" value={purchaserEmail} onChange={(e) => setPurchaserEmail(e.target.value)} placeholder="ivan@example.com" data-testid="input-purchaser-email" />
                  </FormField>
                </div>

                {/* Checkout */}
                <div className="bg-card border border-border rounded-2xl p-5">
                  {/* Total */}
                  <div className="flex items-baseline justify-between mb-5">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Итого</p>
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={total}
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          className="text-3xl font-bold tracking-tight"
                        >
                          {total > 0 ? `${total.toLocaleString()} ₽` : "—"}
                        </motion.p>
                      </AnimatePresence>
                      {quantity > 1 && selectedAmount && (
                        <p className="text-xs text-muted-foreground mt-0.5">{quantity} карт × {(selectedAmount / 100).toLocaleString()} ₽</p>
                      )}
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${selectedAmount ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-zinc-700"}`} />
                  </div>

                  {/* Checkboxes */}
                  <div className="space-y-3 mb-5">
                    <label className="flex items-start gap-3 cursor-pointer group">
                      <Checkbox id="gc-agree-offer" checked={agreeOffer} onCheckedChange={(c) => setAgreeOffer(c as boolean)} data-testid="checkbox-gc-agree-offer" className="mt-0.5 shrink-0" />
                      <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground transition-colors">
                        Ознакомлен с{" "}
                        <a href="https://booomerangs.ru/offer" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                          Публичной офертой
                        </a>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer group">
                      <Checkbox id="gc-agree-policy" checked={agreePolicy} onCheckedChange={(c) => setAgreePolicy(c as boolean)} data-testid="checkbox-gc-agree-policy" className="mt-0.5 shrink-0" />
                      <span className="text-xs text-muted-foreground leading-relaxed group-hover:text-foreground transition-colors">
                        Согласен с{" "}
                        <a href="https://booomerangs.ru/policy" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                          Политикой персональных данных
                        </a>
                      </span>
                    </label>
                  </div>

                  <Button
                    size="lg"
                    className="w-full h-13 text-base font-semibold rounded-xl transition-all duration-200"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    data-testid="btn-purchase"
                  >
                    {createMutation.isPending ? (
                      <><Loader2 className="w-5 h-5 animate-spin mr-2" />Создание...</>
                    ) : (
                      <><CreditCard className="w-5 h-5 mr-2" />Перейти к оплате</>
                    )}
                  </Button>

                  <p className="text-[11px] text-muted-foreground text-center mt-3 leading-relaxed">
                    Код сертификата придёт на email сразу после оплаты
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* How it works */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mt-24 border-t border-border pt-16"
          >
            <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-muted-foreground/50 mb-3">Инструкция</p>
            <h2 className="font-['Oswald',sans-serif] text-4xl sm:text-5xl font-bold uppercase text-foreground mb-14">
              Как это работает
            </h2>

            <div className="grid md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
              {[
                { step: "01", icon: <Gift className="w-5 h-5" />, title: "Выберите номинал", desc: "Определитесь с суммой и дизайном. Можно купить несколько карт одновременно." },
                { step: "02", icon: <CreditCard className="w-5 h-5" />, title: "Оплатите онлайн", desc: "Картой, через СБП или Apple Pay. Оплата проходит безопасно через ЮKassa или T-Bank." },
                { step: "03", icon: <Mail className="w-5 h-5" />, title: "Подарите код", desc: "Получатель вводит код при оформлении заказа — сумма спишется автоматически." },
              ].map((item, i) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.12, duration: 0.5 }}
                  className="py-10 md:py-0 md:px-10 first:md:pl-0 last:md:pr-0 group"
                >
                  <p className="font-['Oswald',sans-serif] text-6xl sm:text-7xl font-bold text-primary/10 leading-none mb-6 select-none group-hover:text-primary/20 transition-colors duration-300">
                    {item.step}
                  </p>
                  <div className="flex items-center gap-2 text-muted-foreground mb-3">{item.icon}</div>
                  <h3 className="font-['Oswald',sans-serif] text-xl font-bold uppercase tracking-wide mb-3 text-foreground">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-4 py-12 text-zinc-500 dark:text-zinc-500">
        <h2 className="text-base font-semibold text-zinc-400 dark:text-zinc-400 mb-3">Подарочные сертификаты BOOOMERANGS</h2>
        <p className="text-sm leading-relaxed mb-3">
          Подарочные сертификаты BOOOMERANGS — универсальный подарок на любой случай. Выбери номинал, оформи в пару кликов и сертификат придёт на email получателя.
        </p>
        <p className="text-sm leading-relaxed">
          Подходит для любого повода: день рождения, праздник или просто приятный сюрприз. Сертификаты действуют на весь ассортимент магазина — одежду, носки, аксессуары и мерч российских артистов.
        </p>
      </div>
    </div>
  );
}

const Section = memo(function Section({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <span className="font-mono text-[11px] text-muted-foreground/50 tracking-widest select-none">{label}</span>
        <h2 className="font-semibold text-base">{title}</h2>
      </div>
      {children}
    </div>
  );
});

const FormField = memo(function FormField({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
        {icon && <span className="opacity-50">{icon}</span>}
        {label}
      </Label>
      {children}
    </div>
  );
});
