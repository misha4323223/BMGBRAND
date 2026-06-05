import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Star, Loader2, PenLine, ChevronDown, ChevronUp, Camera, X, ZoomIn } from "lucide-react";
import { useLocation } from "wouter";

interface Review {
  id: number;
  productId: number;
  userId: number | null;
  authorName: string;
  rating: number;
  comment: string | null;
  photos?: string[];
  isApproved: boolean;
  createdAt: string | null;
}

function StarRating({
  rating,
  max = 5,
  size = 16,
  interactive = false,
  onRate,
}: {
  rating: number;
  max?: number;
  size?: number;
  interactive?: boolean;
  onRate?: (r: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-0.5" data-testid="star-rating">
      {Array.from({ length: max }, (_, i) => {
        const val = i + 1;
        const filled = interactive ? val <= (hover || rating) : val <= rating;
        return (
          <Star
            key={i}
            width={size}
            height={size}
            className={`transition-all duration-150 ${
              filled
                ? "fill-yellow-400 text-yellow-400 scale-110"
                : "fill-transparent text-zinc-300 dark:text-zinc-600"
            } ${interactive ? "cursor-pointer hover:scale-125" : ""}`}
            onClick={() => interactive && onRate?.(val)}
            onMouseEnter={() => interactive && setHover(val)}
            onMouseLeave={() => interactive && setHover(0)}
            data-testid={`star-${val}`}
          />
        );
      })}
    </div>
  );
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-red-500", "bg-orange-500", "bg-amber-500",
    "bg-emerald-500", "bg-teal-500", "bg-cyan-500",
    "bg-blue-500", "bg-violet-500", "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${getAvatarColor(name)}`}
    >
      {initials}
    </div>
  );
}

function RatingBar({ stars, count, total }: { stars: number; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs" data-testid={`rating-bar-${stars}`}>
      <span className="w-3 text-right text-zinc-500 dark:text-zinc-400">{stars}</span>
      <Star width={10} height={10} className="fill-yellow-400 text-yellow-400 shrink-0" />
      <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-yellow-400 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right text-zinc-400 dark:text-zinc-500">{count}</span>
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function PhotoLightbox({ photos, initialIndex, onClose }: {
  photos: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
      data-testid="photo-lightbox"
    >
      <button
        className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
        onClick={onClose}
        data-testid="button-close-lightbox"
      >
        <X className="w-7 h-7" />
      </button>
      <div className="flex items-center gap-4 px-4 max-w-screen-lg w-full" onClick={(e) => e.stopPropagation()}>
        {photos.length > 1 && (
          <button
            className="text-white/50 hover:text-white text-3xl font-light shrink-0 w-8"
            onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
          >
            ‹
          </button>
        )}
        <img
          src={photos[idx]}
          alt={`Фото ${idx + 1}`}
          className="max-h-[80vh] max-w-full object-contain rounded-xl mx-auto"
          data-testid={`lightbox-img-${idx}`}
        />
        {photos.length > 1 && (
          <button
            className="text-white/50 hover:text-white text-3xl font-light shrink-0 w-8"
            onClick={() => setIdx((i) => (i + 1) % photos.length)}
          >
            ›
          </button>
        )}
      </div>
      {photos.length > 1 && (
        <div className="absolute bottom-6 flex gap-2">
          {photos.map((_, i) => (
            <button
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${i === idx ? "bg-white" : "bg-white/30"}`}
              onClick={(e) => { e.stopPropagation(); setIdx(i); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewPhotos({ photos }: { photos: string[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  if (!photos || photos.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2 mt-3">
        {photos.map((url, i) => (
          <button
            key={i}
            className="relative w-20 h-20 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 hover:opacity-90 transition-opacity group"
            onClick={() => setLightboxIdx(i)}
            data-testid={`review-photo-thumb-${i}`}
          >
            <img src={url} alt={`Фото ${i + 1}`} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>
      {lightboxIdx !== null && (
        <PhotoLightbox photos={photos} initialIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ReviewSection({ productId }: { productId: number }) {
  const { toast } = useToast();
  const { data: authData } = useAuth();
  const [, navigate] = useLocation();
  const user = authData?.user;

  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: ["/api/reviews", productId],
    staleTime: 30000,
  });

  const handlePhotoSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const remaining = 5 - photoPreviews.length;
    if (remaining <= 0) return;
    const toProcess = Array.from(files).slice(0, remaining);

    for (const file of toProcess) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 15 * 1024 * 1024) {
        toast({ title: "Файл слишком большой", description: "Максимум 15 МБ", variant: "destructive" });
        continue;
      }
      const base64 = await fileToBase64(file);
      setPhotoPreviews((prev) => [...prev, base64]);
      setUploadingCount((c) => c + 1);

      try {
        const res = await apiRequest("POST", "/api/reviews/upload-photo", { imageData: base64 });
        const data = await res.json();
        if (data.url) {
          setUploadedUrls((prev) => [...prev, data.url]);
        }
      } catch {
        toast({ title: "Не удалось загрузить фото", variant: "destructive" });
        setPhotoPreviews((prev) => prev.filter((p) => p !== base64));
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
  }, [photoPreviews.length, toast]);

  const removePhoto = (idx: number) => {
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
    setUploadedUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setRating(0);
    setComment("");
    setPhotoPreviews([]);
    setUploadedUrls([]);
    setUploadingCount(0);
    setShowForm(false);
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reviews", {
        productId,
        rating,
        comment: comment.trim() || null,
        photos: uploadedUrls,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Спасибо за отзыв! Он появится после модерации." });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["/api/reviews", productId] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

  const dist = [5, 4, 3, 2, 1].map((s) => ({
    stars: s,
    count: reviews.filter((r) => r.rating === s).length,
  }));

  const ratingLabel = (n: number) => {
    if (n === 0) return "отзывов";
    if (n === 1) return "отзыв";
    if (n < 5) return "отзыва";
    return "отзывов";
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-10" data-testid="review-section">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Отзывы</h2>
        {user && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            data-testid="button-toggle-review-form"
          >
            {showForm ? (
              <>
                <ChevronUp className="w-4 h-4" /> Закрыть
              </>
            ) : (
              <>
                <PenLine className="w-4 h-4" /> Написать отзыв
              </>
            )}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : (
        <>
          {reviews.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-6 mb-8 p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
              <div className="flex flex-col items-center justify-center min-w-[100px]">
                <span className="text-5xl font-extrabold leading-none text-zinc-900 dark:text-white" data-testid="text-avg-rating">
                  {avgRating.toFixed(1)}
                </span>
                <StarRating rating={Math.round(avgRating)} size={16} />
                <span className="text-xs text-zinc-400 mt-1" data-testid="text-review-count">
                  {reviews.length} {ratingLabel(reviews.length)}
                </span>
              </div>
              <div className="flex-1 flex flex-col justify-center gap-1.5">
                {dist.map((d) => (
                  <RatingBar
                    key={d.stars}
                    stars={d.stars}
                    count={d.count}
                    total={reviews.length}
                  />
                ))}
              </div>
            </div>
          )}

          {showForm && user && (
            <div className="mb-8 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name={user.name} />
                <div>
                  <p className="text-sm font-semibold leading-none">{user.name}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">Ваш отзыв</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Оценка
                </p>
                <StarRating rating={rating} size={28} interactive onRate={setRating} />
                {rating > 0 && (
                  <p className="text-xs text-zinc-400 mt-1">
                    {["", "Плохо", "Так себе", "Нормально", "Хорошо", "Отлично"][rating]}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Комментарий <span className="normal-case font-normal">(необязательно)</span>
                </p>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Поделитесь впечатлениями о товаре..."
                  rows={3}
                  className="resize-none rounded-xl text-sm"
                  data-testid="input-review-comment"
                />
              </div>

              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
                  Фото <span className="normal-case font-normal">(до 5 штук, необязательно)</span>
                </p>

                <div className="flex flex-wrap gap-2">
                  {photoPreviews.map((preview, i) => (
                    <div
                      key={i}
                      className="relative w-20 h-20 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 shrink-0"
                      data-testid={`photo-preview-${i}`}
                    >
                      <img src={preview} alt="" className="w-full h-full object-cover" />
                      {i >= uploadedUrls.length ? (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                      ) : (
                        <button
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
                          onClick={() => removePhoto(i)}
                          data-testid={`button-remove-photo-${i}`}
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      )}
                    </div>
                  ))}

                  {photoPreviews.length < 5 && (
                    <button
                      className="w-20 h-20 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-600 flex flex-col items-center justify-center gap-1 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shrink-0"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-add-photo"
                    >
                      <Camera className="w-5 h-5 text-zinc-400" />
                      <span className="text-[10px] text-zinc-400">Добавить</span>
                    </button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handlePhotoSelect(e.target.files)}
                  data-testid="input-photo-file"
                />
              </div>

              <button
                onClick={() => submitMutation.mutate()}
                disabled={rating === 0 || submitMutation.isPending || uploadingCount > 0}
                className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                data-testid="button-submit-review"
              >
                {(submitMutation.isPending || uploadingCount > 0) && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploadingCount > 0 ? "Загрузка фото..." : "Отправить отзыв"}
              </button>
            </div>
          )}

          {!user && (
            <button
              onClick={() => navigate("/profile")}
              className="w-full mb-8 flex items-center gap-4 p-4 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all group"
              data-testid="button-login-to-review"
            >
              <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700 transition-colors shrink-0">
                <PenLine className="w-5 h-5 text-zinc-500" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Оставить отзыв
                </p>
                <p className="text-xs text-zinc-400">Войдите, чтобы поделиться мнением</p>
              </div>
            </button>
          )}

          {reviews.length === 0 ? (
            <div className="text-center py-12" data-testid="text-no-reviews">
              <div className="flex justify-center mb-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    width={20}
                    height={20}
                    className="fill-transparent text-zinc-200 dark:text-zinc-700"
                  />
                ))}
              </div>
              <p className="text-sm font-medium text-zinc-500">Пока нет отзывов</p>
              <p className="text-xs text-zinc-400 mt-0.5">Будьте первым, кто поделится мнением</p>
            </div>
          ) : (
            <div className="space-y-0 divide-y divide-zinc-100 dark:divide-zinc-800">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="py-5 first:pt-0"
                  data-testid={`review-item-${review.id}`}
                >
                  <div className="flex gap-3">
                    <Avatar name={review.authorName} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className="text-sm font-semibold"
                          data-testid={`text-review-author-${review.id}`}
                        >
                          {review.authorName}
                        </span>
                        <span className="text-xs text-zinc-400">
                          {formatDate(review.createdAt)}
                        </span>
                      </div>
                      <StarRating rating={review.rating} size={13} />
                      {review.comment && (
                        <p
                          className="text-sm text-zinc-600 dark:text-zinc-300 mt-2 leading-relaxed"
                          data-testid={`text-review-comment-${review.id}`}
                        >
                          {review.comment}
                        </p>
                      )}
                      {review.photos && review.photos.length > 0 && (
                        <ReviewPhotos photos={review.photos} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
