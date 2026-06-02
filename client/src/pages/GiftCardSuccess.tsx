import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Gift, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";

interface GiftCardData {
  code: string;
  amount: number;
  recipientEmail?: string;
}

export default function GiftCardSuccess() {
  const { toast } = useToast();
  const [giftCards, setGiftCards] = useState<GiftCardData[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const giftCardId = params.get("id");

    if (giftCardId) {
      fetch(`/api/gift-cards/batch/${giftCardId}`)
        .then(res => res.json())
        .then(data => {
          if (data.giftCards && data.giftCards.length > 0) {
            setGiftCards(data.giftCards.map((gc: any) => ({
              code: gc.code,
              amount: gc.amount,
              recipientEmail: gc.recipientEmail
            })));
          }
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast({
      title: "Код скопирован",
      description: "Код сертификата скопирован в буфер обмена",
    });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: 0,
    }).format(price / 100);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Подарочная карта оплачена" noindex={true} />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">Оплата прошла успешно!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="text-center text-muted-foreground">Загрузка...</div>
            ) : giftCards.length > 0 ? (
              <>
                <p className="text-center text-muted-foreground">
                  {giftCards.length === 1 
                    ? "Ваш подарочный сертификат готов к использованию"
                    : `Ваши ${giftCards.length} подарочных сертификата готовы к использованию`
                  }
                </p>
                
                <div className="space-y-4">
                  {giftCards.map((gc, index) => (
                    <div 
                      key={gc.code}
                      className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-4 border"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <Gift className="w-5 h-5 text-primary" />
                        <span className="font-medium">
                          Сертификат {giftCards.length > 1 ? `#${index + 1}` : ""} на {formatPrice(gc.amount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-background px-3 py-2 rounded font-mono text-lg tracking-wider">
                          {gc.code}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleCopyCode(gc.code)}
                          data-testid={`button-copy-code-${index}`}
                        >
                          {copiedCode === gc.code ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                      {gc.recipientEmail && (
                        <p className="text-sm text-muted-foreground mt-2">
                          Отправлен на: {gc.recipientEmail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="bg-muted/50 rounded-lg p-4 text-sm">
                  <p className="font-medium mb-2">Как использовать:</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Добавьте товары в корзину</li>
                    <li>На странице оформления заказа введите код сертификата</li>
                    <li>Сумма сертификата будет вычтена из стоимости заказа</li>
                  </ol>
                </div>
              </>
            ) : (
              <p className="text-center text-muted-foreground">
                Подарочный сертификат успешно оплачен. Информация о нём отправлена на вашу почту.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button asChild data-testid="button-continue-shopping">
                <Link href="/products">Продолжить покупки</Link>
              </Button>
              <Button variant="outline" asChild data-testid="button-buy-more-cards">
                <Link href="/gift-cards">Купить ещё сертификат</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
