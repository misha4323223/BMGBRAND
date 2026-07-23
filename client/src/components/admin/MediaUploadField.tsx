import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Upload, Loader2, ImagePlus } from "lucide-react";

function getVideoPreviewType(url: string): "youtube" | "vk" | "file" {
  const s = url.trim();
  if (s.includes("youtube.com") || s.includes("youtu.be")) return "youtube";
  if (s.includes("vk.com") || s.includes("vkvideo") || s.includes("vk.ru")) return "vk";
  return "file";
}

/** Извлекает первый кадр из локального File (без CORS). Работает всегда. */
async function extractFrameFromFile(file: File, timeSeconds = 0.5): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await _extractFrame(objectUrl, timeSeconds, false);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Извлекает кадр из URL (нужен CORS на сервере). */
async function extractFrameFromUrl(src: string, timeSeconds = 0.5): Promise<Blob | null> {
  return _extractFrame(src, timeSeconds, true);
}

function _extractFrame(src: string, timeSeconds: number, useCors: boolean): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    if (useCors) video.crossOrigin = "anonymous";

    let settled = false;
    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.src = "";
      video.load();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), 12000);

    video.addEventListener("loadeddata", () => {
      const t = video.duration > 0 ? Math.min(timeSeconds, video.duration - 0.01) : 0;
      video.currentTime = Math.max(0, t);
    }, { once: true });

    video.addEventListener("seeked", () => {
      try {
        const maxW = 800;
        const ratio = Math.min(1, maxW / (video.videoWidth || maxW));
        const w = Math.round((video.videoWidth || 800) * ratio);
        const h = Math.round((video.videoHeight || 600) * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.85);
      } catch {
        finish(null);
      }
    }, { once: true });

    video.addEventListener("error", () => finish(null), { once: true });
    video.src = src;
    video.load();
  });
}

/** Загружает JPEG-blob как превью в Yandex Storage через admin endpoint. */
async function uploadThumbnailBlob(blob: Blob, apiKey: string): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener("load", () => {
      try { resolve(JSON.parse(xhr.responseText)?.url ?? null); } catch { resolve(null); }
    });
    xhr.addEventListener("error", () => resolve(null));
    xhr.open("POST", "/api/admin/upload-image");
    xhr.setRequestHeader("Content-Type", "image/jpeg");
    xhr.setRequestHeader("X-API-Key", apiKey);
    xhr.setRequestHeader("X-Filename", `thumb_${Date.now()}.jpg`);
    xhr.send(blob);
  });
}

export function MediaUploadField({ value, onChange, apiKey, placeholder, accept, type = "image", hint }: {
  value: string;
  onChange: (url: string) => void;
  apiKey: string;
  placeholder?: string;
  accept?: string;
  type?: "image" | "video";
  hint?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);

  const uploadFile = async (file: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const buffer = await file.arrayBuffer();
      const endpoint = type === "video" ? "/api/admin/upload-video" : "/api/admin/upload-image";

      const xhr = new XMLHttpRequest();
      const result = await new Promise<any>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Parse error")); }
        });
        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
        xhr.open("POST", endpoint);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.setRequestHeader("X-API-Key", apiKey);
        xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
        xhr.send(buffer);
      });

      if (result.url) {
        onChange(result.url);
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const isAccepted = (file: File) => {
    if (type === "video") return file.type.startsWith("video/");
    return file.type.startsWith("image/");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && isAccepted(file)) {
      uploadFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const fileAccept = accept || (type === "video" ? "video/mp4,video/webm,video/quicktime" : "image/*");

  if (type === "video") {
    const previewType = value ? getVideoPreviewType(value) : null;
    return (
      <div className="space-y-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "Вставьте ссылку ВКонтакте, YouTube или прямой URL видео"}
          className="text-sm"
        />
        {!value && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-md transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
          >
            {uploading ? (
              <div className="flex flex-col items-center justify-center py-4 gap-2 text-sm text-muted-foreground px-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Загрузка видео... {progress}%
                </div>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center py-4 gap-1 cursor-pointer text-sm text-muted-foreground">
                <Upload className="w-4 h-4" />
                <span>или загрузите файл с компьютера (MP4, WebM, до 100MB)</span>
                <input type="file" accept={fileAccept} onChange={handleFileSelect} className="sr-only" />
              </label>
            )}
          </div>
        )}
        {value && (
          <div className="space-y-2">
            <div className="border rounded-md overflow-hidden bg-muted/30">
              {previewType === "youtube" && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <span className="text-red-500 font-bold text-xs bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded">YouTube</span>
                  <span className="truncate">{value}</span>
                </div>
              )}
              {previewType === "vk" && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <span className="text-blue-500 font-bold text-xs bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded">ВКонтакте</span>
                  <span className="truncate">{value}</span>
                </div>
              )}
              {previewType === "file" && (
                <video src={value} className="w-full h-32 object-cover" muted controls />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onChange("")}>
                <Trash2 className="w-3 h-3 mr-1" /> Убрать
              </Button>
            </div>
          </div>
        )}
        {hint && !value && (
          <p className="text-[11px] text-muted-foreground/70">{hint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-md p-3 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
      >
        {uploading ? (
          <div className="flex items-center justify-center py-3 gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || "URL или перетащите изображение сюда"}
              className="border-0 p-0 h-auto focus-visible:ring-0 text-sm"
            />
            <input
              type="file"
              accept={fileAccept}
              onChange={handleFileSelect}
              className="absolute inset-0 opacity-0 cursor-pointer"
              style={{ pointerEvents: value ? 'none' : 'auto' }}
            />
          </>
        )}
      </div>
      {hint && !value && (
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>
      )}
      {value && (
        <div className="flex items-center gap-2">
          <img src={value} alt="Preview" className="w-16 h-16 object-cover rounded-md" />
          <label className="inline-flex items-center cursor-pointer">
            <Button size="sm" variant="outline" asChild>
              <span>
                <Upload className="w-3 h-3 mr-1" /> Заменить
              </span>
            </Button>
            <input
              type="file"
              accept={fileAccept}
              onChange={handleFileSelect}
              className="sr-only"
            />
          </label>
          <Button size="sm" variant="outline" onClick={() => onChange("")}>
            <Trash2 className="w-3 h-3 mr-1" /> Убрать
          </Button>
        </div>
      )}
    </div>
  );
}

export function ImageUploadField({ value, onChange, apiKey, placeholder, hint }: {
  value: string;
  onChange: (url: string) => void;
  apiKey: string;
  placeholder?: string;
  hint?: string;
}) {
  return <MediaUploadField value={value} onChange={onChange} apiKey={apiKey} placeholder={placeholder} type="image" hint={hint} />;
}

export function VideoUploadField({ value, onChange, apiKey, placeholder, onThumbnailGenerated }: {
  value: string;
  onChange: (url: string) => void;
  apiKey: string;
  placeholder?: string;
  /** Вызывается с URL автоматически сгенерированного превью */
  onThumbnailGenerated?: (thumbnailUrl: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [thumbStatus, setThumbStatus] = useState<"idle" | "extracting" | "ok" | "error">("idle");

  const previewType = value ? getVideoPreviewType(value) : null;

  const uploadFile = async (file: File) => {
    setUploading(true);
    setProgress(0);
    setThumbStatus("idle");

    // Параллельно: (1) загружаем видео, (2) извлекаем кадр из локального файла
    const thumbPromise = onThumbnailGenerated
      ? extractFrameFromFile(file, 0.5).then(blob =>
          blob ? uploadThumbnailBlob(blob, apiKey) : null
        )
      : Promise.resolve(null);

    try {
      const xhr = new XMLHttpRequest();
      const result = await new Promise<any>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Parse error")); }
        });
        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
        xhr.open("POST", "/api/admin/upload-video");
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.setRequestHeader("X-API-Key", apiKey);
        xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
        // Отправляем File напрямую — не нужно читать весь ArrayBuffer в память
        xhr.send(file);
      });

      if (result.url) {
        onChange(result.url);
      }

      // Дожидаемся превью
      if (onThumbnailGenerated) {
        setThumbStatus("extracting");
        const thumbUrl = await thumbPromise;
        if (thumbUrl) {
          onThumbnailGenerated(thumbUrl);
          setThumbStatus("ok");
        } else {
          setThumbStatus("error");
        }
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("video/")) uploadFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // Сбрасываем input чтобы можно было выбрать тот же файл повторно
    e.target.value = "";
  };

  /** Извлечь превью через сервер (ffmpeg) — без CORS, работает для любых URL */
  const handleExtractFromUrl = async () => {
    if (!value || !onThumbnailGenerated) return;
    setThumbStatus("extracting");
    try {
      const res = await fetch("/api/admin/extract-video-thumbnail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({ videoUrl: value }),
      });
      const data = await res.json();
      if (data.url) {
        onThumbnailGenerated(data.url);
        setThumbStatus("ok");
      } else {
        setThumbStatus("error");
      }
    } catch {
      setThumbStatus("error");
    }
  };

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Вставьте ссылку ВКонтакте, YouTube или прямой URL видео"}
        className="text-sm"
      />

      {!value && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-md transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
        >
          {uploading ? (
            <div className="flex flex-col items-center justify-center py-4 gap-2 text-sm text-muted-foreground px-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {thumbStatus === "extracting" ? "Видео загружено, извлекаю превью..." : `Загрузка видео... ${progress}%`}
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center py-4 gap-1 cursor-pointer text-sm text-muted-foreground">
              <Upload className="w-4 h-4" />
              <span>или загрузите файл с компьютера (MP4, WebM, до 100MB)</span>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={handleFileSelect}
                className="sr-only"
              />
            </label>
          )}
        </div>
      )}

      {value && (
        <div className="space-y-2">
          <div className="border rounded-md overflow-hidden bg-muted/30">
            {previewType === "youtube" && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <span className="text-red-500 font-bold text-xs bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded">YouTube</span>
                <span className="truncate">{value}</span>
              </div>
            )}
            {previewType === "vk" && (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <span className="text-blue-500 font-bold text-xs bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded">ВКонтакте</span>
                <span className="truncate">{value}</span>
              </div>
            )}
            {previewType === "file" && (
              <video src={value} className="w-full h-32 object-cover" muted controls playsInline />
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => { onChange(""); setThumbStatus("idle"); }}>
              <Trash2 className="w-3 h-3 mr-1" /> Убрать
            </Button>

            {/* Кнопка «Извлечь превью» — только для прямых файлов */}
            {onThumbnailGenerated && previewType === "file" && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleExtractFromUrl}
                disabled={thumbStatus === "extracting"}
                title="Автоматически извлечь обложку из первого кадра видео"
              >
                {thumbStatus === "extracting" ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <ImagePlus className="w-3 h-3 mr-1" />
                )}
                {thumbStatus === "ok" ? "Превью обновлено ✓" : thumbStatus === "error" ? "Ошибка — загрузите вручную" : "Извлечь превью"}
              </Button>
            )}

            {/* Загрузить новое видео поверх */}
            <label className="inline-flex">
              <Button size="sm" variant="outline" asChild>
                <span>
                  <Upload className="w-3 h-3 mr-1" /> Заменить
                </span>
              </Button>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={handleFileSelect}
                className="sr-only"
              />
            </label>
          </div>

          {thumbStatus === "error" && (
            <p className="text-[11px] text-amber-500">
              Не удалось извлечь кадр автоматически. Загрузите обложку вручную в поле «Обложка».
            </p>
          )}
        </div>
      )}
    </div>
  );
}
