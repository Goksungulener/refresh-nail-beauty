// Supabase Edge Function: sync-google-calendar
// Google Takvim'in "gizli iCal adresi" özelliğinden etkinlikleri okur ve
// blocked_slots tablosuna source='google' olarak yazar (her çalıştığında
// önce eski google satırlarını siler, sonra güncel listeyi ekler).
//
// Kurulum: Supabase Dashboard -> Edge Functions -> Deploy a new function
// isim: sync-google-calendar, bu dosyanın içeriğini yapıştırın.
// Gerekli secret: GOOGLE_ICAL_URL (Google Takvim'in gizli iCal adresi)
// SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY zaten otomatik sağlanır.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ICAL_URL = Deno.env.get("GOOGLE_ICAL_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function unfold(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseIcsDateTime(str: string): { date: string; time: string | null } {
  if (!str.includes("T")) {
    // Tüm gün etkinlik: YYYYMMDD
    return { date: `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`, time: null };
  }

  const isUtc = str.endsWith("Z");

  if (!isUtc) {
    // Zaten yerel saat olarak kabul et
    return {
      date: `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`,
      time: `${str.slice(9, 11)}:${str.slice(11, 13)}:00`,
    };
  }

  // UTC -> Türkiye saati (UTC+3, yaz saati uygulaması yok, sabit fark)
  const y = Number(str.slice(0, 4));
  const mo = Number(str.slice(4, 6)) - 1;
  const d = Number(str.slice(6, 8));
  const h = Number(str.slice(9, 11));
  const mi = Number(str.slice(11, 13));
  const s = Number(str.slice(13, 15)) || 0;

  const trMs = Date.UTC(y, mo, d, h, mi, s) + 3 * 60 * 60 * 1000;
  const tr = new Date(trMs);
  const yy = tr.getUTCFullYear();
  const mm = String(tr.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tr.getUTCDate()).padStart(2, "0");
  const hh = String(tr.getUTCHours()).padStart(2, "0");
  const mn = String(tr.getUTCMinutes()).padStart(2, "0");
  return { date: `${yy}-${mm}-${dd}`, time: `${hh}:${mn}:00` };
}

interface ParsedEvent {
  uid: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  summary: string;
}

function parseEvents(ics: string): ParsedEvent[] {
  const text = unfold(ics);
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  const events: ParsedEvent[] = [];

  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    if (body.includes("RRULE:")) continue; // yinelenen etkinlikler şimdilik desteklenmiyor

    const uidMatch = body.match(/^UID:(.+)$/m);
    const dtStartMatch = body.match(/^DTSTART[^:]*:(\d{8}(T\d{6}Z?)?)/m);
    const dtEndMatch = body.match(/^DTEND[^:]*:(\d{8}(T\d{6}Z?)?)/m);
    const summaryMatch = body.match(/^SUMMARY:(.*)$/m);
    const statusMatch = body.match(/^STATUS:(.*)$/m);

    if (!uidMatch || !dtStartMatch) continue;
    // Sitenin kendi yazdığı randevular (push-google-calendar, kimlik "rnb...") zaten
    // randevu olarak kayıtlı; tekrar kapatma olarak eklenmesin.
    if (uidMatch[1].trim().startsWith("rnb")) continue;
    if (statusMatch && statusMatch[1].trim() === "CANCELLED") continue;

    const start = parseIcsDateTime(dtStartMatch[1]);
    const end = dtEndMatch ? parseIcsDateTime(dtEndMatch[1]) : null;

    events.push({
      uid: uidMatch[1].trim(),
      date: start.date,
      startTime: start.time,
      endTime: end ? end.time : null,
      summary: summaryMatch ? summaryMatch[1].trim() : "Google Takvim",
    });
  }
  return events;
}

function todayIsoTurkey(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

Deno.serve(async () => {
  try {
    const res = await fetch(ICAL_URL);
    if (!res.ok) throw new Error(`ICS alınamadı: ${res.status}`);
    const ics = await res.text();
    const events = parseEvents(ics);
    const upcoming = events.filter((e) => e.date >= todayIsoTurkey());

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    await supabase.from("blocked_slots").delete().eq("source", "google");

    if (upcoming.length > 0) {
      const rows = upcoming.map((e) => ({
        block_date: e.date,
        start_time: e.startTime,
        end_time: e.endTime,
        reason: e.summary,
        source: "google",
        google_event_id: e.uid,
      }));
      const { error } = await supabase.from("blocked_slots").insert(rows);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ ok: true, synced: upcoming.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
