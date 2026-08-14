/**
 * VirtualTryOn — кнопка + диалог AR-примерки (OOTDiffusion / HF Spaces)
 *
 * Чтобы удалить фичу целиком:
 *   - Удалить этот файл
 *   - Удалить server/virtual-tryon.ts
 *   - Убрать <VirtualTryOn> из ProductDetail.tsx
 *   - Убрать registerVirtualTryOnRoutes из server/index.ts
 */

import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Upload, X, Loader2, Download, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type TryOnCategory = "upper" | "lower" | "dress";

interface VirtualTryOnProps {
  /** Все фото товара — пользователь выберет нужное */
  garmentImages: string[];
  /** Название товара для подписей */
  productName?: string;
  /** Подсказка категории одежды от карточки товара */
  defaultCategory?: TryOnCategory;
}

type Stage = "idle" | "uploading" | "processing" | "done" | "error";

/**
 * Сжимает фото в браузере до JPEG (canvas). Нужно, чтобы запрос гарантированно
 * влезал в лимит 3.5 МБ на размер тела запроса Yandex Serverless Container —
 * иначе инфраструктура отбивает запрос кодом 413 ещё до сервера.
 * Модели для примерки большие фото не нужны: 1280px по большей стороне — с запасом.
 */
async function compressImage(file: File, maxEdge: number, quality: number): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать изображение")); };
    image.src = url;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");

  // Белый фон — JPEG не поддерживает прозрачность (для фото человека это неважно)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Не удалось сжать изображение");

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

/** Пытаемся ужать фото до безопасного размера; если не выходит — отдаём оригинал. */
async function preparePhoto(file: File): Promise<File> {
  // Уже небольшое фото — отправляем как есть (быстрее и без потери качества)
  if (file.size <= 2_500_000) return file;

  const steps: Array<{ maxEdge: number; quality: number }> = [
    { maxEdge: 1280, quality: 0.85 },
    { maxEdge: 800, quality: 0.75 },
  ];

  let last: File = file;
  for (const step of steps) {
    last = await compressImage(file, step.maxEdge, step.quality);
    if (last.size <= 2_000_000) return last;
  }
  return last;
}

export function VirtualTryOn({ garmentImages, productName, defaultCategory }: VirtualTryOnProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TryOnCategory>(defaultCategory ?? "upper");
  const [stage, setStage] = useState<Stage>("idle");
  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [selectedGarmentIdx, setSelectedGarmentIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: settings } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/virtual-tryon/enabled"],
    queryFn: async () => {
      const response = await fetch("/api/virtual-tryon/enabled");
      if (!response.ok) throw new Error("Не удалось получить настройки АР-примерки");
      return response.json() as Promise<{ enabled: boolean }>;
    },
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const garmentUrl = garmentImages[selectedGarmentIdx] ?? garmentImages[0];

  const reset = useCallback(() => {
    setStage("idle");
    setPersonPreview(null);
    setPersonFile(null);
    setResultUrl(null);
    setErrorMsg("");
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Сбрасываем через небольшую задержку (после анимации закрытия)
    setTimeout(reset, 300);
  }, [reset]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const ready = await preparePhoto(file);
        setPersonFile(ready);
        setPersonPreview(URL.createObjectURL(ready));
        setStage("idle");
        setResultUrl(null);
        setErrorMsg("");
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStage("error");
      }
    })();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    void (async () => {
      try {
        const ready = await preparePhoto(file);
        setPersonFile(ready);
        setPersonPreview(URL.createObjectURL(ready));
        setStage("idle");
        setResultUrl(null);
        setErrorMsg("");
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStage("error");
      }
    })();
  }, []);

  const handleTryOn = useCallback(async () => {
    if (!personFile || !garmentUrl) return;

    setStage("uploading");
    setElapsed(0);
    setErrorMsg("");
    setResultUrl(null);

    // Запускаем таймер
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      const fd = new FormData();
      fd.append("personPhoto", personFile);
      fd.append("garmentUrl", garmentUrl);
      fd.append("category", category);

      setStage("processing");

      const res = await fetch("/api/virtual-tryon", {
        method: "POST",
        body: fd,
      });

      const data = await res.json() as { resultUrl?: string; error?: string };

      if (!res.ok || data.error) {
        throw new Error(data.error || `Ошибка сервера (${res.status})`);
      }
      if (!data.resultUrl) throw new Error("Сервер не вернул результат");

      setResultUrl(data.resultUrl);
      setStage("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStage("error");
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [personFile, garmentUrl, category]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "примерка.png";
      a.click();
    } catch {
      window.open(resultUrl, "_blank");
    }
  }, [resultUrl]);

  const isLoading = stage === "uploading" || stage === "processing";

  const formatElapsed = (s: number) =>
    s < 60 ? `${s} сек` : `${Math.floor(s / 60)} мин ${s % 60} сек`;

  // Не показываем функцию, пока сервер не подтвердил, что она включена.
  // Это также скрывает кнопку при ошибке/недоступности настройки.
  if (settings?.enabled !== true) return null;

  return (
    <>
      {/* Кнопка-триггер */}
      <button
        onClick={() => setOpen(true)}
        className="w-full h-11 flex items-center justify-center gap-2 text-sm font-medium rounded-full border border-foreground/20 text-foreground/80 hover:border-foreground/40 hover:text-foreground transition-all active:scale-[0.98]"
      >
        <Sparkles className="w-4 h-4" />
        Примерить на себе (AI)
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!v && !isLoading) handleClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI-примерка
            </DialogTitle>
            <DialogDescription>
              Загрузите своё фото — нейросеть покажет, как будет смотреться товар на вас.
              {productName && <span className="block mt-0.5 text-foreground/60 text-xs">Товар: {productName}</span>}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-5">

            {/* ── Шаг 1: Загрузка фото ── */}
            {stage !== "done" && (
              <div>
                <p className="text-sm font-medium mb-2">1. Ваше фото</p>
                {personPreview ? (
                  <div className="relative inline-block">
                    <img
                      src={personPreview}
                      alt="Ваше фото"
                      className="h-48 w-auto rounded-lg object-cover border border-border"
                    />
                    <button
                      onClick={() => { setPersonPreview(null); setPersonFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-xs hover:bg-destructive/90"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  >
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    <div className="text-center">
                      <p className="text-sm font-medium">Перетащите или нажмите для выбора</p>
                      <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP · фото сожмётся автоматически</p>
                    </div>
                    <Button variant="outline" size="sm" type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                      <Camera className="w-4 h-4 mr-2" />
                      Выбрать фото
                    </Button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Лучший результат — фото в полный рост на нейтральном фоне, одежда плотно прилегает
                </p>
              </div>
            )}

            {/* ── Шаг 2: Выбор фото товара ── */}
            {stage !== "done" && (
              <div>
                <p className="text-sm font-medium mb-2">2. Фото товара для примерки</p>
                {garmentImages.length > 1 ? (
                  <div className="space-y-2">
                    <div className="flex gap-2 flex-wrap">
                      {garmentImages.map((url, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedGarmentIdx(idx)}
                          className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                            selectedGarmentIdx === idx
                              ? "border-primary ring-2 ring-primary/30"
                              : "border-border hover:border-foreground/30"
                          }`}
                        >
                          <img
                            src={url}
                            alt={`Фото ${idx + 1}`}
                            className="w-full h-full object-cover"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                          {selectedGarmentIdx === idx && (
                            <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                              <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      💡 Выберите фото без модели (предметная съёмка) — результат будет точнее
                    </p>
                  </div>
                ) : (
                  <img
                    src={garmentUrl}
                    alt="Товар"
                    className="h-32 w-auto rounded-lg object-contain border border-border bg-muted/20"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
              </div>
            )}

            {/* ── Шаг 3: Тип одежды ── */}
            {stage !== "done" && (
              <div>
                <p className="text-sm font-medium mb-2">3. Тип одежды</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: "upper", label: "Верх", hint: "футболки, худи, куртки" },
                    { value: "lower", label: "Низ", hint: "шорты, брюки" },
                    { value: "dress", label: "Платье", hint: "платья" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCategory(opt.value)}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2.5 text-center transition-all ${
                        category === opt.value
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                      }`}
                    >
                      <span className="text-sm font-medium">{opt.label}</span>
                      <span className="text-[10px] opacity-70">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Загрузка ── */}
            {isLoading && (
              <div className="rounded-xl bg-muted/40 p-6 flex flex-col items-center gap-3 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">
                    {stage === "uploading" ? "Загружаем фото..." : "Нейросеть примеряет одежду..."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stage === "processing"
                      ? `Это занимает 30–90 секунд · прошло ${formatElapsed(elapsed)}`
                      : "Подождите секунду"}
                  </p>
                </div>
                {stage === "processing" && (
                  <div className="w-full max-w-xs bg-border rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(95, (elapsed / 90) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Ошибка ── */}
            {stage === "error" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive mb-1">Не удалось выполнить примерку</p>
                <p className="text-xs text-muted-foreground">{errorMsg}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => { setStage("idle"); setErrorMsg(""); }}>
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Попробовать снова
                </Button>
              </div>
            )}

            {/* ── Результат ── */}
            {stage === "done" && resultUrl && (
              <div className="space-y-4">
                <p className="text-sm font-medium">Результат примерки</p>
                <div className="flex gap-4 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-xs text-muted-foreground mb-1.5">Вы</p>
                    {personPreview && (
                      <img src={personPreview} alt="Вы" className="w-full max-h-80 object-contain rounded-lg border border-border" />
                    )}
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-xs text-muted-foreground mb-1.5">В образе</p>
                    <img src={resultUrl} alt="Результат примерки" className="w-full max-h-80 object-contain rounded-lg border border-border" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  AI-примерка — приблизительная. Цвет, посадка и пропорции могут отличаться от реального товара.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button onClick={handleDownload} variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Скачать фото
                  </Button>
                  <Button onClick={reset} variant="ghost" size="sm">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Попробовать другое фото
                  </Button>
                </div>
              </div>
            )}

            {/* ── Кнопка запуска ── */}
            {(stage === "idle") && personFile && (
              <Button onClick={handleTryOn} className="w-full" size="lg">
                <Sparkles className="w-4 h-4 mr-2" />
                Начать примерку
              </Button>
            )}

            {stage === "idle" && !personFile && (
              <p className="text-center text-sm text-muted-foreground">
                Загрузите своё фото, чтобы начать
              </p>
            )}

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
