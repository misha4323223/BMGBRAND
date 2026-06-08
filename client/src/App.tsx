import { Switch, Route, useLocation } from "wouter";
import { useEffect, useState, lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartDrawerProvider } from "@/components/CartDrawer";
import { captureRefFromUrl } from "@/lib/partner-ref";
import { PreorderCartProvider } from "@/context/PreorderCartContext";

const CookieConsent = lazy(() => import("@/components/CookieConsent").then(m => ({ default: m.CookieConsent })));
const NewsletterPopup = lazy(() => import("@/components/NewsletterPopup").then(m => ({ default: m.NewsletterPopup })));
const ChatWidget = lazy(() => import("@/components/ChatWidget").then(m => ({ default: m.ChatWidget })));

const Home = lazy(() => import("@/pages/Home"));
const ProductList = lazy(() => import("@/pages/ProductList"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const SlugResolver = lazy(() => import("@/pages/SlugResolver"));
const Cart = lazy(() => import("@/pages/Cart"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const About = lazy(() => import("@/pages/About"));
const Admin = lazy(() => import("@/pages/Admin"));
const VerifyEmail = lazy(() => import("@/pages/VerifyEmail"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Profile = lazy(() => import("@/pages/Profile"));
const Vacancies = lazy(() => import("@/pages/Vacancies"));
const FAQ = lazy(() => import("@/pages/FAQ"));
const WholesaleRegister = lazy(() => import("@/pages/WholesaleRegister"));
const WholesaleProfile = lazy(() => import("@/pages/WholesaleProfile"));
const PartnerLogin = lazy(() => import("@/pages/PartnerLogin"));
const PartnerRegister = lazy(() => import("@/pages/PartnerRegister"));
const PartnerConfirmSignature = lazy(() => import("@/pages/PartnerConfirmSignature"));
const PartnerProfile = lazy(() => import("@/pages/PartnerProfile"));
const PartnerPublic = lazy(() => import("@/pages/PartnerPublic"));
const PartnerWidget = lazy(() => import("@/pages/PartnerWidget"));
const GiftCards = lazy(() => import("@/pages/GiftCards"));
const Blog = lazy(() => import("@/pages/Blog"));
const BlogDetail = lazy(() => import("@/pages/BlogDetail"));
const ArtistPage = lazy(() => import("@/pages/ArtistPage"));
const GiftCardSuccess = lazy(() => import("@/pages/GiftCardSuccess"));
const GiftCardFailed = lazy(() => import("@/pages/GiftCardFailed"));
const Terms = lazy(() => import("@/pages/Terms"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const OrderSuccess = lazy(() => import("@/pages/OrderSuccess"));
const OrderFailed = lazy(() => import("@/pages/OrderFailed"));
const Favorites = lazy(() => import("@/pages/Favorites"));
const Links = lazy(() => import("@/pages/Links"));
const TrackOrder = lazy(() => import("@/pages/TrackOrder"));
const ConceptPage = lazy(() => import("@/pages/ConceptPage"));
const PreorderCheckout = lazy(() => import("@/pages/PreorderCheckout"));
const WholesalePreorder = lazy(() => import("@/pages/WholesalePreorder"));
const Care = lazy(() => import("@/pages/Care"));
const MerchOrder = lazy(() => import("@/pages/MerchOrder"));
const NotFound = lazy(() => import("@/pages/not-found"));

function ScrollToTop() {
  const [location] = useLocation();
  
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  
  return null;
}

// Persist ?ref=<slug> from URL into localStorage so partner attribution survives
// the journey from product page → cart → checkout even when the browser drops
// 3rd-party cookies (Safari ITP, iframe widget flow).
function PartnerRefCapture() {
  const [location] = useLocation();
  useEffect(() => {
    captureRefFromUrl();
  }, [location]);
  return null;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/products/:catSlug/:subSlug">{() => <ProductList />}</Route>
        <Route path="/products/:catSlug">{() => <ProductList />}</Route>
        <Route path="/products">{() => <ProductList />}</Route>
        
        <Route path="/cart" component={Cart} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/about" component={About} />
        <Route path="/admin" component={Admin} />
        <Route path="/verify-email" component={VerifyEmail} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/profile" component={Profile} />
        <Route path="/favorites" component={Favorites} />
        <Route path="/vacancies" component={Vacancies} />
        <Route path="/faq" component={FAQ} />
        <Route path="/wholesale/register" component={WholesaleRegister} />
        <Route path="/wholesale/profile" component={WholesaleProfile} />
        <Route path="/wholesale/preorder" component={WholesalePreorder} />
        <Route path="/partner/login" component={PartnerLogin} />
        <Route path="/partner/register" component={PartnerRegister} />
        <Route path="/partner/confirm-signature" component={PartnerConfirmSignature} />
        <Route path="/partner" component={PartnerProfile} />
        <Route path="/partner/:slug/widget" component={PartnerWidget} />
        <Route path="/partner/:slug" component={PartnerPublic} />
        <Route path="/gift-cards" component={GiftCards} />
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:id" component={BlogDetail} />
        <Route path="/gift-cards/success" component={GiftCardSuccess} />
        <Route path="/gift-cards/failed" component={GiftCardFailed} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/care" component={Care} />
        <Route path="/order-success/:orderId" component={OrderSuccess} />
        <Route path="/order-failed/:orderId" component={OrderFailed} />
        <Route path="/links" component={Links} />
        <Route path="/track/:trackNumber" component={TrackOrder} />
        <Route path="/concept" component={ConceptPage} />
        <Route path="/predrop/checkout" component={PreorderCheckout} />
        <Route path="/merch-na-zakaz" component={MerchOrder} />
        <Route path="/:slug">
          {(params: any) => params?.slug?.startsWith("@") ? <ArtistPage /> : <SlugResolver />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function DeferredComponents() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof requestIdleCallback === 'function') {
      const t = requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => cancelIdleCallback(t);
    } else {
      const t = setTimeout(() => setReady(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <CookieConsent />
      <NewsletterPopup />
      <ChatWidget />
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CartDrawerProvider>
          <PreorderCartProvider>
            <ScrollToTop />
            <PartnerRefCapture />
            <Toaster />
            <DeferredComponents />
            <Router />
          </PreorderCartProvider>
        </CartDrawerProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
