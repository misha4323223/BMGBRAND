import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import artistBannerDesktop from "@assets/artist-banner-desktop.webp";
import artistBannerMobile from "@assets/artist-banner-mobile.webp";
import { Helmet } from "react-helmet-async";
import { useLocation, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import SEO from "@/components/SEO";
import { Loader2, Handshake, CheckCircle, ChevronRight, ChevronLeft, ArrowLeft, User, Briefcase, Building2, FileText, ShieldAlert, Percent, Clock, Wallet, Link2, BarChart3, Puzzle, Music2, BookOpen, Eye, EyeOff, Globe, Star, ShoppingBag, AtSign, BadgeCheck, Sparkles, Info } from "lucide-react";
import { ProgramInfoDialog, MediaInfoDialog } from "./partner/ProgramInfoDialog";

type LegalStatus = "self_employed" | "ip" | "ooo";

type LegalDoc = { slug: string; version: string; title: string; body: string; bodyHash: string };

const STATUS_CARDS: { value: LegalStatus; title: string; description: string; icon: any; color: string; bg: string }[] = [
  {
    value: "self_employed",
    title: "Самозанятым",
    description: "Физические лица, зарегистрированные как плательщики НПД",
    icon: User,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10 ring-1 ring-emerald-500/20",
  },
  {
    value: "ip",
    title: "Индивидуальным предпринимателям",
    description: "ИП на любой системе налогообложения",
    icon: Briefcase,
    color: "text-blue-600",
    bg: "bg-blue-500/10 ring-1 ring-blue-500/20",
  },
  {
    value: "ooo",
    title: "Юридическим лицам",
    description: "ООО и другие организации",
    icon: Building2,
    color: "text-violet-600",
    bg: "bg-violet-500/10 ring-1 ring-violet-500/20",
  },
];

interface DadataPartySuggestion {
  value: string;
  data: {
    inn?: string;
    kpp?: string;
    ogrn?: string;
    name?: { full_with_opf?: string; full?: string; short?: string };
    address?: { value?: string };
    fio?: { surname?: string; name?: string; patronymic?: string };
    type?: string; // LEGAL | INDIVIDUAL
  };
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

const PARTNER_SLIDES = [
  {
    desktop: "/partner-banner-desktop.webp",
    mobile: "/partner-banner-mobile.webp",
    alt: "Рекламируй BOOOMERANGS и зарабатывай",
    desktopAspect: "1739/904",
    mobileAspect: "1254/1254",
  },
  {
    desktop: artistBannerDesktop,
    mobile: artistBannerMobile,
    alt: "Создавай вместе с BOOOMERANGS — креаторская программа",
    desktopAspect: "1280/665",
    mobileAspect: "1254/1254",
  },
];

function PartnerBannerSlider({ firstSlideOverride }: { firstSlideOverride?: { desktop?: string; mobile?: string; alt?: string } }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const next = useCallback(() => {
    setCurrent(c => (c + 1) % PARTNER_SLIDES.length);
  }, []);

  const prev = useCallback(() => {
    setCurrent(c => (c - 1 + PARTNER_SLIDES.length) % PARTNER_SLIDES.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    timerRef.current = setTimeout(next, 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current, paused, next]);

  // Только 1-й слайд (реклама программы) может быть переопределён через админку SEO.
  // 2-й слайд («Создавай вместе с BOOOMERANGS») остаётся неизменным.
  const slides = PARTNER_SLIDES.map((s, i) => i === 0 ? {
    ...s,
    desktop: firstSlideOverride?.desktop || s.desktop,
    mobile: firstSlideOverride?.mobile || s.mobile,
    alt: firstSlideOverride?.alt || s.alt,
  } : s);

  const slide = slides[current];

  return (
    <div
      className="w-full relative select-none overflow-hidden"
    >
      {/* Назад */}
      <button
        onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'}
        className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-2 py-2 sm:px-3 rounded-full text-sm font-medium hover:bg-black/70 transition-colors"
        data-testid="button-back-hero"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="hidden sm:inline">Назад</span>
      </button>

      {/* Изображения */}
      {slides.map((s, i) => (
        <div
          key={i}
          className={`transition-opacity duration-700 ${i === current ? "opacity-100" : "opacity-0 absolute inset-0"}`}
        >
          <img
            src={s.desktop}
            alt={s.alt}
            className="w-full h-auto hidden sm:block bg-zinc-100 dark:bg-zinc-900"
            style={{ aspectRatio: s.desktopAspect }}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            data-testid={i === 0 ? "text-register-title" : undefined}
          />
          <img
            src={s.mobile}
            alt={s.alt}
            className="w-full h-auto block sm:hidden bg-zinc-100 dark:bg-zinc-900"
            style={{ aspectRatio: s.mobileAspect }}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
          />
        </div>
      ))}

      {/* Стрелки — только на десктопе */}
      <button
        onClick={() => { prev(); setPaused(true); }}
        className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full w-9 h-9 items-center justify-center transition-colors"
        aria-label="Предыдущий слайд"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={() => { next(); setPaused(true); }}
        className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full w-9 h-9 items-center justify-center transition-colors"
        aria-label="Следующий слайд"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Точки + кнопка паузы */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        {PARTNER_SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => { setCurrent(i); setPaused(true); }}
            className={`rounded-full transition-all ${i === current ? "bg-white w-5 h-2" : "bg-white/50 w-2 h-2"}`}
            aria-label={`Слайд ${i + 1}`}
          />
        ))}
        <button
          onClick={() => setPaused(v => !v)}
          className="ml-1 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full w-6 h-6 flex items-center justify-center transition-colors text-xs"
          aria-label={paused ? "Запустить" : "Пауза"}
        >
          {paused ? "▶" : "⏸"}
        </button>
      </div>
    </div>
  );
}

export default function PartnerRegister() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: partnerRegisterSettings } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/partner_register"],
  });
  const { data: seoOverrides } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/seo"],
  });
  const partnerSeo = seoOverrides?.partner_register || {};
  const partnerHero = partnerRegisterSettings?.hero || {};
  const partnerSeoTitle = partnerSeo.title || "Партнёрская программа BOOOMERANGS - зарабатывай на рекомендациях";
  const partnerSeoDescription = partnerSeo.description || "Рекомендуй одежду BOOOMERANGS и получай комиссию 15–25% с каждого заказа. Программа для самозанятых, ИП и юридических лиц. Своя ссылка, личный кабинет, выплаты без минимума.";
  const partnerFirstSlideOverride = (partnerHero.heroImage || partnerHero.heroImageMobile || partnerHero.heroImageAlt) ? {
    desktop: partnerHero.heroImage,
    mobile: partnerHero.heroImageMobile,
    alt: partnerHero.heroImageAlt,
  } : undefined;

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [legalStatus, setLegalStatus] = useState<LegalStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programInfoOpen, setProgramInfoOpen] = useState(false);
  const [mediaInfoOpen, setMediaInfoOpen] = useState(false);

  // Общие поля
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [partnerSlug, setPartnerSlug] = useState("");
  const [selectedSocials, setSelectedSocials] = useState<string[]>([]);
  const [isArtist, setIsArtist] = useState(false);

  // ФИО
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");

  // Самозанятый
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const birthDate = birthDay && birthMonth && birthYear
    ? `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`
    : "";
  const [citizenship, setCitizenship] = useState("RU");

  // Юр. данные
  const [companyName, setCompanyName] = useState("");
  const [inn, setInn] = useState("");
  const [kpp, setKpp] = useState("");
  const [ogrn, setOgrn] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [signerPosition, setSignerPosition] = useState("");
  const [signerBasis, setSignerBasis] = useState("Устав");

  // DaData подсказки
  const [partySuggestions, setPartySuggestions] = useState<DadataPartySuggestion[]>([]);
  const [addressSuggestions, setAddressSuggestions] = useState<{ value: string }[]>([]);
  const [partyOpen, setPartyOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);

  // Документы
  const [docs, setDocs] = useState<Record<string, LegalDoc>>({});
  const [docsLoading, setDocsLoading] = useState(false);
  const [accept, setAccept] = useState({ offer: false, privacy: false, adult: false, selfEmployed: false, marketing: false });
  const [docDialog, setDocDialog] = useState<LegalDoc | null>(null);

  // Загружаем документы при входе на 2-й шаг
  useEffect(() => {
    if (step !== 2 || !legalStatus) return;
    const need: string[] = ["offer", "privacy", "marketing"];
    if (legalStatus === "self_employed") { need.push("adult"); need.push("self_employed"); }
    setDocsLoading(true);
    Promise.all(
      need.map((slug) =>
        fetch(`/api/legal-documents/${slug}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && ([slug, d] as const))
          .catch(() => null),
      ),
    )
      .then((results) => {
        const map: Record<string, LegalDoc> = {};
        for (const r of results) if (r) map[r[0]] = r[1] as LegalDoc;
        setDocs(map);
      })
      .finally(() => setDocsLoading(false));
  }, [step, legalStatus]);

  // ─── DaData по ИНН (party) ────────────────────────────────────────────
  const partyAbort = useRef<AbortController | null>(null);
  async function lookupParty(query: string) {
    if (!query || query.length < 3) {
      setPartySuggestions([]);
      return;
    }
    partyAbort.current?.abort();
    const ac = new AbortController();
    partyAbort.current = ac;
    try {
      const res = await fetch("/api/dadata/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 7 }),
        signal: ac.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      setPartySuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch {}
  }
  function applyParty(s: DadataPartySuggestion) {
    setInn(s.data.inn || inn);
    setKpp(s.data.kpp || "");
    setOgrn(s.data.ogrn || "");
    if (legalStatus === "ooo") {
      setCompanyName(s.data.name?.full_with_opf || s.data.name?.full || s.data.name?.short || s.value || "");
      setLegalAddress(s.data.address?.value || "");
    } else if (legalStatus === "ip") {
      setCompanyName(s.value || "");
      setLegalAddress(s.data.address?.value || "");
      if (s.data.fio) {
        setLastName(s.data.fio.surname || "");
        setFirstName(s.data.fio.name || "");
        setMiddleName(s.data.fio.patronymic || "");
      }
    }
    setPartyOpen(false);
  }

  // ─── DaData адрес ─────────────────────────────────────────────────────
  const addressAbort = useRef<AbortController | null>(null);
  async function lookupAddress(query: string) {
    if (!query || query.length < 3) {
      setAddressSuggestions([]);
      return;
    }
    addressAbort.current?.abort();
    const ac = new AbortController();
    addressAbort.current = ac;
    try {
      const res = await fetch("/api/dadata/address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 7 }),
        signal: ac.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      setAddressSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch {}
  }

  function autoSlug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  }

  const canGoToStep2 = useMemo(() => {
    if (!legalStatus) return false;
    if (!email || !password || password.length < 6) return false;
    if (!contactName || !contactPhone || !storeName) return false;
    const slug = autoSlug(partnerSlug || storeName);
    if (slug.length < 3) return false;
    const platformDescription = selectedSocials.join(', ');
    if (!platformDescription || platformDescription.length < 1) return false;
    if (!inn) return false;
    if (legalStatus === "self_employed" && (inn.length !== 12 || !birthDate || !citizenship || !lastName || !firstName)) return false;
    if (legalStatus === "ip") {
      if (inn.length !== 12 || !ogrn || ogrn.length !== 15 || !legalAddress || !companyName || !lastName || !firstName) return false;
    }
    if (legalStatus === "ooo") {
      if (inn.length !== 10 || !kpp || kpp.length !== 9 || !ogrn || ogrn.length !== 13 || !legalAddress || !companyName || !signerPosition || !signerBasis || !lastName || !firstName) return false;
    }
    return true;
  }, [legalStatus, email, password, contactName, contactPhone, storeName, partnerSlug, selectedSocials, inn, birthDate, citizenship, lastName, firstName, ogrn, legalAddress, companyName, kpp, signerPosition, signerBasis]);

  const requiredAccepts = useMemo(() => {
    const base = accept.offer && accept.privacy;
    if (legalStatus === "self_employed") return base && accept.adult && accept.selfEmployed;
    return base;
  }, [accept, legalStatus]);

  async function submit() {
    setError(null);
    if (!legalStatus) return;
    if (!requiredAccepts) {
      setError("Подтвердите все обязательные согласия");
      return;
    }
    setSubmitting(true);
    try {
      const slug = autoSlug(partnerSlug || storeName);
      const payload: Record<string, any> = {
        legalStatus,
        email,
        password,
        contactName,
        contactPhone: contactPhone || undefined,
        storeName,
        partnerSlug: slug,
        platformDescription: selectedSocials.join(', '),
        inn,
        offerHash: docs.offer?.bodyHash,
        privacyHash: docs.privacy?.bodyHash,
        acceptMarketing: !!accept.marketing,
        marketingHash: accept.marketing ? docs.marketing?.bodyHash : undefined,
        isArtist: isArtist || undefined,
      };
      if (legalStatus === "self_employed") {
        payload.lastName = lastName;
        payload.firstName = firstName;
        payload.middleName = middleName || undefined;
        payload.birthDate = birthDate;
        payload.citizenship = citizenship;
        payload.acceptSelfEmployed = true;
        payload.selfEmployedHash = docs.self_employed?.bodyHash;
        payload.acceptAdult = true;
        payload.adultHash = docs.adult?.bodyHash;
      }
      if (legalStatus === "ip") {
        payload.lastName = lastName;
        payload.firstName = firstName;
        payload.middleName = middleName || undefined;
        payload.companyName = companyName;
        payload.ogrn = ogrn;
        payload.legalAddress = legalAddress;
        if (birthDate) payload.birthDate = birthDate;
      }
      if (legalStatus === "ooo") {
        payload.companyName = companyName;
        payload.kpp = kpp;
        payload.ogrn = ogrn;
        payload.legalAddress = legalAddress;
        payload.lastName = lastName;
        payload.firstName = firstName;
        payload.middleName = middleName || undefined;
        payload.signerPosition = signerPosition;
        payload.signerBasis = signerBasis;
      }
      payload.acceptOffer = true;
      payload.acceptPrivacy = true;

      await apiRequest("POST", "/api/auth/partner/register", payload);
      setSuccess(true);
      toast({ title: "Заявка отправлена", description: "Подтвердите email и дождитесь решения менеджера." });
    } catch (err: any) {
      let message = err?.message || "Ошибка регистрации";
      try {
        const m = message.match(/^\d+:\s*(.*)$/);
        if (m) {
          const parsed = JSON.parse(m[1]);
          message = parsed.error || message;
        }
      } catch {}
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <>
        <SEO title="Подтвердите подпись на почте - BMG BRAND" />
        <div className="fixed top-4 left-4 z-50">
          <button onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'} className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white px-3 py-2 rounded-full text-sm font-medium hover:bg-black/70 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Назад
          </button>
        </div>
        <main className="container mx-auto px-4 pt-16 pb-12 min-h-[70vh] flex items-start justify-center">
          <div className="w-full max-w-md">
            <Card className="p-6 sm:p-8 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 ring-1 ring-emerald-500/20 mb-4 mx-auto">
                <CheckCircle className="w-7 h-7 text-emerald-600" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-2" data-testid="text-success-title">Проверьте почту</h1>
              <p className="text-sm text-muted-foreground mb-3">
                Мы отправили письмо со ссылкой подтверждения. Переход по ссылке – это и есть ваша подпись под документами BMG BRAND (УНЭП по 63-ФЗ).
              </p>
              <p className="text-[11px] sm:text-xs text-muted-foreground mb-5">
                Ссылка действует <strong>1 час</strong> и одноразовая. После подтверждения мы создадим кабинет и передадим заявку менеджеру.
              </p>
              <Button onClick={() => setLocation("/")} data-testid="button-go-home" className="w-full sm:w-auto">На главную</Button>
            </Card>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <SEO
        title={partnerSeoTitle}
        description={partnerSeoDescription}
        keywords="партнёрская программа одежда, заработок на рекомендациях, реферальная программа магазин одежды, партнёрка для самозанятых, комиссия с продаж одежды, партнёр бренда одежды, заработок на партнёрке, партнёрская программа BOOOMERANGS, партнёрка интернет-магазина одежды, заработок без вложений на одежде, реферальная программа Россия, стать амбассадором бренда, заработок для самозанятых онлайн, партнёрская программа для блогеров, партнёрка для ИП, комиссия за продажи одежды, заработок на рекомендациях одежды, реферальная ссылка магазин"
        canonical="https://www.booomerangs.ru/partner/register"
        ogImage="/og-partner.png"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "Партнёрская программа BOOOMERANGS — зарабатывай 15–25% комиссии",
            "description": "Рекомендуй одежду BOOOMERANGS и получай комиссию 15–25% с каждого заказа. Для самозанятых, ИП и юридических лиц.",
            "url": "https://www.booomerangs.ru/partner/register",
            "publisher": {
              "@type": "Organization",
              "name": "BOOOMERANGS",
              "url": "https://www.booomerangs.ru",
              "logo": "https://www.booomerangs.ru/og-image.png"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": "Партнёрская программа BOOOMERANGS",
            "description": "Зарабатывайте 15–25% комиссии, рекомендуя одежду российского бренда BOOOMERANGS. Программа доступна для самозанятых, ИП и юридических лиц. Выплаты без минимальной суммы.",
            "provider": {
              "@type": "Organization",
              "name": "BOOOMERANGS",
              "url": "https://www.booomerangs.ru"
            },
            "offers": {
              "@type": "Offer",
              "description": "Комиссия 15–25% с каждого оплаченного заказа по реферальной ссылке",
              "priceCurrency": "RUB"
            },
            "audience": {
              "@type": "Audience",
              "audienceType": "Самозанятые, ИП, юридические лица, блогеры, артисты"
            },
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.8",
              "reviewCount": "63",
              "bestRating": "5"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "Сколько можно заработать в партнёрской программе BOOOMERANGS?",
                "acceptedAnswer": { "@type": "Answer", "text": "Комиссия составляет от 15% до 25% с каждого оплаченного заказа. Процент растёт в зависимости от объёма продаж за месяц. Потолка нет." }
              },
              {
                "@type": "Question",
                "name": "Кто может стать партнёром BOOOMERANGS?",
                "acceptedAnswer": { "@type": "Answer", "text": "Партнёром может стать самозанятый, индивидуальный предприниматель или юридическое лицо. Физические лица без статуса не подходят. Регистрация занимает несколько минут." }
              },
              {
                "@type": "Question",
                "name": "Как долго засчитывается заказ по реферальной ссылке?",
                "acceptedAnswer": { "@type": "Answer", "text": "Атрибуция — 30 дней. Если покупатель перешёл по вашей ссылке и оформил заказ в течение 30 дней, комиссия начислится вам." }
              },
              {
                "@type": "Question",
                "name": "Есть ли минимальная сумма для вывода комиссии?",
                "acceptedAnswer": { "@type": "Answer", "text": "Минимальной суммы нет. Подайте заявку после холда — выплатим на карту или расчётный счёт за 5 рабочих дней." }
              },
              {
                "@type": "Question",
                "name": "Что такое партнёрская программа для блогеров BOOOMERANGS?",
                "acceptedAnswer": { "@type": "Answer", "text": "Блогеры и артисты могут получить персональную страницу на booomerangs.ru/@slug, собственную витрину мерча и договорной процент комиссии. Мы уже работаем с Гудтаймс, Молодостью внутри, Дикой Мятой и другими артистами." }
              },
              {
                "@type": "Question",
                "name": "Можно ли создать свой мерч через партнёрскую программу?",
                "acceptedAnswer": { "@type": "Answer", "text": "Да. Артисты и бренды могут заказать авторский мерч на нашем производстве и продавать его через свою страницу на BOOOMERANGS. Условия обсуждаются индивидуально." }
              },
              {
                "@type": "Question",
                "name": "Как работает реферальная ссылка?",
                "acceptedAnswer": { "@type": "Answer", "text": "Вы получаете уникальную ссылку и промокод. Делитесь ими в соцсетях, блоге или мессенджерах. С каждого заказа по вашей ссылке начисляется комиссия в личном кабинете." }
              },
              {
                "@type": "Question",
                "name": "Когда я получу деньги после продажи?",
                "acceptedAnswer": { "@type": "Answer", "text": "После оплаты заказа покупателем начинается 14-дневный холд (на случай возврата). После его окончания средства доступны к выводу. Выплата — 5 рабочих дней." }
              }
            ]
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Главная", "item": "https://www.booomerangs.ru" },
              { "@type": "ListItem", "position": 2, "name": "Партнёрская программа", "item": "https://www.booomerangs.ru/partner/register" }
            ]
          }
        ]}
      />
      <Helmet>
        <link rel="preload" as="image" href="/partner-banner-desktop.webp" media="(min-width: 640px)" />
        <link rel="preload" as="image" href="/partner-banner-mobile.webp" media="(max-width: 639px)" />
      </Helmet>

      {/* ── Hero-баннер — слайдер ── */}
      <PartnerBannerSlider firstSlideOverride={partnerFirstSlideOverride} />
      <h1 className="sr-only">Партнёрская программа BOOOMERANGS — зарабатывай 15–25% комиссии на рекомендациях одежды для самозанятых, ИП и блогеров</h1>

      {/* ── REFERRAL PROGRAM — тёмная секция ── */}
      <section className="bg-zinc-950 text-white" data-testid="partner-program-benefits">

        {/* Заголовок */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-10 text-center">
          <p className="text-[11px] font-black tracking-[0.25em] uppercase text-zinc-300 mb-5">
            Реферальная программа
          </p>
          <h2 className="text-3xl sm:text-5xl font-black leading-[1.05] tracking-tight mb-5">
            Ваш контент&nbsp;—&nbsp;ваш бизнес
          </h2>
          <p className="text-zinc-200 text-base max-w-md mx-auto leading-relaxed">
            Рекламируй BOOOMERANGS и зарабатывай комиссию с каждого заказа по твоей ссылке
          </p>
        </div>

        {/* Большие цифры */}
        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-3 divide-x divide-zinc-800">
            {[
              { value: "15–25%", label: "Комиссия" },
              { value: "30 дн.", label: "Атрибуция" },
              { value: "5 дн.",  label: "Выплата" },
            ].map(({ value, label }) => (
              <div key={label} className="py-10 sm:py-12 flex flex-col items-center justify-center text-center px-2">
                <div className="text-3xl sm:text-5xl font-black text-white tabular-nums mb-1.5">{value}</div>
                <div className="text-[10px] sm:text-xs font-bold tracking-[0.2em] uppercase text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Три фичи */}
        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
            {[
              { label: "Личный кабинет",        desc: "Статистика кликов, заказов и комиссий в реальном времени. Всегда видишь, сколько заработал." },
              { label: "Своя ссылка и витрина", desc: "Личный URL и страница с товарами на booomerangs.ru/r/ваш-slug — делись где угодно." },
              { label: "Выплаты без минималки", desc: "Подай заявку после холда — выплатим на карту или расчётный счёт за 5 рабочих дней." },
            ].map(({ label, desc }) => (
              <div key={label}>
                <div className="w-8 h-0.5 bg-red-500 mb-5" />
                <h3 className="font-black text-white text-lg mb-2 leading-tight">{label}</h3>
                <p className="text-sm text-zinc-300 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Кнопка реферальной программы */}
        <div className="border-t border-zinc-800">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-400">Уже есть аккаунт?</span>
              <a
                href="/partner/login"
                data-testid="link-partner-login"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-white text-white text-sm font-semibold hover:bg-white hover:text-black transition-colors duration-150"
              >
                Войти
              </a>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setProgramInfoOpen(true)}
              data-testid="button-program-info"
              className="gap-2 border-zinc-700 text-white bg-transparent hover:bg-zinc-800 hover:text-white hover:border-zinc-600"
            >
              <BookOpen className="w-4 h-4" />
              Подробнее об условиях
            </Button>
          </div>
        </div>
      </section>

      {/* ── MEDIA PARTNERS — контрастная красная секция ── */}
      <section className="bg-white dark:bg-zinc-900 border-t-[3px] border-red-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">

          {/* Метка секции */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-0.5 bg-red-500" />
            <span className="text-[10px] font-black tracking-[0.25em] uppercase text-red-500">
              Для артистов, блогеров, сообществ и брендов
            </span>
          </div>

          {/* Заголовок + три колонки */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 sm:gap-16 items-start mb-10">
            <div>
              <h2 className="text-3xl sm:text-4xl font-black leading-[1.05] tracking-tight text-zinc-950 dark:text-white mb-5">
                Своя страница.<br />Свой мерч.<br />Свои правила.
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xs">
                Персональная страница на BOOOMERANGS, авторская коллекция и договорной процент — подключись как медийный партнёр.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6">
              {[
                { label: "Своя страница",  desc: "Персональный лендинг с галереей, описанием и соцсетями — booomerangs.ru/@ваш-slug" },
                { label: "Витрина мерча",  desc: "Все товары коллаборации на твоей странице — покупатели приходят напрямую к тебе." },
                { label: "Авторский мерч", desc: "Совместные коллекции под своим именем — зарабатывай с каждой продажи." },
              ].map(({ label, desc }) => (
                <div key={label} className="flex gap-4">
                  <div className="w-0.5 bg-red-500 shrink-0 self-stretch" />
                  <div>
                    <div className="font-black text-zinc-950 dark:text-white text-base mb-1">{label}</div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}

              {/* Мерч под заказ — отдельная карточка */}
              <a href="/merch-na-zakaz" className="flex gap-4 group mt-2 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" data-testid="link-merch-order">
                <div className="w-0.5 bg-zinc-300 dark:bg-zinc-600 group-hover:bg-red-500 shrink-0 self-stretch transition-colors" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-black text-zinc-950 dark:text-white text-base">Мерч под заказ</div>
                    <span className="text-[10px] font-bold tracking-wider uppercase text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full">Производство</span>
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">Нет готового мерча? Производим под ключ — дизайн, тираж, контроль качества. Размещаем на сайте, ты зарабатываешь.</div>
                  <div className="text-xs font-bold text-red-500 mt-2 group-hover:underline">Узнать о производстве →</div>
                </div>
              </a>
            </div>
          </div>

          {/* Нижняя полоса: пометка о ставке + кнопка */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-8 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shrink-0 mt-0.5">
                <Star className="w-3 h-3 text-white fill-white" />
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug max-w-sm">
                <strong className="text-zinc-950 dark:text-white">Процент комиссии — договорной.</strong>{" "}
                Обсуждается индивидуально в зависимости от формата сотрудничества.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setMediaInfoOpen(true)}
              data-testid="button-media-info"
              className="gap-2 bg-red-600 hover:bg-red-700 text-white shrink-0"
            >
              <Star className="w-4 h-4" />
              Для медийных партнёров
            </Button>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-4 pt-8 pb-12 min-h-[70vh]">
        <div className="max-w-2xl mx-auto">

          {/* Шаги - прогресс-индикатор */}
          <div className="mb-5 sm:mb-6">
            <div className="relative flex items-center justify-between max-w-sm mx-auto px-2">
              <div className="absolute left-2 right-2 top-3 sm:top-3.5 h-0.5 bg-muted -z-0" />
              <div
                className="absolute left-2 top-3 sm:top-3.5 h-0.5 bg-primary -z-0 transition-all duration-300"
                style={{ width: `calc((100% - 16px) * ${step / 2})` }}
              />
              {["Тип", "Данные", "Подписание"].map((label, i) => {
                const reached = step >= (i as 0 | 1 | 2);
                const isCurrent = step === (i as 0 | 1 | 2);
                return (
                  <div key={label} className="relative z-10 flex flex-col items-center gap-1.5" data-testid={`step-indicator-${i}`}>
                    <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[11px] sm:text-xs font-semibold transition ring-4 ring-background ${
                      reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    } ${isCurrent ? "scale-110 shadow-md" : ""}`}>
                      {step > i ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                    </div>
                    <span className={`text-[10px] sm:text-[11px] uppercase tracking-wide ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4" data-testid="alert-register-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* ── Шаг 0: выбор типа ─────────────────────────────────────── */}
          {step === 0 && (
            <div data-testid="step-0">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                {STATUS_CARDS.map((c) => {
                  const Icon = c.icon;
                  const selected = legalStatus === c.value;
                  return (
                    <div
                      key={c.value}
                      onClick={() => setLegalStatus(c.value)}
                      data-testid={`card-status-${c.value}`}
                      className={`relative rounded-2xl border-2 overflow-hidden cursor-pointer transition-all select-none group ${
                        selected
                          ? "border-primary shadow-lg shadow-primary/10"
                          : "border-border hover:border-primary/50 hover:shadow-md"
                      }`}
                    >
                      {/* Акцентная полоса сверху */}
                      <div className={`h-1 w-full transition-colors ${selected ? "bg-primary" : "bg-muted group-hover:bg-primary/40"}`} />
                      <div className="p-6 sm:p-8 flex flex-col items-center text-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${selected ? "bg-primary/10" : "bg-muted/60 group-hover:bg-primary/5"}`}>
                          <Icon className={`w-6 h-6 transition-colors ${selected ? "text-primary" : "text-muted-foreground group-hover:text-primary/70"}`} />
                        </div>
                        <div className={`text-base sm:text-lg font-bold leading-snug transition-colors ${selected ? "text-primary" : ""}`}>{c.title}</div>
                        {selected && <CheckCircle className="w-5 h-5 text-primary" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button disabled={!legalStatus} onClick={() => setStep(1)} data-testid="button-next-1">
                  Дальше <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Шаг 1: данные + DaData ────────────────────────────────── */}
          {step === 1 && legalStatus && (
            <Card className="p-4 sm:p-6 space-y-6" data-testid="step-1">
              {/* ── Секция 1: Аккаунт ─────────────────────────────────── */}
              <section>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <AtSign className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold leading-tight">Аккаунт и контакты</h2>
                    <p className="text-xs text-muted-foreground">Данные для входа и связи с вами</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="email">Email *</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-email" autoComplete="email" />
                    <p className="text-xs text-muted-foreground mt-1">На этот адрес придёт ссылка подтверждения</p>
                  </div>
                  <div>
                    <Label htmlFor="phone">Телефон *</Label>
                    <Input id="phone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+7 900 000-00-00" data-testid="input-contact-phone" autoComplete="tel" />
                    <p className="text-xs text-muted-foreground mt-1">Для связи менеджера по заявке</p>
                  </div>
                  <div>
                    <Label htmlFor="password">Пароль *</Label>
                    <div className="relative">
                      <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Минимум 6 символов" data-testid="input-password" autoComplete="new-password" className="pr-10" />
                      <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1} data-testid="button-toggle-password">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="contactName">Контактное лицо *</Label>
                    <Input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Как вас зовут?" data-testid="input-contact-name" />
                    <p className="text-xs text-muted-foreground mt-1">Имя менеджера или ваше имя</p>
                  </div>
                </div>
              </section>

              <div className="border-t" />

              {/* ── Секция 2: Канал и площадки ────────────────────────── */}
              <section>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Link2 className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold leading-tight">Ваш канал и ссылка</h2>
                    <p className="text-xs text-muted-foreground">Название и площадки, где вы размещаете контент</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="store">Название канала / магазина *</Label>
                    <Input id="store" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Например: Блог Анны" data-testid="input-store-name" />
                  </div>
                  <div>
                    <Label htmlFor="slug">Ваш идентификатор для ссылки *</Label>
                    <div className="flex items-center gap-0 rounded-md border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
                      <span className="text-xs text-muted-foreground bg-muted px-2.5 py-2.5 border-r border-input whitespace-nowrap shrink-0 select-none">/r/</span>
                      <input
                        id="slug"
                        value={partnerSlug}
                        onChange={(e) => setPartnerSlug(autoSlug(e.target.value))}
                        placeholder="anna-blog"
                        data-testid="input-partner-slug"
                        className="flex-1 min-w-0 bg-transparent px-2.5 py-2 text-sm outline-none"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Только латиница и дефисы. Ваша ссылка: <span className="font-medium">booomerangs.ru/r/{partnerSlug || "anna-blog"}</span></p>
                  </div>

                  <div className="md:col-span-2">
                    <Label className="mb-2 block">Площадки для размещения ссылок *</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: "vk",        label: "ВКонтакте" },
                        { id: "instagram", label: "Инстаграм" },
                        { id: "telegram",  label: "Телеграм" },
                        { id: "youtube",   label: "YouTube" },
                        { id: "tiktok",    label: "TikTok" },
                        { id: "max",       label: "МАХ" },
                        { id: "other",     label: "Другое" },
                      ].map(({ id, label }) => {
                        const checked = selectedSocials.includes(label);
                        return (
                          <label
                            key={id}
                            data-testid={`checkbox-social-${id}`}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 cursor-pointer select-none transition-all text-sm font-medium ${
                              checked
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border bg-background hover:border-primary/40"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                setSelectedSocials(prev =>
                                  v ? [...prev, label] : prev.filter(s => s !== label)
                                )
                              }
                              className="shrink-0"
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                    {selectedSocials.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-1.5">Выберите хотя бы одну площадку</p>
                    )}
                  </div>

                  {/* Медийный блок */}
                  <div className="md:col-span-2">
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Нажмите, если подходит вам</p>
                    <button
                      type="button"
                      onClick={() => setIsArtist(v => !v)}
                      data-testid="checkbox-is-artist"
                      className={`w-full text-left rounded-2xl border-2 p-4 transition-all cursor-pointer select-none ${
                        isArtist
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-dashed border-primary/40 hover:border-primary/70 bg-primary/[0.02] hover:bg-primary/[0.05]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isArtist ? "bg-primary/15" : "bg-primary/10"}`}>
                          <Sparkles className={`w-4 h-4 transition-colors ${isArtist ? "text-primary" : "text-primary/60"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-semibold ${isArtist ? "" : "text-primary/80"}`}>Я артист, блогер или медийный проект</span>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isArtist ? "border-primary bg-primary" : "border-primary/30"}`}>
                              {isArtist && <CheckCircle className="w-3.5 h-3.5 text-primary-foreground" />}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            Откроет личную страницу <span className="font-medium">/@ваш-slug</span> с витриной товаров, статистикой продаж и разделом для мерча
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </section>

              <div className="border-t" />

              {/* ── Секция 3: Юридические данные ──────────────────────── */}
              <section>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold leading-tight">Юридические данные</h2>
                    <p className="text-xs text-muted-foreground">Нужны для оформления договора и выплат</p>
                  </div>
                </div>
                {legalStatus === "self_employed" && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Фамилия *</Label>
                      <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-last-name" />
                    </div>
                    <div>
                      <Label>Имя *</Label>
                      <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-first-name" />
                    </div>
                    <div>
                      <Label>Отчество <span className="text-muted-foreground font-normal">(если есть)</span></Label>
                      <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} data-testid="input-middle-name" />
                    </div>
                    <div className="md:col-span-3">
                      <Label>ИНН * (12 цифр)</Label>
                      <Input value={inn} onChange={(e) => setInn(onlyDigits(e.target.value).slice(0, 12))} inputMode="numeric" data-testid="input-inn" className="font-mono tracking-wide" />
                      <p className="text-xs text-muted-foreground mt-1">
                        Найти свой ИНН можно на{" "}
                        <a href="https://service.nalog.ru/inn.do" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">nalog.ru</a>
                        {" "}- бесплатно, за 1 минуту
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <Label>Дата рождения *</Label>
                      <div className="grid grid-cols-3 gap-2 mt-0.5">
                        <Select value={birthDay} onValueChange={setBirthDay}>
                          <SelectTrigger data-testid="select-birth-day">
                            <SelectValue placeholder="День" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 31 }, (_, i) => String(i + 1)).map(d => (
                              <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={birthMonth} onValueChange={setBirthMonth}>
                          <SelectTrigger data-testid="select-birth-month">
                            <SelectValue placeholder="Месяц" />
                          </SelectTrigger>
                          <SelectContent>
                            {["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"].map((m, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={birthYear} onValueChange={setBirthYear}>
                          <SelectTrigger data-testid="select-birth-year">
                            <SelectValue placeholder="Год" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 60 }, (_, i) => String(new Date().getFullYear() - 18 - i)).map(y => (
                              <SelectItem key={y} value={y}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Гражданство *</Label>
                      <Input value={citizenship} onChange={(e) => setCitizenship(e.target.value)} placeholder="RU" data-testid="input-citizenship" />
                      <p className="text-xs text-muted-foreground mt-1">Код страны: RU, BY, KZ…</p>
                    </div>
                  </div>
                )}

                {(legalStatus === "ip" || legalStatus === "ooo") && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Label>ИНН * ({legalStatus === "ooo" ? "10" : "12"} цифр) – начните вводить, чтобы подгрузить данные</Label>
                      <Input
                        value={inn}
                        onChange={(e) => {
                          const v = onlyDigits(e.target.value).slice(0, legalStatus === "ooo" ? 10 : 12);
                          setInn(v);
                          lookupParty(v);
                          setPartyOpen(true);
                        }}
                        onFocus={() => inn && setPartyOpen(true)}
                        onBlur={() => setTimeout(() => setPartyOpen(false), 200)}
                        inputMode="numeric"
                        data-testid="input-inn"
                      />
                      {partyOpen && partySuggestions.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto bg-popover border rounded-md shadow-lg">
                          {partySuggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyParty(s)}
                              data-testid={`dadata-party-${i}`}
                            >
                              <div className="font-medium">{s.value}</div>
                              <div className="text-xs text-muted-foreground">ИНН {s.data.inn}{s.data.kpp ? ` · КПП ${s.data.kpp}` : ""}{s.data.address?.value ? ` · ${s.data.address.value}` : ""}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {legalStatus === "ooo" && (
                        <div>
                          <Label>КПП * (9 знаков)</Label>
                          <Input value={kpp} onChange={(e) => setKpp(e.target.value.toUpperCase().slice(0, 9))} data-testid="input-kpp" />
                        </div>
                      )}
                      <div>
                        <Label>{legalStatus === "ooo" ? "ОГРН * (13 цифр)" : "ОГРНИП * (15 цифр)"}</Label>
                        <Input value={ogrn} onChange={(e) => setOgrn(onlyDigits(e.target.value).slice(0, legalStatus === "ooo" ? 13 : 15))} inputMode="numeric" data-testid="input-ogrn" />
                      </div>
                      <div className="md:col-span-2">
                        <Label>{legalStatus === "ooo" ? "Полное наименование организации *" : "Наименование (например, ИП Иванов И.И.) *"}</Label>
                        <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} data-testid="input-company-name" />
                      </div>
                    </div>

                    <div className="relative">
                      <Label>Юридический адрес *</Label>
                      <Input
                        value={legalAddress}
                        onChange={(e) => {
                          setLegalAddress(e.target.value);
                          lookupAddress(e.target.value);
                          setAddressOpen(true);
                        }}
                        onFocus={() => legalAddress && setAddressOpen(true)}
                        onBlur={() => setTimeout(() => setAddressOpen(false), 200)}
                        data-testid="input-legal-address"
                      />
                      {addressOpen && addressSuggestions.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-popover border rounded-md shadow-lg">
                          {addressSuggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setLegalAddress(s.value); setAddressOpen(false); }}
                              data-testid={`dadata-addr-${i}`}
                            >
                              {s.value}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label>{legalStatus === "ooo" ? "Фамилия подписанта *" : "Фамилия *"}</Label>
                        <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-last-name" />
                      </div>
                      <div>
                        <Label>{legalStatus === "ooo" ? "Имя подписанта *" : "Имя *"}</Label>
                        <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-first-name" />
                      </div>
                      <div>
                        <Label>Отчество</Label>
                        <Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} data-testid="input-middle-name" />
                      </div>
                    </div>

                    {legalStatus === "ooo" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label>Должность подписанта *</Label>
                          <Input value={signerPosition} onChange={(e) => setSignerPosition(e.target.value)} placeholder="Генеральный директор" data-testid="input-signer-position" />
                        </div>
                        <div>
                          <Label>Основание полномочий *</Label>
                          <Input value={signerBasis} onChange={(e) => setSignerBasis(e.target.value)} placeholder="Устав / Доверенность №..." data-testid="input-signer-basis" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ── Кнопки навигации + подсказка о незаполненных полях ── */}
              <div className="flex flex-col gap-3 pt-2">
                {!canGoToStep2 && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-3.5 py-3">
                    <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                      {(() => {
                        const missing: string[] = [];
                        if (!email) missing.push("Email");
                        if (!password || password.length < 6) missing.push("Пароль (мин. 6 символов)");
                        if (!contactPhone) missing.push("Телефон");
                        if (!contactName) missing.push("Контактное лицо");
                        if (!storeName) missing.push("Название канала");
                        if (autoSlug(partnerSlug || storeName).length < 3) missing.push("Идентификатор ссылки");
                        if (selectedSocials.length === 0) missing.push("Площадка для ссылок");
                        if (legalStatus === "self_employed") {
                          if (!lastName || !firstName) missing.push("ФИО");
                          if (inn.length !== 12) missing.push("ИНН (12 цифр)");
                          if (!birthDate) missing.push("Дата рождения");
                        }
                        if (legalStatus === "ip") {
                          if (!lastName || !firstName) missing.push("ФИО");
                          if (inn.length !== 12) missing.push("ИНН (12 цифр)");
                          if (!ogrn || ogrn.length !== 15) missing.push("ОГРНИП (15 цифр)");
                          if (!companyName) missing.push("Наименование ИП");
                          if (!legalAddress) missing.push("Юридический адрес");
                        }
                        if (legalStatus === "ooo") {
                          if (!lastName || !firstName) missing.push("ФИО подписанта");
                          if (inn.length !== 10) missing.push("ИНН (10 цифр)");
                          if (!kpp || kpp.length !== 9) missing.push("КПП");
                          if (!ogrn || ogrn.length !== 13) missing.push("ОГРН (13 цифр)");
                          if (!companyName) missing.push("Наименование организации");
                          if (!legalAddress) missing.push("Юридический адрес");
                          if (!signerPosition) missing.push("Должность подписанта");
                        }
                        if (missing.length === 0) return "Проверяем данные...";
                        return `Ещё не заполнено: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` и ещё ${missing.length - 3}` : ""}`;
                      })()}
                    </p>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(0)} data-testid="button-back-0">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Назад
                  </Button>
                  <Button disabled={!canGoToStep2} onClick={() => setStep(2)} data-testid="button-next-2">
                    Дальше <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* ── Шаг 2: подписание ─────────────────────────────────────── */}
          {step === 2 && legalStatus && (
            <Card className="p-4 sm:p-6 space-y-4" data-testid="step-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Подписание документов</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Согласие фиксируется как простая электронная подпись по 63-ФЗ: мы храним хэш каждого документа, время, ваш IP и user-agent. Это юридически значимая подпись.
              </p>

              {legalStatus === "self_employed" && (
                <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20" data-testid="alert-adult">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <AlertDescription>Партнёрская программа для самозанятых доступна только лицам, достигшим 18 лет.</AlertDescription>
                </Alert>
              )}

              {docsLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Загружаем актуальные версии документов…</div>}

              {!docsLoading && (
                <div className="space-y-3">
                  <ConsentRow
                    docKey="offer"
                    doc={docs.offer}
                    label="Я принимаю оферту партнёрской программы"
                    checked={accept.offer}
                    onChange={(v) => setAccept((a) => ({ ...a, offer: v }))}
                    onOpen={() => docs.offer && setDocDialog(docs.offer)}
                  />
                  <ConsentRow
                    docKey="privacy"
                    doc={docs.privacy}
                    label="Я согласен(а) с политикой обработки персональных данных"
                    checked={accept.privacy}
                    onChange={(v) => setAccept((a) => ({ ...a, privacy: v }))}
                    onOpen={() => docs.privacy && setDocDialog(docs.privacy)}
                  />
                  {legalStatus === "self_employed" && (
                    <>
                      <ConsentRow
                        docKey="adult"
                        doc={docs.adult}
                        label="Подтверждаю, что мне исполнилось 18 лет"
                        checked={accept.adult}
                        onChange={(v) => setAccept((a) => ({ ...a, adult: v }))}
                        onOpen={() => docs.adult && setDocDialog(docs.adult)}
                      />
                      <ConsentRow
                        docKey="self_employed"
                        doc={docs.self_employed}
                        label="Подтверждаю, что состою на учёте как плательщик НПД (самозанятый)"
                        checked={accept.selfEmployed}
                        onChange={(v) => setAccept((a) => ({ ...a, selfEmployed: v }))}
                        onOpen={() => docs.self_employed && setDocDialog(docs.self_employed)}
                      />
                    </>
                  )}
                  <ConsentRow
                    docKey="marketing"
                    doc={docs.marketing}
                    optional
                    label="Согласен(а) получать маркетинговые рассылки (необязательно)"
                    checked={accept.marketing}
                    onChange={(v) => setAccept((a) => ({ ...a, marketing: v }))}
                    onOpen={() => docs.marketing && setDocDialog(docs.marketing)}
                  />
                </div>
              )}

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(1)} data-testid="button-back-1">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Назад
                </Button>
                <Button onClick={submit} disabled={submitting || !requiredAccepts || docsLoading} data-testid="button-submit-register">
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Подписать и отправить заявку
                </Button>
              </div>
              <p className="text-xs text-center text-muted-foreground pt-2">
                Уже партнёр?{" "}
                <Link href="/partner/login" className="text-primary hover:underline" data-testid="link-login">Войти</Link>
              </p>
            </Card>
          )}
        </div>
      </main>

      <Dialog open={!!docDialog} onOpenChange={(open) => !open && setDocDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-doc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {docDialog?.title} <span className="text-xs text-muted-foreground">v{docDialog?.version}</span>
            </DialogTitle>
            <DialogDescription>
              Полный текст документа, который будет считаться подписанным после клика по ссылке в письме.
            </DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{docDialog?.body}</pre>
          <p className="text-xs text-muted-foreground mt-3 break-all">SHA-256: {docDialog?.bodyHash}</p>
        </DialogContent>
      </Dialog>

      <ProgramInfoDialog open={programInfoOpen} onOpenChange={setProgramInfoOpen} />
      <MediaInfoDialog open={mediaInfoOpen} onOpenChange={setMediaInfoOpen} />

      <Footer />
    </>
  );
}

const DOC_DISPLAY_NAMES: Record<string, string> = {
  offer: "Оферта партнёрской программы BOOOMERANGS",
  privacy: "Политика обработки персональных данных",
  adult: "Подтверждение возраста (18+)",
  self_employed: "Соглашение для самозанятых",
  marketing: "Согласие на маркетинговые коммуникации",
};

function ConsentRow({
  docKey, doc, label, optional, checked, onChange, onOpen,
}: {
  docKey: string;
  doc?: LegalDoc;
  label: string;
  optional?: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
  onOpen: () => void;
}) {
  const displayName = DOC_DISPLAY_NAMES[docKey] ?? doc?.title ?? docKey;
  return (
    <div className="flex items-start gap-3 p-3 border rounded-md" data-testid={`consent-row-${docKey}`}>
      <Checkbox
        id={`consent-${docKey}`}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
        data-testid={`checkbox-${docKey}`}
      />
      <div className="flex-1 min-w-0">
        <label htmlFor={`consent-${docKey}`} className="text-sm cursor-pointer">
          {label} {optional && <span className="text-xs text-muted-foreground">(по желанию)</span>}
        </label>
        {doc ? (
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
            <button type="button" onClick={onOpen} className="text-primary hover:underline" data-testid={`btn-open-${docKey}`}>
              Открыть текст ({displayName}, v{doc.version})
            </button>
            <span>·</span>
            <code className="text-[10px]">SHA-256: {doc.bodyHash.slice(0, 16)}…</code>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground mt-0.5">Документ не найден</div>
        )}
      </div>
    </div>
  );
}
