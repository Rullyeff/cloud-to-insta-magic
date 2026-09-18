import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Single-user mode: the app has no login, so everything belongs to one owner. */
export const OWNER_ID = "00000000-0000-0000-0000-000000000001";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const mediaKind = z.enum(["REELS", "STORIES"]);

// ---------- Google Drive ----------
export const getDriveFolders = createServerFn({ method: "GET" })
  .inputValidator((d: { parentId: string | null }) => d)
  .handler(async ({ data }) => {
    const { listFolders } = await import("./drive.server");
    return listFolders(data.parentId);
  });

export const getDriveVideos = createServerFn({ method: "GET" })
  .inputValidator((d: { folderId: string | null }) => d)
  .handler(async ({ data }) => {
    const { listVideos } = await import("./drive.server");
    return listVideos(data.folderId);
  });

// ---------- Setup status ----------
export const getSetupStatus = createServerFn({ method: "GET" })
  .handler(async () => {
    const driveConnected = Boolean(process.env["GOOGLE_DRIVE_API_KEY"] && process.env["LOVABLE_API_KEY"]);
    const metaTokenSet = Boolean(process.env["META_ACCESS_TOKEN"]);
    let metaValid: boolean | null = null;
    let metaName: string | null = null;
    let metaError: string | null = null;
    if (metaTokenSet) {
      try {
        const { checkTokenStatus } = await import("./meta.server");
        const me = await checkTokenStatus();
        metaValid = true;
        metaName = me.name ?? me.id;
      } catch (e) {
        metaValid = false;
        metaError = e instanceof Error ? e.message : String(e);
      }
    }
    return { driveConnected, metaTokenSet, metaValid, metaName, metaError };
  });

// ---------- Instagram accounts ----------
export const syncInstagramAccounts = createServerFn({ method: "POST" })
  .handler(async () => {
    const { discoverInstagramAccounts } = await import("./meta.server");
    const found = await discoverInstagramAccounts();
    if (!found.length) return { synced: 0 };
    const rows = found.map((a) => ({ ...a, user_id: OWNER_ID }));
    const { error } = await (await db())
      .from("ig_accounts")
      .upsert(rows, { onConflict: "user_id,ig_user_id" });
    if (error) throw new Error(error.message);
    return { synced: rows.length };
  });

export const setAccountEnabled = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (await db())
      .from("ig_accounts")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Posts / queue ----------
export const enqueuePosts = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        files: z
          .array(z.object({ id: z.string(), name: z.string(), size: z.number().nullable() }))
          .min(1),
        accountIds: z.array(z.string().uuid()).min(1),
        mediaType: mediaKind,
        caption: z.string().max(2200),
        scheduledAt: z.string().datetime().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const rows = data.files.flatMap((f) =>
      data.accountIds.map((account_id) => ({
        user_id: OWNER_ID,
        account_id,
        drive_file_id: f.id,
        drive_file_name: f.name,
        drive_file_size: f.size,
        media_type: data.mediaType,
        caption: data.caption,
        scheduled_at: data.scheduledAt,
      })),
    );
    const { data: inserted, error } = await (await db()).from("posts").insert(rows).select("id");
    if (error) throw new Error(error.message);
    const ids = (inserted ?? []).map((r) => r.id);
    // Start immediately when not scheduled; the cron keeps advancing it afterwards.
    if (!data.scheduledAt && ids.length) {
      const { processQueue } = await import("./publisher.server");
      processQueue({ postIds: ids, limit: ids.length }).catch((e) =>
        console.error("immediate processing failed", e),
      );
    }
    return { created: ids.length };
  });

/** Menjadwalkan SEMUA video dalam satu folder Drive ke slot 13:00 / 17:00 / 20:00 WITA. */
export const enqueueFolder = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        folderId: z.string(),
        accountIds: z.array(z.string().uuid()).min(1),
        captionPreset: z.enum(["zaidul", "uas", "uah"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { listVideos } = await import("./drive.server");
    const { buildCaption, nextSlots } = await import("./captions");
    const videos = await listVideos(data.folderId);
    if (!videos.length) return { created: 0, videos: 0, firstSlot: null as string | null };

    const slots = nextSlots(videos.length);
    const rows = videos.flatMap((v, i) =>
      data.accountIds.map((account_id) => ({
        user_id: OWNER_ID,
        account_id,
        drive_file_id: v.id,
        drive_file_name: v.name,
        drive_file_size: v.size,
        media_type: "REELS" as const,
        caption: buildCaption(v.name, data.captionPreset),
        scheduled_at: slots[i] ?? null,
      })),
    );
    const { data: inserted, error } = await (await db()).from("posts").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return {
      created: inserted?.length ?? 0,
      videos: videos.length,
      firstSlot: slots[0] ?? null,
    };
  });

export const retryPost = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (await db())
      .from("posts")
      .update({ status: "queued", error: null, attempts: 0, locked_at: null, ig_container_id: null })
      .eq("id", data.id)
      .in("status", ["failed", "cancelled"]);
    if (error) throw new Error(error.message);
    const { processQueue } = await import("./publisher.server");
    processQueue({ postIds: [data.id], limit: 1 }).catch((e) => console.error(e));
    return { ok: true };
  });

export const cancelPost = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (await db())
      .from("posts")
      .update({ status: "cancelled", locked_at: null })
      .eq("id", data.id)
      .in("status", ["queued", "copied", "processing"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePost = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = await db();
    // Kiriman yang sudah tayang tidak boleh dihapus — tetap tersimpan sebagai riwayat.
    const { data: existing } = await sb.from("posts").select("status").eq("id", data.id).single();
    if (existing?.status === "published") {
      throw new Error("Kiriman yang sudah tayang tidak bisa dihapus dari riwayat.");
    }
    // Batalkan dulu bila masih aktif, lalu hapus.
    await sb
      .from("posts")
      .update({ status: "cancelled", locked_at: null })
      .eq("id", data.id)
      .in("status", ["queued", "copying", "copied", "processing"]);
    const { error } = await sb.from("posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Posting satu kiriman sekarang juga, tanpa menunggu jadwal. */
export const publishPostNow = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (await db())
      .from("posts")
      .update({
        status: "queued",
        error: null,
        attempts: 0,
        locked_at: null,
        ig_container_id: null,
        scheduled_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const { processQueue } = await import("./publisher.server");
    processQueue({ postIds: [data.id], limit: 1 }).catch((e) => console.error(e));
    return { ok: true };
  });

/** Hentikan semua kiriman yang masih aktif di antrian. */
export const stopQueue = createServerFn({ method: "POST" }).handler(async () => {
  const { data, error } = await (await db())
    .from("posts")
    .update({ status: "cancelled", locked_at: null })
    .in("status", ["queued", "copying", "copied", "processing"])
    .select("id");
  if (error) throw new Error(error.message);
  return { stopped: data?.length ?? 0 };
});

/** Hapus seluruh antrian (semua kiriman yang belum tayang). */
export const clearQueue = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ all: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = await db();
    await sb
      .from("posts")
      .update({ status: "cancelled", locked_at: null })
      .in("status", ["queued", "copying", "copied", "processing"]);
    let q = sb.from("posts").delete();
    if (!data.all) q = q.neq("status", "published");
    const { data: rows, error } = await q.select("id");
    if (error) throw new Error(error.message);
    return { deleted: rows?.length ?? 0 };
  });

export const runQueueNow = createServerFn({ method: "POST" })
  .handler(async () => {
    const { runScheduledTick } = await import("./publisher.server");
    return runScheduledTick();
  });

// ---------- Watched folders ----------
export const addWatchedFolder = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        folderId: z.string(),
        folderName: z.string(),
        accountIds: z.array(z.string().uuid()).min(1),
        mediaType: mediaKind,
        captionTemplate: z.string().max(2200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // Mark videos that already exist as seen so only NEW uploads get published.
    const { listVideos } = await import("./drive.server");
    const existing = await listVideos(data.folderId);
    const { error } = await (await db()).from("watched_folders").insert({
      user_id: OWNER_ID,
      folder_id: data.folderId,
      folder_name: data.folderName,
      account_ids: data.accountIds,
      media_type: data.mediaType,
      caption_template: data.captionTemplate,
    });
    if (error) throw new Error(error.message);
    if (existing.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("seen_drive_files").upsert(
        existing.map((v) => ({ user_id: OWNER_ID, folder_id: data.folderId, file_id: v.id })),
        { onConflict: "folder_id,file_id", ignoreDuplicates: true },
      );
    }
    return { ok: true, skippedExisting: existing.length };
  });

export const setWatchedFolderEnabled = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (await db())
      .from("watched_folders")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWatchedFolder = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await (await db()).from("watched_folders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

