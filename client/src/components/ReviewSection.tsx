import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Star, ChevronDown, ChevronUp, Loader2, LogIn } from "lucide-react";

interface Review {
  id: number;
  productId: number;
  userId: number | null;
  authorName: string;
  rating: number;
  comment: string | null;
  isApproved: boolean;
  createdAt: string | null;
}

function StarRating({ rating, max = 5, size = "w-4 h-4", interactive = false, onRate }: {
  rating: number;
  max?: number;
  size?: string;
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
            className={`${size} ${filled ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"} ${interactive ? "cursor-pointer" : ""}`}
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

export function ReviewSection({ productId }: { productId: number }) {
  const { toast } = useToast();
  const { data: authData } = useAuth();
  const user = authData?.user;
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: ["/api/reviews", productId],
    staleTime: 30000,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reviews", {
        productId,
        rating,
        comment: comment.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Спасибо за отзыв! Он появится после модерации." });
      setRating(0);
      setComment("");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/reviews", productId] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-8" data-testid="review-section">
      <h2 className="text-xl font-semibold mb-4">Отзывы</h2>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-6">
            <StarRating rating={Math.round(avgRating)} />
            <span className="text-sm text-muted-foreground" data-testid="text-review-count">
              {avgRating > 0 ? avgRating.toFixed(1) : "0"} ({reviews.length}{" "}
              {reviews.length === 1 ? "отзыв" : reviews.length < 5 ? "отзыва" : "отзывов"})
            </span>
          </div>

          {user ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(!showForm)}
              className="mb-4"
              data-testid="button-toggle-review-form"
            >
              {showForm ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
              Написать отзыв
            </Button>
          ) : (
            <div className="mb-4 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = "/profile"}
                data-testid="button-login-to-review"
              >
                <LogIn className="w-4 h-4 mr-1" />
                Войдите, чтобы оставить отзыв
              </Button>
            </div>
          )}

          {showForm && user && (
            <Card className="mb-6">
              <CardContent className="pt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Отзыв от: <span className="font-medium text-foreground">{user.name}</span>
                </p>
                <div>
                  <label className="text-sm font-medium mb-1 block">Оценка</label>
                  <StarRating rating={rating} size="w-6 h-6" interactive onRate={setRating} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Комментарий (необязательно)</label>
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Поделитесь впечатлениями..."
                    rows={3}
                    data-testid="input-review-comment"
                  />
                </div>
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={rating === 0 || submitMutation.isPending}
                  data-testid="button-submit-review"
                >
                  {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Отправить отзыв
                </Button>
              </CardContent>
            </Card>
          )}

          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="text-no-reviews">
              Пока нет отзывов. Будьте первым!
            </p>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="border-b border-border pb-4" data-testid={`review-item-${review.id}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating rating={review.rating} size="w-3.5 h-3.5" />
                    <span className="text-sm font-medium" data-testid={`text-review-author-${review.id}`}>
                      {review.authorName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(review.createdAt)}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-foreground/80 mt-1" data-testid={`text-review-comment-${review.id}`}>
                      {review.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
