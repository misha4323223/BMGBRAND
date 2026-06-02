import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3Client = new S3Client({
  region: "ru-central1",
  endpoint: "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || process.env.YC_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || process.env.YC_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.YANDEX_STORAGE_BUCKET_NAME || "bmg";

async function listImages(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
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
}

async function downloadImage(key: string): Promise<Buffer | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });
    const response = await s3Client.send(command);
    const byteArray = await response.Body?.transformToByteArray();
    return byteArray ? Buffer.from(byteArray) : null;
  } catch (error) {
    console.error(`Failed to download ${key}:`, error);
    return null;
  }
}

async function uploadWebP(key: string, buffer: Buffer): Promise<string | null> {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      ACL: "public-read",
      CacheControl: "public, max-age=31536000, immutable",
    });
    await s3Client.send(command);
    return `https://storage.yandexcloud.net/${BUCKET}/${key}`;
  } catch (error) {
    console.error(`Failed to upload ${key}:`, error);
    return null;
  }
}

async function convertToWebP(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .webp({ quality: 85 })
    .toBuffer();
}

async function main() {
  console.log("Listing images in bucket...");
  
  const allKeys = await listImages("products/");
  
  const imageKeys = allKeys.filter(key => 
    key.endsWith(".jpg") || 
    key.endsWith(".jpeg") || 
    key.endsWith(".png") ||
    key.endsWith(".JPG") ||
    key.endsWith(".JPEG") ||
    key.endsWith(".PNG")
  );
  
  console.log(`Found ${imageKeys.length} images to convert`);
  
  let converted = 0;
  let failed = 0;
  
  for (const key of imageKeys) {
    const webpKey = key.replace(/\.(jpg|jpeg|png)$/i, ".webp");
    
    // Check if WebP already exists
    const existingWebP = allKeys.find(k => k === webpKey);
    if (existingWebP) {
      console.log(`[SKIP] ${key} - WebP already exists`);
      continue;
    }
    
    console.log(`[CONVERT] ${key} -> ${webpKey}`);
    
    const originalBuffer = await downloadImage(key);
    if (!originalBuffer) {
      console.error(`[FAIL] Could not download ${key}`);
      failed++;
      continue;
    }
    
    try {
      const webpBuffer = await convertToWebP(originalBuffer);
      const url = await uploadWebP(webpKey, webpBuffer);
      
      if (url) {
        console.log(`[OK] ${url}`);
        converted++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`[FAIL] Conversion error for ${key}:`, error);
      failed++;
    }
  }
  
  console.log(`\nDone! Converted: ${converted}, Failed: ${failed}`);
}

main().catch(console.error);
