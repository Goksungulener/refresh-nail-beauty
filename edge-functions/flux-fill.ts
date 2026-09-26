// Supabase Edge Function: flux-fill
// admin.html'deki "AI Görsel" sekmesinden gönderilen orijinal görsel + maske +
// prompt'u BFL (Black Forest Labs) FLUX.1 Fill [pro] modeline gönderir, sonucu
// hazır olana kadar bekler (polling) ve üretilen görseli doğrudan binary (PNG)
// olarak admin paneline döner.
//
// Kurulum: Supabase Dashboard -> Edge Functions -> Deploy a new function
// isim: flux-fill, bu dosyanın içeriğini yapıştırın.
// Gerekli secret: FLUX_API_KEY (bfl.ai hesabınızdaki API anahtarı,
// Project Settings -> Edge Functions -> Secrets kısmından eklenir)
// SUPABASE_URL ve SUPABASE_ANON_KEY zaten otomatik sağlanır.
//
// Güvenlik: Bu fonksiyon isteği gönderen kullanıcının admin.html'e giriş
// yapmış (Supabase Auth) gerçek bir oturumu olup olmadığını kontrol eder.
// Sadece anon anahtarla (herkese açık, config.js içinde) çağrı yapmak
// yetmez - aksi halde siteyi inceleyen herkes ücretli FLUX çağrıları
// yaptırabilirdi.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FLUX_API_KEY = Deno.env.get("FLUX_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SUBMIT_URL = "https://api.bfl.ai/v1/flux-pro-1.0-fill";
const RESULT_URL = "https://api.bfl.ai/v1/get_result";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(",");
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    // Sadece gerçek bir admin oturumu ile çağrılabilir.
    const authHeader = req.headers.get("Authorization") ?? "";
    const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await authedClient.auth.getUser();
    if (!userData?.user) {
      return jsonError("Yetkisiz erişim: lütfen giriş yapın.", 401);
    }

    const body = await req.json();
    const { image, mask, prompt, steps, guidance, prompt_upsampling } = body;

    if (!image || !mask) {
      return jsonError("image ve mask alanları zorunlu.", 400);
    }

    const submitRes = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-key": FLUX_API_KEY },
      body: JSON.stringify({
        prompt: prompt || "",
        steps: steps || 40,
        prompt_upsampling: !!prompt_upsampling,
        guidance: guidance || 60,
        output_format: "png",
        safety_tolerance: 6,
        image: stripDataUrlPrefix(image),
        mask: stripDataUrlPrefix(mask),
      }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      return jsonError(`FLUX gönderim hatası (${submitRes.status}): ${errText}`, 502);
    }

    const { id } = await submitRes.json();
    if (!id) {
      return jsonError("FLUX task id alınamadı.", 502);
    }

    let resultUrl: string | null = null;
    const MAX_ATTEMPTS = 40; // ~80 saniye
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const statusRes = await fetch(`${RESULT_URL}?id=${encodeURIComponent(id)}`, {
        headers: { "x-key": FLUX_API_KEY },
      });
      if (!statusRes.ok) continue;

      const statusJson = await statusRes.json();
      if (statusJson.status === "Pending") continue;
      if (statusJson.status === "Ready") {
        resultUrl = statusJson.result?.sample ?? null;
        break;
      }
      // Error, Content Moderated, Request Moderated, Task not found vb.
      return jsonError(`FLUX işlemi tamamlanamadı: ${statusJson.status}`, 502);
    }

    if (!resultUrl) {
      return jsonError("FLUX zaman aşımına uğradı, lütfen tekrar deneyin.", 504);
    }

    const imageRes = await fetch(resultUrl);
    if (!imageRes.ok) {
      return jsonError("Üretilen görsel indirilemedi.", 502);
    }
    const imageBuffer = await imageRes.arrayBuffer();

    return new Response(imageBuffer, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": imageRes.headers.get("Content-Type") || "image/png",
      },
    });
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
