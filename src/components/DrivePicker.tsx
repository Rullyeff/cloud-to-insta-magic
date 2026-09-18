import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Film, Folder, HardDrive } from "lucide-react";
import { useState } from "react";
import { getDriveFolders, getDriveVideos } from "@/lib/ig.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type PickedFile = { id: string; name: string; size: number | null };
type Crumb = { id: string | null; name: string };

export function formatBytes(n: number | null) {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function useDriveFolders(parentId: string | null) {
  const fn = useServerFn(getDriveFolders);
  return useQuery({
    queryKey: ["drive-folders", parentId],
    queryFn: () => fn({ data: { parentId } }),
    staleTime: 60_000,
  });
}

export function DrivePicker({
  selected,
  onChange,
  mode = "videos",
  onFolderChange,
  initialFolder,
}: {
  selected: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  mode?: "videos" | "folders";
  onFolderChange?: (crumb: Crumb) => void;
  initialFolder?: Crumb | null;
}) {
  const [crumbs, setCrumbs] = useState<Crumb[]>(() => {
    const root: Crumb = { id: null, name: "Drive Saya" };
    return initialFolder?.id ? [root, initialFolder] : [root];
  });
  const current = crumbs[crumbs.length - 1]!;
  const videosFn = useServerFn(getDriveVideos);

  const folders = useDriveFolders(current.id);
  const videos = useQuery({
    queryKey: ["drive-videos", current.id],
    queryFn: () => videosFn({ data: { folderId: current.id } }),
    enabled: mode === "videos",
    staleTime: 60_000,
  });

  const open = (c: Crumb) => {
    const next = [...crumbs, c];
    setCrumbs(next);
    onFolderChange?.(c);
  };
  const jump = (i: number) => {
    const next = crumbs.slice(0, i + 1);
    setCrumbs(next);
    onFolderChange?.(next[next.length - 1]!);
  };

  const isSelected = (id: string) => selected.some((f) => f.id === id);
  const toggle = (f: PickedFile) =>
    onChange(isSelected(f.id) ? selected.filter((x) => x.id !== f.id) : [...selected, f]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-sm">
        <HardDrive className="mr-1 size-4 text-muted-foreground" />
        {crumbs.map((c, i) => (
          <span key={`${c.id}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
            <button
              type="button"
              onClick={() => jump(i)}
              className={cn("rounded px-1.5 py-0.5 hover:bg-accent", i === crumbs.length - 1 && "font-semibold")}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="max-h-[420px] overflow-y-auto p-2">
        {(folders.isLoading || videos.isLoading) && (
          <div className="space-y-2 p-1">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}
        {folders.error && <p className="p-3 text-sm text-destructive">{(folders.error as Error).message}</p>}

        {folders.data?.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => open({ id: f.id, name: f.name })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Folder className="size-4 shrink-0 text-warning" />
            <span className="truncate">{f.name}</span>
            <ChevronRight className="ml-auto size-4 text-muted-foreground" />
          </button>
        ))}

        {mode === "videos" &&
          videos.data?.map((v) => {
            const checked = isSelected(v.id);
            return (
              <label
                key={v.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent",
                  checked && "bg-accent",
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle({ id: v.id, name: v.name, size: v.size })} />
                {v.thumbnailLink ? (
                  <img src={v.thumbnailLink} alt="" className="size-9 rounded object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-9 place-items-center rounded bg-muted"><Film className="size-4" /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(v.size)}{v.durationMs ? ` · ${Math.round(v.durationMs / 1000)} dtk` : ""}
                  </span>
                </span>
              </label>
            );
          })}

        {!folders.isLoading && !videos.isLoading && !folders.data?.length && (mode === "folders" || !videos.data?.length) && (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {mode === "videos" ? "Tidak ada folder atau video di sini." : "Tidak ada sub-folder."}
          </p>
        )}
      </div>
    </div>
  );
}
