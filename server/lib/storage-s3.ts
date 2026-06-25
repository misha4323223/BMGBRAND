import { S3Client, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import crypto from "crypto";

const s3Client = new S3Client({
  region: "ru-central1",
  endpoint: "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
  },
});

export async function uploadToYandexStorage(fileBuffer: Buffer, fileName: string, contentType: string) {
  const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME;
  const accessKey = process.env.YANDEX_STORAGE_ACCESS_KEY;
  const secretKey = process.env.YANDEX_STORAGE_SECRET_KEY;
  
  if (!bucketName) {
    console.warn("[S3] YANDEX_STORAGE_BUCKET_NAME is not set, skipping upload");
    return null;
  }
  
  if (!accessKey || !secretKey) {
    console.error("[S3] YANDEX_STORAGE_ACCESS_KEY or SECRET_KEY not set!");
    return null;
  }

  // Keep original path structure (convert backslashes to forward slashes)
  const cleanPath = fileName.replace(/\\/g, '/');
  const key = `products/${cleanPath}`;
  
  // Calculate MD5 for integrity check
  const md5Hash = crypto.createHash('md5').update(fileBuffer).digest('base64');
  console.log(`[S3] Starting upload: ${key}, size: ${fileBuffer.length}, type: ${contentType}, md5: ${md5Hash}`);

  try {
    // Use PutObjectCommand with ContentMD5 for integrity verification
    // S3 will reject the upload if MD5 doesn't match
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ContentMD5: md5Hash,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    });

    await s3Client.send(putCommand);
    const url = `https://storage.yandexcloud.net/${bucketName}/${key}`;
    
    // Verify upload succeeded by checking if file exists and size matches
    const verifyCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    
    try {
      const headResult = await s3Client.send(verifyCommand);
      const uploadedSize = headResult.ContentLength || 0;
      
      if (uploadedSize !== fileBuffer.length) {
        console.error(`[S3] SIZE MISMATCH! Uploaded: ${uploadedSize}, Expected: ${fileBuffer.length}`);
        return null;
      }
      
      console.log(`[S3] Upload VERIFIED: ${url}, size: ${uploadedSize}`);
      return url;
    } catch (verifyError: any) {
      console.error(`[S3] Upload appeared successful but verification FAILED for ${key}:`, verifyError.message);
      return null;
    }
  } catch (error: any) {
    console.error(`[S3] Upload FAILED for ${key}:`, error.message || error);
    if (error.Code) console.error(`[S3] Error code: ${error.Code}`);
    if (error.$metadata) console.error(`[S3] HTTP status: ${error.$metadata.httpStatusCode}`);
    throw error;
  }
}

export async function downloadFromYandexStorage(key: string): Promise<string | null> {
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    console.warn("YANDEX_STORAGE_BUCKET_NAME is not set");
    return null;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.YANDEX_STORAGE_BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    const body = await response.Body?.transformToString("utf-8");
    return body || null;
  } catch (error) {
    console.error(`Failed to download ${key} from Object Storage:`, error);
    return null;
  }
}

export async function downloadBinaryFromYandexStorage(key: string): Promise<Buffer | null> {
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    return null;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.YANDEX_STORAGE_BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    const byteArray = await response.Body?.transformToByteArray();
    return byteArray ? Buffer.from(byteArray) : null;
  } catch (error) {
    console.error(`Failed to download binary ${key}:`, error);
    return null;
  }
}

export async function listObjectsFromYandexStorage(prefix: string): Promise<string[]> {
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    return [];
  }

  const keys: string[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: process.env.YANDEX_STORAGE_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);
      if (response.Contents) {
        keys.push(...response.Contents.map(obj => obj.Key!).filter(Boolean));
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  } catch (error) {
    console.error(`Failed to list objects with prefix ${prefix}:`, error);
    return [];
  }
}

export async function deleteFromYandexStorage(key: string): Promise<boolean> {
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    return false;
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.YANDEX_STORAGE_BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error(`Failed to delete ${key}:`, error);
    return false;
  }
}

// ─── Приватные документы выплат партнёрам (счета и чеки самозанятых) ──────
// В отличие от uploadToYandexStorage (картинки товаров → префикс products/, ACL public-read),
// эти файлы:
//   • кладутся в префикс `payouts/{partnerId}/{payoutId}/...`
//   • НЕ имеют public-read ACL — скачиваются строго через наш сервер
//     с проверкой прав (партнёр видит только своё, админ видит всё).
//   • не кэшируются на CDN.
// Возвращает S3-ключ (а не URL), потому что URL приватный и не должен быть прямой ссылкой.
export async function uploadPayoutDocument(
  fileBuffer: Buffer,
  payoutId: number,
  partnerId: number,
  kind: "invoice" | "receipt" | "act",
  ext: string,
  contentType: string,
): Promise<string | null> {
  const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME;
  const accessKey = process.env.YANDEX_STORAGE_ACCESS_KEY;
  const secretKey = process.env.YANDEX_STORAGE_SECRET_KEY;

  if (!bucketName) {
    console.warn("[S3 payout] YANDEX_STORAGE_BUCKET_NAME is not set");
    return null;
  }
  if (!accessKey || !secretKey) {
    console.error("[S3 payout] YANDEX_STORAGE_ACCESS_KEY or SECRET_KEY not set!");
    return null;
  }

  // Sanitize ext (только буквы/цифры, max 8 символов)
  const safeExt = String(ext || "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) || "bin";
  const ts = Date.now();
  const key = `payouts/${partnerId}/${payoutId}/${kind}-${ts}.${safeExt}`;

  const md5Hash = crypto.createHash("md5").update(fileBuffer).digest("base64");
  console.log(`[S3 payout] Upload: ${key}, size: ${fileBuffer.length}, type: ${contentType}`);

  try {
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ContentMD5: md5Hash,
      // ACL не указываем → дефолт private; CDN-кэш отключаем
      CacheControl: "private, no-cache, no-store, must-revalidate",
    });
    await s3Client.send(putCommand);

    // Verify size
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    if ((head.ContentLength || 0) !== fileBuffer.length) {
      console.error(`[S3 payout] SIZE MISMATCH for ${key}`);
      return null;
    }
    console.log(`[S3 payout] Uploaded OK: ${key}`);
    return key;
  } catch (error: any) {
    console.error(`[S3 payout] Upload FAILED for ${key}:`, error.message || error);
    throw error;
  }
}

// Скачать приватный документ выплаты как Buffer (используется в admin/partner endpoints).
// Принимает S3-ключ (не URL).
export async function downloadPayoutDocument(
  key: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME;
  if (!bucketName) return null;
  // Защита: ключ должен начинаться с payouts/ (no path traversal)
  if (!key.startsWith("payouts/") || key.includes("..")) {
    console.warn(`[S3 payout] Refusing to download key outside payouts/: ${key}`);
    return null;
  }
  try {
    const resp = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const bytes = await resp.Body?.transformToByteArray();
    if (!bytes) return null;
    return {
      buffer: Buffer.from(bytes),
      contentType: resp.ContentType || "application/octet-stream",
    };
  } catch (error: any) {
    console.error(`[S3 payout] Download FAILED for ${key}:`, error.message || error);
    return null;
  }
}

// ─── Загрузка аудиофайлов треков артистов ────────────────────────────────────
// Prefix: artists/{slug}/tracks/
// ACL: public-read (треки публичные)
// Без конвертации — MP3/M4A загружаем как есть.
export async function uploadAudioToYOS(
  fileBuffer: Buffer,
  artistSlug: string,
  originalName: string,
  contentType: string,
): Promise<string | null> {
  const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME;
  const accessKey = process.env.YANDEX_STORAGE_ACCESS_KEY;
  const secretKey = process.env.YANDEX_STORAGE_SECRET_KEY;

  if (!bucketName || !accessKey || !secretKey) {
    console.warn("[S3 audio] Storage credentials not set, skipping upload");
    return null;
  }

  const safeSlug = artistSlug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const ext = originalName.split(".").pop()?.toLowerCase() || "mp3";
  const safeExt = ["mp3", "m4a", "aac", "ogg", "wav", "flac"].includes(ext) ? ext : "mp3";
  const ts = Date.now();
  const key = `artists/${safeSlug}/tracks/audio-${ts}.${safeExt}`;

  const md5Hash = crypto.createHash("md5").update(fileBuffer).digest("base64");
  console.log(`[S3 audio] Uploading: ${key}, size: ${fileBuffer.length}, type: ${contentType}`);

  try {
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ContentMD5: md5Hash,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    });
    await s3Client.send(putCommand);

    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    if ((head.ContentLength || 0) !== fileBuffer.length) {
      console.error(`[S3 audio] SIZE MISMATCH for ${key}`);
      return null;
    }

    const url = `https://storage.yandexcloud.net/${bucketName}/${key}`;
    console.log(`[S3 audio] Uploaded OK: ${url}`);
    return url;
  } catch (error: any) {
    console.error(`[S3 audio] Upload FAILED for ${key}:`, error.message || error);
    throw error;
  }
}

// ─── Загрузка обложки трека (WebP через sharp) ───────────────────────────────
export async function uploadTrackCoverToYOS(
  fileBuffer: Buffer,
  artistSlug: string,
  contentType: string,
): Promise<string | null> {
  const bucketName = process.env.YANDEX_STORAGE_BUCKET_NAME;
  const accessKey = process.env.YANDEX_STORAGE_ACCESS_KEY;
  const secretKey = process.env.YANDEX_STORAGE_SECRET_KEY;

  if (!bucketName || !accessKey || !secretKey) {
    console.warn("[S3 cover] Storage credentials not set, skipping upload");
    return null;
  }

  let processedBuffer = fileBuffer;
  let finalContentType = contentType;

  // Convert to WebP if it's a raster image
  if (!contentType.includes("svg")) {
    try {
      const sharp = (await import("sharp")).default;
      processedBuffer = await sharp(fileBuffer)
        .resize(800, 800, { fit: "cover", position: "center" })
        .webp({ quality: 88 })
        .toBuffer();
      finalContentType = "image/webp";
    } catch (e: any) {
      console.warn("[S3 cover] sharp conversion failed, uploading original:", e.message);
    }
  }

  const safeSlug = artistSlug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const ext = finalContentType.includes("webp") ? "webp" : finalContentType.includes("svg") ? "svg" : "jpg";
  const ts = Date.now();
  const key = `artists/${safeSlug}/tracks/cover-${ts}.${ext}`;

  const md5Hash = crypto.createHash("md5").update(processedBuffer).digest("base64");

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: processedBuffer,
      ContentType: finalContentType,
      ContentMD5: md5Hash,
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    const url = `https://storage.yandexcloud.net/${bucketName}/${key}`;
    console.log(`[S3 cover] Uploaded OK: ${url}`);
    return url;
  } catch (error: any) {
    console.error(`[S3 cover] Upload FAILED for ${key}:`, error.message || error);
    throw error;
  }
}

// Check if file exists in Object Storage
export async function checkFileExistsInYandexStorage(key: string): Promise<boolean> {
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    return false;
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: process.env.YANDEX_STORAGE_BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    // NotFound means file doesn't exist
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    // Log other errors but return false
    console.error(`Failed to check existence of ${key}:`, error.name || error);
    return false;
  }
}
