// Artist tracks storage (2.4.5g).
// Extends DatabaseStorage via typed prototype assignment (module augmentation).
// The single DatabaseStorage instance lives in core.ts; this file patches its
// prototype so all `this.` calls (helpers, caches, cross-domain methods) work as before.
import { DatabaseStorage } from "./core";
import type { ArtistTrack } from "./core";

declare module "./core" {
  interface DatabaseStorage {
    getArtistTracks(artistSlug: string, adminMode?: boolean): Promise<ArtistTrack[]>;
    createArtistTrack(data: { artistSlug: string; title: string; subtitle?: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number }): Promise<ArtistTrack>;
    updateArtistTrack(id: number, data: Partial<{ title: string; subtitle: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number; isActive: boolean }>): Promise<void>;
    deleteArtistTrack(id: number): Promise<void>;
    incrementTrackPlays(id: number, count?: number): Promise<void>;
  }
}

// --- prototype assignments (byte-for-byte bodies from core.ts) ---
DatabaseStorage.prototype.getArtistTracks = async function (this: DatabaseStorage, artistSlug: string, adminMode = false): Promise<ArtistTrack[]> {
    const result = await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      const whereActive = adminMode ? '' : 'AND is_active = true';
      const { resultSets } = await session.executeQuery(
        `DECLARE $artist_slug AS Utf8;
         SELECT id, artist_slug, title, subtitle, audio_url, cover_url, duration, track_order, plays, is_active, created_at
         FROM artist_tracks
         WHERE artist_slug = $artist_slug ${whereActive}
         ORDER BY track_order ASC, id ASC`,
        { '$artist_slug': TypedValues.utf8(artistSlug) }
      );
      const rows = this.parseResultSet<any>(resultSets[0]);
      return rows.map((r: any) => ({
        id: Number(r.id ?? 0),
        artistSlug: String(r.artistSlug ?? ''),
        title: String(r.title ?? ''),
        subtitle: String(r.subtitle ?? ''),
        audioUrl: String(r.audioUrl ?? ''),
        coverUrl: String(r.coverUrl ?? ''),
        duration: Number(r.duration ?? 0),
        trackOrder: Number(r.trackOrder ?? 0),
        plays: Number(r.plays ?? 0),
        isActive: Boolean(r.isActive ?? true),
        createdAt: r.createdAt ? new Date(typeof r.createdAt === 'number' ? r.createdAt * 1000 : r.createdAt).toISOString() : new Date().toISOString(),
      }));
    });
    return result || [];
  }
;

DatabaseStorage.prototype.createArtistTrack = async function (this: DatabaseStorage, data: { artistSlug: string; title: string; subtitle?: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number }): Promise<ArtistTrack> {
    const id = Date.now();
    const now = new Date();
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(
        `DECLARE $id AS Uint64;
         DECLARE $artist_slug AS Utf8;
         DECLARE $title AS Utf8;
         DECLARE $subtitle AS Utf8;
         DECLARE $audio_url AS Utf8;
         DECLARE $cover_url AS Utf8;
         DECLARE $duration AS Int32;
         DECLARE $track_order AS Int32;
         DECLARE $plays AS Int64;
         DECLARE $is_active AS Bool;
         DECLARE $created_at AS Timestamp;
         UPSERT INTO artist_tracks (id, artist_slug, title, subtitle, audio_url, cover_url, duration, track_order, plays, is_active, created_at)
         VALUES ($id, $artist_slug, $title, $subtitle, $audio_url, $cover_url, $duration, $track_order, $plays, $is_active, $created_at)`,
        {
          '$id': TypedValues.uint64(id),
          '$artist_slug': TypedValues.utf8(data.artistSlug),
          '$title': TypedValues.utf8(data.title),
          '$subtitle': TypedValues.utf8(data.subtitle || ''),
          '$audio_url': TypedValues.utf8(data.audioUrl),
          '$cover_url': TypedValues.utf8(data.coverUrl),
          '$duration': TypedValues.int32(data.duration),
          '$track_order': TypedValues.int32(data.trackOrder),
          '$plays': TypedValues.int64(0),
          '$is_active': TypedValues.bool(true),
          '$created_at': TypedValues.timestamp(now),
        }
      );
    });
    return {
      id,
      artistSlug: data.artistSlug,
      title: data.title,
      subtitle: data.subtitle || '',
      audioUrl: data.audioUrl,
      coverUrl: data.coverUrl,
      duration: data.duration,
      trackOrder: data.trackOrder,
      plays: 0,
      isActive: true,
      createdAt: now.toISOString(),
    };
  }
;

DatabaseStorage.prototype.updateArtistTrack = async function (this: DatabaseStorage, id: number, data: Partial<{ title: string; subtitle: string; audioUrl: string; coverUrl: string; duration: number; trackOrder: number; isActive: boolean }>): Promise<void> {
    type FieldDef = [string, string, any];
    const fields: FieldDef[] = [];
    if (data.title !== undefined) fields.push(['title', 'Utf8', data.title]);
    if (data.subtitle !== undefined) fields.push(['subtitle', 'Utf8', data.subtitle]);
    if (data.audioUrl !== undefined) fields.push(['audio_url', 'Utf8', data.audioUrl]);
    if (data.coverUrl !== undefined) fields.push(['cover_url', 'Utf8', data.coverUrl]);
    if (data.duration !== undefined) fields.push(['duration', 'Int32', data.duration]);
    if (data.trackOrder !== undefined) fields.push(['track_order', 'Int32', data.trackOrder]);
    if (data.isActive !== undefined) fields.push(['is_active', 'Bool', data.isActive]);
    if (fields.length === 0) return;

    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      const declares = ['DECLARE $id AS Uint64;'];
      const setClause: string[] = [];
      const params: Record<string, any> = { '$id': TypedValues.uint64(id) };

      for (const [col, yqlType, value] of fields) {
        const param = `$${col}`;
        declares.push(`DECLARE ${param} AS ${yqlType};`);
        setClause.push(`${col} = ${param}`);
        if (yqlType === 'Utf8') params[param] = TypedValues.utf8(String(value));
        else if (yqlType === 'Int32') params[param] = TypedValues.int32(Number(value));
        else if (yqlType === 'Bool') params[param] = TypedValues.bool(Boolean(value));
      }

      const query = `${declares.join('\n')}\nUPDATE artist_tracks SET ${setClause.join(', ')} WHERE id = $id`;
      await session.executeQuery(query, params);
    });
  }
;

DatabaseStorage.prototype.deleteArtistTrack = async function (this: DatabaseStorage, id: number): Promise<void> {
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(
        `DECLARE $id AS Uint64;\nDELETE FROM artist_tracks WHERE id = $id`,
        { '$id': TypedValues.uint64(id) }
      );
    });
  }
;

DatabaseStorage.prototype.incrementTrackPlays = async function (this: DatabaseStorage, id: number, count = 1): Promise<void> {
    await this.safeQuery(async (session) => {
      const { TypedValues } = await import('ydb-sdk');
      await session.executeQuery(
        `DECLARE $id AS Uint64;\nDECLARE $count AS Int64;\nUPDATE artist_tracks SET plays = plays + $count WHERE id = $id`,
        {
          '$id': TypedValues.uint64(id),
          '$count': TypedValues.int64(count),
        }
      );
    });
  }
;
