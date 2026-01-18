import { Link } from "wouter";
import { SiVk, SiTelegram } from "react-icons/si";

export function Footer() {
  return (
    <footer className="relative pb-12 pt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="bg-black/80 backdrop-blur-xl border border-white/20 p-8 rounded-[2rem] shadow-[0_0_20px_rgba(255,255,255,0.05),0_8px_32px_rgba(0,0,0,0.6)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
            <div>
              <Link href="/" className="block mb-6 cursor-pointer">
                <span className="font-display text-4xl tracking-tighter text-white">
                  BMG<span className="text-primary">BRAND</span>
                </span>
              </Link>
              <p className="text-zinc-500 max-w-sm mb-6 font-mono text-[10px] uppercase tracking-wider leading-relaxed">
                Аутентичный российский стритвир. Смелые дизайны. Качественные материалы. 
                Мы создаем то, что носим сами.
              </p>
              <div className="flex space-x-4">
                <a 
                  href="https://vk.com/bmgbrand" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full flex items-center justify-center border border-white/10 text-zinc-400 hover:text-primary hover:border-primary transition-all duration-300 bg-white/5"
                  data-testid="link-social-vk"
                >
                  <SiVk className="w-5 h-5" />
                </a>
                <a 
                  href="https://t.me/bmg_booomerangs" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full flex items-center justify-center border border-white/10 text-zinc-400 hover:text-primary hover:border-primary transition-all duration-300 bg-white/5"
                  data-testid="link-social-telegram"
                >
                  <SiTelegram className="w-5 h-5" />
                </a>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-8">
              <div>
                <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400 mb-6 border-b border-white/10 pb-2">Каталог</h4>
                <ul className="space-y-3 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  <li><Link href="/products" className="hover:text-primary transition-colors" data-testid="link-footer-all">Все товары</Link></li>
                  <li><Link href="/products?category=clothing" className="hover:text-primary transition-colors" data-testid="link-footer-clothing">Одежда</Link></li>
                  <li><Link href="/products?category=socks" className="hover:text-primary transition-colors" data-testid="link-footer-socks">Носки</Link></li>
                  <li><Link href="/products?category=accessories" className="hover:text-primary transition-colors" data-testid="link-footer-accessories">Аксессуары</Link></li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400 mb-6 border-b border-white/10 pb-2">Контакты</h4>
                <ul className="space-y-3 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  <li className="text-zinc-400">Россия</li>
                  <li>
                    <a href="mailto:support@booomerangs.ru" className="hover:text-primary transition-colors lowercase tracking-normal">
                      support@booomerangs.ru
                    </a>
                  </li>
                  <li><Link href="/about" className="hover:text-primary transition-colors" data-testid="link-footer-about">О нас</Link></li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-zinc-600 text-[10px] font-mono uppercase tracking-[0.2em]">
            <p>&copy; {new Date().getFullYear()} Booomerangs. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
