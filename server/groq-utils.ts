/**
 * Shared Groq helper — STREAMING chat.completions call, exactly like the
 * working chat widget / product-info routes (gpt-oss-20b does NOT respond
 * reliably in non-streaming mode through the proxy, but streams fine).
 *
 * Accumulates the streamed content (stripping any <think>…</think> reasoning)
 * and returns the final visible text. Throws on non-2xx with `.status` set
 * so callers can implement their own 429/retry logic.
 */
export interface GroqStreamOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function groqCompleteStream(opts: GroqStreamOptions): Promise<string> {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    temperature = 0.3,
    maxTokens = 1000,
    signal,
  } = opts;

  const resp = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      const body = await resp.json();
      detail = body?.error?.message || JSON.stringify(body).slice(0, 200);
    } catch {
      /* ignore */
    }
    const err: any = new Error(`Groq error: ${resp.status}${detail ? ` — ${detail}` : ""}`);
    err.status = resp.status;
    throw err;
  }

  if (!resp.body) throw new Error("Groq: пустое тело ответа");

  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") content += delta;
      } catch {
        /* ignore partial JSON lines */
      }
    }
  }

  // Reasoning models may still emit <think>…</think> in streamed deltas.
  content = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();

  return content;
}
