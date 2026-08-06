/**
 * Virtual Try-On module (OOTDiffusion via Hugging Face Spaces)
 *
 * Чтобы полностью удалить фичу:
 *   1. Удалить этот файл
 *   2. Убрать import + вызов registerVirtualTryOnRoutes в server/index.ts
 *   3. Удалить client/src/components/VirtualTryOn.tsx
 *   4. Убрать <VirtualTryOn> из client/src/pages/ProductDetail.tsx
 */

import { Express, Request, Response } from 'express';
import multer from 'multer';

const SPACE_URL = 'https://levihsu-ootdiffusion.hf.space';
const HF_TOKEN = process.env.HF_TOKEN;
const TIMEOUT_MS = 4 * 60 * 1000; // 4 минуты — HF бесплатный tier может быть медленным

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 МБ
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

function hfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (HF_TOKEN) headers['Authorization'] = `Bearer ${HF_TOKEN}`;
  return headers;
}

/** Загружает Buffer на HF Space и возвращает серверный path */
async function uploadToSpace(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const blob = new Blob([buffer], { type: mimeType });
  const fd = new FormData();
  fd.append('files', blob, filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${SPACE_URL}/gradio_api/upload`, {
      method: 'POST',
      headers: hfHeaders(),
      body: fd,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upload HTTP ${res.status}: ${await res.text()}`);
    const paths = await res.json() as string[];
    if (!paths?.[0]) throw new Error('Upload вернул пустой ответ');
    return paths[0];
  } finally {
    clearTimeout(timer);
  }
}

/** Скачивает URL и загружает файл на HF Space */
async function fetchAndUploadToSpace(url: string, filename: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Не удалось скачать ${url}: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return await uploadToSpace(buffer, filename, mimeType);
  } finally {
    clearTimeout(timer);
  }
}

/** Вызывает /process_hd и ждёт SSE-события complete */
async function runTryOn(vtonPath: string, garmPath: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // 1. Запустить задачу — оба изображения передаём как path (уже на Space)
    const joinRes = await fetch(`${SPACE_URL}/gradio_api/call/process_hd`, {
      method: 'POST',
      headers: hfHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        data: [
          { path: vtonPath, meta: { _type: 'gradio.FileData' } }, // vton_img — фото человека
          { path: garmPath, meta: { _type: 'gradio.FileData' } }, // garm_img — одежда
          1,    // n_samples
          20,   // n_steps
          2.0,  // image_scale (guidance scale)
          -1,   // seed (-1 = random)
        ],
      }),
      signal: controller.signal,
    });

    if (!joinRes.ok) {
      const txt = await joinRes.text();
      throw new Error(`Запуск модели: HTTP ${joinRes.status} — ${txt}`);
    }

    const { event_id } = await joinRes.json() as { event_id: string };
    if (!event_id) throw new Error('event_id не получен');

    // 2. Читать SSE-поток до события complete
    const pollRes = await fetch(`${SPACE_URL}/gradio_api/call/process_hd/${event_id}`, {
      headers: hfHeaders(),
      signal: controller.signal,
    });

    if (!pollRes.ok || !pollRes.body) {
      throw new Error(`Polling HTTP ${pollRes.status}`);
    }

    // Читаем весь текст (блокирующий, ждём complete)
    const text = await pollRes.text();
    const blocks = text.split('\n\n').filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const eventType = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
      const dataRaw  = lines.find(l => l.startsWith('data:'))?.slice(5).trim();

      if (eventType === 'error') {
        // {"error": null} — задача отклонена Space без сообщения (перегруз / cold start)
        let errMsg = 'Space отклонил задачу';
        try {
          const parsed = JSON.parse(dataRaw ?? '{}');
          if (parsed?.error) errMsg = String(parsed.error);
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      if (eventType === 'complete' && dataRaw) {
        let parsed: unknown;
        try { parsed = JSON.parse(dataRaw); } catch { continue; }

        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const img = arr[0] as { url?: string; path?: string } | null;
        if (!img) throw new Error('Пустой результат от модели');

        // Возвращаем URL из Space (публично доступен пока Space запущен)
        const url = img.url ?? (img.path ? `${SPACE_URL}/gradio_api/file=${img.path}` : null);
        if (!url) throw new Error('URL результата не найден в ответе');
        return url;
      }
    }

    throw new Error('complete-событие не получено — возможно, Space перегружен');
  } finally {
    clearTimeout(timer);
  }
}

export function registerVirtualTryOnRoutes(app: Express): void {
  /**
   * POST /api/virtual-tryon
   * multipart/form-data:
   *   personPhoto — файл (image/*)
   *   garmentUrl  — публичный URL фото товара
   */
  app.post(
    '/api/virtual-tryon',
    upload.single('personPhoto'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const file = req.file;
        const garmentUrl = typeof req.body.garmentUrl === 'string' ? req.body.garmentUrl.trim() : '';

        if (!file) {
          res.status(400).json({ error: 'Прикрепите фото (поле personPhoto)' });
          return;
        }
        if (!garmentUrl) {
          res.status(400).json({ error: 'Укажите garmentUrl' });
          return;
        }

        console.log('[VirtualTryOn] Запрос:', file.originalname, file.size, 'bytes, garment:', garmentUrl.slice(0, 60));

        // Загружаем оба фото на HF Space — так модель точно их видит
        const [vtonPath, garmPath] = await Promise.all([
          uploadToSpace(file.buffer, file.originalname || 'photo.jpg', file.mimetype),
          fetchAndUploadToSpace(garmentUrl, 'garment.jpg'),
        ]);
        console.log('[VirtualTryOn] Оба фото загружены. person:', vtonPath.slice(-20), 'garment:', garmPath.slice(-20));

        const resultUrl = await runTryOn(vtonPath, garmPath);
        console.log('[VirtualTryOn] Готово:', resultUrl.slice(0, 80));

        res.json({ resultUrl });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[VirtualTryOn] Ошибка:', msg);

        if (msg.includes('aborted') || msg.includes('abort')) {
          res.status(504).json({ error: 'Превышено время ожидания. HF Space, возможно, перегружен — попробуйте позже.' });
        } else {
          res.status(500).json({ error: msg });
        }
      }
    },
  );
}
