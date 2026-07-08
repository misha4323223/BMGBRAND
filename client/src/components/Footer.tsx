import { Link } from "wouter";
import { SiVk, SiTelegram, SiInstagram, SiYoutube, SiTiktok, SiWhatsapp } from "react-icons/si";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FOOTER_SETTINGS, type FooterSettings } from "./footer-settings";

const SOCIAL_ICONS: Record<string, any> = {
  vk: SiVk,
  telegram: SiTelegram,
  instagram: SiInstagram,
  youtube: SiYoutube,
  tiktok: SiTiktok,
  whatsapp: SiWhatsapp,
};

function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  const Icon = SOCIAL_ICONS[platform];
  if (!Icon) return null;
  return <Icon className={className} />;
}

function isExternal(href: string) {
  return href.startsWith("http") || href.startsWith("mailto:");
}

export function Footer() {
  const { data: pageData } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/footer"],
  });

  const s: FooterSettings = (() => {
    try {
      if (pageData?.footer_data) {
        let parsed = typeof pageData.footer_data === "string" ? JSON.parse(pageData.footer_data) : pageData.footer_data;
        if (parsed?.value && typeof parsed.value === "object") parsed = parsed.value;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          return { ...DEFAULT_FOOTER_SETTINGS, ...parsed };
        }
      }
    } catch {}
    return DEFAULT_FOOTER_SETTINGS;
  })();

  const socialLinksWithInstagram = (() => {
    const links = [...s.socialLinks];
    if (!links.some((l) => l.platform === "instagram")) {
      links.push({ platform: "instagram", url: "https://www.instagram.com/bmgbrand/", visible: true });
    }
    return links;
  })();
  const visibleSocials = socialLinksWithInstagram.filter((l) => l.visible);
  const visibleColumns = s.columns.filter((c) => c.visible);

  const renderLink = (link: { label: string; href: string }, testId: string) => {
    const cls = "transition-colors duration-200 hover:text-primary";
    if (!link.href || link.href === "") {
      return <span className="opacity-40 cursor-default">{link.label}</span>;
    }
    if (isExternal(link.href)) {
      return <a href={link.href} className={cls} target="_blank" rel="noopener noreferrer" data-testid={testId}>{link.label}</a>;
    }
    return <Link href={link.href} className={cls} data-testid={testId}>{link.label}</Link>;
  };

  /* ── MINIMAL ── */
  if (s.style === "minimal") {
    return (
      <footer className="bg-zinc-950 text-white border-t border-white/[0.08] py-6">
        <div className="max-w-8xl mx-auto px-4 sm:px-8 lg:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/"><span className="font-['Oswald',sans-serif] text-xl font-bold uppercase tracking-widest">{s.logoText}<span className="text-primary">{s.logoAccentText}</span></span></Link>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-white/55">
            {visibleColumns.map((col) => col.links.filter((l) => l.visible).map((link, i) => <span key={i}>{renderLink(link, `link-footer-${col.title}-${i}`)}</span>))}
          </div>
          <div className="flex gap-4">{visibleSocials.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-white/35 hover:text-primary transition-colors" aria-label={s.platform}><SocialIcon platform={s.platform} className="w-5 h-5" /></a>)}</div>
        </div>
      </footer>
    );
  }

  /* ── CENTERED ── */
  if (s.style === "centered") {
    return (
      <footer className="bg-zinc-950 text-white py-12">
        <div className="max-w-8xl mx-auto px-4 sm:px-8 lg:px-12 text-center">
          <Link href="/"><span className="font-['Oswald',sans-serif] text-3xl font-bold uppercase tracking-widest">{s.logoText}<span className="text-primary">{s.logoAccentText}</span></span></Link>
          {s.description && <p className="text-white/45 max-w-md mx-auto mt-3 mb-8 text-sm leading-relaxed">{s.description}</p>}
          <div className="flex flex-wrap justify-center gap-8 mb-8">
            {visibleColumns.map((col, ci) => (
              <div key={ci} className="text-left">
                <p className="text-[10px] font-mono tracking-[0.2em] uppercase text-white/30 mb-3">{col.title}</p>
                <ul className="space-y-2 text-sm text-white/55">{col.links.filter((l) => l.visible).map((link, li) => <li key={li}>{renderLink(link, `link-footer-${col.title}-${li}`)}</li>)}</ul>
              </div>
            ))}
          </div>
          {visibleSocials.length > 0 && <div className="flex justify-center gap-5 mb-8">{visibleSocials.map((soc, i) => <a key={i} href={soc.url} target="_blank" rel="noopener noreferrer" className="text-white/35 hover:text-primary transition-colors" aria-label={soc.platform}><SocialIcon platform={soc.platform} className="w-5 h-5" /></a>)}</div>}
          <div className="border-t border-white/[0.08] pt-5 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-white/30">
            <p>&copy; {new Date().getFullYear()} {s.copyrightText}</p>
            <div className="flex gap-5">{s.showPrivacyLink && <Link href="/privacy" className="hover:text-primary transition-colors">{s.privacyLinkText}</Link>}{s.showTermsLink && <Link href="/terms" className="hover:text-primary transition-colors">{s.termsLinkText}</Link>}</div>
          </div>
        </div>
      </footer>
    );
  }

  /* ── CLASSIC ── */
  return (
    <footer className="bg-zinc-950 text-white">

      {/* Top bar: logo + description + socials */}
      <div className="border-b border-white/[0.08] px-4 sm:px-8 lg:px-12 py-4 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="shrink-0 cursor-pointer">
            <span className="font-['Oswald',sans-serif] text-xl sm:text-2xl font-bold uppercase tracking-[0.15em]">
              {s.logoText}<span className="text-primary">{s.logoAccentText}</span>
            </span>
          </Link>
          {s.description && (
            <p className="hidden lg:block text-xs text-white/35 max-w-xs leading-relaxed">{s.description}</p>
          )}
          {visibleSocials.length > 0 && (
            <div className="flex items-center gap-4 sm:gap-5 shrink-0">
              {visibleSocials.map((soc, i) => (
                <a key={i} href={soc.url} target="_blank" rel="noopener noreferrer"
                  className="text-white/35 hover:text-primary transition-colors duration-200 p-1"
                  aria-label={soc.platform} data-testid={`link-social-${soc.platform}`}>
                  <SocialIcon platform={soc.platform} className="w-5 h-5 sm:w-[18px] sm:h-[18px]" />
                </a>
              ))}
            </div>
          )}
        </div>
        {/* Description visible only on mobile — under the logo row */}
        {s.description && (
          <p className="lg:hidden text-xs text-white/35 leading-relaxed mt-3">{s.description}</p>
        )}
      </div>

      {/* Nav columns */}
      <div className="px-4 sm:px-8 lg:px-12 py-7 sm:py-10">
        <div className={`grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-8 ${visibleColumns.length >= 3 ? "md:grid-cols-3 lg:grid-cols-4" : "md:grid-cols-2 lg:grid-cols-3"}`}>
          {visibleColumns.map((col, ci) => (
            <div key={ci}>
              <p className="text-[9px] sm:text-[10px] font-mono tracking-[0.22em] uppercase text-white/30 mb-3 sm:mb-4">{col.title}</p>
              <ul className="space-y-2 sm:space-y-2.5">
                {col.links.filter((l) => l.visible).map((link, li) => (
                  <li key={li} className="text-sm text-white/55 leading-snug">
                    {renderLink(link, `link-footer-${col.title}-${li}`)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/[0.08] px-4 sm:px-8 lg:px-12 py-4 sm:py-5">
        {/* Mobile: stacked layout */}
        <div className="flex flex-col items-center gap-3 text-xs sm:hidden">
          {s.creditText && (
            <div>
              {s.creditUrl ? (
                <a href={s.creditUrl} target="_blank" rel="noopener noreferrer"
                  className="group flex items-center gap-1.5 hover:opacity-90 transition-opacity">
                  <span className="text-white/30 text-[10px] tracking-widest uppercase font-mono">Разработано</span>
                  <span className="font-['Oswald',sans-serif] text-sm font-bold uppercase tracking-wider text-primary group-hover:text-primary/80 transition-colors">{s.creditText}</span>
                </a>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="text-white/30 text-[10px] tracking-widest uppercase font-mono">Разработано</span>
                  <span className="font-['Oswald',sans-serif] text-sm font-bold uppercase tracking-wider text-primary">{s.creditText}</span>
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-white/30">
            {s.showPrivacyLink && <Link href="/privacy" className="hover:text-primary transition-colors" data-testid="link-privacy">{s.privacyLinkText}</Link>}
            {s.showTermsLink && <Link href="/terms" className="hover:text-primary transition-colors" data-testid="link-terms">{s.termsLinkText}</Link>}
          </div>
          <p className="text-white/20">&copy; {new Date().getFullYear()} {s.copyrightText}</p>
        </div>

        {/* Desktop: row layout */}
        <div className="hidden sm:flex items-center justify-between gap-4 text-xs">
          <p className="text-white/30">&copy; {new Date().getFullYear()} {s.copyrightText}. Все права защищены.</p>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-white/30">
            {s.showPrivacyLink && <Link href="/privacy" className="hover:text-primary transition-colors" data-testid="link-privacy-d">{s.privacyLinkText}</Link>}
            {s.showTermsLink && <Link href="/terms" className="hover:text-primary transition-colors" data-testid="link-terms-d">{s.termsLinkText}</Link>}
          </div>
          {s.creditText && (
            <div className="shrink-0">
              {s.creditUrl ? (
                <a href={s.creditUrl} target="_blank" rel="noopener noreferrer"
                  className="group flex items-center gap-1.5 hover:opacity-90 transition-opacity">
                  <span className="text-white/30 text-[10px] tracking-widest uppercase font-mono">Разработано</span>
                  <span className="font-['Oswald',sans-serif] text-sm font-bold uppercase tracking-wider text-primary group-hover:text-primary/80 transition-colors">{s.creditText}</span>
                </a>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="text-white/30 text-[10px] tracking-widest uppercase font-mono">Разработано</span>
                  <span className="font-['Oswald',sans-serif] text-sm font-bold uppercase tracking-wider text-primary">{s.creditText}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
