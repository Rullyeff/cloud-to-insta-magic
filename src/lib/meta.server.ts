// Server-only Meta Graph API helpers for Instagram publishing.
const GRAPH = "https://graph.facebook.com/v21.0";

export function getMetaToken() {
  const token = process.env["META_ACCESS_TOKEN"];
  if (!token) {
    throw new Error(
      "Token Meta belum diatur. Tambahkan META_ACCESS_TOKEN di pengaturan aplikasi.",
    );
  }
  return token;
}

async function graph<T>(
  path: string,
  init?: { method?: "GET" | "POST"; params?: Record<string, string> },
): Promise<T> {
  const token = getMetaToken();
  const params = new URLSearchParams({ ...(init?.params ?? {}), access_token: token });
  const method = init?.method ?? "GET";
  const url = method === "GET" ? `${GRAPH}${path}?${params}` : `${GRAPH}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === "POST"
      ? { body: params, headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      : {}),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_user_msg?: string };
  } & T;
  if (!res.ok || json.error) {
    const msg = json.error?.error_user_msg ?? json.error?.message ?? `HTTP ${res.status}`;
    console.error(`Meta Graph error on ${path}: ${msg}`);
    throw new Error(`Instagram/Meta: ${msg}`);
  }
  return json;
}

export type DiscoveredAccount = {
  ig_user_id: string;
  username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  page_id: string;
  page_name: string;
};

/** Lists every Instagram professional account reachable from the token's Facebook Pages. */
export async function discoverInstagramAccounts(): Promise<DiscoveredAccount[]> {
  type Page = {
    id: string;
    name: string;
    instagram_business_account?: {
      id: string;
      username: string;
      name?: string;
      profile_picture_url?: string;
    };
  };
  const out: DiscoveredAccount[] = [];
  let after: string | undefined;
  do {
    const res = await graph<{ data: Page[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      "/me/accounts",
      {
        params: {
          fields: "id,name,instagram_business_account{id,username,name,profile_picture_url}",
          limit: "100",
          ...(after ? { after } : {}),
        },
      },
    );
    for (const page of res.data ?? []) {
      const ig = page.instagram_business_account;
      if (!ig) continue;
      out.push({
        ig_user_id: ig.id,
        username: ig.username,
        display_name: ig.name ?? null,
        profile_picture_url: ig.profile_picture_url ?? null,
        page_id: page.id,
        page_name: page.name,
      });
    }
    after = res.paging?.next ? res.paging.cursors?.after : undefined;
  } while (after);
  return out;
}

export async function createVideoContainer(opts: {
  igUserId: string;
  videoUrl: string;
  mediaType: "REELS" | "STORIES";
  caption: string;
}) {
  const params: Record<string, string> = {
    media_type: opts.mediaType,
    video_url: opts.videoUrl,
  };
  if (opts.mediaType === "REELS") {
    params["caption"] = opts.caption;
    params["share_to_feed"] = "true";
    // Crosspost otomatis ke Halaman Facebook yang tertaut saat Reels terbit.
    params["share_to_facebook"] = "true";
  }
  const res = await graph<{ id: string }>(`/${opts.igUserId}/media`, { method: "POST", params });
  return res.id;
}

export async function getContainerStatus(containerId: string) {
  const res = await graph<{ status_code: string; status?: string }>(`/${containerId}`, {
    params: { fields: "status_code,status" },
  });
  return res;
}

export async function publishContainer(igUserId: string, containerId: string) {
  const res = await graph<{ id: string }>(`/${igUserId}/media_publish`, {
    method: "POST",
    params: { creation_id: containerId },
  });
  return res.id;
}

export async function getPermalink(mediaId: string) {
  const res = await graph<{ permalink?: string }>(`/${mediaId}`, { params: { fields: "permalink" } });
  return res.permalink ?? null;
}

/** Menerbitkan video yang sama sebagai Story Instagram. Best-effort. */
export async function publishStory(igUserId: string, videoUrl: string) {
  const containerId = await createVideoContainer({
    igUserId,
    videoUrl,
    mediaType: "STORIES",
    caption: "",
  });
  // Story container juga butuh waktu proses.
  for (let i = 0; i < 20; i++) {
    const st = await getContainerStatus(containerId);
    if (st.status_code === "FINISHED") return publishContainer(igUserId, containerId);
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") {
      throw new Error(`Story ditolak: ${st.status ?? st.status_code}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Story belum selesai diproses.");
}

// Catatan: Reels tidak lagi diunggah ulang ke Halaman Facebook.
// Video dikirim sekali ke Instagram dengan crosspost otomatis (share_to_facebook),
// sehingga di aplikasi Instagram tombol "Bagikan ke Facebook" sudah nonaktif/terpakai.

export async function checkTokenStatus() {
  const res = await graph<{ id: string; name?: string }>("/me", { params: { fields: "id,name" } });
  return res;
}
