import { Link, useLocation } from "wouter";
import { ShoppingBag, Menu, X } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/hooks/use-cart";
import { motion, AnimatePresence } from "framer-motion";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const { data: cartItems } = useCart();
  
  const cartCount = cartItems?.reduce((acc, item) => acc + item.quantity, 0) || 0;

  const links = [
    { href: "/", label: "Главная" },
    { href: "/products", label: "Магазин" },
    { href: "/about", label: "О нас" },
  ];

  return (
    <nav className="fixed top-4 left-1/2 -translate-x-1/2 w-[95%] max-w-4xl z-50">
      <div className="bg-black/80 backdrop-blur-xl border border-white/20 px-5 py-2 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.05),0_8px_32px_rgba(0,0,0,0.6)] group-hover:border-primary/50 transition-all duration-500">
        <div className="flex items-center justify-between h-8">
          
          {/* Logo */}
          <Link href="/" className="flex-shrink-0 cursor-pointer group">
            <span className="font-display text-xl tracking-tighter text-white group-hover:text-primary transition-colors">
              BMG<span className="text-primary group-hover:text-white transition-colors">BRAND</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center bg-zinc-900/50 rounded-full px-2 py-1 border border-white/5">
            {links.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={`px-4 py-1.5 rounded-full font-mono text-[10px] uppercase tracking-[0.2em] transition-all duration-300 ${
                  location === link.href 
                    ? 'bg-primary text-white' 
                    : 'text-zinc-500 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Icons */}
          <div className="flex items-center space-x-4">
            <Link href="/cart" className="relative cursor-pointer group p-2 hover:bg-white/5 rounded-full transition-colors">
              <ShoppingBag className="w-5 h-5 text-white group-hover:text-primary transition-colors" />
              {cartCount > 0 && (
                <span className="absolute top-1 right-1 bg-primary text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                  {cartCount}
                </span>
              )}
            </Link>
            
            <button 
              className="md:hidden text-white hover:text-primary p-2"
              onClick={() => setIsOpen(!isOpen)}
            >
              {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 10 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            className="md:hidden absolute top-full left-0 w-full mt-2"
          >
            <div className="bg-black/95 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl">
              <div className="space-y-4">
                {links.map((link) => (
                  <Link 
                    key={link.href} 
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className={`block font-display text-3xl uppercase tracking-tight hover:text-primary transition-all ${location === link.href ? 'text-primary' : 'text-zinc-500'}`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
