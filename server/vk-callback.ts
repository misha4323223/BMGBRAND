// Приём сообщений ИЗ ВК (ответы менеджера) в чат сайта.
//
// Почему Callback API, а не Long Poll:
//  - сайт живёт в Yandex Serverless Container: инстанс засыпает между запросами,
//    а Long Poll — это вечно висящий HTTP-запрос, который в такой среде обрывается;
//  - `groups.getLongPollServer` с ключом сообщества требует право `manage` и
//    отдаёт код 29, если Long Poll API в сообществе не включён (проверено 15.09.2026);
//  - Callback API сам присылает POST на наш HTTPS-эндпоинт — холодный старт не мешает,
//    VK повторяет доставку, если мы ответили не 200/"ok".
//
// Настройка со стороны VK делается кодом (см. setupVkCallbackApi): добавляем сервер
// `groups.addCallbackServer` → включаем `message_new` в `groups.setCallbackSettings`.
// Строку подтверждения адреса отдаём из `groups.getCallbackConfirmationCode`.
import type { Express } from "express";
import { storage } from "./storage";
import { logError, logInfo, logWarn } from "./logger";

const VK_API = "https://api.vk.ru/method";

function vkToken(): string {
  return process.env.VK_GROUP_TOKEN || process.env.VK_USER_TOKEN || "";
}
function vkGroupId(): string {
  return process.env.VK_GROUP_ID || "";
}
function siteUrl(): string {
  return (process.env.SITE_URL || process.env.APP_DOMAIN || "https://booomerangs.ru").replace(/\/$/, "");
}

async function vkCall(method: string, params: Record<string, string> = {}): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: vkToken(), v: "5.199" });
  const res = await fetch(`${VK_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data: any = await res.json();
  if (data.error) {
    throw new Error(`${method}: ${data.error.error_code} ${data.error.error_msg}`);
  }
  return data.response;
}

// ── Доставка сообщения менеджера из ВК в чат сайта ───────────────────────────

// Дедуп: Callback API и Long Poll могут работать одновременно (VK шлёт событие
// и в вебхук, и в Long Poll-сессию), поэтому одно и то же vk-сообщение
// обрабатываем один раз.
const seenVkMessageIds = new Map<number, number>();
const SEEN_TTL_MS = 10 * 60 * 1000;

function isDuplicate(vkMessageId?: number): boolean {
  if (!vkMessageId) return false;
  const now = Date.now();
  for (const [id, ts] of seenVkMessageIds) {
    if (now - ts > SEEN_TTL_MS) seenVkMessageIds.delete(id);
  }
  if (seenVkMessageIds.has(vkMessageId)) return true;
  seenVkMessageIds.set(vkMessageId, now);
  return false;
}

async function vkUserName(userId: number): Promise<string | null> {
  if (!userId) return null;
  try {
    const resp = await vkCall("users.get", { user_ids: String(userId) });
    const name = resp?.[0] ? `${resp[0].first_name || ""} ${resp[0].last_name || ""}`.trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

export interface VkAdminMessage {
  /** id сообщения ВК, на которое отвечает менеджер (0/undefined → берём последний диалог сайта) */
  vkMessageId?: number;
  /** id входящего сообщения ВК — нужен только для дедупа */
  incomingMessageId?: number;
  text: string;
  author?: string;
  fromUserId?: number;
  invalidate?: (sessionId: string) => void;
}

/**
 * Сохраняет ответ менеджера как сообщение от админа в диалоге сайта.
 * Если сообщение — ответ на конкретное уведомление, находим сессию по его vk- id.
 * Если менеджер написал в чат «просто так» — кладём в самый свежий диалог,
 * куда уходили VK-уведомления (иначе ответ терялся бы).
 */
export async function deliverVkAdminMessage(msg: VkAdminMessage): Promise<boolean> {
  const text = String(msg.text || "").trim();
  if (!text) return false;
  if (isDuplicate(msg.incomingMessageId)) {
    logInfo(`[VK In] Duplicate vk_msg_id=${msg.incomingMessageId} ignored`);
    return false;
  }

  let sessionId: string | null = null;
  if (msg.vkMessageId) {
    sessionId = await storage.getSessionIdByVkMessageId(msg.vkMessageId);
    if (!sessionId) {
      logWarn(`[VK In] Session not found for vk_message_id=${msg.vkMessageId}, fallback to latest dialog`);
    }
  }
  if (!sessionId) sessionId = await storage.getLatestVkChatSessionId();
  if (!sessionId) {
    logWarn("[VK In] No site chat session to deliver the message to — nothing saved");
    return false;
  }

  const author = msg.author || (msg.fromUserId ? (await vkUserName(msg.fromUserId)) || "Менеджер (ВК)" : "Менеджер (ВК)");
  const { randomUUID } = await import("crypto");
  await storage.saveChatMessage({
    messageId: randomUUID(),
    sessionId,
    sender: "admin",
    text,
    timestamp: Date.now(),
    userName: author,
  });
  msg.invalidate?.(sessionId);
  logInfo(`[VK In] Manager message saved to session ${sessionId.slice(0, 8)} (author: ${author})`);
  return true;
}

// ── Callback API: настройка и статус ────────────────────────────────────────

// VK ограничивает название сервера 14 символами (иначе ошибка 100).
const CALLBACK_TITLE = "BMG site";

export async function getVkCallbackConfirmationCode(): Promise<string> {
  const envCode = process.env.VK_CALLBACK_CONFIRM_CODE;
  if (envCode) return envCode;
  const code = await vkCall("groups.getCallbackConfirmationCode", { group_id: vkGroupId() });
  return String(code);
}

export interface VkCallbackStatus {
  ok: boolean;
  groupId: string;
  tokenFound: boolean;
  callbackUrl: string;
  servers: Array<{ id: number; url: string; title: string }>;
  activeServerId: number | null;
  confirmationCode: string | null;
  settings?: any;
  longPoll?: any;
  error?: string;
}

/** Читает текущие настройки Callback/Long Poll в сообществе (ничего не меняет). */
export async function getVkCallbackStatus(): Promise<VkCallbackStatus> {
  const result: VkCallbackStatus = {
    ok: false,
    groupId: vkGroupId(),
    tokenFound: !!vkToken(),
    callbackUrl: `${siteUrl()}/api/vk/callback`,
    servers: [],
    activeServerId: null,
    confirmationCode: null,
  };
  if (!result.tokenFound || !result.groupId) {
    result.error = "VK_GROUP_TOKEN или VK_GROUP_ID не заданы";
    return result;
  }
  try {
    const servers = await vkCall("groups.getCallbackServers", { group_id: result.groupId });
    const items = servers?.items || [];
    result.servers = items.map((s: any) => ({ id: s.id, url: s.url, title: s.title }));
    const match = items.find((s: any) => String(s.url).replace(/\/$/, "") === result.callbackUrl);
    result.activeServerId = match ? match.id : null;
    result.ok = true;
  } catch (err: any) {
    result.error = err.message;
  }
  try {
    result.confirmationCode = await getVkCallbackConfirmationCode();
  } catch (err: any) {
    result.confirmationCode = null;
    result.error = result.error || err.message;
  }
  try {
    result.settings = await vkCall("groups.getCallbackSettings", { group_id: result.groupId });
  } catch {
    /* не критично для диагностики */
  }
  try {
    result.longPoll = await vkCall("groups.getLongPollSettings", { group_id: result.groupId });
  } catch {
    /* не критично для диагностики */
  }
  return result;
}

/**
 * Регистрирует наш сервер в Callback API сообщества и включает событие «Входящее
 * сообщение». Повторный вызов безопасен: если сервер с таким URL уже есть — правим его.
 */
export interface VkCallbackSetupResult {
  ok: boolean;
  callbackUrl: string;
  serverId: number | null;
  created: boolean;
  confirmationCode: string | null;
  steps: string[];
  error?: string;
}

export async function setupVkCallbackApi(): Promise<VkCallbackSetupResult> {
  const url = `${siteUrl()}/api/vk/callback`;
  const secret = process.env.VK_CALLBACK_SECRET || "";
  const steps: string[] = [];
  const out: VkCallbackSetupResult = { ok: false, callbackUrl: url, serverId: null, created: false, confirmationCode: null, steps };

  try {
    if (!vkToken() || !vkGroupId()) throw new Error("VK_GROUP_TOKEN или VK_GROUP_ID не заданы");

    const existing = await vkCall("groups.getCallbackServers", { group_id: vkGroupId() });
    const items: any[] = existing?.items || [];
    let serverId: number | null = null;
    const match = items.find((s: any) => String(s.url).replace(/\/$/, "") === url);
    if (match) {
      serverId = match.id;
      steps.push(`Сервер с этим URL уже есть (id=${serverId})`);
      if (secret) {
        await vkCall("groups.editCallbackServer", {
          group_id: vkGroupId(),
          server_id: String(serverId),
          url,
          title: CALLBACK_TITLE,
          secret_key: secret,
        });
        steps.push("Секретный ключ обновлён (editCallbackServer)");
      }
    } else {
      const params: Record<string, string> = { group_id: vkGroupId(), url, title: CALLBACK_TITLE };
      if (secret) params.secret_key = secret;
      serverId = Number(await vkCall("groups.addCallbackServer", params));
      out.created = true;
      steps.push(`Сервер добавлен (addCallbackServer → id=${serverId})`);
    }
    out.serverId = serverId;

    await vkCall("groups.setCallbackSettings", {
      group_id: vkGroupId(),
      server_id: String(serverId),
      api_version: "5.199",
      message_new: "1",
      message_reply: "0",
    });
    steps.push("Включено событие message_new (setCallbackSettings)");

    out.confirmationCode = await getVkCallbackConfirmationCode();
    steps.push("Строка подтверждения получена (getCallbackConfirmationCode)");
    out.ok = true;
  } catch (err: any) {
    out.error = err.message;
    logError("[VK Callback] setup error:", err.message);
  }
  return out;
}

// ── Вебхук ──────────────────────────────────────────────────────────────────

/**
 * POST /api/vk/callback — сюда VK присылает события сообщества.
 * VK ждёт быстрый ответ: на событие — строку "ok", на confirmation — код из настроек.
 */
export function registerVkCallbackWebhook(
  app: Express,
  chatCacheInvalidate: (sessionId: string) => void
): void {
  app.post("/api/vk/callback", async (req, res) => {
    const body: any = req.body || {};
    const type = String(body.type || "");
    const secret = process.env.VK_CALLBACK_SECRET || "";

    if (secret && String(body.secret || "") !== secret) {
      logWarn(`[VK Callback] Rejected event type=${type}: bad secret`);
      return res.status(403).send("forbidden");
    }

    if (type === "confirmation") {
      try {
        const code = await getVkCallbackConfirmationCode();
        logInfo("[VK Callback] Confirmation request answered");
        return res.status(200).send(code);
      } catch (err: any) {
        logError("[VK Callback] Cannot answer confirmation:", err.message);
        return res.status(500).send("");
      }
    }

    // Отвечаем VK сразу: разбор и запись в чат делаем после ответа.
    res.status(200).send("ok");

    if (type !== "message_new") return;

    try {
      const obj = body.object || {};
      const msg = obj.message || obj; // до API 5.103 в object лежит само сообщение
      const incomingId = Number(msg.id || 0);
      const peerId = String(msg.peer_id || "");
      const fromId = Number(msg.from_id || 0);
      const groupId = Number(vkGroupId());
      const text = String(msg.text || "").trim();
      const replyTo = msg.reply_message?.id ? Number(msg.reply_message.id) : 0;

      if (!text) return;
      if (groupId && fromId === -groupId) return; // наше собственное сообщение

      const configuredPeer = process.env.VK_CHAT_PEER_ID || "";
      if (configuredPeer && peerId !== configuredPeer) {
        logInfo(`[VK Callback] message_new from peer ${peerId} — not the notification chat (${configuredPeer}), skipped`);
        return;
      }

      logInfo(`[VK Callback] message_new peer=${peerId} from=${fromId} reply_to=${replyTo} text="${text.slice(0, 60)}"`);
      await deliverVkAdminMessage({
        vkMessageId: replyTo,
        incomingMessageId: incomingId,
        text: text.replace(/^\[Ответ\][^\n]*\n?/m, "").trim(),
        fromUserId: fromId,
        invalidate: chatCacheInvalidate,
      });
    } catch (err: any) {
      logError("[VK Callback] message_new handling failed:", err.message);
    }
  });

  logInfo("[VK Callback] Webhook registered at /api/vk/callback");
}
