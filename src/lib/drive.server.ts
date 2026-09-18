// Server-only Google Drive helpers (via the Lovable connector gateway).
const GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

function headers(extra?: Record<string, string>) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const driveKey = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lovableKey || !driveKey) {
    throw new Error("Google Drive belum terhubung ke aplikasi ini.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": driveKey,
    ...extra,
  };
}

async function driveFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: headers(init?.headers as Record<string, string> | undefined),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Drive request failed [${res.status}]: ${body}`);
    throw new Error(`Google Drive error [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res;
}

export type DriveFolder = { id: string; name: string };
export type DriveVideo = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  modifiedTime: string;
  thumbnailLink: string | null;
  durationMs: number | null;
};

export async function listFolders(parentId: string | null): Promise<DriveFolder[]> {
  const parent = parentId ?? "root";
  const q = `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: "200",
    orderBy: "name",
    fields: "files(id,name)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await driveFetch(`/files?${params}`);
  const json = (await res.json()) as { files: DriveFolder[] };
  return json.files ?? [];
}

export async function listVideos(folderId: string | null): Promise<DriveVideo[]> {
  const parent = folderId ?? "root";
  const q = `'${parent}' in parents and mimeType contains 'video/' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: "200",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,size,mimeType,modifiedTime,thumbnailLink,videoMediaMetadata(durationMillis))",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await driveFetch(`/files?${params}`);
  const json = (await res.json()) as {
    files: Array<{
      id: string;
      name: string;
      size?: string;
      mimeType: string;
      modifiedTime: string;
      thumbnailLink?: string;
      videoMediaMetadata?: { durationMillis?: string };
    }>;
  };
  return (json.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    size: Number(f.size ?? 0),
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink ?? null,
    durationMs: f.videoMediaMetadata?.durationMillis
      ? Number(f.videoMediaMetadata.durationMillis)
      : null,
  }));
}

export async function getFileMeta(fileId: string) {
  const params = new URLSearchParams({
    fields: "id,name,size,mimeType,md5Checksum",
    supportsAllDrives: "true",
  });
  const res = await driveFetch(`/files/${fileId}?${params}`);
  return (await res.json()) as {
    id: string;
    name: string;
    size?: string;
    mimeType: string;
    md5Checksum?: string;
  };
}

/** Download a byte range of a Drive file. */
export async function downloadRange(fileId: string, start: number, endInclusive: number) {
  const res = await driveFetch(`/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
  });
  return new Uint8Array(await res.arrayBuffer());
}

/** Permanently deletes a Drive file (skips the trash). */
export async function deleteFilePermanently(fileId: string) {
  await driveFetch(`/files/${fileId}?supportsAllDrives=true`, { method: "DELETE" });
  return { ok: true };
}
