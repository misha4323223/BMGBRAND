import type { Express } from "express";
import { logError } from "../logger";
import { storage } from "../storage";

// Artists / tracks API extracted from routes.ts (public + admin routes).
export function registerArtistsRoutes(
  app: Express,
  requireAdminOrApiKey: (req: any, res: any, next: any) => void
) {
  // GET /api/artists/:slug/promo — public: promo code for artist page display
  app.get("/api/artists/:slug/promo", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json({ promoCode: null });
      const partner = await storage.getPartnerBySlug(slug);
      if (!partner || !partner.isArtist) return res.json({ promoCode: null });
      const promo = await storage.getPartnerPromoCode(partner.id);
      if (!promo || !promo.isActive) return res.json({ promoCode: null });
      res.set("Cache-Control", "public, max-age=120");
      res.json({ promoCode: { code: promo.code, discountPercent: promo.discountPercent } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/artists/:slug/likes — public: get like count
  app.get("/api/artists/:slug/likes", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json({ likes: 0 });
      const key = `artist_likes_${slug}`;
      const raw = await storage.getBonusSetting(key);
      const likes = raw ? parseInt(raw, 10) : 0;
      res.set("Cache-Control", "public, max-age=10");
      res.json({ likes: isNaN(likes) ? 0 : likes });
    } catch {
      res.json({ likes: 0 });
    }
  });

  // POST /api/artists/:slug/like — public: increment like count
  app.post("/api/artists/:slug/like", async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) return res.json({ likes: 0 });
      const key = `artist_likes_${slug}`;
      const raw = await storage.getBonusSetting(key);
      const current = raw ? parseInt(raw, 10) : 0;
      const newCount = (isNaN(current) ? 0 : current) + 1;
      await storage.setBonusSetting(key, String(newCount));
      res.json({ likes: newCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/artists/:slug/view — public: increment page view counter (fire-and-forget)
  app.post("/api/artists/:slug/view", async (req, res) => {
    try {
      const { slug } = req.params;
      if (slug) {
        const key = `artist_page_views_${slug}`;
        const raw = await storage.getBonusSetting(key);
        const current = raw ? parseInt(raw, 10) : 0;
        await storage.setBonusSetting(key, String((isNaN(current) ? 0 : current) + 1));
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  // ─── Artist Tracks API ──────────────────────────────────────────────────────

  // GET /api/artists/all-tracks — public: all active tracks grouped by artist
  app.get("/api/artists/all-tracks", async (req, res) => {
    try {
      const artists = await storage.getArtistPartners();
      const result = await Promise.all(
        artists
          .map(async a => {
            const tracks = await storage.getArtistTracks(a.partnerSlug, false);
            if (tracks.length === 0) return null;
            return {
              slug: a.partnerSlug,
              name: a.storeName || a.contactName || a.partnerSlug,
              tracks,
            };
          })
      );
      res.json({ artists: result.filter(Boolean) });
    } catch (err: any) {
      logError("[all-tracks] error:", err.message);
      res.json({ artists: [] });
    }
  });

  // GET /api/artists/:slug/tracks — public: get active tracks
  app.get("/api/artists/:slug/tracks", async (req, res) => {
    try {
      const { slug } = req.params;
      const tracks = await storage.getArtistTracks(slug, false);
      res.json({ tracks });
    } catch (err: any) {
      logError("[tracks] get error:", err.message);
      res.json({ tracks: [] });
    }
  });

  // GET /api/admin/artists/:slug/tracks — admin: get all tracks (incl. inactive)
  app.get("/api/admin/artists/:slug/tracks", requireAdminOrApiKey, async (req, res) => {
    try {
      const { slug } = req.params;
      const tracks = await storage.getArtistTracks(slug, true);
      res.json({ tracks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/artists/:slug/tracks — admin: create track (JSON body with URLs)
  app.post("/api/admin/artists/:slug/tracks", requireAdminOrApiKey, async (req, res) => {
    try {
      const { slug } = req.params;
      const { title, subtitle, audioUrl, coverUrl, duration, trackOrder } = req.body || {};
      if (!title || !audioUrl) return res.status(400).json({ error: "title and audioUrl required" });
      const track = await storage.createArtistTrack({
        artistSlug: slug,
        title: String(title),
        subtitle: String(subtitle || ""),
        audioUrl: String(audioUrl),
        coverUrl: String(coverUrl || ""),
        duration: Number(duration) || 0,
        trackOrder: Number(trackOrder) || 0,
      });
      res.json({ track });
    } catch (err: any) {
      logError("[tracks] create error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/admin/artists/tracks/:id — admin: update track metadata
  app.patch("/api/admin/artists/tracks/:id", requireAdminOrApiKey, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });
      const { title, subtitle, audioUrl, coverUrl, duration, trackOrder, isActive } = req.body || {};
      await storage.updateArtistTrack(id, { title, subtitle, audioUrl, coverUrl, duration, trackOrder, isActive });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/artists/tracks/:id — admin: delete track
  app.delete("/api/admin/artists/tracks/:id", requireAdminOrApiKey, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });
      await storage.deleteArtistTrack(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/artists/tracks/:id/play — public: batch-increment play count
  app.post("/api/artists/tracks/:id/play", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 100);
      if (id > 0) await storage.incrementTrackPlays(id, count);
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  // POST /api/admin/artists/:slug/presign-audio — admin: get presigned URL for direct S3 upload
  app.post("/api/admin/artists/:slug/presign-audio", requireAdminOrApiKey, async (req, res) => {
    try {
      const { slug } = req.params;
      const { filename, contentType } = req.body || {};
      if (!filename || !contentType) return res.status(400).json({ error: "filename and contentType required" });
      const { generateAudioPresignedUrl } = await import("../lib/storage-s3");
      const result = await generateAudioPresignedUrl(slug, filename, contentType);
      if (!result) return res.status(500).json({ error: "Failed to generate presigned URL — check YOS credentials" });
      res.json(result);
    } catch (err: any) {
      logError("[presign-audio]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/artists/:slug/upload-audio — admin: upload MP3/M4A to YOS (legacy, kept for compatibility)
  app.post("/api/admin/artists/:slug/upload-audio", requireAdminOrApiKey, async (req, res) => {
    try {
      const { slug } = req.params;
      const contentType = (req.headers["content-type"] || "audio/mpeg").split(";")[0].trim();
      const rawFilename = (req.headers["x-filename"] as string) || `audio_${Date.now()}.mp3`;
      const filename = (() => { try { return decodeURIComponent(rawFilename); } catch { return rawFilename; } })();

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) return res.status(400).json({ error: "Empty file" });

      const { uploadAudioToYOS } = await import("../lib/storage-s3");
      const url = await uploadAudioToYOS(buffer, slug, filename, contentType);
      if (!url) return res.status(500).json({ error: "Upload failed — check YOS credentials" });
      res.json({ url });
    } catch (err: any) {
      logError("[upload-audio]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/artists/:slug/upload-track-cover — admin: upload track cover to YOS
  app.post("/api/admin/artists/:slug/upload-track-cover", requireAdminOrApiKey, async (req, res) => {
    try {
      const { slug } = req.params;
      const contentType = (req.headers["content-type"] || "image/jpeg").split(";")[0].trim();

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) return res.status(400).json({ error: "Empty file" });

      const { uploadTrackCoverToYOS } = await import("../lib/storage-s3");
      const url = await uploadTrackCoverToYOS(buffer, slug, contentType);
      if (!url) return res.status(500).json({ error: "Upload failed — check YOS credentials" });
      res.json({ url });
    } catch (err: any) {
      logError("[upload-track-cover]", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
