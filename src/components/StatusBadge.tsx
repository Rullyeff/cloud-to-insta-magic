import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const map: Record<string, { label: string; className: string }> = {
  queued: { label: "Antri", className: "bg-muted text-muted-foreground" },
  copying: { label: "Menyalin", className: "bg-info/15 text-info animate-pulse-soft" },
  copied: { label: "Tersalin", className: "bg-info/15 text-info" },
  processing: { label: "Diproses Instagram", className: "bg-warning/15 text-warning animate-pulse-soft" },
  published: { label: "Terbit", className: "bg-success/15 text-success" },
  failed: { label: "Gagal", className: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Dibatalkan", className: "bg-muted text-muted-foreground line-through" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = map[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}
