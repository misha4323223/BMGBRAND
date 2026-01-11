import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-zinc-950 border-t border-white/10 pt-16 pb-8">
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
          </div>
          
          <div>
            <h4 className="font-display text-lg text-white mb-6">Исследовать</h4>
            <ul className="space-y-4 font-mono text-sm text-zinc-500">
              <li><Link href="/products" className="hover:text-primary transition-colors">Все товары</Link></li>
              <li><Link href="/products?category=new" className="hover:text-primary transition-colors">Новинки</Link></li>
              <li><Link href="/about" className="hover:text-primary transition-colors">Философия</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display text-lg text-white mb-6">Контакты</h4>
            <ul className="space-y-4 font-mono text-sm text-zinc-500">
              <li>Москва, Россия</li>
              <li>support@booomerangs.ru</li>
              <li className="flex space-x-4 mt-4">
                <a href="#" className="text-white hover:text-primary text-xl">VK</a>
                <a href="#" className="text-white hover:text-primary text-xl">TG</a>
                <a href="#" className="text-white hover:text-primary text-xl">IG</a>
              </li>
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
