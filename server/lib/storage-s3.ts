import { S3Client } from "@aws-sdk/client-s3";
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
