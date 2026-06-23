import { sendAgentAlert } from "./telegram";
import { vkNotifyAgentAlert } from "./vk";

// Rate limiter: не спамим одной и той же ошибкой чаще раза в 5 минут
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const recentErrors = new Map<string, number>();

function isDuplicate(key: string): boolean {
  const last = recentErrors.get(key);
  const now = Date.now();
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentErrors.set(key, now);
  // Чистим старые записи чтобы Map не рос бесконечно
  if (recentErrors.size > 200) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, t] of recentErrors) {
      if (t < cutoff) recentErrors.delete(k);
    }
  }
  return false;
}

function emoji(category: string): string {
  if (category.includes("payment") || category.includes("оплат")) return "💳";
  if (category.includes("ydb") || category.includes("database") || category.includes("база")) return "🗄";
  if (category.includes("cdek") || category.includes("доставк")) return "📦";
  if (category.includes("crash") || category.includes("uncaught") || category.includes("критич") || category.includes("сбой")) return "💥";
  if (category.includes("unhandled") || category.includes("необработ")) return "⚠️";
  if (category.includes("500") || category.includes("express") || category.includes("сервер")) return "🔴";
  if (category.includes("auth") || category.includes("взлом") || category.includes("brute")) return "🔐";
  return "❌";
}

/**
 * Отправляет уведомление об ошибке в Telegram и VK.
 * Дедуплицирует: одна и та же category+message не отправляется чаще раза в 5 минут.
 * Никогда не бросает исключений — monitoring не должен ломать основной поток.
 */
export function notifyError(category: string, message: string, details?: string): void {
  const dedupKey = `${category}:${message.slice(0, 100)}`;
  if (isDuplicate(dedupKey)) return;

  const icon = emoji(category.toLowerCase());
  const time = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const lines = [
    `${icon} <b>[Ошибка] ${category}</b>`,
    `<code>${escapeHtml(message.slice(0, 500))}</code>`,
  ];
  if (details) lines.push(`<i>${escapeHtml(details.slice(0, 300))}</i>`);
  lines.push(`🕐 ${time} (МСК)`);
  const text = lines.join("\n");

  // Telegram
  sendAgentAlert(text).catch(err =>
    console.error("[ErrorMonitor] TG send failed:", err?.message)
  );

  // VK (plain text — VK не поддерживает HTML)
  const vkText = text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  vkNotifyAgentAlert(vkText);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
