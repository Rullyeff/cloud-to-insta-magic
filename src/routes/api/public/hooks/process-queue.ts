import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/process-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bearer = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        const tickToken = process.env["QUEUE_TICK_TOKEN"];
        if (!tickToken || bearer !== tickToken) {
          const denied = await authenticateCronRequest(request);
          if (denied) return denied;
        }
        const { runScheduledTick } = await import("@/lib/publisher.server");
        try {
          const result = await runScheduledTick();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("Scheduled tick failed", e);
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
