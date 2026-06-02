import SEO from "@/components/SEO";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Briefcase, MapPin, Clock, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const defaultVacancies = [
  {
    id: "1",
    title: "Менеджер по продажам",
    location: "Тула",
    type: "Полная занятость",
    description: "Ищем активного менеджера для работы с клиентами и развития продаж в онлайн и офлайн каналах.",
    visible: true,
  },
  {
    id: "2",
    title: "SMM-специалист",
    location: "Удалённо",
    type: "Частичная занятость",
    description: "Ведение социальных сетей бренда, создание контента, взаимодействие с аудиторией.",
    visible: true,
  },
  {
    id: "3",
    title: "Дизайнер одежды",
    location: "Тула",
    type: "Полная занятость",
    description: "Разработка новых коллекций, работа с принтами и паттернами, подбор материалов.",
    visible: true,
  },
];

const defaultSettings = {
  pageTitle: "Вакансии",
  pageSubtitle: "Присоединяйся к команде BMGBRAND! Мы всегда в поиске талантливых и увлечённых людей.",
  hrEmail: "hr@booomerangs.ru",
  resumeText: "Не нашли подходящую вакансию? Отправьте резюме, и мы свяжемся с вами!",
  emptyText: "Сейчас открытых вакансий нет, но вы можете отправить резюме",
  pageVisible: true,
  vacancies: defaultVacancies,
};

export default function Vacancies() {
  const { data: pageData, isLoading } = useQuery<Record<string, any>>({
    queryKey: ["/api/page-settings/vacancies"],
  });

  const settings = pageData?.vacancies_data || defaultSettings;
  const pageTitle = settings.pageTitle || defaultSettings.pageTitle;
  const pageSubtitle = settings.pageSubtitle || defaultSettings.pageSubtitle;
  const hrEmail = settings.hrEmail || defaultSettings.hrEmail;
  const resumeText = settings.resumeText || defaultSettings.resumeText;
  const emptyText = settings.emptyText || defaultSettings.emptyText;
  const vacancies = (settings.vacancies || defaultSettings.vacancies).filter((v: any) => v.visible !== false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 pb-16 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </main>
        <Footer />
      </div>
    );
  }

  if (settings.pageVisible === false) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 pb-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Раздел вакансий временно недоступен</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Вакансии"
        description="Вакансии в BMGBRAND — присоединяйтесь к команде российского бренда одежды и аксессуаров."
        keywords="вакансии BMGBRAND, работа в бренде, карьера"
      />
      <Navbar />
      
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4" data-testid="text-vacancies-title">{pageTitle}</h1>
            <p className="text-muted-foreground max-w-2xl mx-auto" data-testid="text-vacancies-subtitle">
              {pageSubtitle}
            </p>
          </div>

          {vacancies.length > 0 ? (
            <div className="space-y-4">
              {vacancies.map((vacancy: any) => (
                <Card key={vacancy.id} className="hover-elevate transition-all" data-testid={`card-vacancy-${vacancy.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-primary" />
                      {vacancy.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-3">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {vacancy.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {vacancy.type}
                      </span>
                    </div>
                    <p className="text-foreground/80 mb-4">{vacancy.description}</p>
                    <Button asChild variant="outline" size="sm">
                      <a href={`mailto:${hrEmail}?subject=Отклик на вакансию: ${vacancy.title}`} data-testid={`button-apply-${vacancy.id}`}>
                        Откликнуться
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="text-center py-12">
              <CardContent>
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{emptyText}, отправив его на {hrEmail}</p>
              </CardContent>
            </Card>
          )}

          <div className="mt-12 text-center">
            <p className="text-muted-foreground mb-4" data-testid="text-resume-info">
              {resumeText}
            </p>
            <Button asChild>
              <a href={`mailto:${hrEmail}`} data-testid="button-send-resume">
                Отправить резюме
              </a>
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
