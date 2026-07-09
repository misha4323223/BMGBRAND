import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SEO from "@/components/SEO";
import { Package, Check, Truck, MapPin, Calendar, ExternalLink } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";

interface TrackingStatus {
  code: string;
  name: string;
  date: string;
  city?: string;
}

interface TrackingData {
  orderId: number;
  status: string;
  trackNumber: string | null;
  lastStatus: string | null;
  lastStatusDate: string | null;
  statuses: TrackingStatus[];
}

export default function TrackOrder() {
  const params = useParams<{ trackNumber: string }>();
  const trackNumber = params.trackNumber;

  const { data, isLoading, error } = useQuery<TrackingData>({
    queryKey: ["/api/track", trackNumber],
    enabled: !!trackNumber,
  });

  const getOrderStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Ожидает оплаты';
      case 'paid': return 'Оплачен';
      case 'processing': return 'Собирается';
      case 'shipped': return 'Отправлен';
      case 'delivered': return 'Доставлен';
      case 'cancelled': return 'Отменён';
      default: return status;
    }
  };

  const statusSteps = [
    { key: 'paid', label: 'Оплачен' },
    { key: 'processing', label: 'Собирается' },
    { key: 'shipped', label: 'Отправлен' },
    { key: 'delivered', label: 'Доставлен' },
  ];

  const currentStepIndex = data ? statusSteps.findIndex(s => s.key === data.status) : -1;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO
        title={`Отслеживание ${trackNumber || ''} | BMGBRAND`}
        description="Отслеживание заказа BMGBRAND"
        noindex
      />
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-6" data-testid="text-track-title">
          Отслеживание заказа
        </h1>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <BrandLoader size="sm" />
          </div>
        )}

        {error && (
          <Card className="p-8 text-center">
            <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-track-error">
              Заказ с трек-номером {trackNumber} не найден
            </p>
          </Card>
        )}

        {data && (
          <div className="space-y-6">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
                <div className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-primary" />
                  <span className="font-semibold text-foreground" data-testid="text-track-number-display">
                    СДЭК: {data.trackNumber || trackNumber}
                  </span>
                </div>
                <Badge variant={data.status === 'delivered' ? 'default' : 'secondary'} className={data.status === 'delivered' ? 'bg-green-600' : ''}>
                  {getOrderStatusLabel(data.status)}
                </Badge>
              </div>

              {data.status !== 'cancelled' && (
                <div className="py-3">
                  <div className="flex items-center justify-between relative">
                    <div className="absolute top-3 left-0 right-0 h-0.5 bg-muted mx-6" />
                    <div 
                      className="absolute top-3 left-0 h-0.5 bg-primary mx-6 transition-all duration-500" 
                      style={{ width: currentStepIndex >= 0 ? `calc(${(currentStepIndex / (statusSteps.length - 1)) * 100}% - 3rem)` : '0%' }}
                    />
                    {statusSteps.map((step, idx) => {
                      const isCompleted = currentStepIndex >= idx;
                      const isCurrent = currentStepIndex === idx;
                      return (
                        <div key={step.key} className="flex flex-col items-center relative z-10">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
                            isCompleted 
                              ? 'bg-primary border-primary' 
                              : 'bg-background border-muted-foreground/30'
                          }`}>
                            {isCompleted && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                          </div>
                          <span className={`text-xs mt-2 text-center leading-tight max-w-[70px] ${
                            isCurrent ? 'font-semibold text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                          }`}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`https://www.cdek.ru/ru/tracking?order_id=${data.trackNumber || trackNumber}`, '_blank')}
                  data-testid="button-track-on-cdek"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                  Отследить на сайте СДЭК
                </Button>
              </div>
            </Card>

            {data.statuses && data.statuses.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  История статусов
                </h3>
                <div className="space-y-0">
                  {data.statuses.map((status, idx) => (
                    <div key={idx} className="flex gap-3 pb-3 last:pb-0 relative" data-testid={`track-status-${idx}`}>
                      <div className="flex flex-col items-center">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${idx === 0 ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                        {idx < data.statuses.length - 1 && (
                          <div className="w-px flex-1 bg-muted mt-1" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-3 border-b last:border-b-0">
                        <p className={`text-sm ${idx === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                          {status.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                          {status.date && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(status.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {status.city && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {status.city}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
