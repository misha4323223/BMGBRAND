import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Loader2, Package, TrendingUp, ShoppingBag, BarChart2, Percent,
  BadgeDollarSign, ExternalLink, Save,
  X, ImageIcon, Plus, GripVertical, Globe, Eye, EyeOff, Users,
  Monitor, Smartphone, Pencil, Trash2, Upload,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ArtistProduct {
  id: number;
  name: string;
  slug: string | null;
  price: number;
  discountPercent: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  subcategory: string | null;
  sku: string | null;
  artistSlug: string | null;
  isHidden?: boolean;
  artistOnly?: boolean;
  images?: string[];
  sizes?: string[];
  sizeStock?: Record<string, number>;
  composition?: string | null;
  description?: string | null;
}

interface MyProductForm {
  name: string;
  description: string;
  price: string;
  images: string[];
  sizes: string[];
  sizeStock: Record<string, number>;
  category: string;
  composition: string;
}

const EMPTY_PRODUCT_FORM: MyProductForm = {
  name: "", description: "", price: "", images: [],
  sizes: [], sizeStock: {}, category: "merch", composition: "",
};

const COMMON_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "ONE SIZE"];

function MyProductDialog({
  open, onClose, editing, partnerSlug,
}: {
  open: boolean; onClose: () => void; editing: ArtistProduct | null; partnerSlug: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<MyProductForm>(EMPTY_PRODUCT_FORM);
  const [uploading, setUploading] = useState(false);
  const [newSize, setNewSize] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name || "",
        description: editing.description || "",
        price: editing.price ? String(editing.price / 100) : "",
        images: Array.isArray(editing.images) ? editing.images : (editing.imageUrl ? [editing.imageUrl] : []),
        sizes: Array.isArray(editing.sizes) ? editing.sizes : [],
        sizeStock: editing.sizeStock || {},
        category: editing.category || "merch",
        composition: editing.composition || "",
      });
    } else {
      setForm(EMPTY_PRODUCT_FORM);
    }
  }, [editing, open]);

  const saveMutation = useMutation({
    mutationFn: async (data: MyProductForm) => {
      const payload = {
        name: data.name.trim(),
        description: data.description.trim(),
        price: parseFloat(data.price),
        images: data.images,
        sizes: data.sizes,
        sizeStock: data.sizeStock,
        category: data.category,
        composition: data.composition,
      };
      if (editing) {
        return apiRequest("PUT", `/api/partner/my-products/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/partner/my-products", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/my-products"] });
      toast({ title: editing ? "Товар обновлён" : "Товар создан", description: "Он появится на вашей странице" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Ошибка", description: e?.message || "Попробуйте снова", variant: "destructive" }),
  });

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const res = await fetch("/api/partner/my-products/upload-image", {
        method: "POST",
        headers: { "content-type": file.type, "x-filename": encodeURIComponent(file.name) },
        body: file,
        credentials: "include",
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error("Неверный ответ сервера"); }
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setForm(p => ({ ...p, images: [...p.images, data.url] }));
    } catch (e: any) {
      toast({ title: "Ошибка загрузки", description: e?.message || "Попробуйте ещё раз", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function removeImage(idx: number) {
    setForm(p => ({ ...p, images: p.images.filter((_, i) => i !== idx) }));
  }

  function toggleSize(s: string) {
    setForm(p => {
      const has = p.sizes.includes(s);
      const sizes = has ? p.sizes.filter(x => x !== s) : [...p.sizes, s];
      const sizeStock = { ...p.sizeStock };
      if (has) delete sizeStock[s];
      else sizeStock[s] = sizeStock[s] ?? 0;
      return { ...p, sizes, sizeStock };
    });
  }

  function setStock(size: string, val: string) {
    setForm(p => ({ ...p, sizeStock: { ...p.sizeStock, [size]: Math.max(0, parseInt(val) || 0) } }));
  }

  function addCustomSize() {
    const s = newSize.trim().toUpperCase();
    if (!s || form.sizes.includes(s)) return;
    setForm(p => ({ ...p, sizes: [...p.sizes, s], sizeStock: { ...p.sizeStock, [s]: 0 } }));
    setNewSize("");
  }

  const canSave = form.name.trim().length >= 2 && parseFloat(form.price) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактировать товар" : "Создать товар"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Name */}
          <div>
            <label className="text-xs font-medium mb-1 block">Название *</label>
            <Input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Например: Худи «CHAOS» чёрный"
              data-testid="input-product-name"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium mb-1 block">Описание</label>
            <Textarea
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Расскажите о товаре..."
              rows={3}
              data-testid="textarea-product-desc"
            />
          </div>

          {/* Price */}
          <div>
            <label className="text-xs font-medium mb-1 block">Цена (₽) *</label>
            <Input
              type="number"
              min="1"
              value={form.price}
              onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
              placeholder="3500"
              data-testid="input-product-price"
            />
          </div>

          {/* Composition */}
          <div>
            <label className="text-xs font-medium mb-1 block">Состав ткани</label>
            <Input
              value={form.composition}
              onChange={e => setForm(p => ({ ...p, composition: e.target.value }))}
              placeholder="Хлопок 100%"
              data-testid="input-product-composition"
            />
          </div>

          {/* Images */}
          <div>
            <label className="text-xs font-medium mb-2 block">Фотографии</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.images.map((img, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-md overflow-hidden border bg-muted">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center"
                    data-testid={`btn-remove-image-${idx}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-20 h-20 rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                data-testid="btn-upload-image"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                <span className="text-[10px]">{uploading ? "Загрузка…" : "Добавить"}</span>
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }}
            />
          </div>

          {/* Sizes */}
          <div>
            <label className="text-xs font-medium mb-2 block">Размеры и остатки</label>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {COMMON_SIZES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSize(s)}
                  className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-colors ${form.sizes.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'}`}
                  data-testid={`btn-size-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Custom size */}
            <div className="flex gap-2 mb-3">
              <Input
                value={newSize}
                onChange={e => setNewSize(e.target.value)}
                placeholder="Свой размер"
                className="text-xs h-8"
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCustomSize())}
                data-testid="input-custom-size"
              />
              <Button type="button" variant="outline" size="sm" onClick={addCustomSize} className="h-8 px-2">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            {/* Stock per size */}
            {form.sizes.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Количество на складе:</p>
                <div className="grid grid-cols-2 gap-2">
                  {form.sizes.map(s => (
                    <div key={s} className="flex items-center gap-2">
                      <span className="text-xs font-medium w-16 flex-shrink-0">{s}</span>
                      <Input
                        type="number"
                        min="0"
                        value={form.sizeStock[s] ?? 0}
                        onChange={e => setStock(s, e.target.value)}
                        className="h-7 text-xs"
                        data-testid={`input-stock-${s}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={!canSave || saveMutation.isPending || uploading}
              className="flex-1"
              data-testid="btn-save-product"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {editing ? "Сохранить" : "Создать товар"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} data-testid="btn-cancel-product">
              Отмена
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ArtistStats {
  revenue: number;
  orders: number;
  items: number;
  monthlyRevenue: { month: string; revenue: number }[];
  topProducts: { name: string; revenue: number; items: number }[];
}

interface ArtistPageSettings {
  name?: string;
  role?: string;
  shortDescription?: string;
  logoUrl?: string;
  cardImage?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroImage?: string;
  heroImageMobile?: string;
  aboutTitle?: string;
  aboutText?: string;
  galleryTitle?: string;
  galleryImages?: string[];
  aboutImages?: string[];
  quoteText?: string;
  quoteAuthor?: string;
  videoUrl?: string;
  socialTelegram?: string;
  socialVk?: string;
  socialYoutube?: string;
  socialInstagram?: string;
  socialOther?: string;
  socialOtherLabel?: string;
  productsTitle?: string;
  productsLimit?: number;
  productsLinkText?: string;
  seoTitle?: string;
  seoDescription?: string;
  heroVisible?: boolean;
  aboutVisible?: boolean;
  galleryVisible?: boolean;
  productsVisible?: boolean;
  quoteVisible?: boolean;
  videoVisible?: boolean;
  socialsVisible?: boolean;
  theme?: string;
  marqueeText?: string;
}

interface ArtistTabProps {
  partnerSlug: string;
  artistRate?: number | null;
}

function fmtRub(kopecks: number) {
  return (kopecks / 100).toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

// ─── Single Image Uploader ────────────────────────────────────────────────────
interface ImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  label: string;
  hint?: string;
  testId?: string;
  uploadUrl?: string;
  accept?: string;
  allowedTypes?: string[];
}

function ImageUploader({ value, onChange, label, hint, testId, uploadUrl, accept, allowedTypes }: ImageUploaderProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolvedUploadUrl = uploadUrl || "/api/partner/artist/upload-image";
  const resolvedAccept = accept || "image/jpeg,image/png,image/webp";
  const resolvedAllowedTypes = allowedTypes || ["image/jpeg", "image/png", "image/webp", "image/gif"];

  const uploadFile = useCallback(async (file: File) => {
    if (!resolvedAllowedTypes.includes(file.type)) {
      toast({ title: "Неподдерживаемый формат", description: `Допустимые форматы: ${resolvedAccept}`, variant: "destructive" });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "Файл слишком большой", description: "Максимум 15 МБ", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(resolvedUploadUrl, {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(file.name), "content-type": file.type },
        body: file,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Ошибка загрузки");
      }
      const { url } = await res.json();
      onChange(url);
      toast({ title: "Изображение загружено" });
    } catch (e: any) {
      toast({ title: "Ошибка загрузки", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [onChange, toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  return (
    <div>
      <label className="text-xs font-medium mb-1 block">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        className={`relative border-2 border-dashed rounded-lg transition-colors cursor-pointer
          ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"}
          ${value ? "p-2" : "p-5"}`}
        onClick={() => !uploading && inputRef.current?.click()}
        data-testid={testId}
      >
        <input
          ref={inputRef}
          type="file"
          accept={resolvedAccept}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 py-1 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-xs">Загружаю...</span>
          </div>
        ) : value ? (
          <div className="flex items-center gap-3">
            <img src={value} alt="preview" className="w-14 h-14 object-cover rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate">{value.split("/").pop()}</p>
              <p className="text-xs text-primary mt-1">Нажмите или перетащите для замены</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              className="p-1 rounded hover:bg-destructive/10 text-destructive shrink-0"
              title="Удалить"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <p className="text-xs text-center">Перетащите или нажмите · {resolvedAccept.split(",").map(t => t.split("/")[1]?.toUpperCase()).join(", ")} · до 15 МБ</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Gallery Uploader (multiple images) ──────────────────────────────────────
interface GalleryUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
}

function GalleryUploader({ images, onChange }: GalleryUploaderProps) {
  const { toast } = useToast();
  const [uploadCount, setUploadCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ref-аккумулятор — всегда содержит актуальный список, даже при параллельных загрузках
  const accRef = useRef<string[]>(images);
  useEffect(() => { accRef.current = images; }, [images]);

  const handleReorderDragStart = (i: number) => setDragSrcIdx(i);
  const handleReorderDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(i);
  };
  const handleReorderDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragSrcIdx === null || dragSrcIdx === i) { setDragSrcIdx(null); setDragOverIdx(null); return; }
    const next = [...images];
    const [moved] = next.splice(dragSrcIdx, 1);
    next.splice(i, 0, moved);
    onChange(next);
    setDragSrcIdx(null);
    setDragOverIdx(null);
  };
  const handleReorderDragEnd = () => { setDragSrcIdx(null); setDragOverIdx(null); };

  const uploadFile = useCallback(async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      toast({ title: "Неподдерживаемый формат", description: "Загрузите JPG, PNG или WebP", variant: "destructive" });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "Файл слишком большой", description: "Максимум 15 МБ", variant: "destructive" });
      return;
    }
    setUploadCount(n => n + 1);
    try {
      const res = await fetch("/api/partner/artist/upload-image", {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(file.name), "content-type": file.type },
        body: file,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Ошибка загрузки");
      }
      const { url } = await res.json();
      // Читаем актуальный список из ref, добавляем новый URL
      accRef.current = [...accRef.current, url];
      onChange(accRef.current);
      toast({ title: "Фото добавлено в галерею" });
    } catch (e: any) {
      toast({ title: "Ошибка загрузки", description: e?.message, variant: "destructive" });
    } finally {
      setUploadCount(n => n - 1);
    }
  }, [onChange, toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => uploadFile(f));
  }, [uploadFile]);

  const remove = (i: number) => {
    const next = [...images];
    next.splice(i, 1);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <GripVertical className="w-3 h-3 inline" /> Перетащите фото для изменения порядка
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {images.map((url, i) => (
              <div
                key={i}
                draggable
                onDragStart={() => handleReorderDragStart(i)}
                onDragOver={(e) => handleReorderDragOver(e, i)}
                onDrop={(e) => handleReorderDrop(e, i)}
                onDragEnd={handleReorderDragEnd}
                className={`relative group aspect-square rounded-lg overflow-hidden bg-muted cursor-grab active:cursor-grabbing transition-all
                  ${dragSrcIdx === i ? 'opacity-30 scale-95' : ''}
                  ${dragOverIdx === i && dragSrcIdx !== i ? 'ring-2 ring-primary scale-105' : ''}`}
                data-testid={`gallery-img-${i}`}
              >
                <img src={url} alt={`Галерея ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Удалить"
                >
                  <X className="w-3 h-3" />
                </button>
                <span className="absolute bottom-1 left-1 text-[10px] font-mono bg-black/50 text-white px-1 rounded">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
          ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}
        onClick={() => uploadCount === 0 && inputRef.current?.click()}
        data-testid="upload-gallery-add"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            Array.from(e.target.files || []).forEach(f => uploadFile(f));
            e.target.value = "";
          }}
        />
        {uploadCount > 0 ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Загружаю {uploadCount} фото...</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Plus className="w-4 h-4" />
            <span className="text-xs">Добавить фото · можно несколько сразу</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page Editor ───────────────────────────────────────────────────────────────
export function PageEditor({ partnerSlug }: { partnerSlug: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ArtistPageSettings>({});
  const [formInitialized, setFormInitialized] = useState(false);
  const savedFormRef = useRef<string>("");

  const pageQuery = useQuery<ArtistPageSettings>({
    queryKey: ["/api/partner/artist/page"],
    staleTime: 0,
  });

  useEffect(() => {
    if (pageQuery.data && !formInitialized) {
      setForm(pageQuery.data);
      savedFormRef.current = JSON.stringify(pageQuery.data);
      setFormInitialized(true);
    }
  }, [pageQuery.data, formInitialized]);

  const isDirty = formInitialized && JSON.stringify(form) !== savedFormRef.current;

  const saveMutation = useMutation({
    mutationFn: (data: ArtistPageSettings) =>
      apiRequest("PUT", "/api/partner/artist/page", data),
    onSuccess: (_, variables) => {
      savedFormRef.current = JSON.stringify(variables);
      queryClient.invalidateQueries({ queryKey: ["/api/page-settings/artist_pages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/artist/page"] });
      toast({ title: "Страница сохранена" });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка сохранения", description: e?.message, variant: "destructive" });
    },
  });

  const f = (key: keyof ArtistPageSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const set = (key: keyof ArtistPageSettings) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  return (
    <Card className="overflow-hidden">
      <div className="w-full flex items-center justify-between px-5 py-4 text-left bg-primary/5 border-b border-primary/10">
        <div>
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary shrink-0" />
            <p className="font-semibold text-sm text-primary">Редактировать страницу</p>
            {isDirty && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                Не сохранено
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Публичная страница:{" "}
            <a
              href={`/@${partnerSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary"
            >
              /@{partnerSlug} <ExternalLink className="inline w-3 h-3" />
            </a>
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-6 pt-5">
          {pageQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Тема оформления */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Тема оформления</h4>
                <p className="text-xs text-muted-foreground">Выберите визуальный стиль публичной страницы</p>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { id: 'default',  label: 'Стандарт', bg: '#ffffff', accent: '#111111', text: '#111111', border: '#e5e7eb' },
                    { id: 'dark',     label: 'Тёмная',   bg: '#0a0a0a', accent: '#ffffff', text: '#ffffff', border: '#222222' },
                    { id: 'raw',      label: 'Сырая',    bg: '#f0ebe3', accent: '#1a1a1a', text: '#1a1a1a', border: '#d9d0c4' },
                    { id: 'neon',     label: 'Неон',     bg: '#0d0d0d', accent: '#00ff88', text: '#ffffff', border: '#1a1a1a' },
                    { id: 'warm',     label: 'Тёплая',   bg: '#f7ece4', accent: '#ffa000', text: '#2e2e2e', border: '#e8d8cc' },
                    { id: 'midnight', label: 'Полночь',  bg: '#070a1f', accent: '#7c83ff', text: '#dde2ff', border: '#1a1f4a' },
                    { id: 'forest',   label: 'Лес',      bg: '#071310', accent: '#27d97e', text: '#d5f5e8', border: '#123320' },
                    { id: 'dawn',     label: 'Рассвет',  bg: '#faf4f2', accent: '#c4344a', text: '#1a0c0e', border: '#e8d0ce' },
                  ] as const).map((t) => {
                    const active = (form.theme || 'default') === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setForm(p => ({ ...p, theme: t.id }))}
                        data-testid={`btn-theme-${t.id}`}
                        title={t.label}
                        className="relative rounded-xl overflow-hidden flex flex-col transition-all focus:outline-none"
                        style={{
                          border: `2px solid ${active ? t.accent : t.border}`,
                          boxShadow: active ? `0 0 0 2px ${t.accent}33` : undefined,
                          transform: active ? 'scale(1.04)' : undefined,
                        }}
                      >
                        <div className="h-9" style={{ background: t.bg }} />
                        <div className="px-1 py-1.5 flex flex-col items-center gap-1" style={{ background: t.bg }}>
                          <div className="w-5 h-1 rounded-full" style={{ background: t.accent }} />
                          <span className="text-[9px] font-semibold leading-none" style={{ color: t.text }}>{t.label}</span>
                        </div>
                        {active && (
                          <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: t.accent }}>
                            <svg width="7" height="5" viewBox="0 0 7 5" fill="none"><path d="M1 2.5L2.8 4.2L6 1" stroke={t.bg} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Основное */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Основное</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Имя / псевдоним</label>
                    <Input value={form.name || ""} onChange={f("name")} placeholder="Например: Minta" data-testid="input-artist-name" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Роль</label>
                    <Input value={form.role || ""} onChange={f("role")} placeholder="Например: Рэпер, Блогер, Артист" data-testid="input-artist-role" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Короткое описание</label>
                  <Input value={form.shortDescription || ""} onChange={f("shortDescription")} placeholder="Одна строка под именем на обложке" data-testid="input-artist-short-desc" />
                </div>
                <ImageUploader
                  label="Логотип (вместо текстового названия на обложке)"
                  hint="JPG, PNG, WebP или SVG с прозрачным фоном. Если загружено — показывается вместо имени в hero-блоке страницы."
                  value={form.logoUrl || ""}
                  onChange={set("logoUrl")}
                  uploadUrl="/api/partner/artist/upload-logo"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  allowedTypes={["image/jpeg", "image/jpg", "image/png", "image/webp", "image/svg+xml", "image/gif", ""]}
                  testId="upload-artist-logo"
                />
                <div>
                  <label className="text-xs font-medium mb-1 block">Бегущая строка</label>
                  <Input value={form.marqueeText || ""} onChange={f("marqueeText")} placeholder="Имя ★ Слоган ★ Дроп — по умолчанию имя артиста" data-testid="input-artist-marquee" />
                  <p className="text-[11px] text-muted-foreground mt-1">Текст прокручивается под обложкой. Если пусто — используется имя артиста.</p>
                </div>
                <ImageUploader
                  label="Фото для карточки на главной странице"
                  hint="Квадратное или портретное фото, рекомендуется минимум 600×600. Отображается в секции «Артисты» на главной"
                  value={form.cardImage || ""}
                  onChange={set("cardImage")}
                  testId="upload-artist-card-image"
                />
              </section>

              {/* Hero — обложка */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Обложка страницы</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, heroVisible: !(p.heroVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.heroVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-hero-visible">
                    {(form.heroVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.heroVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.heroVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <p className="text-xs text-muted-foreground">
                  Большой баннер вверху страницы. По умолчанию показывается имя и роль из раздела «Основное».
                </p>
                <ImageUploader
                  label="Фото обложки (десктоп)"
                  hint="Рекомендуется горизонтальное фото, минимум 1920×1080"
                  value={form.heroImage || ""}
                  onChange={set("heroImage")}
                  testId="upload-artist-hero-image"
                />
                <ImageUploader
                  label="Фото обложки (мобильная версия)"
                  hint="Вертикальное фото 9:16 или квадрат 1:1, минимум 750×1000. Если не загружено — используется десктопный баннер"
                  value={form.heroImageMobile || ""}
                  onChange={set("heroImageMobile")}
                  testId="upload-artist-hero-image-mobile"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Заголовок на обложке</label>
                    <Input
                      value={form.heroTitle || ""}
                      onChange={f("heroTitle")}
                      placeholder="Например: Новая коллекция 2025"
                      data-testid="input-artist-hero-title"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Если не заполнено — показывается имя</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Подзаголовок на обложке</label>
                    <Input
                      value={form.heroSubtitle || ""}
                      onChange={f("heroSubtitle")}
                      placeholder="Например: Только здесь и сейчас"
                      data-testid="input-artist-hero-subtitle"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Если не заполнено — показывается роль</p>
                  </div>
                </div>
                </div>
              </section>

              {/* О себе */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">О себе</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, aboutVisible: !(p.aboutVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.aboutVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-about-visible">
                    {(form.aboutVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.aboutVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.aboutVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <div>
                  <label className="text-xs font-medium mb-1 block">Заголовок раздела</label>
                  <Input value={form.aboutTitle || ""} onChange={f("aboutTitle")} placeholder="Например: О художнике" data-testid="input-artist-about-title" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Текст</label>
                  <Textarea
                    value={form.aboutText || ""}
                    onChange={f("aboutText")}
                    placeholder="Расскажите о себе..."
                    rows={4}
                    data-testid="textarea-artist-about-text"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Фото рядом с текстом (до 2 шт.)</label>
                  <p className="text-[11px] text-muted-foreground mb-2">Отображаются справа от текста в секции «О себе»</p>
                  <GalleryUploader
                    images={(form.aboutImages || []).slice(0, 2)}
                    onChange={(imgs) => setForm((prev) => ({ ...prev, aboutImages: imgs.slice(0, 2) }))}
                  />
                </div>
                </div>
              </section>

              {/* Галерея */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Галерея фотографий</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, galleryVisible: !(p.galleryVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.galleryVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-gallery-visible">
                    {(form.galleryVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.galleryVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.galleryVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <div>
                  <label className="text-xs font-medium mb-1 block">Заголовок раздела</label>
                  <Input
                    value={form.galleryTitle || ""}
                    onChange={f("galleryTitle")}
                    placeholder="Например: Галерея"
                    data-testid="input-artist-gallery-title"
                  />
                </div>
                <GalleryUploader
                  images={form.galleryImages || []}
                  onChange={(imgs) => setForm((prev) => ({ ...prev, galleryImages: imgs }))}
                />
                </div>
              </section>

              {/* Цитата */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Цитата</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, quoteVisible: !(p.quoteVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.quoteVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-quote-visible">
                    {(form.quoteVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.quoteVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.quoteVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <div>
                  <label className="text-xs font-medium mb-1 block">Текст цитаты</label>
                  <Textarea value={form.quoteText || ""} onChange={f("quoteText")} placeholder="Ваша цитата..." rows={2} data-testid="textarea-artist-quote" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Автор (подпись)</label>
                  <Input value={form.quoteAuthor || ""} onChange={f("quoteAuthor")} placeholder="— Имя" data-testid="input-artist-quote-author" />
                </div>
                </div>
              </section>

              {/* Видео */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Видео</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, videoVisible: !(p.videoVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.videoVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-video-visible">
                    {(form.videoVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.videoVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.videoVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <div>
                  <label className="text-xs font-medium mb-1 block">Ссылка на видео</label>
                  <Input value={form.videoUrl || ""} onChange={f("videoUrl")} placeholder="https://youtube.com/watch?v=... или ссылка на Яндекс Диск" data-testid="input-artist-video-url" />
                  {/* Подсказка по формату видео */}
                  <div className="mt-2 rounded-lg border border-border/60 bg-muted/40 p-3 space-y-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">Рекомендуемый формат — 16:9 (горизонтальное)</p>
                    <div className="flex gap-4 items-start">
                      {/* Десктоп */}
                      <div className="flex flex-col items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5 text-muted-foreground" />
                        <div className="relative rounded overflow-hidden bg-muted border border-border/70" style={{ width: 72, height: 40 }}>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full bg-foreground/15 flex items-center justify-center">
                              <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[7px] border-l-foreground/40 ml-0.5" />
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground/70 text-center leading-tight">половина экрана</span>
                      </div>
                      {/* Мобильный */}
                      <div className="flex flex-col items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                        <div className="relative rounded overflow-hidden bg-muted border border-border/70" style={{ width: 72, height: 40 }}>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full bg-foreground/15 flex items-center justify-center">
                              <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[7px] border-l-foreground/40 ml-0.5" />
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground/70 text-center leading-tight">на всю ширину</span>
                      </div>
                    </div>
                    {/* Поддерживаемые платформы */}
                    <div className="space-y-1 pt-0.5">
                      <p className="text-[10px] font-medium text-muted-foreground">Поддерживаемые источники:</p>
                      <div className="grid grid-cols-1 gap-0.5 text-[10px] text-muted-foreground/80">
                        <span>✅ <b>YouTube</b> — просто вставьте ссылку</span>
                        <span>✅ <b>VK Video</b> — просто вставьте ссылку</span>
                        <span>✅ <b>Яндекс Диск</b> — вставьте публичную ссылку на файл</span>
                        <span>✅ <b>Другие сайты</b> — нажмите «Поделиться → Встроить» на видео и вставьте весь код целиком</span>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </section>

              {/* Соцсети */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Соцсети</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, socialsVisible: !(p.socialsVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.socialsVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-socials-visible">
                    {(form.socialsVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.socialsVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.socialsVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Telegram</label>
                    <Input value={form.socialTelegram || ""} onChange={f("socialTelegram")} placeholder="https://t.me/..." data-testid="input-artist-telegram" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">ВКонтакте</label>
                    <Input value={form.socialVk || ""} onChange={f("socialVk")} placeholder="https://vk.com/..." data-testid="input-artist-vk" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">YouTube</label>
                    <Input value={form.socialYoutube || ""} onChange={f("socialYoutube")} placeholder="https://youtube.com/..." data-testid="input-artist-youtube" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Instagram</label>
                    <Input value={form.socialInstagram || ""} onChange={f("socialInstagram")} placeholder="https://instagram.com/..." data-testid="input-artist-instagram" />
                  </div>
                </div>
                <div className="pt-1 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-3">Другая платформа — TikTok, Twitch, Spotify, личный сайт и т.д.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Название платформы</label>
                      <Input value={form.socialOtherLabel || ""} onChange={f("socialOtherLabel")} placeholder="Например: TikTok" data-testid="input-artist-social-other-label" />
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Ссылка</label>
                      <Input value={form.socialOther || ""} onChange={f("socialOther")} placeholder="https://tiktok.com/@..." data-testid="input-artist-social-other" />
                    </div>
                  </div>
                </div>
                </div>
              </section>

              {/* Блок товаров */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Блок товаров</h4>
                  <button type="button" onClick={() => setForm(p => ({ ...p, productsVisible: !(p.productsVisible ?? true) }))} className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${(form.productsVisible ?? true) ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground bg-muted/60'}`} data-testid="toggle-products-visible">
                    {(form.productsVisible ?? true) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {(form.productsVisible ?? true) ? 'Видно' : 'Скрыто'}
                  </button>
                </div>
                <div className={`space-y-3 transition-opacity ${!(form.productsVisible ?? true) ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                <p className="text-xs text-muted-foreground">Настройте заголовок и количество товаров на вашей странице.</p>
                <div>
                  <label className="text-xs font-medium mb-1 block">Заголовок блока</label>
                  <Input value={form.productsTitle || ""} onChange={f("productsTitle")} placeholder="Например: Моя коллекция" data-testid="input-artist-products-title" />
                  <p className="text-[11px] text-muted-foreground mt-1">Если не заполнено — показывается «Мерч»</p>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Количество товаров на странице</label>
                  <div className="flex gap-2 flex-wrap">
                    {[4, 8, 12, 16, 20].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setForm(p => ({ ...p, productsLimit: n }))}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${(form.productsLimit ?? 8) === n ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'}`}
                        data-testid={`btn-products-limit-${n}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">По умолчанию — 8</p>
                </div>
                </div>
              </section>

              {/* SEO */}
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SEO</h4>
                <p className="text-xs text-muted-foreground -mt-1">
                  Как ваша страница выглядит в результатах поиска Яндекс и Google.
                </p>
                <div>
                  <label className="text-xs font-medium mb-1 block">Заголовок страницы в поиске</label>
                  <Input
                    value={form.seoTitle || ""}
                    onChange={f("seoTitle")}
                    placeholder="Например: Официальный мерч MINTA — купить футболки и худи"
                    data-testid="input-artist-seo-title"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Рекомендуется до 60 символов. Если не заполнено — формируется автоматически</p>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Описание страницы в поиске</label>
                  <Textarea
                    value={form.seoDescription || ""}
                    onChange={f("seoDescription")}
                    placeholder="Например: Авторский мерч певицы MINTA. Лимитированные коллекции, доставка по России."
                    rows={2}
                    data-testid="textarea-artist-seo-description"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Рекомендуется до 160 символов</p>
                </div>
              </section>

              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className={`w-full sm:w-auto ${isDirty && !saveMutation.isPending ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                data-testid="button-artist-page-save"
              >
                {saveMutation.isPending
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Save className="w-4 h-4 mr-2" />}
                {isDirty ? 'Сохранить изменения' : 'Сохранить страницу'}
              </Button>
            </>
          )}
        </div>
    </Card>
  );
}

// ─── Main ArtistTab ────────────────────────────────────────────────────────────
export function ArtistTab({ partnerSlug, artistRate }: ArtistTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ArtistProduct | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  const productsQuery = useQuery<{ products: ArtistProduct[] }>({
    queryKey: ["/api/partner/artist/products"],
  });

  const myProductsQuery = useQuery<ArtistProduct[]>({
    queryKey: ["/api/partner/my-products"],
  });

  const statsQuery = useQuery<ArtistStats>({
    queryKey: ["/api/partner/artist/stats"],
  });

  const viewsQuery = useQuery<{ views: number }>({
    queryKey: ["/api/partner/artist/views"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/partner/my-products/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/my-products"] });
      qc.invalidateQueries({ queryKey: ["/api/partner/artist/products"] });
      toast({ title: "Товар удалён" });
      setDeletingId(null);
    },
    onError: (e: any) => toast({ title: "Ошибка", description: e?.message, variant: "destructive" }),
  });

  const toggleHiddenMutation = useMutation({
    mutationFn: async ({ id, isHidden }: { id: number; isHidden: boolean }) => {
      await apiRequest("PUT", `/api/partner/my-products/${id}`, { isHidden });
    },
    onMutate: async ({ id, isHidden }) => {
      await qc.cancelQueries({ queryKey: ["/api/partner/my-products"] });
      const prev = qc.getQueryData<any[]>(["/api/partner/my-products"]);
      qc.setQueryData<any[]>(["/api/partner/my-products"], (old) =>
        (old || []).map((p: any) => p.id === id ? { ...p, isHidden } : p)
      );
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["/api/partner/my-products"], ctx.prev);
      toast({ title: "Ошибка", description: e?.message, variant: "destructive" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/my-products"] });
      qc.invalidateQueries({ queryKey: ["/api/partner/artist/products"] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/partner/artist/linked-products/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/artist/products"] });
      toast({ title: "Товар отвязан с вашей страницы" });
      setUnlinkingId(null);
    },
    onError: (e: any) => toast({ title: "Ошибка", description: e?.message, variant: "destructive" }),
  });

  const loading = productsQuery.isLoading || statsQuery.isLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const products = productsQuery.data?.products ?? [];
  const stats = statsQuery.data;
  const pageViews = viewsQuery.data?.views ?? 0;

  const hasRate = artistRate != null && artistRate > 0;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentMonthRevenue = stats?.monthlyRevenue.find((m) => m.month === currentMonth)?.revenue ?? 0;
  const totalEarned = hasRate ? Math.round((stats?.revenue ?? 0) * (artistRate! / 100)) : null;
  const currentMonthEarned = hasRate ? Math.round(currentMonthRevenue * (artistRate! / 100)) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" /> Статистика
        </p>
        <div className="flex-1 h-px bg-border" />
      </div>
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <Card className="p-4 flex items-center gap-3" data-testid="artist-stat-views">
          <Users className="w-7 h-7 text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Просмотров страницы</p>
            <p className="text-lg font-bold">{viewsQuery.isLoading ? "—" : pageViews.toLocaleString("ru-RU")}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3" data-testid="artist-stat-revenue">
          <TrendingUp className="w-7 h-7 text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Оборот всего</p>
            <p className="text-lg font-bold">{stats ? fmtRub(stats.revenue) : "—"}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3" data-testid="artist-stat-orders">
          <ShoppingBag className="w-7 h-7 text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Заказов</p>
            <p className="text-lg font-bold">{stats ? stats.orders.toLocaleString("ru-RU") : "—"}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3" data-testid="artist-stat-items">
          <Package className="w-7 h-7 text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Продано единиц</p>
            <p className="text-lg font-bold">{stats ? stats.items.toLocaleString("ru-RU") : "—"}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3" data-testid="artist-stat-month-earned">
          <Percent className="w-7 h-7 text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Начислено в этом месяце</p>
            <p className="text-lg font-bold">
              {hasRate
                ? fmtRub(currentMonthEarned!)
                : <span className="text-sm text-muted-foreground">% не задан</span>}
            </p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3" data-testid="artist-stat-total-earned">
          <BadgeDollarSign className="w-7 h-7 text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Начислено за всё время</p>
            <p className="text-lg font-bold">
              {hasRate
                ? fmtRub(totalEarned!)
                : <span className="text-sm text-muted-foreground">% не задан</span>}
            </p>
          </div>
        </Card>
      </div>

      {/* Monthly revenue table */}
      {stats && stats.monthlyRevenue.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" /> Выручка по месяцам
          </h3>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Месяц</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.monthlyRevenue].reverse().map((row) => (
                  <tr key={row.month} className="border-b last:border-0 hover:bg-muted/20" data-testid={`artist-month-${row.month}`}>
                    <td className="px-4 py-2">{fmtMonth(row.month)}</td>
                    <td className="px-4 py-2 text-right font-medium">{fmtRub(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Top products */}
      {stats && stats.topProducts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Топ товаров
          </h3>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Товар</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Штук</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Выручка</th>
                </tr>
              </thead>
              <tbody>
                {stats.topProducts.map((p, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20" data-testid={`artist-top-product-${i}`}>
                    <td className="px-4 py-2 max-w-[260px] truncate" title={p.name}>{p.name}</td>
                    <td className="px-4 py-2 text-right">{p.items.toLocaleString("ru-RU")}</td>
                    <td className="px-4 py-2 text-right font-medium">{fmtRub(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* My Products — full manager */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Package className="w-4 h-4" /> Мои товары
            <Badge variant="secondary" className="ml-1">
              {(myProductsQuery.data?.length ?? 0) + products.filter(p => !p.artistOnly).length}
            </Badge>
          </h3>
          <Button
            size="sm"
            onClick={() => { setEditingProduct(null); setDialogOpen(true); }}
            data-testid="btn-create-product"
          >
            <Plus className="w-4 h-4 mr-1" /> Создать товар
          </Button>
        </div>

        {/* Artist-only products (created by artist themselves) */}
        {myProductsQuery.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (myProductsQuery.data?.length ?? 0) > 0 ? (
          <div className="space-y-2 mb-4">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Созданы вами</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {(myProductsQuery.data ?? []).map((p) => (
                <Card key={p.id} className="overflow-hidden group relative" data-testid={`my-product-${p.id}`}>
                  <div className="aspect-square bg-muted overflow-hidden">
                    {p.thumbnailUrl || p.imageUrl ? (
                      <img src={p.thumbnailUrl || p.imageUrl || ""} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-muted-foreground/40" />
                      </div>
                    )}
                    {/* Скрыт-оверлей */}
                    {p.isHidden && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                        <span className="text-white text-[10px] font-semibold uppercase tracking-wider bg-black/60 px-2 py-0.5 rounded">Скрыт</span>
                      </div>
                    )}
                    {/* Hover actions */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditingProduct(p); setDialogOpen(true); }}
                        className="bg-white text-black rounded-full p-1.5 hover:bg-white/90"
                        title="Редактировать"
                        data-testid={`btn-edit-product-${p.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleHiddenMutation.mutate({ id: p.id, isHidden: !p.isHidden })}
                        className="bg-white text-black rounded-full p-1.5 hover:bg-white/90"
                        title={p.isHidden ? "Показать товар" : "Скрыть товар"}
                        data-testid={`btn-toggle-hidden-${p.id}`}
                        disabled={toggleHiddenMutation.isPending}
                      >
                        {p.isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(p.id)}
                        className="bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600"
                        title="Удалить"
                        data-testid={`btn-delete-product-${p.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium leading-tight line-clamp-2" title={p.name}>{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtRub(p.price)}</p>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500 text-emerald-600">ваш мерч</Badge>
                      {p.sizes && p.sizes.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">{p.sizes.join(", ")}</span>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-4">
            <Package className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">Вы ещё не создали ни одного товара</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setEditingProduct(null); setDialogOpen(true); }}
              data-testid="btn-create-first-product"
            >
              <Plus className="w-4 h-4 mr-1" /> Создать первый товар
            </Button>
          </div>
        )}

        {/* Products linked via 1C / admin */}
        {products.filter(p => !p.artistOnly).length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Привязаны из каталога</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {products.filter(p => !p.artistOnly).map((p) => (
                <Card key={p.id} className="overflow-hidden relative group" data-testid={`artist-catalog-product-${p.id}`}>
                  <button
                    onClick={() => setUnlinkingId(p.id)}
                    className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-black/60 hover:bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Отвязать товар со страницы"
                    data-testid={`button-unlink-catalog-product-${p.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="aspect-square bg-muted overflow-hidden">
                    {p.thumbnailUrl || p.imageUrl ? (
                      <img src={p.thumbnailUrl || p.imageUrl || ""} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium leading-tight line-clamp-2" title={p.name}>{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtRub(p.price)}</p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Product dialog */}
      <MyProductDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingProduct(null); }}
        editing={editingProduct}
        partnerSlug={partnerSlug}
      />

      {/* Delete confirmation */}
      <Dialog open={deletingId !== null} onOpenChange={(v) => !v && setDeletingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить товар?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Товар будет скрыт с вашей страницы. Отменить нельзя.</p>
          <div className="flex gap-2 mt-2">
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleteMutation.isPending}
              onClick={() => deletingId !== null && deleteMutation.mutate(deletingId)}
              data-testid="btn-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Удалить
            </Button>
            <Button variant="outline" onClick={() => setDeletingId(null)} data-testid="btn-cancel-delete">Отмена</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unlink catalog product confirmation */}
      <Dialog open={unlinkingId !== null} onOpenChange={(v) => !v && setUnlinkingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отвязать товар?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Товар пропадёт с вашей страницы. Администратор сможет привязать его снова в любой момент.
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              variant="destructive"
              className="flex-1"
              disabled={unlinkMutation.isPending}
              onClick={() => unlinkingId !== null && unlinkMutation.mutate(unlinkingId)}
              data-testid="btn-confirm-unlink"
            >
              {unlinkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Отвязать
            </Button>
            <Button variant="outline" onClick={() => setUnlinkingId(null)} data-testid="btn-cancel-unlink">Отмена</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
