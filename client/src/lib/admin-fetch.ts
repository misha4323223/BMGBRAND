// Общий admin-хелпер: запросы к API с ключом, JSON-парсинг, логирование.
// Вынесен из Admin.tsx (Фаза 1 рефакторинга).
export async function adminFetch(url: string, apiKey: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    ...(options.headers as Record<string, string>),
  };
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  
  console.log(`[adminFetch] ${options.method || 'GET'} ${url} body-length: ${options.body ? (options.body as string).length : 0}`);
  
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (networkErr: any) {
    console.error(`[adminFetch] Network error for ${options.method || 'GET'} ${url}:`, networkErr.message);
    throw networkErr;
  }
  
  console.log(`[adminFetch] Response: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`[adminFetch] Non-JSON response from ${url}:`, text.substring(0, 200));
    throw new Error("Server returned non-JSON response");
  }
}

