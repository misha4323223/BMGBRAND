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
    <nav className="fixed top-0 left-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo */}
          <Link href="/" className="flex-shrink-0 cursor-pointer group">
            <span className="font-display text-2xl tracking-tighter text-white group-hover:text-primary transition-colors">
              BMG<span className="text-primary group-hover:text-white transition-colors">BRAND</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-8">
            {links.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={`font-mono text-sm uppercase tracking-widest hover:text-primary transition-colors ${location === link.href ? 'text-primary' : 'text-zinc-400'}`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Icons */}
          <div className="flex items-center space-x-6">
            <Link href="/cart" className="relative cursor-pointer group">
              <ShoppingBag className="w-6 h-6 text-white group-hover:text-primary transition-colors" />
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-none">
                  {cartCount}
                </span>
              )}
            </Link>
            
            <button 
              className="md:hidden text-white hover:text-primary"
              onClick={() => setIsOpen(!isOpen)}
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-zinc-900 border-b border-white/10"
          >
            <div className="px-4 py-4 space-y-4">
              {links.map((link) => (
                <Link 
                  key={link.href} 
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className={`block font-display text-2xl uppercase tracking-wide hover:text-primary hover:pl-2 transition-all ${location === link.href ? 'text-primary' : 'text-zinc-400'}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
