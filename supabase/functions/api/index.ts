// Sporkent Müdür Takip: tek API ucu.
// Giriş kodları sırdır (UYE_KODU, MUDUR_KODU); tarayıcıya hiçbir tablo açık değildir.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KODLAR: [Rol, string][] = [
  ["mudur", Deno.env.get("MUDUR_KODU") ?? ""],
  ["sef", Deno.env.get("SEF_KODU") ?? ""],
  ["yonetim", Deno.env.get("YONETIM_KODU") ?? ""],
  ["uye", Deno.env.get("UYE_KODU") ?? ""],
];
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

// mudur ve sef işi kapatır; yonetim her kaydı görür; uye yalnızca kendi kayıtlarını ve yapılan işleri görür.
type Rol = "mudur" | "sef" | "yonetim" | "uye";
const HEPSINI_GORUR: Rol[] = ["mudur", "sef", "yonetim"];
const KAPATABILIR: Rol[] = ["mudur", "sef"];

function rolBul(kod: unknown): Rol | null {
  const k = String(kod ?? "").trim().toLowerCase();
  if (!k) return null;
  for (const [rol, gercek] of KODLAR) if (gercek && k === gercek.toLowerCase()) return rol;
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

type Hedef = Rol[] | "hepsi" | { cihaz: string };

async function bildir(hedef: Hedef, baslik: string, govde: string, kayitId?: number, resim?: string | null) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { hedef: 0, basarili: 0 };
  let q = db.from("abonelikler").select("endpoint, abonelik, rol");
  if (Array.isArray(hedef)) q = q.in("rol", hedef);
  else if (hedef !== "hepsi") q = q.eq("cihaz", hedef.cihaz);
  const { data } = await q;
  const mesaj = JSON.stringify({ baslik, govde, kayitId, resim: resim ?? undefined });
  const hatalar: unknown[] = [];
  let basarili = 0;
  await Promise.all((data ?? []).map(async (a: any) => {
    try {
      // urgency: high → Android telefonu uykudayken de hemen uyandırır
      await webpush.sendNotification(a.abonelik, mesaj, { TTL: 60 * 60 * 24, urgency: "high" });
      basarili++;
    } catch (e: any) {
      hatalar.push({ rol: a.rol, kod: e?.statusCode ?? null, mesaj: String(e?.body ?? e?.message ?? e).slice(0, 300) });
      // Yalnızca servis "bu abonelik artık yok" derse sil; telefon her açılışta yeniden kaydolur
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.from("abonelikler").delete().eq("endpoint", a.endpoint);
      }
    }
  }));
  const sonuc = { hedef: (data ?? []).length, basarili };
  await db.from("bildirim_gunlugu").insert({ baslik, ...sonuc, hatalar: hatalar.length ? hatalar : null });
  return sonuc;
}

async function islem(eylem: string, rol: Rol, g: any) {
  switch (eylem) {
    case "giris":
      return { rol, vapid: VAPID_PUBLIC || null };

    case "liste": {
      let q = db.from("kayitlar").select("*").order("created_at", { ascending: false }).limit(300);
      if (!HEPSINI_GORUR.includes(rol)) {
        // Grup üyesi: yapılan işler + kendi açtığı kayıtlar
        const cihaz = temiz(g.cihaz, 80).replace(/[^a-zA-Z0-9-]/g, "");
        q = cihaz ? q.or(`durum.eq.tamam,cihaz.eq.${cihaz}`) : q.eq("durum", "tamam");
      }
      const { data, error } = await q;
      if (error) throw error;
      const kayitlar = HEPSINI_GORUR.includes(rol)
        ? data ?? []
        : (data ?? []).map(({ cihaz: _c, ...k }: any) => k);
      return { kayitlar: await fotoUrlleri(kayitlar) };
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
        bolge: temiz(g.bolge, 80) || null,
        yer: temiz(g.yer, 200),
        sorun: temiz(g.sorun),
        oncelik,
        foto_once: temiz(g.foto, 200) || null,
      };
      if (!kayit.yer || !kayit.sorun) throw new Hata("Yer ve sorun zorunlu.");
      const { data, error } = await db.from("kayitlar").insert(kayit).select().single();
      if (error) throw error;
      await bildir(["mudur", "sef"], `Yeni sorun ${data.no}`,
        `${kayit.yer}: ${kayit.sorun}`.slice(0, 180), data.id);
      return { kayit: data };
    }

    case "kapat": {
      if (!KAPATABILIR.includes(rol)) throw new Hata("Bu işlemi yalnızca müdür veya şef yapabilir.", 403);
      if (!g.foto) throw new Hata("Yapılan işin fotoğrafını çekin.");
      const { data, error } = await db.from("kayitlar").update({
        durum: "tamam",
        sonuc: temiz(g.sonuc) || null,
        foto_sonra: temiz(g.foto, 200),
        kapatan: temiz(g.ad, 80) || (rol === "mudur" ? "Müdür" : "Şef"),
        kapanis_at: new Date().toISOString(),
      }).eq("id", g.id).neq("durum", "tamam").select().single();
      if (error) throw new Hata("Kayıt bulunamadı ya da zaten kapatılmış.");
      // Yapılan iş herkese: bildirimde yapılan işin fotoğrafı da görünsün
      const { data: url } = await db.storage.from(BUCKET).createSignedUrl(data.foto_sonra, 60 * 60 * 24 * 7);
      await bildir("hepsi", `Yapıldı • ${data.yer}`.slice(0, 80),
        (data.sonuc || data.sorun || "").slice(0, 180), data.id, url?.signedUrl);
      return { kayit: data };
    }

    case "bildirim_dene": {
      const cihaz = temiz(g.cihaz, 80);
      if (!cihaz) throw new Hata("Cihaz bilgisi yok.");
      const sonuc = await bildir({ cihaz }, "Sporkent deneme", "Bildirimler bu telefonda çalışıyor.");
      return sonuc;
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
