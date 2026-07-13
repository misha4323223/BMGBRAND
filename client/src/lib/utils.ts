import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Derives the small (~120px) thumbnail URL uploaded alongside a track cover
// (see server/lib/storage-s3.ts uploadTrackCoverToYOS) without any API/DB change.
// Falls back to the original URL if it doesn't match the expected naming pattern
// (e.g. covers uploaded before the thumb existed, until backfilled).
export function getTrackCoverThumb(coverUrl: string | undefined | null): string | undefined {
  if (!coverUrl) return coverUrl ?? undefined;
  return coverUrl.replace(/\.[a-z0-9]+$/i, "_thumb.webp");
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
