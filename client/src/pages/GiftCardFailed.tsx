import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import SEO from "@/components/SEO";

export default function GiftCardFailed() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Ошибка оплаты подарочной карты" noindex={true} />
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 flex items-center justify-center">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
              <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-2xl">Оплата не прошла</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-center text-muted-foreground">
              К сожалению, оплата подарочного сертификата не была завершена. 
              Деньги не были списаны с вашей карты.
            </p>

            <div className="bg-muted/50 rounded-lg p-4 text-sm">
              <p className="font-medium mb-2">Возможные причины:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Недостаточно средств на карте</li>
                <li>Карта заблокирована банком</li>
                <li>Превышен лимит на операции</li>
                <li>Оплата была отменена</li>
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <Button asChild data-testid="button-try-again">
                <Link href="/gift-cards">Попробовать снова</Link>
              </Button>
              <Button variant="outline" asChild data-testid="button-go-home">
                <Link href="/">На главную</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
