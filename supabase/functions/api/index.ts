// Sporkent İşletme Kooperatifi SAHA TAKİP: tek API ucu.
// Giriş kodu yalnızca gruba katılırken kullanılır; yönetici (YK başkanı) onaylayınca telefon
// kendi gizli anahtarıyla çalışır. Tarayıcıya hiçbir tablo açık değildir.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
  constructor(msg: string, public status = 400, public ek: Record<string, unknown> = {}) { super(msg); }
}

// baskan: YK başkanı ve yönetici (onay, üye çıkarma, kodlar, tümden silme)
// baskan, mudur ve sef işi "yapıldı" olarak kapatır; onaylı her üye bütün kayıtları görür.
type Rol = "baskan" | "mudur" | "sef" | "yonetim" | "uye";
const ROLLER: Rol[] = ["baskan", "mudur", "sef", "yonetim", "uye"];
const KAPATABILIR: Rol[] = ["baskan", "mudur", "sef"];
const MAKS_UYE = 50; // başkan dahil onaylı üye sınırı
const ROL_ADI: Record<Rol, string> = {
  baskan: "YK Başkanı", mudur: "Müdür", sef: "Şef", yonetim: "Yönetim Kurulu", uye: "Grup üyesi",
};

const temiz = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

// Kodlar: yöneticinin değiştirdiği değer (ayarlar tablosu), yoksa sunucu sırrı
async function kodlar(): Promise<Record<Rol, string>> {
  const { data } = await db.from("ayarlar").select("ad, deger").like("ad", "kod_%");
  const dbde = new Map((data ?? []).map((r: any) => [r.ad, r.deger]));
  const sonuc = {} as Record<Rol, string>;
  for (const r of ROLLER) sonuc[r] = dbde.get(`kod_${r}`) ?? Deno.env.get(`${r.toUpperCase()}_KODU`) ?? "";
  return sonuc;
}

async function rolBul(kod: unknown): Promise<Rol | null> {
  const k = temiz(kod, 100).toLowerCase();
  if (!k) return null;
  const hepsi = await kodlar();
  for (const r of ROLLER) if (hepsi[r] && k === hepsi[r].toLowerCase()) return r;
  return null;
}

// Yeni işlerin yapılma süresi (gün): yöneticinin ayarı, yoksa 3
async function varsayilanSure(): Promise<number> {
  const { data } = await db.from("ayarlar").select("deger").eq("ad", "varsayilan_sure").maybeSingle();
  const n = Number(data?.deger);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 3;
}

// Türkiye saatiyle (UTC+3, yaz saati yok) gün + n gün → "YYYY-MM-DD"
const sonGun = (baslangic: string | Date, gun: number) =>
  new Date(new Date(baslangic).getTime() + 3 * 3600e3 + gun * 864e5).toISOString().slice(0, 10);

const anahtarUret = () => crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");

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

async function bildir(hedef: Hedef, baslik: string, govde: string, ek: { kayitId?: number; resim?: string | null; sayfa?: string } = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { hedef: 0, basarili: 0 };
  let q = db.from("abonelikler").select("endpoint, abonelik, rol");
  if (Array.isArray(hedef)) q = q.in("rol", hedef);
  else if (hedef !== "hepsi") q = q.eq("cihaz", hedef.cihaz);
  const { data } = await q;
  const mesaj = JSON.stringify({ baslik, govde, kayitId: ek.kayitId, resim: ek.resim ?? undefined, sayfa: ek.sayfa });
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

// ---------- Gruba katılma ----------
async function giris(g: any) {
  const rol = await rolBul(g.kod);
  if (!rol) throw new Hata("Kod hatalı.", 401);
  const cihaz = temiz(g.cihaz, 80);
  const ad = temiz(g.ad, 80);
  if (!cihaz || !ad) throw new Hata("Ad ve cihaz bilgisi gerekli.");

  const { data: var_ } = await db.from("uyeler").select("*").eq("cihaz", cihaz).maybeSingle();
  if (var_?.durum === "cikarildi") throw new Hata("Bu telefonun gruba erişimi yönetici tarafından kaldırıldı.", 403);

  // Başkan kodu kendiliğinden onaylıdır; diğerleri (ya da rolü değişen telefon) onay bekler.
  const durum = rol === "baskan" ? "onayli" : var_ && var_.rol === rol ? var_.durum : "bekliyor";
  const anahtar = var_?.anahtar ?? anahtarUret();
  const { error } = await db.from("uyeler").upsert({
    cihaz, anahtar, ad, rol, durum,
    onay_at: durum === "onayli" ? var_?.onay_at ?? new Date().toISOString() : null,
    son_gorulme: new Date().toISOString(),
  });
  if (error) throw error;
  await db.from("abonelikler").update({ rol }).eq("cihaz", cihaz);

  if (durum === "bekliyor") {
    await bildir(["baskan"], "Onay bekleyen üye", `${ad} (${ROL_ADI[rol]}) gruba katılmak istiyor.`, { sayfa: "uyeler" });
  }
  return { rol, durum, anahtar, vapid: VAPID_PUBLIC || null };
}

// Telefonu gizli anahtarıyla tanı
async function kimlik(g: any) {
  const cihaz = temiz(g.cihaz, 80);
  const anahtar = temiz(g.anahtar, 200);
  if (!cihaz || !anahtar) throw new Hata("Oturum bulunamadı, tekrar giriş yapın.", 401, { cikis: true });
  const { data: u } = await db.from("uyeler").select("*").eq("cihaz", cihaz).maybeSingle();
  if (!u || u.anahtar !== anahtar) throw new Hata("Oturum geçersiz, tekrar giriş yapın.", 401, { cikis: true });
  if (u.durum === "cikarildi") throw new Hata("Bu telefonun gruba erişimi yönetici tarafından kaldırıldı.", 401, { cikis: true });
  // Son görülme dakikada bir güncellenir
  if (!u.son_gorulme || Date.now() - Date.parse(u.son_gorulme) > 60_000) {
    await db.from("uyeler").update({ son_gorulme: new Date().toISOString() }).eq("cihaz", cihaz);
  }
  return u as { cihaz: string; ad: string; rol: Rol; durum: string };
}

async function tumFotograflariSil() {
  const { data: klasorler } = await db.storage.from(BUCKET).list("", { limit: 1000 });
  for (const k of klasorler ?? []) {
    for (;;) {
      const { data: dosyalar } = await db.storage.from(BUCKET).list(k.name, { limit: 1000 });
      if (!dosyalar?.length) break;
      await db.storage.from(BUCKET).remove(dosyalar.map((d: any) => `${k.name}/${d.name}`));
      if (dosyalar.length < 1000) break;
    }
  }
}

async function islem(eylem: string, u: { cihaz: string; ad: string; rol: Rol; durum: string }, g: any) {
  const rol = u.rol;
  const yonetici = () => { if (rol !== "baskan") throw new Hata("Bu işlemi yalnızca yönetici (YK başkanı) yapabilir.", 403); };

  // Onay bekleyen telefon yalnızca durumunu sorabilir ve bildirime kaydolabilir
  if (u.durum !== "onayli" && !["durum", "abone_ol"].includes(eylem)) {
    throw new Hata("Kaydınız yönetici onayını bekliyor.", 403, { bekliyor: true });
  }

  switch (eylem) {
    case "durum":
      return { rol, durum: u.durum, ad: u.ad };

    case "liste": {
      const { data, error } = await db.from("kayitlar").select("*").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      const kayitlar = (data ?? []).map(({ cihaz: c, ...k }: any) => ({ ...k, benim: c === u.cihaz }));
      let bekleyen: number | undefined;
      if (rol === "baskan") {
        const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "bekliyor");
        bekleyen = count ?? 0;
      }
      if (rol === "baskan" || rol === "yonetim") {
        // Yönetici ve yönetim kurulu, müdür ve şefin her kaydı ne zaman gördüğünü de alır
        const ids = kayitlar.map((k: any) => k.id);
        const { data: g } = ids.length
          ? await db.from("goruntulemeler").select("kayit_id, ad, rol, ilk_at").in("kayit_id", ids).order("ilk_at")
          : { data: [] };
        for (const k of kayitlar as any[]) {
          k.gorenler = (g ?? []).filter((x: any) => x.kayit_id === k.id).map(({ kayit_id: _i, ...x }: any) => x);
        }
      }
      return { kayitlar: await fotoUrlleri(kayitlar), rol, bekleyen };
    }

    case "yukleme_adresi": {
      const yol = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(yol);
      if (error) throw error;
      return { yol: data.path, adres: data.signedUrl };
    }

    case "yeni": {
      // Müdür ve şef sorun bildirmez, yalnızca işi "Yapıldı" olarak kapatır
      if (rol === "mudur" || rol === "sef") throw new Hata("Müdür ve şef yeni kayıt giremez; yalnızca \"Yapıldı\" girebilir.", 403);
      const kayit = {
        bildiren: u.ad,
        cihaz: u.cihaz,
        yer: temiz(g.yer, 200),
        sorun: temiz(g.sorun),
        foto_once: temiz(g.foto, 200) || null,
        son_tarih: sonGun(new Date(), await varsayilanSure()),
      };
      if (!kayit.yer || !kayit.sorun) throw new Hata("Yer ve sorun zorunlu.");
      const { data, error } = await db.from("kayitlar").insert(kayit).select().single();
      if (error) throw error;
      // Yeni sorun bütün gruba duyurulur
      await bildir("hepsi", `Yeni sorun ${data.no}`, `${kayit.yer}: ${kayit.sorun}`.slice(0, 180), { kayitId: data.id });
      const { cihaz: _c, ...donen } = data;
      return { kayit: { ...donen, benim: true } };
    }

    case "kapat": {
      if (!KAPATABILIR.includes(rol)) throw new Hata("Bu işlemi yalnızca yönetici, müdür veya şef yapabilir.", 403);
      if (!g.foto) throw new Hata("Yapılan işin fotoğrafını çekin.");
      const { data, error } = await db.from("kayitlar").update({
        durum: "tamam",
        sonuc: temiz(g.sonuc) || null,
        foto_sonra: temiz(g.foto, 200),
        kapatan: u.ad,
        kapanis_at: new Date().toISOString(),
      }).eq("id", g.id).neq("durum", "tamam").select().single();
      if (error) throw new Hata("Kayıt bulunamadı ya da zaten kapatılmış.");
      // Yapılan iş herkese: bildirimde yapılan işin fotoğrafı da görünsün
      const { data: url } = await db.storage.from(BUCKET).createSignedUrl(data.foto_sonra, 60 * 60 * 24 * 7);
      await bildir("hepsi", `Yapıldı • ${data.yer}`.slice(0, 80), (data.sonuc || data.sorun || "").slice(0, 180),
        { kayitId: data.id, resim: url?.signedUrl });
      return { tamam: true };
    }

    case "sure_degistir": {
      yonetici();
      const gun = Number(g.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 60) throw new Hata("Süre 1 ile 60 gün arasında olmalı.");
      const { data: k } = await db.from("kayitlar").select("id, created_at, durum").eq("id", g.id).maybeSingle();
      if (!k) throw new Hata("Kayıt bulunamadı.");
      if (k.durum === "tamam") throw new Hata("Bu iş zaten yapıldı.");
      const son_tarih = sonGun(k.created_at, gun);
      const { error } = await db.from("kayitlar").update({ son_tarih }).eq("id", k.id);
      if (error) throw error;
      return { son_tarih };
    }

    case "goruldu": {
      // Yalnızca müdür ve şefin ilk açışı saklanır; sonraki açışlar ilk zamanı değiştirmez
      if (rol !== "mudur" && rol !== "sef") return { tamam: true };
      await db.from("goruntulemeler").upsert(
        { kayit_id: Number(g.id), cihaz: u.cihaz, ad: u.ad, rol },
        { onConflict: "kayit_id,cihaz", ignoreDuplicates: true },
      );
      return { tamam: true };
    }

    case "cevap_ver": {
      // Yönetici işi kapatmadan "Bu iş N gün içinde yapılacaktır." der; son gün bugünden sayılır
      yonetici();
      const gun = Number(g.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 60) throw new Hata("Süre 1 ile 60 gün arasında olmalı.");
      const yanitMetni = `Bu iş ${gun} gün içinde yapılacaktır.`;
      const { data, error } = await db.from("kayitlar").update({
        yanit: yanitMetni, yanit_veren: u.ad, yanit_at: new Date().toISOString(), son_tarih: sonGun(new Date(), gun),
      }).eq("id", g.id).neq("durum", "tamam").select().single();
      if (error) throw new Hata("Kayıt bulunamadı ya da iş zaten yapıldı.");
      await bildir("hepsi", `Cevap • ${data.yer}`.slice(0, 80), yanitMetni, { kayitId: data.id });
      return { yanit: data.yanit, yanit_veren: data.yanit_veren, yanit_at: data.yanit_at, son_tarih: data.son_tarih };
    }

    case "varsayilan_sure": {
      yonetici();
      const gun = Number(g.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 60) throw new Hata("Süre 1 ile 60 gün arasında olmalı.");
      const { error } = await db.from("ayarlar").upsert({ ad: "varsayilan_sure", deger: String(gun) });
      if (error) throw error;
      return { tamam: true };
    }

    case "kayit_sil": {
      // Yönetici uygun görmediği kaydı fotoğraflarıyla birlikte herkesten kaldırır
      yonetici();
      const { data: k } = await db.from("kayitlar").select("id, foto_once, foto_sonra").eq("id", g.id).maybeSingle();
      if (!k) throw new Hata("Kayıt bulunamadı.");
      const fotolar = [k.foto_once, k.foto_sonra].filter(Boolean);
      if (fotolar.length) await db.storage.from(BUCKET).remove(fotolar);
      const { error } = await db.from("kayitlar").delete().eq("id", k.id);
      if (error) throw error;
      return { tamam: true };
    }

    case "abone_ol": {
      const a = g.abonelik;
      if (!a?.endpoint) throw new Hata("Geçersiz abonelik.");
      const { error } = await db.from("abonelikler").upsert({ endpoint: a.endpoint, abonelik: a, rol, cihaz: u.cihaz });
      if (error) throw error;
      return { tamam: true };
    }

    // ---------- Yönetici (YK başkanı) ----------
    case "uye_listesi": {
      yonetici();
      const { data, error } = await db.from("uyeler")
        .select("cihaz, ad, rol, durum, created_at, onay_at, son_gorulme").order("created_at", { ascending: false });
      if (error) throw error;
      return { uyeler: (data ?? []).map((x: any) => ({ ...x, ben: x.cihaz === u.cihaz })) };
    }

    case "uye_onayla":
    case "uye_cikar":
    case "uye_geri_al": {
      yonetici();
      const hedef = temiz(g.hedef, 80);
      if (hedef === u.cihaz) throw new Hata("Kendi telefonunuzu değiştiremezsiniz.");
      const durum = eylem === "uye_cikar" ? "cikarildi" : "onayli";
      if (durum === "onayli") {
        const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "onayli");
        if ((count ?? 0) >= MAKS_UYE) throw new Hata(`Grup dolu (${MAKS_UYE} kişi). Yeni üye için önce birini çıkarın.`);
      }
      const { data, error } = await db.from("uyeler")
        .update({ durum, onay_at: durum === "onayli" ? new Date().toISOString() : null })
        .eq("cihaz", hedef).select("ad").maybeSingle();
      if (error) throw error;
      if (!data) throw new Hata("Üye bulunamadı.");
      if (durum === "cikarildi") {
        await db.from("abonelikler").delete().eq("cihaz", hedef);
      } else {
        await bildir({ cihaz: hedef }, "Gruba kabul edildiniz", "Sporkent İşletme Kooperatifi SAHA TAKİP uygulamasını kullanmaya başlayabilirsiniz.");
      }
      return { tamam: true };
    }

    case "uye_sil": {
      // Reddedilen başvuruyu ya da çıkarılan üyeyi listeden tamamen kaldırır (tekrar kodla başvurabilir)
      yonetici();
      const hedef = temiz(g.hedef, 80);
      if (hedef === u.cihaz) throw new Hata("Kendi telefonunuzu silemezsiniz.");
      await db.from("abonelikler").delete().eq("cihaz", hedef);
      await db.from("uyeler").delete().eq("cihaz", hedef);
      return { tamam: true };
    }

    case "kodlar": {
      yonetici();
      return { kodlar: await kodlar(), varsayilan_sure: await varsayilanSure() };
    }

    case "kod_degistir": {
      yonetici();
      const hedefRol = g.rol as Rol;
      if (!ROLLER.includes(hedefRol)) throw new Hata("Geçersiz rol.");
      const yeni = temiz(g.yeni, 60);
      if (yeni.length < 6 || /\s/.test(yeni)) throw new Hata("Kod en az 6 karakter olmalı ve boşluk içermemeli.");
      const hepsi = await kodlar();
      if (ROLLER.some((r) => r !== hedefRol && hepsi[r].toLowerCase() === yeni.toLowerCase())) {
        throw new Hata("Bu kod başka bir grup için kullanılıyor.");
      }
      const { error } = await db.from("ayarlar").upsert({ ad: `kod_${hedefRol}`, deger: yeni });
      if (error) throw error;
      return { tamam: true };
    }

    case "hepsini_sil": {
      yonetici();
      if (temiz(g.onay) !== "SİL") throw new Hata("Onay için büyük harflerle SİL yazın.");
      await tumFotograflariSil();
      const { error } = await db.rpc("kayitlari_sifirla");
      if (error) throw error;
      return { tamam: true };
    }

    default:
      throw new Hata("Bilinmeyen işlem.");
  }
}

// Her sabah zamanlayıcı (pg_cron) çağırır: süresi geçen işleri yönetime bildirir.
const CRON_ANAHTARI = Deno.env.get("CRON_ANAHTARI") ?? "";

async function gunlukGecikme() {
  const bugun = sonGun(new Date(), 0);
  const { data, error } = await db.from("kayitlar").select("id, no, yer, son_tarih")
    .neq("durum", "tamam").lt("son_tarih", bugun).order("son_tarih");
  if (error) throw error;
  if (!data?.length) return { geciken: 0 };
  const gun = (t: string) => Math.round((Date.parse(bugun) - Date.parse(t)) / 864e5);
  const ozet = data.slice(0, 4).map((k: any) => `${k.yer} (${gun(k.son_tarih)} gün)`).join(", ")
    + (data.length > 4 ? ` ve ${data.length - 4} iş daha` : "");
  const sonuc = await bildir(["baskan", "mudur", "sef", "yonetim"], `⚠ ${data.length} iş süresinde yapılmadı`, ozet, { kayitId: data[0].id });
  return { geciken: data.length, ...sonuc };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const g = await req.json();
    if (g.eylem === "gunluk_gecikme") {
      if (!CRON_ANAHTARI || g.cron !== CRON_ANAHTARI) throw new Hata("Yetkisiz.", 401);
      return yanit(await gunlukGecikme());
    }
    if (g.eylem === "giris") return yanit(await giris(g));
    const u = await kimlik(g);
    return yanit(await islem(String(g.eylem), u, g));
  } catch (e: any) {
    console.error(e);
    if (e instanceof Hata) return yanit({ hata: e.message, ...e.ek }, e.status);
    return yanit({ hata: "Sunucu hatası, tekrar deneyin." }, 500);
  }
});
