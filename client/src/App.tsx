import { Link, Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import ProductList from "@/pages/ProductList";
import ProductDetail from "@/pages/ProductDetail";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import About from "@/pages/About";
import { CookieConsent } from "@/components/CookieConsent";

function ScrollToTop() {
  const [location] = useLocation();
  
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/products" component={ProductList} />
      <Route path="/products/:id" component={ProductDetail} />
      <Route path="/cart" component={Cart} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/about" component={About} />
      <Route path="/privacy">
        <div className="min-h-screen bg-background text-white p-8 pt-32 max-w-3xl mx-auto font-mono text-sm leading-relaxed">
          <h1 className="font-display text-4xl mb-8 uppercase">Политика конфиденциальности</h1>
          <p className="mb-4">Мы собираем минимальный набор данных (cookie), необходимый для работы корзины и авторизации.</p>
          <p className="mb-4">Ваши данные не передаются третьим лицам и используются исключительно для обеспечения функциональности магазина BMGBRAND.</p>
          <Link href="/" className="text-primary hover:underline uppercase block mt-8">Вернуться на главную</Link>
        </div>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ScrollToTop />
        <Toaster />
        <CookieConsent />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
