import { useParams, Link } from "wouter";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";

export default function OrderFailed() {
  const { orderId } = useParams<{ orderId: string }>();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Ошибка заказа" noindex={true} />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-16 flex items-center justify-center">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <XCircle className="w-16 h-16 text-red-500" />
            </div>
            <CardTitle className="text-2xl">Оплата не прошла</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              К сожалению, оплата заказа #{orderId} не была завершена.
            </p>
            <p className="text-sm text-muted-foreground">
              Попробуйте оформить заказ заново или выберите другой способ оплаты.
            </p>
            <div className="flex flex-col gap-2 pt-4">
              <Link href="/cart">
                <Button className="w-full" data-testid="button-retry-payment">
                  Вернуться в корзину
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" className="w-full" data-testid="button-go-home">
                  На главную
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
