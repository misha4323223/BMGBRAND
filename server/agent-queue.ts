import { storage } from "./storage";

const QUEUE_KEY = "agent_queue";
const LOG_KEY = "agent_log";
const SETTINGS_KEY = "agent_settings";
const MAX_LOG_ENTRIES = 100;
const MAX_QUEUE_ITEMS = 200;

export type QueueItemStatus = "pending" | "approved" | "rejected" | "executed";
export type QueueItemType =
  | "discount"
  | "description"
  | "hide_product"
  | "seo"
  | "blog_draft"
  | "review_reply"
  | "promo_code"
  | "cart_promo";

export interface QueueItem {
  id: string;
  type: QueueItemType;
  title: string;
  description: string;
  params: any;
  tool: string;
  createdAt: string;
  status: QueueItemStatus;
  executedAt?: string;
  error?: string;
}

export interface LogEntry {
  id: string;
  type: string;
  action: string;
  summary: string;
  createdAt: string;
  isAuto: boolean;
}

export interface AgentSettings {
  enabled: boolean;
  seoEnabled: boolean;
  alertsEnabled: boolean;
  digestEnabled: boolean;
}

const DEFAULT_SETTINGS: AgentSettings = {
  enabled: true,
  seoEnabled: true,
  alertsEnabled: true,
  digestEnabled: true,
};

// ── Queue ──────────────────────────────────────────────────────────────────

async function readQueue(): Promise<QueueItem[]> {
  try {
    const raw = await (storage as any).getBonusSetting(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeQueue(items: QueueItem[]): Promise<void> {
  await (storage as any).setBonusSetting(QUEUE_KEY, JSON.stringify(items));
}

export async function getQueue(status?: QueueItemStatus): Promise<QueueItem[]> {
  const items = await readQueue();
  if (status) return items.filter((i) => i.status === status);
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addToQueue(
  item: Omit<QueueItem, "id" | "createdAt" | "status">
): Promise<QueueItem> {
  const items = await readQueue();
  const newItem: QueueItem = {
    ...item,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  items.push(newItem);
  await writeQueue(items.slice(-MAX_QUEUE_ITEMS));
  return newItem;
}

export async function updateQueueItemStatus(
  id: string,
  status: QueueItemStatus,
  extra?: { executedAt?: string; error?: string }
): Promise<QueueItem | null> {
  const items = await readQueue();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], status, ...extra };
  await writeQueue(items);
  return items[idx];
}

export async function getQueueItemById(id: string): Promise<QueueItem | null> {
  const items = await readQueue();
  return items.find((i) => i.id === id) ?? null;
}

// ── Log ───────────────────────────────────────────────────────────────────

async function readLog(): Promise<LogEntry[]> {
  try {
    const raw = await (storage as any).getBonusSetting(LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addLogEntry(
  entry: Omit<LogEntry, "id" | "createdAt">
): Promise<void> {
  try {
    const log = await readLog();
    const newEntry: LogEntry = {
      ...entry,
      id: `log_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    log.unshift(newEntry);
    await (storage as any).setBonusSetting(
      LOG_KEY,
      JSON.stringify(log.slice(0, MAX_LOG_ENTRIES))
    );
  } catch (e: any) {
    console.error("[AgentQueue] addLogEntry failed:", e?.message);
  }
}

export async function getLog(): Promise<LogEntry[]> {
  return readLog();
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getAgentSettings(): Promise<AgentSettings> {
  try {
    const raw = await (storage as any).getBonusSetting(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveAgentSettings(
  settings: Partial<AgentSettings>
): Promise<AgentSettings> {
  const current = await getAgentSettings();
  const updated = { ...current, ...settings };
  await (storage as any).setBonusSetting(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}
