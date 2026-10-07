// Ответ магазина на отзыв (публичный, от имени магазина).
// Отдельный файл, чтобы не раздувать и без того огромный Admin.tsx
// (та же причина, по которой тут лежит ReviewRequestsPanel).
// API: PATCH /api/admin/reviews/:id { adminComment } — пустая строка удаляет ответ.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "@/lib/admin-fetch";

const MAX_ADMIN_COMMENT_LENGTH = 1000;

function formatReplyDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

interface Props {
  reviewId: number;
  apiKey: string;
  adminComment?: string | null;
  adminCommentedAt?: string | null;
}

export default function ReviewReplyForm({ reviewId, apiKey, adminComment, adminCommentedAt }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const existing = (adminComment || "").trim();
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState(existing);

  const saveMutation = useMutation({
    mutationFn: (value: string) =>
      adminFetch(`/api/admin/reviews/${reviewId}`, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ adminComment: value }),
      }),
    onSuccess: (_data, value) => {
      toast({ title: value.trim() ? "Ответ магазина сохранён" : "Ответ магазина удалён" });
      setIsOpen(false);
      setText(value.trim());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reviews"] });
    },
    onError: (err: any) =>
      toast({ title: "Ошибка", description: err?.message || "Не удалось сохранить ответ", variant: "destructive" }),
  });

  // Есть сохранённый ответ — показываем его с возможностью изменить/удалить
  if (existing && !isOpen) {
    return (
      <div className="mt-2.5 rounded-lg border-l-2 border-primary/60 bg-muted/40 px-3 py-2"
        data-testid={`admin-reply-${reviewId}`}
      >
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <MessageCircle className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Ответ магазина</span>
          {adminCommentedAt && (
            <span className="text-[11px] text-muted-foreground">{formatReplyDate(adminCommentedAt)}</span>
          )}
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap">{existing}</p>
        <div className="flex items-center gap-1 mt-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={saveMutation.isPending}
            onClick={() => { setText(existing); setIsOpen(true); }}
            data-testid={`button-edit-reply-${reviewId}`}
          >
            Изменить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate("")}
            data-testid={`button-delete-reply-${reviewId}`}
          >
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Удалить"}
          </Button>
        </div>
      </div>
    );
  }

  if (isOpen) {
    return (
      <div className="mt-2.5 space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={MAX_ADMIN_COMMENT_LENGTH}
          placeholder="Публичный ответ от имени магазина (виден всем покупателям на странице товара)"
          className="resize-none text-sm"
          data-testid={`textarea-reply-${reviewId}`}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={saveMutation.isPending || !text.trim()}
            onClick={() => saveMutation.mutate(text)}
            data-testid={`button-save-reply-${reviewId}`}
          >
            {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Сохранить ответ
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saveMutation.isPending}
            onClick={() => setIsOpen(false)}
            data-testid={`button-cancel-reply-${reviewId}`}
          >
            Отмена
          </Button>
          <span className="text-[11px] text-muted-foreground ml-auto">
            {text.length}/{MAX_ADMIN_COMMENT_LENGTH}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-2.5"
      onClick={() => { setText(""); setIsOpen(true); }}
      data-testid={`button-reply-${reviewId}`}
    >
      <MessageCircle className="w-3.5 h-3.5 mr-1" />
      Ответить
    </Button>
  );
}
