import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  Clapperboard,
  Link as LinkIcon,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AccountPicker, useAccounts } from "@/components/AccountPicker";
import { DrivePicker } from "@/components/DrivePicker";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelPost,
  clearQueue,
  deletePost,
  enqueueFolder,
  getDriveVideos,
  publishPostNow,
  retryPost,
  runQueueNow,
  stopQueue,
  syncInstagramAccounts,
} from "@/lib/ig.functions";
import {
  CAPTION_PRESETS,
  buildCaption,
  nextSlots,
  type CaptionPresetId,
} from "@/lib/captions";
import { cn } from "@/lib/utils";

const ACTIVE = ["queued", "copying", "copied", "processing"];

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ReelDrive — Antrian Reels otomatis dari Google Drive" },
      {
        name: "description",
        content:
          "Pilih akun Instagram, pilih satu folder Google Drive, dan seluruh videonya otomatis masuk antrian Reels jam 13.00, 17.00, dan 20.00 WITA lengkap dengan caption dan hashtag.",
      },
      { property: "og:title", content: "ReelDrive — Antrian Reels otomatis dari Google Drive" },
      {
        property: "og:description",
        content:
          "Satu folder Drive, satu pilihan caption: semua video terjadwal ke Reels dan Story, otomatis tershare ke Halaman Facebook.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Makassar",
      })
    : "—";



function Step({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full border border-border text-xs",
          done && "border-primary/60 bg-accent text-primary",
        )}
      >
        {n}
      </span>
      {title}
    </h2>
  );
}

function Home() {
  const enqueue = useServerFn(enqueueFolder);
  const runNow = useServerFn(runQueueNow);
  const cancel = useServerFn(cancelPost);
  const retry = useServerFn(retryPost);
  const remove = useServerFn(deletePost);
  const postNow = useServerFn(publishPostNow);
  const stopAll = useServerFn(stopQueue);
  const clearAll = useServerFn(clearQueue);
  const syncFn = useServerFn(syncInstagramAccounts);
  const videosFn = useServerFn(getDriveVideos);

  const accounts = useAccounts();
  const posts = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .order("scheduled_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) =>
      q.state.data?.some((p) => ACTIVE.includes(p.status)) ? 2500 : false,

  });

  // Jalankan antrian otomatis selama masih ada kiriman yang berjalan,
  // supaya status "Diproses Instagram" tidak berhenti menunggu klik manual.
  const hasActive = Boolean(posts.data?.some((p) => ACTIVE.includes(p.status)));
  const tickingRef = useRef(false);
  useEffect(() => {
    if (!hasActive) return;
    let stop = false;
    const tick = async () => {
      if (stop || tickingRef.current) return;
      tickingRef.current = true;
      try {
        await runNow();
      } catch (e) {
        console.error("auto tick failed", e);
      } finally {
        tickingRef.current = false;
        posts.refetch();
      }
    };
    void tick();
    const id = setInterval(tick, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [hasActive]);

  type AccountSettings = {
    folder: { id: string; name: string } | null;
    preset: CaptionPresetId;
  };
  const defaultSettings: AccountSettings = { folder: null, preset: "zaidul" };
  const [settingsByAccount, setSettingsByAccount] = useState<Record<string, AccountSettings>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem("reeldrive-account-settings") ?? "{}");
      } catch {
        return {};
      }
    },
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const settings = (accountId && settingsByAccount[accountId]) || defaultSettings;
  const folder = settings.folder;
  const preset = settings.preset;
  const updateSettings = (patch: Partial<AccountSettings>) => {
    if (!accountId) return;
    setSettingsByAccount((prev) => {
      const next = {
        ...prev,
        [accountId]: { ...(prev[accountId] ?? defaultSettings), ...patch },
      };
      localStorage.setItem("reeldrive-account-settings", JSON.stringify(next));
      return next;
    });
  };
  const setFolder = (f: { id: string; name: string } | null) => updateSettings({ folder: f });
  const setPreset = (p: CaptionPresetId) => updateSettings({ preset: p });
  const [busy, setBusy] = useState(false);

  const videos = useQuery({
    queryKey: ["drive-videos", folder?.id],
    queryFn: () => videosFn({ data: { folderId: folder!.id } }),
    enabled: Boolean(folder?.id),
    staleTime: 60_000,
  });

  const list = videos.data ?? [];
  const slots = list.length ? nextSlots(list.length) : [];

  const allRows = posts.data ?? [];
  const rows = accountId ? allRows.filter((p) => p.account_id === accountId) : allRows;
  const username = (id: string) => accounts.data?.find((a) => a.id === id)?.username ?? "—";

  const statusCounts = rows.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusOrder = ["queued", "copying", "copied", "processing", "published", "failed", "cancelled"];

  const STAGE: Record<string, number> = {
    queued: 5,
    copying: 35,
    copied: 60,
    processing: 80,
    published: 100,
    failed: 100,
    cancelled: 100,
  };
  const STAGE_LABEL: Record<string, string> = {
    queued: "Menunggu giliran",
    copying: "Mengunduh dari Drive",
    copied: "Mengunggah ke Instagram",
    processing: "Diproses Instagram",
    published: "Selesai tayang",
    failed: "Gagal",
    cancelled: "Dibatalkan",
  };
  const totalJobs = rows.filter((p) => p.status !== "cancelled").length;
  const doneJobs = rows.filter((p) => p.status === "published" || p.status === "failed").length;
  const overallPct = totalJobs
    ? Math.round(
        rows
          .filter((p) => p.status !== "cancelled")
          .reduce((s, p) => s + (STAGE[p.status] ?? 0), 0) / totalJobs,
      )
    : 0;
  const publishedTimes = rows
    .filter((p) => p.status === "published" && p.published_at)
    .map((p) => new Date(p.published_at as string).getTime())
    .sort((a, b) => a - b);
  const avgMs =
    publishedTimes.length > 1
      ? (publishedTimes[publishedTimes.length - 1]! - publishedTimes[0]!) /
        (publishedTimes.length - 1)
      : null;
  const remainingJobs = totalJobs - doneJobs;
  const etaMs = avgMs && remainingJobs > 0 ? avgMs * remainingJobs : null;
  const fmtDur = (ms: number) => {
    const m = Math.round(ms / 60000);
    if (m < 1) return "kurang dari 1 menit";
    if (m < 60) return `${m} menit`;
    const h = Math.floor(m / 60);
    return `${h} jam ${m % 60} menit`;
  };

  const guard = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
      posts.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Aksi gagal.");
    }
  };

  const submit = async () => {
    if (!accountId) {
      toast.error("Pilih akun Instagram dulu.");
      return;
    }
    if (!folder) {
      toast.error("Pilih folder video di Drive.");
      return;
    }
    if (!list.length) {
      toast.error("Folder ini belum berisi video.");
      return;
    }
    setBusy(true);
    try {
      const res = await enqueue({
        data: { folderId: folder.id, accountIds: [accountId], captionPreset: preset },
      });
      toast.success(
        `${res.videos} video masuk antrian. Tayang pertama ${fmt(res.firstSlot)} WITA.`,
      );
      posts.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat antrian.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-brand text-primary-foreground">
            <Clapperboard className="size-5" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">ReelDrive</h1>
            <p className="text-xs text-muted-foreground">
              Tayang 13.00 · 17.00 · 20.00 WITA — Reels + Story, auto-share ke Halaman Facebook
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            guard("Akun disinkronkan.", async () => {
              await syncFn();
              accounts.refetch();
            })
          }
        >
          <RefreshCw /> Sinkron akun
        </Button>
      </header>

      <section className="space-y-6">
        <div>
          <Step n={1} title="Pilih akun Instagram" done={Boolean(accountId)} />
          <AccountPicker value={accountId} onChange={setAccountId} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <Step n={2} title="Pilih folder video" done={Boolean(folder)} />
            {accountId ? (
              <DrivePicker
                key={accountId}
                selected={[]}
                onChange={() => {}}
                mode="folders"
                initialFolder={folder}
                onFolderChange={(c) => setFolder(c.id ? { id: c.id, name: c.name } : null)}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Pilih akun Instagram dulu — pengaturan folder dan caption tersimpan terpisah untuk setiap akun.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {folder
                ? videos.isLoading
                  ? `Membaca isi folder “${folder.name}”…`
                  : `Folder “${folder.name}” · ${list.length} video siap diantrikan.`
                : "Buka folder yang berisi video. Semua video di dalamnya akan diantrikan."}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <Step n={3} title="Pilih caption" done />
              <div className="space-y-2">
                {CAPTION_PRESETS.map((p) => (
                  <label
                    key={p.id}
                    className={cn(
                      "block cursor-pointer rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-raised",
                      preset === p.id && "border-primary/60 bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name="caption-preset"
                      className="sr-only"
                      checked={preset === p.id}
                      onChange={() => setPreset(p.id)}
                    />
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                      {p.text}
                    </p>
                    <p className="mt-1 text-xs text-primary">{p.hashtags.join(" ")}</p>
                  </label>
                ))}
              </div>
            </div>

            {list.length > 0 && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Contoh caption video pertama
                </p>
                <p className="whitespace-pre-line text-xs">{buildCaption(list[0]!.name, preset)}</p>
              </div>
            )}

            <Button className="w-full" size="lg" onClick={submit} disabled={busy}>
              {busy ? (
                "Menyusun antrian…"
              ) : (
                <>
                  <CalendarClock /> Antrikan {list.length || ""} video
                </>
              )}
            </Button>
          </div>
        </div>

      </section>

      <div className="mt-10 mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold">
            Antrian posting{accountId ? ` — @${username(accountId)}` : ""}
          </h2>
          {statusOrder
            .filter((s) => statusCounts[s])
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <StatusBadge status={s} />
                <span className="text-xs text-muted-foreground">{statusCounts[s]}</span>
              </span>
            ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              guard("Antrian dijalankan.", async () => {
                const r = await runNow();
                toast.info(`${r.processed} kiriman diproses`);
              })
            }
          >
            <Play /> Jalankan sekarang
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              guard("Antrian dihentikan.", async () => {
                const r = await stopAll();
                toast.info(`${r.stopped} kiriman dihentikan`);
              })
            }
          >
            <Square /> Hentikan sekarang
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (!confirm("Hapus semua kiriman yang belum tayang dari antrian?")) return;
              guard("Antrian dihapus.", async () => {
                const r = await clearAll({ data: { all: false } });
                toast.info(`${r.deleted} kiriman dihapus`);
              });
            }}
          >
            <Trash2 /> Hapus antrian
          </Button>
        </div>
      </div>

      {totalJobs > 0 && (
        <div className="mb-3 rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">Kemajuan {overallPct}%</span>
            <span className="text-xs text-muted-foreground">
              {doneJobs} dari {totalJobs} selesai
              {etaMs ? ` · perkiraan sisa ${fmtDur(etaMs)}` : ""}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${overallPct}%` }} />
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {posts.isLoading && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {!posts.isLoading && !rows.length && (
          <p className="p-10 text-center text-sm text-muted-foreground">Belum ada kiriman.</p>
        )}

        {rows.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.drive_file_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                @{username(p.account_id)} · {p.media_type === "REELS" ? "Reels" : "Story"} ·{" "}
                {p.scheduled_at
                  ? `jadwal ${fmt(p.scheduled_at)} WITA`
                  : fmt(p.published_at ?? p.created_at)}
              </p>
              {p.status === "published" && (
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {p.permalink && (
                    <a
                      href={p.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <LinkIcon className="size-3" />
                      <span className="max-w-[16rem] truncate">{p.permalink}</span>
                    </a>
                  )}
                  {p.drive_deleted_at && (
                    <span className="inline-flex items-center gap-1">
                      <Trash2 className="size-3" /> File Drive terhapus permanen
                    </span>
                  )}
                </div>
              )}
              {p.error && <p className="mt-1 truncate text-xs text-destructive">{p.error}</p>}
            </div>

            <div className="flex w-36 flex-col items-end gap-1">
              <StatusBadge status={p.status} />
              <div className="h-1 w-full overflow-hidden rounded-full bg-primary/20">
                <div
                  className={`h-full rounded-full transition-all ${p.status === "failed" ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${STAGE[p.status] ?? 0}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {STAGE_LABEL[p.status] ?? p.status} · {STAGE[p.status] ?? 0}%
              </span>
            </div>

            <div className="flex gap-1">
              {p.permalink && (
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-2 py-1 text-xs text-primary hover:underline"
                >
                  Lihat
                </a>
              )}
              {p.status !== "published" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Posting sekarang"
                  title="Posting sekarang"
                  onClick={() =>
                    guard("Kiriman diposting sekarang.", () => postNow({ data: { id: p.id } }))
                  }
                >
                  <Send />
                </Button>
              )}
              {ACTIVE.includes(p.status) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Batalkan"
                  title="Batalkan"
                  onClick={() => guard("Kiriman dibatalkan.", () => cancel({ data: { id: p.id } }))}
                >
                  <X />
                </Button>
              )}
              {(p.status === "failed" || p.status === "cancelled") && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Coba lagi"
                  title="Coba lagi"
                  onClick={() => guard("Kiriman diulang.", () => retry({ data: { id: p.id } }))}
                >
                  <RotateCcw />
                </Button>
              )}
              {p.status !== "published" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hapus"
                  title="Hapus"
                  onClick={() => guard("Kiriman dihapus.", () => remove({ data: { id: p.id } }))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
