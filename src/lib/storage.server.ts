// Server-only: copy a Google Drive video into Cloud storage in chunks (resumable upload),
// and mint temporary signed URLs so Instagram can fetch the file.
import { downloadRange, getFileMeta } from "./drive.server";

export const VIDEO_BUCKET = "ig-videos";
const CHUNK = 24 * 1024 * 1024; // resumable uploads require 6MB multiples

function storageHeaders(extra?: Record<string, string>) {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("Storage belum dikonfigurasi.");
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

function storageUrl() {
  const url = process.env["SUPABASE_URL"];
  if (!url) throw new Error("Storage belum dikonfigurasi.");
  return `${url}/storage/v1`;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export function storagePathFor(fileId: string, name: string) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "mp4";
  return `drive/${fileId}.${ext}`;
}

export async function objectExists(path: string) {
  const res = await fetch(`${storageUrl()}/object/info/${VIDEO_BUCKET}/${path}`, {
    headers: storageHeaders(),
  });
  return res.ok;
}

/** Copies the Drive file into the bucket. Returns the storage path. Skips when already present. */
export async function copyDriveFileToStorage(fileId: string, fileName: string) {
  const path = storagePathFor(fileId, fileName);
  if (await objectExists(path)) return path;

  const meta = await getFileMeta(fileId);
  const size = Number(meta.size ?? 0);
  if (!size) throw new Error("Ukuran file di Drive tidak diketahui.");
  const contentType = meta.mimeType?.startsWith("video/") ? meta.mimeType : "video/mp4";

  const createRes = await fetch(`${storageUrl()}/upload/resumable`, {
    method: "POST",
    headers: storageHeaders({
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(size),
      "Upload-Metadata": `bucketName ${b64(VIDEO_BUCKET)},objectName ${b64(path)},contentType ${b64(contentType)},cacheControl ${b64("3600")}`,
      "x-upsert": "true",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Gagal memulai salinan ke storage [${createRes.status}]: ${await createRes.text()}`);
  }
  const location = createRes.headers.get("location");
  if (!location) throw new Error("Storage tidak mengembalikan lokasi unggahan.");

  // Unduh beberapa potongan sekaligus (paralel) sambil mengunggah berurutan,
  // sehingga waktu tunggu jaringan tidak menumpuk.
  const PREFETCH = 3;
  const starts: number[] = [];
  for (let s = 0; s < size; s += CHUNK) starts.push(s);
  const queue: Array<Promise<Uint8Array>> = [];
  let next = 0;
  const fill = () => {
    while (queue.length < PREFETCH && next < starts.length) {
      const s = starts[next]!;
      queue.push(downloadRange(fileId, s, Math.min(s + CHUNK, size) - 1));
      next++;
    }
  };
  fill();

  let offset = 0;
  for (let i = 0; i < starts.length; i++) {
    const bytes = await queue.shift()!;
    fill();
    const patch = await fetch(location, {
      method: "PATCH",
      headers: storageHeaders({
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
      }),
      body: bytes.slice().buffer as ArrayBuffer,
    });
    if (!patch.ok) {
      throw new Error(`Gagal menyalin potongan video [${patch.status}]: ${await patch.text()}`);
    }
    offset += bytes.byteLength;
  }
  return path;
}

/** Signed URL valid for `expiresIn` seconds (default 12 hours). */
export async function signedVideoUrl(path: string, expiresIn = 60 * 60 * 12) {
  const res = await fetch(`${storageUrl()}/object/sign/${VIDEO_BUCKET}/${path}`, {
    method: "POST",
    headers: storageHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`Gagal membuat tautan video [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { signedURL: string };
  return `${storageUrl()}${json.signedURL}`;
}

export async function deleteStorageObject(path: string) {
  await fetch(`${storageUrl()}/object/${VIDEO_BUCKET}/${path}`, {
    method: "DELETE",
    headers: storageHeaders(),
  });
}
