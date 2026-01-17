import { Link } from "wouter";
import { SiVk, SiTelegram } from "react-icons/si";

export function Footer() {
  return (
    <footer className="bg-zinc-950 border-t border-white/10 pt-16 pb-8 relative z-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="block mb-6 cursor-pointer">
              <span className="font-display text-4xl tracking-tighter text-white">
                BMG<span className="text-primary">BRAND</span>
              </span>
            </Link>
            <p className="text-zinc-500 max-w-sm mb-6 font-mono text-sm">
              Аутентичный российский стритвир. Смелые дизайны. Качественные материалы. 
              Мы создаем то, что носим сами.
            </p>
            <div className="flex space-x-4">
              <a 
                href="https://vk.com/bmgbrand" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-10 h-10 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary transition-colors"
                data-testid="link-social-vk"
              >
                <SiVk className="w-5 h-5" />
              </a>
              <a 
                href="https://t.me/bmg_booomerangs" 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-10 h-10 flex items-center justify-center border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary transition-colors"
                data-testid="link-social-telegram"
              >
                <SiTelegram className="w-5 h-5" />
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="font-display text-lg text-white mb-6">Каталог</h4>
            <ul className="space-y-4 font-mono text-sm text-zinc-500">
              <li><Link href="/products" className="hover:text-primary transition-colors" data-testid="link-footer-all">Все товары</Link></li>
              <li><Link href="/products?category=clothing" className="hover:text-primary transition-colors" data-testid="link-footer-clothing">Одежда</Link></li>
              <li><Link href="/products?category=socks" className="hover:text-primary transition-colors" data-testid="link-footer-socks">Носки</Link></li>
              <li><Link href="/products?category=accessories" className="hover:text-primary transition-colors" data-testid="link-footer-accessories">Аксессуары</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display text-lg text-white mb-6">Контакты</h4>
            <ul className="space-y-4 font-mono text-sm text-zinc-500">
              <li>Россия</li>
              <li>
                <a href="mailto:support@booomerangs.ru" className="hover:text-primary transition-colors">
                  support@booomerangs.ru
                </a>
              </li>
              <li><Link href="/about" className="hover:text-primary transition-colors" data-testid="link-footer-about">О нас</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-zinc-600 text-xs font-mono uppercase">
          <p>&copy; {new Date().getFullYear()} Booomerangs. All rights reserved.</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
