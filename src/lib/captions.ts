/** Caption presets applied to every video in a folder. Client-safe. */
export const CAPTION_PRESETS = [
  {
    id: "zaidul",
    label: "dr Zaidul Akbar",
    text: "Barakallah dr Zaidul Akbar\nsumber video dari Youtube dr Zaidul Akbar Official",
    hashtags: ["#drzaidulakbar", "#jurussehatrasulullah", "#hidupsehat", "#resepsehat", "#dakwahislam"],
  },
  {
    id: "uas",
    label: "Ustadz Abdul Somad",
    text: "Barakallah Ustadz Abdul Somad\nsumber video dari Youtube Ustadz Abdul Somad Official",
    hashtags: ["#ustadzabdulsomad", "#uas", "#ceramahsingkat", "#kajianislam", "#dakwahislam"],
  },
  {
    id: "uah",
    label: "Ustadz Adi Hidayat",
    text: "Barakallah Ustadz Adi Hidayat\nsumber video dari Youtube Ustadz Adi Hidayat Official",
    hashtags: ["#ustadzadihidayat", "#uah", "#ceramahsingkat", "#kajianislam", "#dakwahislam"],
  },
] as const;

export type CaptionPresetId = (typeof CAPTION_PRESETS)[number]["id"];

export const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

/** Judul = nama file, lalu teks preset, lalu 5 hashtag relevan. */
export function buildCaption(fileName: string, presetId: CaptionPresetId) {
  const preset = CAPTION_PRESETS.find((p) => p.id === presetId) ?? CAPTION_PRESETS[0];
  return `${stripExt(fileName)}\n\n${preset.text}\n\n${preset.hashtags.join(" ")}`.slice(0, 2200);
}

/** Jam tayang harian dalam WITA (UTC+8). */
export const SLOT_HOURS_WITA = [13, 17, 20];

/** Menghasilkan jadwal berurutan 13:00 / 17:00 / 20:00 WITA mulai dari slot berikutnya. */
export function nextSlots(count: number, from = new Date()): string[] {
  const out: string[] = [];
  // WITA = UTC+8, jadi jam UTC-nya 05:00, 09:00, 12:00.
  const utcHours = SLOT_HOURS_WITA.map((h) => h - 8);

  let day = 0;
  while (out.length < count) {
    for (const h of utcHours) {
      const d = new Date(
        Date.UTC(
          from.getUTCFullYear(),
          from.getUTCMonth(),
          from.getUTCDate() + day,
          h,
          0,
          0,
          0,
        ),
      );
      if (d.getTime() <= from.getTime()) continue;
      out.push(d.toISOString());
      if (out.length === count) break;
    }
    day++;
    if (day > 400) break;
  }
  return out;
}
