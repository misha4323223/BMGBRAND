import { S3Client, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const s3Client = new S3Client({
  region: "ru-central1",
  endpoint: "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.YANDEX_STORAGE_ACCESS_KEY || "",
    secretAccessKey: process.env.YANDEX_STORAGE_SECRET_KEY || "",
  },
});

export async function uploadToYandexStorage(fileBuffer: Buffer, fileName: string, contentType: string) {
  if (!process.env.YANDEX_STORAGE_BUCKET_NAME) {
    console.warn("YANDEX_STORAGE_BUCKET_NAME is not set, skipping upload");
    return null;
  }

  // Keep original path structure (convert backslashes to forward slashes)
  const cleanPath = fileName.replace(/\\/g, '/');

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: process.env.YANDEX_STORAGE_BUCKET_NAME,
      Key: `products/${cleanPath}`,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: "public-read",
    },
  });

  await upload.done();
  return `https://storage.yandexcloud.net/${process.env.YANDEX_STORAGE_BUCKET_NAME}/products/${cleanPath}`;
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
