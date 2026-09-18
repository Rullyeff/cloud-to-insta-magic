import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export function useAccounts() {
  return useQuery({
    queryKey: ["ig_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ig_accounts").select("*").order("username");
      if (error) throw error;
      return data;
    },
  });
}

export function AccountPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { data: accounts, isLoading } = useAccounts();
  if (isLoading) return <p className="text-sm text-muted-foreground">Memuat akun…</p>;
  if (!accounts?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Belum ada akun Instagram. Klik “Sinkron akun” di atas.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Pilih satu akun. Setiap akun punya pengaturan antrian sendiri.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {accounts.map((a) => {
          const checked = value === a.id;
          return (
            <button
              key={a.id}
              type="button"
              disabled={!a.enabled}
              aria-pressed={checked}
              onClick={() => onChange(checked ? null : a.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-raised",
                checked && "border-primary/60 bg-accent",
                !a.enabled && "cursor-not-allowed opacity-50",
              )}
            >
              <span
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border border-muted-foreground/50",
                  checked && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {checked && <Check className="size-3" />}
              </span>
              <Avatar className="size-8">
                <AvatarImage src={a.profile_picture_url ?? undefined} />
                <AvatarFallback>{a.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">@{a.username}</p>
                <p className="truncate text-xs text-muted-foreground">{a.page_name}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
