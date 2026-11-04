// Sporkent Müdür Takip: tek API ucu.
// Giriş kodları sırdır (UYE_KODU, MUDUR_KODU); tarayıcıya hiçbir tablo açık değildir.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UYE_KODU = Deno.env.get("UYE_KODU") ?? "";
const MUDUR_KODU = Deno.env.get("MUDUR_KODU") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE") ?? "";
const BUCKET = "fotograflar";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails("mailto:bildirim@sporkent.local", VAPID_PUBLIC, VAPID_PRIVATE);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const yanit = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Hata extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

function rolBul(kod: unknown): "mudur" | "uye" | null {
  const k = String(kod ?? "").trim().toLowerCase();
  if (!k) return null;
  if (MUDUR_KODU && k === MUDUR_KODU.toLowerCase()) return "mudur";
  if (UYE_KODU && k === UYE_KODU.toLowerCase()) return "uye";
  return null;
}

const temiz = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

async function fotoUrlleri(kayitlar: any[]) {
  const yollar = kayitlar.flatMap((k) => [k.foto_once, k.foto_sonra]).filter(Boolean);
  if (!yollar.length) return kayitlar;
  const { data } = await db.storage.from(BUCKET).createSignedUrls(yollar, 60 * 60 * 6);
  const harita = new Map((data ?? []).map((d: any) => [d.path, d.signedUrl]));
  return kayitlar.map((k) => ({
    ...k,
    foto_once_url: k.foto_once ? harita.get(k.foto_once) ?? null : null,
    foto_sonra_url: k.foto_sonra ? harita.get(k.foto_sonra) ?? null : null,
  }));
}

async function bildir(hedef: { rol?: string; cihaz?: string }, baslik: string, govde: string, kayitId?: number) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  let q = db.from("abonelikler").select("endpoint, abonelik");
  if (hedef.rol) q = q.eq("rol", hedef.rol);
  if (hedef.cihaz) q = q.eq("cihaz", hedef.cihaz);
  const { data } = await q;
  const mesaj = JSON.stringify({ baslik, govde, kayitId });
  await Promise.all((data ?? []).map(async (a: any) => {
    try {
      await webpush.sendNotification(a.abonelik, mesaj, { TTL: 60 * 60 * 24 });
    } catch (e: any) {
      // Süresi dolmuş abonelikleri temizle
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.from("abonelikler").delete().eq("endpoint", a.endpoint);
      } else {
        console.error("push hatası", e?.statusCode, e?.body ?? e?.message);
      }
    }
  }));
}

const ONCELIK_ADI: Record<string, string> = { acil: "ACİL", oncelikli: "Öncelikli", normal: "Normal" };

async function islem(eylem: string, rol: "mudur" | "uye", g: any) {
  switch (eylem) {
    case "giris":
      return { rol, vapid: VAPID_PUBLIC || null };

    case "liste": {
      const { data, error } = await db.from("kayitlar").select("*")
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return { kayitlar: await fotoUrlleri(data ?? []) };
    }

    case "yukleme_adresi": {
      const yol = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(yol);
      if (error) throw error;
      return { yol: data.path, adres: data.signedUrl };
    }

    case "yeni": {
      const oncelik = ["acil", "oncelikli", "normal"].includes(g.oncelik) ? g.oncelik : "normal";
      const kayit = {
        bildiren: temiz(g.bildiren, 80) || "İsimsiz",
        cihaz: temiz(g.cihaz, 80),
        bolge: temiz(g.bolge, 80),
        yer: temiz(g.yer, 200),
        sorun: temiz(g.sorun),
        oncelik,
        foto_once: temiz(g.foto, 200) || null,
      };
      if (!kayit.bolge || !kayit.yer || !kayit.sorun) throw new Hata("Bölge, yer ve sorun zorunlu.");
      const { data, error } = await db.from("kayitlar").insert(kayit).select().single();
      if (error) throw error;
      await bildir({ rol: "mudur" }, `${ONCELIK_ADI[oncelik]} • Yeni kayıt ${data.no}`,
        `${kayit.yer}: ${kayit.sorun}`.slice(0, 180), data.id);
      return { kayit: data };
    }

    case "baslat": {
      if (rol !== "mudur") throw new Hata("Bu işlem yalnızca müdür içindir.", 403);
      const { data, error } = await db.from("kayitlar").update({
        durum: "devam",
        sorumlu: temiz(g.sorumlu, 120) || null,
        son_tarih: g.son_tarih || null,
        mudahale_at: new Date().toISOString(),
      }).eq("id", g.id).neq("durum", "tamam").select().single();
      if (error) throw error;
      return { kayit: data };
    }

    case "gecikme": {
      if (rol !== "mudur") throw new Hata("Bu işlem yalnızca müdür içindir.", 403);
      const { data, error } = await db.from("kayitlar").update({
        gecikme_nedeni: temiz(g.neden, 500) || null,
        son_tarih: g.son_tarih || null,
      }).eq("id", g.id).select().single();
      if (error) throw error;
      return { kayit: data };
    }

    case "kapat": {
      if (rol !== "mudur") throw new Hata("Bu işlem yalnızca müdür içindir.", 403);
      if (!g.foto) throw new Hata("İş bitti fotoğrafı olmadan kayıt kapatılamaz.");
      if (!temiz(g.sonuc)) throw new Hata("Yapılan işlemi yazın.");
      const { data, error } = await db.from("kayitlar").update({
        durum: "tamam",
        sonuc: temiz(g.sonuc),
        foto_sonra: temiz(g.foto, 200),
        kapanis_at: new Date().toISOString(),
      }).eq("id", g.id).select().single();
      if (error) throw error;
      if (data.cihaz) {
        await bildir({ cihaz: data.cihaz }, `Yapıldı • ${data.no}`, `${data.yer}: ${data.sonuc}`.slice(0, 180), data.id);
      }
      return { kayit: data };
    }

    case "abone_ol": {
      const a = g.abonelik;
      if (!a?.endpoint) throw new Hata("Geçersiz abonelik.");
      const { error } = await db.from("abonelikler").upsert({
        endpoint: a.endpoint, abonelik: a, rol, cihaz: temiz(g.cihaz, 80),
      });
      if (error) throw error;
      return { tamam: true };
    }

    default:
      throw new Hata("Bilinmeyen işlem.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const g = await req.json();
    const rol = rolBul(g.kod);
    if (!rol) return yanit({ hata: "Kod hatalı." }, 401);
    return yanit(await islem(String(g.eylem), rol, g));
  } catch (e: any) {
    console.error(e);
    return yanit({ hata: e instanceof Hata ? e.message : "Sunucu hatası, tekrar deneyin." }, e?.status ?? 500);
  }
});
