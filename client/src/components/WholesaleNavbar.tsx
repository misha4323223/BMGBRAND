import { useState, useEffect } from "react";
import { Link } from "wouter";
import { LogIn, LogOut, User, ArrowLeft } from "lucide-react";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { AuthModal } from "./AuthModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WholesaleNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const { data: authData } = useAuth();
  const user = authData?.user;
  const logout = useLogout();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
        style={{
          background: scrolled
            ? "linear-gradient(135deg, rgba(8,8,12,0.85) 0%, rgba(18,18,28,0.75) 50%, rgba(8,10,16,0.85) 100%)"
            : "linear-gradient(135deg, rgba(4,4,8,0.6) 0%, rgba(12,12,20,0.4) 50%, rgba(4,6,10,0.6) 100%)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.03)",
          boxShadow: scrolled ? "0 1px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)" : "none",
        }}
      >
        <div className="max-w-none px-6 sm:px-10 h-14 flex items-center justify-between">

          {/* Left: back button */}
          <div className="flex items-center">
            <button
              onClick={() => window.history.back()}
              className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors text-[11px] uppercase tracking-[0.15em] font-medium"
              data-testid="button-wholesale-back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Назад
            </button>
          </div>

          {/* Center: logo */}
          <Link href="/" className="hidden sm:flex items-center justify-center w-12 h-12 rounded-full border border-white/70" data-testid="link-wholesale-logo-center">
            <img
              src="/images/boomerangs-logo.webp"
              alt="Booomerangs"
              className="h-8 w-auto object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </Link>

          {/* Right: auth */}
          <div className="flex items-center gap-3">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-[11px] uppercase tracking-[0.15em] font-medium"
                    data-testid="button-wholesale-user"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{user.name || "Кабинет"}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="bg-black border border-white/10 text-white min-w-[160px]"
                >
                  <DropdownMenuItem asChild>
                    <Link
                      href="/profile"
                      className="cursor-pointer text-white/70 hover:text-white focus:text-white focus:bg-white/10"
                    >
                      <User className="w-4 h-4 mr-2" />
                      Личный кабинет
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem
                    onClick={() => logout.mutate()}
                    className="text-white/50 hover:text-white cursor-pointer focus:bg-white/10"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Выйти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                onClick={() => setIsAuthOpen(true)}
                className="flex items-center gap-1.5 border border-white/35 hover:border-white/70 text-white/85 hover:text-white transition-all text-[10px] uppercase tracking-[0.2em] font-bold px-4 py-2 rounded-full"
                data-testid="button-wholesale-login"
              >
                <LogIn className="w-3 h-3" />
                Войти
              </button>
            )}
          </div>
        </div>
      </nav>

      <AuthModal open={isAuthOpen} onOpenChange={setIsAuthOpen} />
    </>
  );
}
