/** Pembuatan caption otomatis via Lovable AI. Server-only. */

type SseEvent = {
  type?: string;
  delta?: string;
  response?: { output_text?: string };
};

/** Panggil /v1/responses secara streaming, kembalikan teks akhir. */
async function callAi(prompt: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Lovable AI belum aktif.");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      input: prompt,
      stream: true,
      reasoning: { effort: "low", summary: "auto" },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI gagal merespons (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let evt: SseEvent;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
        text += evt.delta;
      } else if (evt.type === "response.completed" && evt.response?.output_text) {
        text = evt.response.output_text;
      }
    }
  }
  return text.trim();
}

function parseJsonArray(raw: string): string[] {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Buat caption Reels Islami untuk banyak judul video sekaligus (satu panggilan AI).
 * Hasil selalu sejumlah judul; judul yang gagal digenerate jatuh ke caption sederhana.
 */
export async function generateAutoCaptions(titles: string[]): Promise<string[]> {
  const fallback = (t: string) =>
    `${t}\n\nBarakallah, semoga bermanfaat.\n\n#ceramahsingkat #kajianislam #dakwahislam #hidupsehat #islami`;

  if (!titles.length) return [];
  let captions: string[] = [];
  try {
    const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const raw = await callAi(
      [
        "Kamu penulis caption Instagram Reels untuk konten dakwah/kesehatan Islami berbahasa Indonesia.",
        "Untuk setiap judul video di bawah, buat SATU caption menarik:",
        "- 2-4 kalimat pembuka yang menggugah, sesuai isi judul (jangan mengarang klaim di luar judul).",
        "- Akhiri dengan tepat 5 hashtag relevan.",
        "- Maksimal 700 karakter per caption. Tanpa emoji berlebihan (maks 2).",
        'Balas HANYA dengan JSON array of strings (bukan objek), urut sesuai nomor. Contoh: ["caption 1", "caption 2"].',
        "",
        "Judul video:",
        numbered,
      ].join("\n"),
    );
    captions = parseJsonArray(raw);
  } catch (e) {
    console.error("generateAutoCaptions gagal, pakai caption cadangan:", e);
  }
  return titles.map((t, i) => (captions[i] ?? fallback(t)).slice(0, 2200));
}
