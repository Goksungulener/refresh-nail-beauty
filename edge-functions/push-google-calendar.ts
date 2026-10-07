// Supabase Edge Function: push-google-calendar
// Randevuları Google Takvim'e yazar. appointments tablosundaki her ekleme /
// değişiklik / silmede Supabase Database Webhook ile çağrılır:
//   yeni randevu -> takvime eklenir, değişirse güncellenir, iptal/silinirse takvimden silinir.
// Gövdesiz (boş) çağrılırsa bugünden sonraki tüm randevuları takvime aktarır (ilk kurulum).
//
// Kurulum: Supabase Dashboard -> Edge Functions -> Deploy a new function
// isim: push-google-calendar, bu dosyanın içeriğini yapıştırın.
// Gerekli secret'lar:
//   GOOGLE_SERVICE_ACCOUNT_JSON  Google Cloud'dan indirilen servis hesabı anahtar dosyasının tüm içeriği
//   GOOGLE_CALENDAR_ID           takvimin kimliği (ana takvim için Gmail adresi)
// Takvim, servis hesabının e-postasıyla "Etkinliklerde değişiklik yapma" yetkisiyle paylaşılmalı.
//
// Takvime yazılan etkinliklerin kimliği "rnb" + randevu id'si olur; sync-google-calendar
// bu etkinlikleri atlar, böylece randevular siteye tekrar "kapatma" olarak dönmez.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SA = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!);
const CALENDAR_ID = encodeURIComponent(Deno.env.get("GOOGLE_CALENDAR_ID")!);
const API = `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events`;

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Servis hesabı anahtarıyla imzalı JWT üretip Google'dan erişim anahtarı alır. */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: SA.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = SA.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claims}.${b64url(sig)}`,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("Google girişi başarısız: " + JSON.stringify(json));
  return json.access_token;
}

/** Google etkinlik kimliği: sadece 0-9 ve a-v harfleri olabilir; uuid'nin tireleri atılınca uygun olur. */
const eventId = (apptId: string) => "rnb" + apptId.replace(/-/g, "");

function addMinutes(date: string, time: string, mins: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi + mins));
  return t.toISOString().slice(0, 19);
}

// deno-lint-ignore no-explicit-any
function eventBody(a: any) {
  const pending = a.status === "pending" ? " (Onay bekliyor)" : "";
  return {
    id: eventId(a.id),
    status: "confirmed",
    summary: `${a.customer_name} - ${a.service_name}${pending}`,
    description: [`Telefon: ${a.customer_phone}`, a.note ? `Not: ${a.note}` : ""].filter(Boolean).join("\n"),
    start: { dateTime: `${a.appt_date}T${a.appt_time.slice(0, 5)}:00`, timeZone: "Europe/Istanbul" },
    end: { dateTime: addMinutes(a.appt_date, a.appt_time, a.duration_minutes), timeZone: "Europe/Istanbul" },
  };
}

// deno-lint-ignore no-explicit-any
async function upsert(token: string, a: any) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const body = JSON.stringify(eventBody(a));
  // Önce güncellemeyi dene (daha önce silinmiş etkinliği de geri getirir), yoksa yeni ekle.
  let res = await fetch(`${API}/${eventId(a.id)}`, { method: "PUT", headers, body });
  if (res.status === 404) res = await fetch(API, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`Takvime yazılamadı (${res.status}): ${await res.text()}`);
}

async function remove(token: string, apptId: string) {
  const res = await fetch(`${API}/${eventId(apptId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Takvimden silinemedi (${res.status}): ${await res.text()}`);
  }
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));
    const token = await getAccessToken();

    if (payload.type === "DELETE") {
      await remove(token, payload.old_record.id);
    } else if (payload.record) {
      if (payload.record.status === "cancelled") await remove(token, payload.record.id);
      else await upsert(token, payload.record);
    } else {
      // İlk kurulum: bugünden sonraki tüm randevuları aktar.
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
      const { data, error } = await supabase.from("appointments").select("*")
        .gte("appt_date", today).neq("status", "cancelled");
      if (error) throw error;
      for (const a of data || []) await upsert(token, a);
      return Response.json({ ok: true, aktarilan: data?.length || 0 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
