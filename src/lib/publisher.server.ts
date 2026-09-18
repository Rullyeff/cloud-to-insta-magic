// Server-only publishing pipeline: Drive -> Cloud storage -> Instagram.
import type { Database } from "@/integrations/supabase/types";
import { deleteFilePermanently, listVideos } from "./drive.server";
import {
  createVideoContainer,
  getContainerStatus,
  getPermalink,
  publishContainer,
} from "./meta.server";
import { copyDriveFileToStorage, deleteStorageObject, signedVideoUrl } from "./storage.server";

type Post = Database["public"]["Tables"]["posts"]["Row"];
type Account = Database["public"]["Tables"]["ig_accounts"]["Row"];

const MAX_ATTEMPTS = 3;
const LOCK_MS = 10 * 60 * 1000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 900);

async function fail(postId: string, attempts: number, message: string) {
  const db = await admin();
  const retry = attempts + 1 < MAX_ATTEMPTS;
  await db
    .from("posts")
    .update({
      status: retry ? "queued" : "failed",
      error: message,
      attempts: attempts + 1,
      locked_at: null,
      ig_container_id: null,
    })
    .eq("id", postId);
}

/**
 * Hapus permanen video di Google Drive setelah semua kiriman yang memakainya selesai.
 * Menunggu kiriman lain (akun lain) agar file tidak hilang saat masih dibutuhkan.
 */
async function deleteDriveFileIfDone(driveFileId: string) {
  try {
    const db = await admin();
    const { count } = await db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("drive_file_id", driveFileId)
      .in("status", ["queued", "copying", "copied", "processing"]);
    if (count) return;
    await deleteFilePermanently(driveFileId);
    await db
      .from("posts")
      .update({ drive_deleted_at: new Date().toISOString() })
      .eq("drive_file_id", driveFileId);
  } catch (e) {
    console.error("drive delete failed", e);
  }
}


/** Terbitkan container yang sudah siap, lalu simpan hasilnya. */
async function finalizePost(post: Post, account: Account, containerId: string) {
  const db = await admin();
  const mediaId = await publishContainer(account.ig_user_id, containerId);
  // Tandai tayang secepatnya; detail tambahan menyusul.
  await db
    .from("posts")
    .update({
      status: "published",
      ig_media_id: mediaId,
      published_at: new Date().toISOString(),
      locked_at: null,
      error: null,
    })
    .eq("id", post.id);

  // Permalink + Story dikerjakan berbarengan agar tidak menambah waktu antrian.
  const permalinkJob = getPermalink(mediaId)
    .then((permalink) =>
      permalink ? db.from("posts").update({ permalink }).eq("id", post.id) : null,
    )
    .catch(() => null);

  const storyJob =
    post.media_type === "REELS" && post.storage_path
      ? (async () => {
          const shareUrl = await signedVideoUrl(post.storage_path!).catch(() => null);
          if (!shareUrl) return;
          const { publishStory } = await import("./meta.server");
          await publishStory(account.ig_user_id, shareUrl).catch((e) =>
            console.error("story crosspost failed", e),
          );
          // Halaman Facebook terisi otomatis lewat crosspost Reels Instagram.
        })()
      : Promise.resolve();

  // Statistik tidak diambil di sini (lambat & sering kosong di menit pertama);
  // tombol "Perbarui statistik" / cron yang mengambilnya nanti.
  await Promise.allSettled([permalinkJob, storyJob]);
  await deleteDriveFileIfDone(post.drive_file_id);
}

/** Tunggu container Instagram selesai diproses. Cek awal cepat, lalu melambat. */
async function waitForContainer(containerId: string, budgetMs = 25_000) {
  const deadline = Date.now() + budgetMs;
  let delay = 1000;
  let st = await getContainerStatus(containerId);
  while (st.status_code !== "FINISHED" && st.status_code !== "ERROR" && st.status_code !== "EXPIRED") {
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 1000, 4000);
    st = await getContainerStatus(containerId);
  }
  return st;
}

/** Moves one post forward. Publishes in the same run when Instagram is ready in time. */
export async function advancePost(post: Post, account: Account): Promise<string> {
  const db = await admin();

  if (post.status === "queued" || post.status === "copied") {
    if (!account.enabled) return post.status;
    await db.from("posts").update({ locked_at: new Date().toISOString(), status: "copying", error: null }).eq("id", post.id);
    try {
      const path = post.storage_path ?? (await copyDriveFileToStorage(post.drive_file_id, post.drive_file_name));
      const url = await signedVideoUrl(path);
      const containerId = await createVideoContainer({
        igUserId: account.ig_user_id,
        videoUrl: url,
        mediaType: post.media_type,
        caption: post.caption,
      });
      await db
        .from("posts")
        .update({ storage_path: path, ig_container_id: containerId, public_url: url, status: "processing", locked_at: null })
        .eq("id", post.id);
      const ready = { ...post, storage_path: path, status: "processing" as const, ig_container_id: containerId };
      const st = await waitForContainer(containerId);
      if (st.status_code === "FINISHED") {
        await finalizePost(ready, account, containerId);
        return "published";
      }
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
        await fail(post.id, post.attempts, `Instagram menolak video: ${st.status ?? st.status_code}`);
        return "failed";
      }
      return "processing";
    } catch (e) {
      await fail(post.id, post.attempts, errText(e));
      return "failed";
    }
  }

  if (post.status === "processing" && post.ig_container_id) {
    try {
      const st = await waitForContainer(post.ig_container_id, 20_000);
      if (st.status_code === "FINISHED") {
        await finalizePost(post, account, post.ig_container_id);
        return "published";
      }
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
        await fail(post.id, post.attempts, `Instagram menolak video: ${st.status ?? st.status_code}`);
        return "failed";
      }
      return "processing";
    } catch (e) {
      await fail(post.id, post.attempts, errText(e));
      return "failed";
    }
  }
  return post.status;
}


/** Processes every due post. Safe to call from cron or right after enqueueing. */
export async function processQueue(opts?: { postIds?: string[]; limit?: number }) {
  const db = await admin();
  const now = new Date().toISOString();
  const staleLock = new Date(Date.now() - LOCK_MS).toISOString();

  let q = db
    .from("posts")
    .select("*")
    .in("status", ["queued", "copied", "processing", "copying"])
    .or(`locked_at.is.null,locked_at.lt.${staleLock}`)
    .order("scheduled_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(opts?.limit ?? 16);
  if (opts?.postIds?.length) q = q.in("id", opts.postIds);
  const { data: posts, error } = await q;
  if (error) throw error;

  const due = (posts ?? []).filter((p) => !p.scheduled_at || p.scheduled_at <= now);
  if (!due.length) return { processed: 0 };

  const accountIds = [...new Set(due.map((p) => p.account_id))];
  const { data: accounts } = await db.from("ig_accounts").select("*").in("id", accountIds);
  const byId = new Map((accounts ?? []).map((a) => [a.id, a]));

  // Kolam pekerja: begitu satu selesai, langsung ambil kiriman berikutnya
  // (tidak menunggu seluruh batch seperti sebelumnya).
  const CONCURRENCY = 8;
  let processed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < due.length) {
      const post = due[cursor++]!;
      const account = byId.get(post.account_id);
      if (!account) continue;
      // Recover posts stuck in "copying" by a crashed run.
      const p = post.status === "copying" ? { ...post, status: "queued" as const } : post;
      await advancePost(p, account).catch((e) => console.error("advance failed", e));
      processed++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
  return { processed };

}

/** Deletes temporary copies no active post still needs. */
export async function cleanupStorage() {
  const db = await admin();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: done } = await db
    .from("posts")
    .select("id, storage_path")
    .in("status", ["published", "failed", "cancelled"])
    .not("storage_path", "is", null)
    .lt("updated_at", cutoff)
    .limit(50);
  for (const row of done ?? []) {
    if (!row.storage_path) continue;
    const { count } = await db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", row.storage_path)
      .in("status", ["queued", "copying", "copied", "processing"]);
    if (!count) await deleteStorageObject(row.storage_path);
    await db.from("posts").update({ storage_path: null, public_url: null }).eq("id", row.id);
  }
}

/** Looks for new videos in watched folders and enqueues them. */
export async function scanWatchedFolders() {
  const db = await admin();
  const { data: folders } = await db.from("watched_folders").select("*").eq("enabled", true);
  let enqueued = 0;
  for (const folder of folders ?? []) {
    try {
      const videos = await listVideos(folder.folder_id);
      if (!videos.length) continue;
      const { data: seen } = await db
        .from("seen_drive_files")
        .select("file_id")
        .eq("folder_id", folder.folder_id)
        .in("file_id", videos.map((v) => v.id));
      const seenSet = new Set((seen ?? []).map((s) => s.file_id));
      const fresh = videos.filter((v) => !seenSet.has(v.id));
      for (const video of fresh) {
        const { error: seenErr } = await db
          .from("seen_drive_files")
          .insert({ user_id: folder.user_id, folder_id: folder.folder_id, file_id: video.id });
        if (seenErr) continue; // another run already picked it up
        const caption = folder.caption_template.replaceAll(
          "{nama}",
          video.name.replace(/\.[^.]+$/, ""),
        );
        const rows = folder.account_ids.map((account_id) => ({
          user_id: folder.user_id,
          account_id,
          drive_file_id: video.id,
          drive_file_name: video.name,
          drive_file_size: video.size,
          media_type: folder.media_type,
          caption,
        }));
        if (rows.length) {
          const { error: insErr } = await db.from("posts").insert(rows);
          if (!insErr) enqueued += rows.length;
        }
      }
      await db
        .from("watched_folders")
        .update({ last_scanned_at: new Date().toISOString() })
        .eq("id", folder.id);
    } catch (e) {
      console.error(`Scan folder ${folder.folder_name} failed:`, e);
    }
  }
  return { enqueued };
}

export async function runScheduledTick() {
  const scan = await scanWatchedFolders();
  const queue = await processQueue({ limit: 8 });
  await cleanupStorage().catch((e) => console.error("cleanup failed", e));
  return { ...scan, ...queue };
}
