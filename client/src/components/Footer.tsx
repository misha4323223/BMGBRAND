import { Link } from "wouter";
import { SiVk, SiTelegram } from "react-icons/si";

export function Footer() {
  return (
    <footer className="relative pb-8 pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-black/80 backdrop-blur-xl border border-white/20 p-8 md:p-12 rounded-[2.5rem] shadow-[0_0_30px_rgba(255,255,255,0.05),0_8px_48px_rgba(0,0,0,0.8)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
            <div className="lg:col-span-2">
              <Link href="/" className="block mb-8 cursor-pointer group">
                <span className="font-display text-5xl tracking-tighter text-white group-hover:text-primary transition-colors">
                  BMG<span className="text-primary group-hover:text-white transition-colors">BRAND</span>
                </span>
              </Link>
              <p className="text-zinc-500 max-w-md mb-8 font-mono text-xs uppercase tracking-[0.2em] leading-relaxed">
                Аутентичный российский стритвир. Смелые дизайны. Качественные материалы. 
                Мы создаем то, что носим сами. Из Тулы с любовью к уличной культуре.
              </p>
              <div className="flex space-x-5">
                <a 
                  href="https://vk.com/bmgbrand" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-12 h-12 rounded-full flex items-center justify-center border border-white/10 text-zinc-400 hover:text-primary hover:border-primary transition-all duration-500 bg-white/5 hover:bg-white/10 hover:scale-110"
                  data-testid="link-social-vk"
                >
                  <SiVk className="w-6 h-6" />
                </a>
                <a 
                  href="https://t.me/bmg_booomerangs" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-12 h-12 rounded-full flex items-center justify-center border border-white/10 text-zinc-400 hover:text-primary hover:border-primary transition-all duration-500 bg-white/5 hover:bg-white/10 hover:scale-110"
                  data-testid="link-social-telegram"
                >
                  <SiTelegram className="w-6 h-6" />
                </a>
              </div>
            </div>
            
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-[0.3em] text-white mb-8 border-b border-white/10 pb-3">Каталог</h4>
              <ul className="space-y-4 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <li><Link href="/products" className="hover:text-primary transition-colors" data-testid="link-footer-all">Все товары</Link></li>
                <li><Link href="/products?category=clothing" className="hover:text-primary transition-colors" data-testid="link-footer-clothing">Одежда</Link></li>
                <li><Link href="/products?category=socks" className="hover:text-primary transition-colors" data-testid="link-footer-socks">Носки</Link></li>
                <li><Link href="/products?category=accessories" className="hover:text-primary transition-colors" data-testid="link-footer-accessories">Аксессуары</Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-[0.3em] text-white mb-8 border-b border-white/10 pb-3">Инфо</h4>
              <ul className="space-y-4 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                <li className="text-zinc-400">Россия, Тула</li>
                <li>
                  <a href="mailto:support@booomerangs.ru" className="hover:text-primary transition-colors lowercase tracking-normal">
                    support@booomerangs.ru
                  </a>
                </li>
                <li><Link href="/about" className="hover:text-primary transition-colors" data-testid="link-footer-about">О бренде</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-10 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-zinc-600 text-[10px] font-mono uppercase tracking-[0.3em]">
            <p>&copy; {new Date().getFullYear()} Booomerangs. Underground aesthetic.</p>
            <div className="flex space-x-8 mt-6 md:mt-0">
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
