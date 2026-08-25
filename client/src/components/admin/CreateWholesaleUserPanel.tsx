import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, UserPlus } from "lucide-react";

interface Props {
  apiKey: string;
  onCreated: () => void; // callback to refetch the wholesale users list
}

interface FormState {
  email: string;
  password: string;
  name: string;
  companyName: string;
  inn: string;
  kpp: string;
  legalAddress: string;
  storeName: string;
  storeAddress: string;
  contactPerson: string;
  contactPhone: string;
}

const emptyForm: FormState = {
  email: "",
  password: "",
  name: "",
  companyName: "",
  inn: "",
  kpp: "",
  legalAddress: "",
  storeName: "",
  storeAddress: "",
  contactPerson: "",
  contactPhone: "",
};

export default function CreateWholesaleUserPanel({ apiKey, onCreated }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function reset() {
    setForm(emptyForm);
    setError("");
  }

  async function handleCreate() {
    setError("");

    // Client-side validation
    const email = form.email.trim();
    if (!email || !form.password || !form.name.trim() || !form.companyName.trim() || !form.inn.trim()) {
      setError("Заполните email, пароль, имя, компанию и ИНН");
      return;
    }
    if (form.password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return;
    }
    if (form.inn.trim().length < 10 || form.inn.trim().length > 12) {
      setError("ИНН должен быть 10 или 12 цифр");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/wholesale-users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          email,
          password: form.password,
          name: form.name.trim(),
          companyName: form.companyName.trim(),
          inn: form.inn.trim(),
          kpp: form.kpp.trim() || undefined,
          legalAddress: form.legalAddress.trim() || undefined,
          storeName: form.storeName.trim() || undefined,
          storeAddress: form.storeAddress.trim() || undefined,
          contactPerson: form.contactPerson.trim() || form.name.trim(),
          contactPhone: form.contactPhone.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      toast({ title: "Оптовый покупатель создан", description: data.user?.email || email });
      reset();
      onCreated();
    } catch (e: any) {
      const message = e?.message || "Неизвестная ошибка";
      setError(message);
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border border-zinc-800 bg-zinc-900 text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          Создать оптового покупателя
        </CardTitle>
        <CardDescription className="text-xs text-zinc-400">
          Аккаунт создаётся сразу подтверждённым — без подтверждения email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Row 1 */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Email <span className="text-red-400">*</span>
            </label>
            <Input
              type="email"
              value={form.email}
              onChange={update("email")}
              placeholder="partner@example.com"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Пароль <span className="text-red-400">*</span>
            </label>
            <Input
              type="password"
              value={form.password}
              onChange={update("password")}
              placeholder="Минимум 6 символов"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Row 2 */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Имя контактного лица <span className="text-red-400">*</span>
            </label>
            <Input
              value={form.name}
              onChange={update("name")}
              placeholder="Иван Петров"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Компания <span className="text-red-400">*</span>
            </label>
            <Input
              value={form.companyName}
              onChange={update("companyName")}
              placeholder="ООО Магазин"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Row 3 */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              ИНН <span className="text-red-400">*</span>
            </label>
            <Input
              value={form.inn}
              onChange={update("inn")}
              placeholder="10 или 12 цифр"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">КПП</label>
            <Input
              value={form.kpp}
              onChange={update("kpp")}
              placeholder="9 цифр"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Row 4 — optional fields, collapsed by default feel, but all visible */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Юр. адрес</label>
            <Input
              value={form.legalAddress}
              onChange={update("legalAddress")}
              placeholder="г. Москва, ул. ..."
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Название магазина</label>
            <Input
              value={form.storeName}
              onChange={update("storeName")}
              placeholder="Мой магазин"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>

          {/* Row 5 */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Адрес магазина</label>
            <Input
              value={form.storeAddress}
              onChange={update("storeAddress")}
              placeholder="г. Москва, ул. ..."
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Телефон</label>
            <Input
              value={form.contactPhone}
              onChange={update("contactPhone")}
              placeholder="+7 999 123-45-67"
              className="h-8 text-sm bg-zinc-800 border-zinc-700"
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 mt-3">{error}</p>
        )}

        <div className="flex gap-2 mt-4">
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Plus className="w-4 h-4 mr-1" />
            )}
            Создать
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={reset}
            disabled={saving}
          >
            Очистить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}