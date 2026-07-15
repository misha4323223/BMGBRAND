import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Upload, Loader2 } from "lucide-react";

function getVideoPreviewType(url: string): "youtube" | "vk" | "file" {
  const s = url.trim();
  if (s.includes("youtube.com") || s.includes("youtu.be")) return "youtube";
  if (s.includes("vk.com") || s.includes("vkvideo") || s.includes("vk.ru")) return "vk";
  return "file";
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

export function VideoUploadField({ value, onChange, apiKey, placeholder }: {
  value: string;
  onChange: (url: string) => void;
  apiKey: string;
  placeholder?: string;
}) {
  return <MediaUploadField value={value} onChange={onChange} apiKey={apiKey} placeholder={placeholder} type="video" />;
}
