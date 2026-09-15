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
function vkChatPeerId(): string {
  return String(process.env.VK_CHAT_PEER_ID || "2000000003").trim();
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

// ── Диагностика: последние полученные события от VK ─────────────────────────
// В serverless-контейнере логи читать неудобно, поэтому держим последние 10
// событий в памяти инстанса и отдаём их в /api/admin/vk/callback-status.
export interface VkRecentEvent {
  at: number;
  type: string;
  eventId?: string;
  peerId?: string;
  fromId?: number;
  replyTo?: number;
  text?: string;
  delivered?: boolean;
  note?: string;
  /** Каким путём нашли диалог: exact | cmid | fallback | miss | not-reply | duplicate */
  route?: string;
}

const recentEvents: VkRecentEvent[] = [];
const MAX_RECENT_EVENTS = 10;

function trackEvent(ev: VkRecentEvent): VkRecentEvent {
  recentEvents.push(ev);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
  return ev;
}

// Журнал храним ещё и в БД (bonus_settings): в serverless инстансов несколько,
// они засыпают, поэтому по памяти инстанса видно не всё — а вопрос «почему не пришло»
// решается именно этим журналом.
const EVENTS_KEY = "vk_callback_last_events";

export async function persistRecentVkEvents(): Promise<void> {
  try {
    await storage.setBonusSetting(EVENTS_KEY, JSON.stringify(recentEvents.slice(-MAX_RECENT_EVENTS)));
  } catch (err: any) {
    logWarn("[VK Callback] Не удалось сохранить журнал событий:", err.message);
  }
}

async function loadPersistedVkEvents(): Promise<VkRecentEvent[]> {
  try {
    const raw = await storage.getBonusSetting(EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Свежие события: память инстанса + журнал из БД, без дублей. */
export async function getRecentVkEvents(): Promise<VkRecentEvent[]> {
  const merged = [...recentEvents, ...(await loadPersistedVkEvents())];
  const seen = new Set<string>();
  const unique: VkRecentEvent[] = [];
  for (const ev of merged.sort((a, b) => (b.at || 0) - (a.at || 0))) {
    const key = `${ev.at}|${ev.type}|${ev.eventId ?? ""}|${ev.replyTo ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ev);
    if (unique.length >= MAX_RECENT_EVENTS) break;
  }
  return unique;
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

export interface VkAdminMessage {
  /** id сообщения ВК, на которое менеджер ответил («Ответить») — обязателен */
  vkMessageId?: number;
  /** id входящего сообщения ВК — нужен только для дедупа */
  incomingMessageId?: number;
  text: string;
  /** Имя отправителя в чате сайта; по умолчанию всегда «Администратор» */
  author?: string;
  invalidate?: (sessionId: string) => void;
  /** Диагностика: каким путём нашли диалог (exact | cmid | fallback | miss) */
  debug?: { route?: string };
}

/**
 * В беседе ВК у сообщения два идентификатора: глобальный `id` (его возвращает
 * `messages.send`, его мы и сохраняем) и `conversation_message_id` (номер внутри
 * беседы). В событии «Ответить» может прийти любой из них — поэтому если прямой
 * поиск не дал результата, читаем историю беседы и сопоставляем по обоим.
 */
async function resolveReplyTarget(rawId: number): Promise<{ messageId: number | null; foundInChat: boolean; error?: string }> {
  try {
    const resp: any = await vkCall("messages.getHistory", {
      peer_id: String(vkChatPeerId()),
      count: "100",
    });
    const items: any[] = resp?.items || [];
    const byConv = items.find((m) => Number(m.conversation_message_id) === rawId);
    if (byConv) return { messageId: Number(byConv.id), foundInChat: true };
    const byId = items.find((m) => Number(m.id) === rawId);
    if (byId) return { messageId: rawId, foundInChat: true };
    return { messageId: null, foundInChat: false };
  } catch (err: any) {
    return { messageId: null, foundInChat: false, error: err.message };
  }
}

/**
 * Сохраняет ответ менеджера как сообщение от админа в диалоге сайта.
 *
 * ⚠️ Доставляем ТОЛЬКО ответы («Ответить»). Обычные сообщения в беседе игнорируем:
 * в этом ВК-чате идут ещё и заявки, и они не должны попадать в чат клиента.
 * Ответ на чужое сообщение (заявку) тоже не отправляем клиенту.
 */
export async function deliverVkAdminMessage(msg: VkAdminMessage): Promise<boolean> {
  const text = String(msg.text || "").trim();
  if (!text) return false;
  if (!msg.vkMessageId) {
    logInfo("[VK In] Message is not a reply to a site notification — skipped");
    if (msg.debug) msg.debug.route = "not-reply";
    return false;
  }
  if (isDuplicate(msg.incomingMessageId)) {
    logInfo(`[VK In] Duplicate vk_msg_id=${msg.incomingMessageId} ignored`);
    if (msg.debug) msg.debug.route = "duplicate";
    return false;
  }

  let sessionId = await storage.getSessionIdByVkMessageId(msg.vkMessageId);
  if (sessionId && msg.debug) msg.debug.route = "exact";

  if (!sessionId) {
    const resolved = await resolveReplyTarget(msg.vkMessageId);
    if (resolved.messageId) {
      sessionId = await storage.getSessionIdByVkMessageId(resolved.messageId);
      if (sessionId && msg.debug) msg.debug.route = "cmid";
    }
    if (!sessionId) {
      if (resolved.foundInChat || resolved.error) {
        // Ответ на чужое сообщение в беседе (например, заявку) — клиенту не шлём.
        logWarn(
          `[VK In] Reply target ${msg.vkMessageId} is not one of our notifications (inChat=${resolved.foundInChat}) — skipped`
        );
        if (msg.debug) msg.debug.route = "miss";
        return false;
      }
      // Сообщение уже вне последних 100 в беседе / история недоступна — берём
      // самый свежий диалог, куда уходили VK-уведомления (поведение до ужесточения).
      sessionId = await storage.getLatestVkChatSessionId();
      logWarn(`[VK In] Reply target ${msg.vkMessageId} not found — fallback to latest VK dialog`);
      if (msg.debug) msg.debug.route = "fallback";
    }
  }
  if (!sessionId) {
    logWarn("[VK In] No site chat session to deliver the message to — nothing saved");
    return false;
  }

  // Имя в чате сайта всегда одинаковое — менеджеров не раскрываем.
  const author = msg.author || "Администратор";
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

// ── Строка подтверждения адреса сервера ─────────────────────────────────────
//
// КРИТИЧНО (найдено 15.09.2026): VK отдаёт не голую строку, а JSON-объект
// `{"response":{"code":"d8v2ve07"}}`. Раньше код делал `String(response)` и
// возвращал на запрос `confirmation` строку "[object Object]" (ровно 15 символов).
// Из-за этого VK НИКОГДА не подтверждал сервер, а без подтверждения события не
// доставляются вообще — при этом `groups.getCallbackSettings` показывал
// `message_new: 1, is_enabled: true`, т.е. настройки выглядели правильными.
// Отсюда и симптом «в ВК уходит, обратно не приходит».
export async function getVkCallbackConfirmationCode(): Promise<string> {
  const envCode = process.env.VK_CALLBACK_CONFIRM_CODE;
  if (envCode) return envCode;
  const resp: any = await vkCall("groups.getCallbackConfirmationCode", { group_id: vkGroupId() });
  const code = typeof resp === "string" ? resp : resp?.code ?? resp?.confirmation_code;
  if (!code || typeof code !== "string") {
    throw new Error(`getCallbackConfirmationCode вернул неожиданный ответ: ${JSON.stringify(resp)}`);
  }
  return code;
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
  settingsError?: string;
  longPoll?: any;
  /** Настройки сообщества (например, messages — включены ли сообщения сообщества) */
  groupSettings?: any;
  /** Последние события, которые VK реально прислал на наш вебхук (пусто → VK пока не доставляет) */
  recentEvents?: VkRecentEvent[];
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
  result.recentEvents = await getRecentVkEvents();
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
    // server_id обязателен — без него VK отвечает ошибкой, и диагностика пустая.
    const params: Record<string, string> = { group_id: result.groupId };
    if (result.activeServerId) params.server_id = String(result.activeServerId);
    result.settings = await vkCall("groups.getCallbackSettings", params);
  } catch (err: any) {
    result.settings = undefined;
    result.settingsError = err.message;
  }
  try {
    result.longPoll = await vkCall("groups.getLongPollSettings", { group_id: result.groupId });
  } catch {
    /* не критично для диагностики */
  }
  try {
    // Приём сообщений сообщества невозможен, если в сообществе выключены сообщения.
    result.groupSettings = await vkCall("groups.getSettings", { group_id: result.groupId });
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

export async function setupVkCallbackApi(
  opts: { recreate?: boolean; events?: Record<string, boolean> } = {}
): Promise<VkCallbackSetupResult> {
  const url = `${siteUrl()}/api/vk/callback`;
  const secret = process.env.VK_CALLBACK_SECRET || "";
  const steps: string[] = [];
  const out: VkCallbackSetupResult = { ok: false, callbackUrl: url, serverId: null, created: false, confirmationCode: null, steps };

  try {
    if (!vkToken() || !vkGroupId()) throw new Error("VK_GROUP_TOKEN или VK_GROUP_ID не заданы");

    const existing = await vkCall("groups.getCallbackServers", { group_id: vkGroupId() });
    let items: any[] = existing?.items || [];

    // `recreate` — принудительное переподтверждение адреса: удаляем старый сервер
    // с нашим URL, чтобы VK заново прислал запрос `confirmation`. Без успешного
    // подтверждения VK не доставляет события, даже если настройки выставлены.
    if (opts.recreate) {
      const ours = items.filter((s: any) => String(s.url).replace(/\/$/, "") === url);
      for (const s of ours) {
        await vkCall("groups.deleteCallbackServer", { group_id: vkGroupId(), server_id: String(s.id) });
        steps.push(`Старый сервер удалён (id=${s.id}) — VK пришлёт новый confirmation`);
      }
      if (ours.length) items = items.filter((s: any) => !ours.includes(s));
    }

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
      } else {
        // Правка сервера заставляет VK перепроверить адрес (новый confirmation) —
        // полезно, если предыдущее подтверждение не прошло.
        await vkCall("groups.editCallbackServer", {
          group_id: vkGroupId(),
          server_id: String(serverId),
          url,
          title: CALLBACK_TITLE,
        });
        steps.push("Сервер перепроверяется: VK отправит запрос confirmation (editCallbackServer)");
      }
    } else {
      const params: Record<string, string> = { group_id: vkGroupId(), url, title: CALLBACK_TITLE };
      if (secret) params.secret_key = secret;
      // VK возвращает { server_id: 11 } (в старых версиях — просто число).
      const added = await vkCall("groups.addCallbackServer", params);
      serverId = Number(typeof added === "object" ? added?.server_id : added);
      if (!Number.isFinite(serverId)) throw new Error(`addCallbackServer вернул неожиданный ответ: ${JSON.stringify(added)}`);
      out.created = true;
      steps.push(`Сервер добавлен (addCallbackServer → id=${serverId})`);
    }
    out.serverId = serverId;

    // message_new нужен всегда; остальные события можно включить/выключить через
    // `events` — нужно для диагностики (например, message_reply = исходящие
    // сообщения сообщества: по нему видно, доставляет ли VK события в наш вебхук).
    const eventParams: Record<string, string> = { message_new: "1", message_reply: "0" };
    for (const [key, value] of Object.entries(opts.events || {})) {
      if (/^[a-z_]+$/.test(key)) eventParams[key] = value ? "1" : "0";
    }
    await vkCall("groups.setCallbackSettings", {
      group_id: vkGroupId(),
      server_id: String(serverId),
      api_version: "5.199",
      ...eventParams,
    });
    steps.push(
      `События Callback: ${Object.entries(eventParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")} (setCallbackSettings)`
    );

    // ⚠️ КРИТИЧНО: пока в сообществе включён Bots Long Poll API, события уходят в его
    // очередь (она живёт на стороне ВК) и в Callback НЕ приходят — при этом настройки
    // Callback выглядят включёнными. В serverless-контейнере держать Long Poll-сессию
    // нечем, поэтому очередь просто копится. Основной канал — Callback, Long Poll гасим.
    try {
      await vkCall("groups.setLongPollSettings", {
        group_id: vkGroupId(),
        enabled: "0",
        api_version: "5.199",
      });
      steps.push("Bots Long Poll API отключён — события идут только в Callback API");
    } catch (err: any) {
      steps.push(`Не удалось отключить Bots Long Poll API: ${err.message}`);
    }

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

    // Логируем КАЖДЫЙ запрос от VK: так сразу видно, доставляет ли VK события
    // (в том числе `confirmation` — по нему видно, прошла ли проверка адреса).
    logInfo(`[VK Callback] → event type=${type || "(empty)"} event_id=${body.event_id ?? "-"} group=${body.group_id ?? "-"} v=${body.v ?? "-"}`);
    const tracked = trackEvent({
      at: Date.now(),
      type: type || "(empty)",
      eventId: body.event_id !== undefined ? String(body.event_id) : undefined,
      peerId: body.object?.message?.peer_id ? String(body.object.message.peer_id) : undefined,
      fromId: body.object?.message?.from_id,
      replyTo: body.object?.message?.reply_message?.id,
      text: body.object?.message?.text ? String(body.object.message.text).slice(0, 80) : undefined,
    });

    if (secret && String(body.secret || "") !== secret) {
      logWarn(`[VK Callback] Rejected event type=${type}: bad secret`);
      return res.status(403).send("forbidden");
    }

    if (type === "confirmation") {
      try {
        const code = await getVkCallbackConfirmationCode();
        logInfo("[VK Callback] Confirmation request answered");
        void persistRecentVkEvents();
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

      if (!text) { tracked.note = "пустой текст"; return; }
      if (groupId && fromId === -groupId) { tracked.note = "наше собственное сообщение"; return; } // наше собственное сообщение
      // Только ответы («Ответить» на наше уведомление) — обычные сообщения в беседе
      // не пересылаем: там идут посторонние заявки, клиенту они не нужны.
      if (!replyTo) {
        tracked.note = "не ответ на уведомление — пропущено";
        logInfo(`[VK Callback] message_new peer=${peerId} без «Ответа» — пропущено`);
        return;
      }

      // Сравниваем с обрезкой пробелов/переводов строк: в env-секрете значение может
      // прийти с хвостовым пробелом, и тогда фильтр молча резал все сообщения.
      const configuredPeer = String(process.env.VK_CHAT_PEER_ID || "").trim();
      if (configuredPeer && peerId !== configuredPeer) {
        tracked.note = `peer ${peerId} ≠ настроенного ${configuredPeer}`;
        logWarn(`[VK Callback] message_new from peer ${peerId} — not the notification chat (${configuredPeer}), skipped`);
        return;
      }

      logInfo(`[VK Callback] message_new peer=${peerId} from=${fromId} reply_to=${replyTo} text="${text.slice(0, 60)}"`);
      const debug: { route?: string } = {};
      tracked.delivered = await deliverVkAdminMessage({
        vkMessageId: replyTo,
        incomingMessageId: incomingId,
        text: text.replace(/^\[Ответ\][^\n]*\n?/m, "").trim(),
        invalidate: chatCacheInvalidate,
        debug,
      });
      tracked.route = debug.route;
    } catch (err: any) {
      logError("[VK Callback] message_new handling failed:", err.message);
    } finally {
      // Журнал событий кладём в БД: инстансов в serverless несколько, и по памяти
      // потом не видно, кто и как обработал событие.
      await persistRecentVkEvents();
    }
  });

  const peerForLog = String(process.env.VK_CHAT_PEER_ID || "").trim();
  logInfo(
    `[VK Callback] Webhook registered at /api/vk/callback (chat filter: ${peerForLog || "любой peer"})`
  );
}
