import { useParams, Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";

interface OrderStatus {
  orderId: number;
  status: string;
  paid: boolean;
}

export default function OrderSuccess() {
  const { orderId } = useParams<{ orderId: string }>();
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}/status`);
        if (!response.ok) {
          throw new Error("Не удалось получить статус заказа");
        }
        const data = await response.json();
        setOrderStatus(data);
        
        if (!data.paid && data.status === "cancelled") {
          setLocation(`/order-failed/${orderId}`);
        }
        
        // Stop polling if payment confirmed
        if (data.paid || data.status === "paid") {
          if (intervalId) {
            clearInterval(intervalId);
          }
        }
      } catch (err: any) {
        setError("Не удалось проверить статус заказа. Попробуйте обновить страницу.");
      } finally {
        setLoading(false);
      }
    };

    // Initial check
    checkStatus();
    
    // Poll every 3 seconds until payment confirmed
    intervalId = setInterval(checkStatus, 3000);
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [orderId, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-16 flex items-center justify-center">
          <Card className="max-w-md w-full text-center">
            <CardContent className="py-12">
              <Loader2 className="w-12 h-12 animate-spin mx-auto text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">Проверяем статус оплаты...</p>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  const isPaid = orderStatus?.paid || orderStatus?.status === "paid";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Заказ оформлен" noindex={true} />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-16 flex items-center justify-center">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              {isPaid ? (
                <CheckCircle className="w-16 h-16 text-green-500" />
              ) : (
                <XCircle className="w-16 h-16 text-orange-500" />
              )}
            </div>
            <CardTitle className="text-2xl">
              {isPaid ? "Заказ успешно оплачен!" : "Ожидание оплаты"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPaid ? (
              <>
                <p className="text-muted-foreground">
                  Спасибо за покупку! Ваш заказ #{orderId} успешно оплачен и передан в обработку.
                </p>
                <p className="text-sm text-muted-foreground">
                  Информация о заказе отправлена на вашу электронную почту.
                </p>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Заказ #{orderId} создан, но оплата пока не подтверждена. 
                  Если вы оплатили заказ, статус обновится автоматически.
                </p>
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Проверяем статус оплаты...</span>
                </div>
              </>
            )}
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <div className="flex flex-col gap-2 pt-4">
              <Link href="/products">
                <Button className="w-full" data-testid="button-continue-shopping">
                  Продолжить покупки
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" className="w-full" data-testid="button-go-home">
                  На главную
                </Button>
              </Link>
            </div>

            {isPaid && (
              <div className="border-t pt-4 mt-2">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MessageSquare className="w-4 h-4" />
                    <p className="text-sm">Поделись впечатлением — это важно для нас</p>
                  </div>
                  <Link href="/profile">
                    <Button variant="outline" size="sm" data-testid="button-leave-review">
                      Написать отзыв
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
