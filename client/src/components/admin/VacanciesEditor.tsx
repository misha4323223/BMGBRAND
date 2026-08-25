import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Plus, Trash2, Save, Loader2 } from "lucide-react";

interface VacancyItem {
  id: string;
  title: string;
  location: string;
  type: string;
  description: string;
  visible: boolean;
}

const DEFAULT_VACANCIES: VacancyItem[] = [
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

export function VacanciesEditor({ pageSettingsQuery, savePageSectionMutation }: {
  pageSettingsQuery: any;
  savePageSectionMutation: any;
}) {
  const data = pageSettingsQuery.data?.vacancies_data || {};
  
  const [pageTitle, setPageTitle] = useState(data.pageTitle || "Вакансии");
  const [pageSubtitle, setPageSubtitle] = useState(data.pageSubtitle || "Присоединяйся к команде BMGBRAND! Мы всегда в поиске талантливых и увлечённых людей.");
  const [hrEmail, setHrEmail] = useState(data.hrEmail || "hr@booomerangs.ru");
  const [resumeText, setResumeText] = useState(data.resumeText || "Не нашли подходящую вакансию? Отправьте резюме, и мы свяжемся с вами!");
  const [emptyText, setEmptyText] = useState(data.emptyText || "Сейчас открытых вакансий нет, но вы можете отправить резюме");
  const [pageVisible, setPageVisible] = useState(data.pageVisible !== false);
  const [vacancies, setVacancies] = useState<VacancyItem[]>(data.vacancies || DEFAULT_VACANCIES);
  const [editingVacancyId, setEditingVacancyId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (isInitialized) return;
    const d = pageSettingsQuery.data?.vacancies_data;
    if (!d) return;
    setPageTitle(d.pageTitle || "Вакансии");
    setPageSubtitle(d.pageSubtitle || "Присоединяйся к команде BMGBRAND! Мы всегда в поиске талантливых и увлечённых людей.");
    setHrEmail(d.hrEmail || "hr@booomerangs.ru");
    setResumeText(d.resumeText || "Не нашли подходящую вакансию? Отправьте резюме, и мы свяжемся с вами!");
    setEmptyText(d.emptyText || "Сейчас открытых вакансий нет, но вы можете отправить резюме");
    if (d.pageVisible !== undefined) setPageVisible(d.pageVisible);
    setVacancies(d.vacancies || DEFAULT_VACANCIES);
    setIsInitialized(true);
  }, [pageSettingsQuery.data, isInitialized]);

  const handleSave = () => {
    savePageSectionMutation.mutate({
      sectionId: "vacancies_data",
      settings: {
        pageTitle,
        pageSubtitle,
        hrEmail,
        resumeText,
        emptyText,
        pageVisible,
        vacancies,
      },
    }, {
      onSuccess: () => {
        setIsInitialized(false);
      },
    });
  };

  const addVacancy = () => {
    const newVacancy: VacancyItem = {
      id: String(Date.now()),
      title: "",
      location: "",
      type: "Полная занятость",
      description: "",
      visible: true,
    };
    setVacancies([...vacancies, newVacancy]);
    setEditingVacancyId(newVacancy.id);
  };

  const updateVacancy = (id: string, updates: Partial<VacancyItem>) => {
    setVacancies(vacancies.map(v => v.id === id ? { ...v, ...updates } : v));
  };

  const removeVacancy = (id: string) => {
    setVacancies(vacancies.filter(v => v.id !== id));
    if (editingVacancyId === id) setEditingVacancyId(null);
  };

  const editingVacancy = vacancies.find(v => v.id === editingVacancyId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Настройки страницы</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-sm">Заголовок</Label>
                <Input
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="Вакансии"
                  data-testid="input-vacancies-title"
                />
              </div>
              <div>
                <Label className="text-sm">Подзаголовок</Label>
                <Textarea
                  value={pageSubtitle}
                  onChange={(e) => setPageSubtitle(e.target.value)}
                  placeholder="Присоединяйся к команде..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-vacancies-subtitle"
                />
              </div>
              <div>
                <Label className="text-sm">Email для откликов</Label>
                <Input
                  value={hrEmail}
                  onChange={(e) => setHrEmail(e.target.value)}
                  placeholder="hr@booomerangs.ru"
                  data-testid="input-vacancies-hr-email"
                />
              </div>
              <div>
                <Label className="text-sm">Текст "Отправить резюме"</Label>
                <Textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Не нашли подходящую вакансию?..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-vacancies-resume-text"
                />
              </div>
              <div>
                <Label className="text-sm">Текст при отсутствии вакансий</Label>
                <Textarea
                  value={emptyText}
                  onChange={(e) => setEmptyText(e.target.value)}
                  placeholder="Сейчас открытых вакансий нет..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-vacancies-empty-text"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={pageVisible}
                  onCheckedChange={setPageVisible}
                  data-testid="switch-vacancies-visible"
                />
                <Label className="text-sm">Показывать страницу</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
                <span>Вакансии ({vacancies.length})</span>
                <Button size="sm" variant="outline" onClick={addVacancy} data-testid="button-add-vacancy">
                  <Plus className="w-4 h-4 mr-1" /> Добавить
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {vacancies.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Нет вакансий. Нажмите "Добавить".</p>
              ) : (
                vacancies.map((vacancy) => (
                  <Card
                    key={vacancy.id}
                    className={`cursor-pointer transition-colors hover-elevate ${editingVacancyId === vacancy.id ? 'border-primary bg-primary/5' : ''} ${!vacancy.visible ? 'opacity-60' : ''}`}
                    onClick={() => setEditingVacancyId(vacancy.id)}
                    data-testid={`card-admin-vacancy-${vacancy.id}`}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{vacancy.title || "Без названия"}</p>
                        <p className="text-xs text-muted-foreground truncate">{vacancy.location || "Не указан"} · {vacancy.type}</p>
                      </div>
                      {!vacancy.visible && (
                        <Badge variant="secondary" className="text-xs shrink-0">скрыта</Badge>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {!editingVacancy ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Выберите вакансию слева для редактирования или создайте новую</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">Редактирование вакансии</CardTitle>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm("Удалить эту вакансию?")) {
                      removeVacancy(editingVacancy.id);
                    }
                  }}
                  data-testid="button-delete-vacancy"
                >
                  <Trash2 className="w-4 h-4 mr-1" /> Удалить
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm">Название должности</Label>
                  <Input
                    value={editingVacancy.title}
                    onChange={(e) => updateVacancy(editingVacancy.id, { title: e.target.value })}
                    placeholder="Менеджер по продажам"
                    data-testid="input-vacancy-title"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Город / Локация</Label>
                    <Input
                      value={editingVacancy.location}
                      onChange={(e) => updateVacancy(editingVacancy.id, { location: e.target.value })}
                      placeholder="Тула"
                      data-testid="input-vacancy-location"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Тип занятости</Label>
                    <Select
                      value={editingVacancy.type}
                      onValueChange={(v) => updateVacancy(editingVacancy.id, { type: v })}
                    >
                      <SelectTrigger data-testid="select-vacancy-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Полная занятость">Полная занятость</SelectItem>
                        <SelectItem value="Частичная занятость">Частичная занятость</SelectItem>
                        <SelectItem value="Удалённая работа">Удалённая работа</SelectItem>
                        <SelectItem value="Стажировка">Стажировка</SelectItem>
                        <SelectItem value="Проектная работа">Проектная работа</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Описание вакансии</Label>
                  <Textarea
                    value={editingVacancy.description}
                    onChange={(e) => updateVacancy(editingVacancy.id, { description: e.target.value })}
                    placeholder="Опишите обязанности, требования и условия работы..."
                    rows={5}
                    className="resize-none"
                    data-testid="input-vacancy-description"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editingVacancy.visible}
                    onCheckedChange={(checked) => updateVacancy(editingVacancy.id, { visible: checked })}
                    data-testid="switch-vacancy-visible"
                  />
                  <Label className="text-sm">Показывать вакансию</Label>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="mt-4">
            <Button
              onClick={handleSave}
              disabled={savePageSectionMutation.isPending}
              data-testid="button-save-vacancies"
            >
              {savePageSectionMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Сохранить всё
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

