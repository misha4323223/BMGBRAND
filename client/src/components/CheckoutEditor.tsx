import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Save, Plus, Trash2, ArrowUp, ArrowDown, Loader2, RotateCcw } from "lucide-react";
import { DEFAULT_CHECKOUT_SETTINGS } from "./checkout-settings";
import type { DeliveryInfoItem, CheckoutSettings } from "./checkout-settings";
export type { DeliveryInfoItem, CheckoutSettings };
export { DEFAULT_CHECKOUT_SETTINGS };

interface CheckoutEditorProps {
  apiKey: string;
}

async function adminFetch(url: string, apiKey: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, "x-api-key": apiKey },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

type SettingsSection = "general" | "delivery" | "contacts" | "payment" | "summary" | "agreements" | "delivery_info";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "Основные" },
  { id: "delivery", label: "Доставка" },
  { id: "contacts", label: "Контакты" },
  { id: "payment", label: "Оплата и промокоды" },
  { id: "summary", label: "Итоги заказа" },
  { id: "agreements", label: "Согласия" },
  { id: "delivery_info", label: "Инфо о доставке" },
];

export function CheckoutEditor({ apiKey }: CheckoutEditorProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<CheckoutSettings>(DEFAULT_CHECKOUT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const res = await fetch("/api/page-settings/checkout");
      const data = await res.json();
      if (data?.checkout_data) {
        const parsed = typeof data.checkout_data === "string" ? JSON.parse(data.checkout_data) : data.checkout_data;
        setSettings({ ...DEFAULT_CHECKOUT_SETTINGS, ...parsed });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    try {
      setSaving(true);
      await adminFetch("/api/admin/page-settings/checkout/checkout_data", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings", "checkout"] });
      toast({ title: "Настройки чекаута сохранены" });
    } catch (err: any) {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    setSettings(DEFAULT_CHECKOUT_SETTINGS);
    toast({ title: "Сброшено к значениям по умолчанию" });
  }

  const update = <K extends keyof CheckoutSettings>(key: K, value: CheckoutSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const updateDeliveryItem = (idx: number, field: keyof DeliveryInfoItem, value: any) => {
    const items = [...settings.retailDeliveryInfoItems];
    items[idx] = { ...items[idx], [field]: value };
    update("retailDeliveryInfoItems", items);
  };

  const addDeliveryItem = () => {
    update("retailDeliveryInfoItems", [...settings.retailDeliveryInfoItems, { text: "", visible: true }]);
  };

  const removeDeliveryItem = (idx: number) => {
    update("retailDeliveryInfoItems", settings.retailDeliveryInfoItems.filter((_, i) => i !== idx));
  };

  const moveDeliveryItem = (idx: number, dir: -1 | 1) => {
    const items = [...settings.retailDeliveryInfoItems];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= items.length) return;
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    update("retailDeliveryInfoItems", items);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  function renderField(label: string, key: keyof CheckoutSettings, type: "input" | "textarea" = "input") {
    const value = settings[key];
    if (typeof value !== "string") return null;
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {type === "textarea" ? (
          <Textarea
            value={value}
            onChange={(e) => update(key, e.target.value as any)}
            rows={3}
            data-testid={`input-checkout-${key}`}
          />
        ) : (
          <Input
            value={value}
            onChange={(e) => update(key, e.target.value as any)}
            data-testid={`input-checkout-${key}`}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-medium text-foreground">Редактор страницы оформления заказа</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefaults} data-testid="button-checkout-reset">
            <RotateCcw className="w-4 h-4 mr-1" /> Сбросить
          </Button>
          <Button size="sm" onClick={saveSettings} disabled={saving} data-testid="button-checkout-save">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {SECTIONS.map(sec => (
          <Button
            key={sec.id}
            size="sm"
            variant={activeSection === sec.id ? "secondary" : "ghost"}
            onClick={() => setActiveSection(sec.id)}
            data-testid={`button-checkout-section-${sec.id}`}
          >
            {sec.label}
          </Button>
        ))}
      </div>

      {activeSection === "general" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Основные тексты</h4>
            {renderField("Заголовок страницы", "pageTitle")}
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Экран успешного заказа</p>
              {renderField("Заголовок", "successTitle")}
              {renderField("Описание", "successDescription", "textarea")}
              {renderField("Текст кнопки", "successButtonText")}
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Пустая корзина</p>
              {renderField("Текст загрузки", "emptyCartText")}
              {renderField("Текст кнопки", "emptyCartButtonText")}
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Заголовки секций</p>
              {renderField("Секция доставки (розница)", "deliverySectionTitle")}
              {renderField("Секция доставки (опт)", "deliverySectionTitleWholesale")}
              {renderField("Секция оплаты", "paymentSectionTitle")}
              {renderField("Секция контактов", "contactsSectionTitle")}
              {renderField("Секция итогов", "orderSummaryTitle")}
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === "delivery" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Настройки доставки</h4>
            {renderField("Название СДЭК", "cdekOptionTitle")}
            {renderField("Описание СДЭК", "cdekOptionDescription")}
            {renderField("Подпись поиска города", "citySearchLabel")}
            {renderField("Плейсхолдер поиска города", "citySearchPlaceholder")}
            {renderField("Подпись ПВЗ", "pvzLabel")}
            {renderField("Подпись выбранного пункта", "selectedPointLabel")}
            {renderField("Подпись стоимости доставки", "deliveryCostLabel")}
            {renderField("Подсказка: выберите город", "selectCityHint")}
            {renderField("Подсказка: выберите ПВЗ", "selectPointHint")}
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Бесплатная доставка</p>
              <div className="flex items-center gap-3 mb-3">
                <Switch
                  checked={settings.showFreeDeliveryBanner}
                  onCheckedChange={(v) => update("showFreeDeliveryBanner", v)}
                  data-testid="switch-free-delivery"
                />
                <Label className="text-sm">Показывать баннер о бесплатной доставке</Label>
              </div>
              {renderField("Текст (используйте {threshold} для суммы)", "freeDeliveryText")}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Порог бесплатной доставки (в копейках)</Label>
                <Input
                  type="number"
                  value={settings.freeDeliveryThreshold}
                  onChange={(e) => update("freeDeliveryThreshold", Number(e.target.value))}
                  data-testid="input-checkout-freeDeliveryThreshold"
                />
                <p className="text-xs text-muted-foreground">= {(settings.freeDeliveryThreshold / 100).toLocaleString("ru-RU")} руб.</p>
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Оптовые заказы</p>
              {renderField("Бейдж", "wholesaleBadgeText")}
              {renderField("Заголовок транспортных компаний", "wholesaleTransportTitle")}
              {renderField("Описание транспортных компаний", "wholesaleTransportDescription")}
              {renderField("Текст минимального заказа", "wholesaleMinOrderText")}
              {renderField("Описание поля адреса (опт)", "addressWholesaleDescription")}
              {renderField("Плейсхолдер адреса (опт)", "addressPlaceholder")}
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === "contacts" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Поля формы</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {renderField("Подпись имени", "nameLabel")}
              {renderField("Плейсхолдер имени", "namePlaceholder")}
              {renderField("Подпись email", "emailLabel")}
              {renderField("Плейсхолдер email", "emailPlaceholder")}
              {renderField("Подпись телефона", "phoneLabel")}
              {renderField("Плейсхолдер телефона", "phonePlaceholder")}
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Кнопка отправки</p>
              {renderField("Текст кнопки (после · будет добавлена сумма)", "submitButtonText")}
            </div>
          </CardContent>
        </Card>
      )}

      {activeSection === "payment" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Промокоды и сертификаты</h4>
            {renderField("Подпись промокода", "promoCodeLabel")}
            {renderField("Плейсхолдер промокода", "promoCodePlaceholder")}
            {renderField("Кнопка применить (промокод)", "promoCodeApplyText")}
            <div className="border-t pt-4" />
            {renderField("Подпись подарочного сертификата", "giftCardLabel")}
            {renderField("Плейсхолдер сертификата", "giftCardPlaceholder")}
            {renderField("Кнопка применить (сертификат)", "giftCardApplyText")}
          </CardContent>
        </Card>
      )}

      {activeSection === "summary" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Подписи в блоке итогов</h4>
            {renderField("Сумма", "summarySubtotalLabel")}
            {renderField("Скидка по промокоду", "summaryPromoLabel")}
            {renderField("Накопительная скидка", "summaryLoyaltyLabel")}
            {renderField("Подарочный сертификат", "summaryGiftCardLabel")}
            {renderField("Доставка (розница)", "summaryDeliveryLabel")}
            {renderField("Доставка (опт) — подпись", "summaryDeliveryLabelWholesale")}
            {renderField("Доставка (опт) — значение", "summaryDeliveryWholesaleValue")}
            {renderField("Итого", "summaryTotalLabel")}
          </CardContent>
        </Card>
      )}

      {activeSection === "agreements" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Тексты согласий</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {renderField("Текст перед ссылкой на оферту", "offerAgreementText")}
              {renderField("Текст ссылки на оферту", "offerLinkText")}
              {renderField("URL оферты", "offerLinkUrl")}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {renderField("Текст перед ссылкой на политику", "policyAgreementText")}
              {renderField("Текст ссылки на политику", "policyLinkText")}
              {renderField("URL политики", "policyLinkUrl")}
            </div>
            {renderField("Текст согласия на обработку данных", "consentText", "textarea")}
          </CardContent>
        </Card>
      )}

      {activeSection === "delivery_info" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h4 className="font-medium text-sm text-foreground">Диалог «Информация о доставке»</h4>
            {renderField("Текст кнопки", "deliveryInfoButtonText")}
            {renderField("Заголовок диалога", "deliveryInfoTitle")}
            
            <div className="border-t pt-4">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <p className="text-xs font-medium text-muted-foreground">Пункты для розничных клиентов ({settings.retailDeliveryInfoItems.length})</p>
                <Button size="sm" variant="outline" onClick={addDeliveryItem} data-testid="button-add-delivery-info">
                  <Plus className="w-4 h-4 mr-1" /> Добавить
                </Button>
              </div>
              
              {settings.retailDeliveryInfoItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Нет пунктов</p>
              ) : (
                <div className="space-y-3">
                  {settings.retailDeliveryInfoItems.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-3 border rounded-md">
                      <div className="flex-1">
                        <Textarea
                          value={item.text}
                          onChange={(e) => updateDeliveryItem(idx, "text", e.target.value)}
                          rows={2}
                          data-testid={`input-delivery-info-${idx}`}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Switch
                          checked={item.visible}
                          onCheckedChange={(v) => updateDeliveryItem(idx, "visible", v)}
                          data-testid={`switch-delivery-info-${idx}`}
                        />
                        {idx > 0 && (
                          <Button size="icon" variant="ghost" onClick={() => moveDeliveryItem(idx, -1)} data-testid={`button-delivery-info-up-${idx}`}>
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                        )}
                        {idx < settings.retailDeliveryInfoItems.length - 1 && (
                          <Button size="icon" variant="ghost" onClick={() => moveDeliveryItem(idx, 1)} data-testid={`button-delivery-info-down-${idx}`}>
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => removeDeliveryItem(idx)} data-testid={`button-delivery-info-remove-${idx}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Текст для оптовых клиентов</p>
              {renderField("Текст информации о доставке (опт)", "wholesaleDeliveryInfoText", "textarea")}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
