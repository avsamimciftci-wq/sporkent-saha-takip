// Sporkent İşletme Kooperatifi SAHA TAKİP: tek API ucu.
// Giriş kodu yalnızca gruba katılırken kullanılır; yönetici (YK başkanı) onaylayınca telefon
// kendi gizli anahtarıyla çalışır. Tarayıcıya hiçbir tablo açık değildir.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { GUNLUK, HAFTALIK, KALEM_IDLERI } from "./gorev_programi.ts";

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
type Rol = "baskan" | "mudur" | "sef" | "yonetim" | "muhasebe" | "uye";
const ROLLER: Rol[] = ["baskan", "mudur", "sef", "yonetim", "muhasebe", "uye"];
const KAPATABILIR: Rol[] = ["baskan", "mudur", "sef"];
// Yönetim işleri: yönetici ve yönetim kurulu girer; yalnızca bu dört görev görür, bildirim de yalnızca onlara gider
const YONETIM_ISI_GIREN: Rol[] = ["baskan", "yonetim"];
const YONETIM_ISI_GOREN: Rol[] = ["baskan", "yonetim", "mudur", "sef"];
const kimeBildir = (k: { gizli?: boolean }): Hedef => (k.gizli ? YONETIM_ISI_GOREN : "hepsi");
const MAKS_UYE = 400; // başkan dahil onaylı üye sınırı
// Bu dört görevin yazdığı kayıt doğrudan iş listesine düşer; diğerlerininki (TG üyesi, muhasebe)
// önce yönetici / yönetim kurulu onayını bekler, onaylanınca herkes görür.
// Kaydı onay beklemeden iş listesine düşenler. TG üyeleri (rolü "uye", unvanı TG…) de onaysız girer;
// yalnızca düz ortakların kaydı yönetici ya da YK onayı bekler.
const ONAYSIZ_GIREN: Rol[] = ["baskan", "yonetim", "mudur", "sef", "muhasebe"];
const onaysizGirer = (u: any) => ONAYSIZ_GIREN.includes(u.rol) || (u.rol === "uye" && !u.ortak_no && /^TG/.test(u.unvan ?? ""));
const KAYIT_ONAYLAYAN: Rol[] = ["baskan", "yonetim"];
// Aidat resmini yönetici ve muhasebe ekler; iş programına bu dört görev girer
const AIDAT_EKLEYEN: Rol[] = ["baskan", "muhasebe"];
const PROGRAM_GIREN: Rol[] = ["baskan", "yonetim", "mudur", "sef"];
const ROL_ADI: Record<Rol, string> = {
  baskan: "YK Başkanı", mudur: "Müdür", sef: "Şef", yonetim: "Yönetim Kurulu", muhasebe: "Muhasebe", uye: "TG Üyesi",
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
  // TG üyeleri ve yönetim kurulu yalnızca kişisel kodla girer; ortak kodları kapalı
  for (const r of ROLLER) if (r !== "uye" && r !== "yonetim" && hepsi[r] && k === hepsi[r].toLowerCase()) return r;
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

// Görev programı: müdür ve şef işaretler; yönetici, yönetim kurulu, müdür ve şef görür
const GOREV_GOREN: Rol[] = ["baskan", "yonetim", "mudur", "sef"];
const GOREV_ISARETLEYEN: Rol[] = ["mudur", "sef"];
const kalemSayisi = (p: typeof GUNLUK) => p.bolumler.reduce((n, b) => n + b.kalemler.length, 0);
// "YYYY-MM-DD" gününün haftasının pazartesisi
const haftaBasi = (gun: string) => {
  const d = new Date(gun + "T00:00:00Z");
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
};
const gunEkle = (gun: string, n: number) => new Date(Date.parse(gun + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// gecmisli: geçmiş günler / haftalar özeti yalnızca yöneticiye gönderilir
async function gorevDurumu(gun: string, gecmisli = false) {
  const hafta = haftaBasi(gun);
  const { data: isaretler, error } = await db.from("gorev_isaretleri").select("tur, donem, kalem, ad, rol, isaret_at")
    .or(`and(tur.eq.gunluk,donem.eq.${gun}),and(tur.eq.haftalik,donem.eq.${hafta})`);
  if (error) throw error;
  const bugun = sonGun(new Date(), 0);
  let gunler: unknown[] = [], haftalar: unknown[] = [];
  if (gecmisli) {
    // Son 14 gün ve son 8 hafta, kaç kalem işaretlendi (programdan çıkarılan kalemler sayılmaz)
    const { data: eski } = await db.from("gorev_isaretleri").select("tur, donem, kalem")
      .gte("donem", gunEkle(haftaBasi(bugun), -7 * 7));
    const say = (tur: string, donem: string) =>
      (eski ?? []).filter((x: any) => x.tur === tur && x.donem === donem && KALEM_IDLERI.has(x.kalem)).length;
    gunler = Array.from({ length: 14 }, (_, i) => gunEkle(bugun, -i)).map((d) => ({ donem: d, yapilan: say("gunluk", d) }));
    haftalar = Array.from({ length: 8 }, (_, i) => gunEkle(haftaBasi(bugun), -7 * i)).map((d) => ({ donem: d, yapilan: say("haftalik", d) }));
  }
  return {
    program: { gunluk: GUNLUK, haftalik: HAFTALIK },
    gun, hafta, bugun, buHafta: haftaBasi(bugun),
    isaretler: (isaretler ?? []).filter((x: any) => KALEM_IDLERI.has(x.kalem)),
    gecmisGorur: gecmisli,
    gecmis: { gunler, haftalar, gunlukToplam: kalemSayisi(GUNLUK), haftalikToplam: kalemSayisi(HAFTALIK) },
  };
}

async function gorevHatirlat() {
  const bugun = sonGun(new Date(), 0);
  const sonuc: Record<string, unknown> = {};
  sonuc.gunluk = await bildir(GOREV_ISARETLEYEN, "📋 Günlük görevler",
    `Bugünkü ${kalemSayisi(GUNLUK)} kalem görev ve denetim sizi bekliyor. Yaptıkça işaretleyin.`, { sayfa: "gorevler" });
  // Pazartesi: haftalık program da hatırlatılır
  if (haftaBasi(bugun) === bugun) {
    sonuc.haftalik = await bildir(GOREV_ISARETLEYEN, "📋 Haftalık görevler",
      `Bu haftanın ${kalemSayisi(HAFTALIK)} kalem görev ve denetimi sizi bekliyor.`, { sayfa: "gorevler-haftalik" });
  }
  return sonuc;
}

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
  let rol: Rol | null = null;
  let ad = temiz(g.ad, 80);
  // "Ortak 12" + kendi şifresi: TG üyesi olarak katılır (onay kuralı aynı)
  const m = ad.match(/^ortak\s*-?\s*(\d{1,4})$/i);
  const sifre = temiz(g.kod, 60);
  if (m && sifre) {
    const { data: o } = await db.from("ortaklar").select("no").eq("no", Number(m[1])).eq("sifre", sifre).maybeSingle();
    if (o) { rol = "uye"; ad = `Ortak ${o.no}`; }
  }
  // TG Başkanı, TG üyeleri ve YK üyeleri: kişiye özel kod; ad, unvan ve görev listeden gelir, onay beklemez
  let tg: { ad: string; unvan: string; rol: Rol } | null = null;
  if (!rol && sifre) {
    const { data: t } = await db.from("tg_uyeleri").select("ad, unvan, rol").eq("kod", sifre.toUpperCase().replace(/\s+/g, "")).maybeSingle();
    if (t) { tg = t; rol = t.rol; ad = t.ad; }
  }
  if (!rol) rol = await rolBul(g.kod);
  if (!rol) throw new Hata("Kullanıcı adı ya da şifre / kod hatalı.", 401);
  const cihaz = temiz(g.cihaz, 80);
  if (!cihaz || !ad) throw new Hata("Ad ve cihaz bilgisi gerekli.");

  const { data: var_ } = await db.from("uyeler").select("*").eq("cihaz", cihaz).maybeSingle();
  if (var_?.durum === "cikarildi") throw new Hata("Bu telefonun gruba erişimi yönetici tarafından kaldırıldı.", 403);

  // Kişiye özel hesap (Ortak N ya da kişisel kod): aynı kişinin başka bir yerden (tarayıcı,
  // ana ekran uygulaması, eski telefon) yaptığı eski girişler tek kayda indirilir.
  // Önceden onaylanmışsa yeniden onay beklemez.
  const kisisel = !!(m && rol === "uye" && ad.startsWith("Ortak ")) || !!tg;
  let eskiOnayli: string | null = null;
  if (kisisel) {
    const { data: eskiler } = await db.from("uyeler").select("cihaz, durum, onay_at").eq("ad", ad).eq("rol", rol).neq("cihaz", cihaz);
    if ((eskiler ?? []).some((e: any) => e.durum === "cikarildi")) {
      throw new Hata("Bu hesabın erişimi yönetici tarafından kaldırıldı.", 403);
    }
    eskiOnayli = (eskiler ?? []).find((e: any) => e.durum === "onayli")?.onay_at ?? null;
    const eskiCihazlar = (eskiler ?? []).map((e: any) => e.cihaz);
    if (eskiCihazlar.length) {
      await db.from("abonelikler").delete().in("cihaz", eskiCihazlar);
      await db.from("uyeler").delete().in("cihaz", eskiCihazlar);
    }
  }

  // Başkan kodu kendiliğinden onaylıdır; diğerleri (ya da rolü değişen telefon) onay bekler.
  const durum = rol === "baskan" || tg || eskiOnayli ? "onayli" : var_ && var_.rol === rol ? var_.durum : "bekliyor";
  const anahtar = var_?.anahtar ?? anahtarUret();
  const { error } = await db.from("uyeler").upsert({
    cihaz, anahtar, ad, rol, durum, unvan: tg?.unvan ?? null,
    onay_at: durum === "onayli" ? var_?.onay_at ?? eskiOnayli ?? new Date().toISOString() : null,
    son_gorulme: new Date().toISOString(),
  });
  if (error) throw error;
  await db.from("abonelikler").update({ rol }).eq("cihaz", cihaz);

  if (durum === "bekliyor" && !cihaz.startsWith("test-")) {
    await bildir(["baskan"], "Onay bekleyen üye", `${ad} (${ROL_ADI[rol]}) gruba katılmak istiyor.`, { sayfa: "uyeler" });
  }
  return { rol, durum, anahtar, ad, unvan: tg?.unvan ?? null, vapid: VAPID_PUBLIC || null };
}

const adNorm = (s: string) => String(s ?? "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();

// Ortak kaydı: kod yok. Ad soyad, telefon ve ortaklık numarası; yönetici onaylayınca girer.
async function ortakKayit(g: any) {
  const ad = temiz(g.ad_soyad, 80).replace(/\s+/g, " ");
  const no = Number(temiz(g.ortak_no, 6));
  const ham = temiz(g.telefon, 30);
  let tel = ham.replace(/\D/g, "");
  const cihaz = temiz(g.cihaz, 80);
  if (ad.split(" ").length < 2) throw new Hata("Adınızı ve soyadınızı birlikte yazın.");
  if (!Number.isInteger(no) || no < 1 || no > 9999) throw new Hata("Ortaklık numaranızı doğru yazın.");
  if (!cihaz) throw new Hata("Cihaz bilgisi gerekli.");
  // Türkiye numarası: 0532 123 45 67 biçiminde saklanır; yurt dışı numarası (+49 …) olduğu gibi
  let telefon: string;
  if (tel.startsWith("90") && tel.length === 12) tel = tel.slice(2);
  else if (tel.startsWith("0") && tel.length === 11) tel = tel.slice(1);
  if (/^[2-5]\d{9}$/.test(tel)) telefon = `0${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6, 8)} ${tel.slice(8)}`;
  else if (/^(\+|00)/.test(ham) && tel.replace(/^00/, "").length >= 9 && tel.length <= 15) telefon = "+" + tel.replace(/^00/, "");
  else throw new Hata("Cep telefonu numaranızı doğru yazın (örn. 0532 123 45 67; yurt dışı ise +49 … ile).");

  // Kişisel kodu olan (TG/YK) kişi düz ortak olarak kayıt olamaz: kendi koduyla girmeli.
  // Yazdığı ad ya da ortak listesinde bu numaradaki ad, kişisel kod listesindeki bir adla eşleşirse engellenir.
  const { data: kodlular } = await db.from("tg_uyeleri").select("ad, unvan");
  const { data: listede } = await db.from("ortak_rehberi").select("ad").eq("no", no).maybeSingle();
  const adlar = new Set([adNorm(ad), listede ? adNorm(listede.ad) : ""]);
  const kodlu = (kodlular ?? []).find((t: any) => adlar.has(adNorm(t.ad)));
  if (kodlu) throw new Hata(`${kodlu.unvan} olduğunuzdan size verilen şahsi kodunuz ile giriş yapmak zorundasınız. Alttaki "Görevli misiniz? Kişisel kodla giriş" yazısına dokunun.`, 403);

  const { data: var_ } = await db.from("uyeler").select("*").eq("cihaz", cihaz).maybeSingle();
  // Erişimi kaldırılmış telefon da yeniden başvurabilir: kayıt baştan onay bekler.
  // Aynı telefon aynı bilgilerle yeniden kayıt olursa durumu korunur; bilgi değişirse yeniden onay bekler
  const ayni = var_ && var_.durum !== "cikarildi" && var_.rol === "uye" && var_.ortak_no === no && var_.ad === ad && var_.telefon === telefon;
  const durum = ayni ? var_.durum : "bekliyor";
  const anahtar = var_?.anahtar ?? anahtarUret();
  const unvan = `${no} No'lu Ortak`;
  const { error } = await db.from("uyeler").upsert({
    cihaz, anahtar, ad, rol: "uye", durum, unvan, ortak_no: no, telefon,
    onay_at: durum === "onayli" ? var_.onay_at : null, son_gorulme: new Date().toISOString(),
  });
  if (error) throw error;
  await db.from("abonelikler").update({ rol: "uye" }).eq("cihaz", cihaz);
  if (durum === "bekliyor" && !cihaz.startsWith("test-")) {
    const { data: r } = await db.from("ortak_rehberi").select("telefonlar").eq("no", no).maybeSingle();
    const uyuyor = !!r?.telefonlar?.some((t: string) => t.replace(/\D/g, "").slice(-10) === telefon.replace(/\D/g, "").slice(-10));
    await bildir(["baskan"], "Onay bekleyen ortak", `${ad} (${no} No'lu Ortak, ${telefon}) katılmak istiyor. ${uyuyor ? "🔵 Bilgileri örtüşüyor." : "🔴 Bilgileri örtüşmüyor!"}`, { sayfa: "uyeler" });
  }
  return { rol: "uye", durum, anahtar, ad, unvan, vapid: VAPID_PUBLIC || null };
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
    if (k.name === "aidat") continue; // aidat resimleri iş kayıtlarından ayrı, silinmez
    for (;;) {
      const { data: dosyalar } = await db.storage.from(BUCKET).list(k.name, { limit: 1000 });
      if (!dosyalar?.length) break;
      await db.storage.from(BUCKET).remove(dosyalar.map((d: any) => `${k.name}/${d.name}`));
      if (dosyalar.length < 1000) break;
    }
  }
}

// Yönetici (YK başkanı) gruptan çıkarılamaz; önce yöneticilik devredilmeli
async function yoneticiyeDokunma(cihaz: string) {
  const { data } = await db.from("uyeler").select("rol, durum").eq("cihaz", cihaz).maybeSingle();
  if (data?.rol === "baskan" && data.durum === "onayli") {
    throw new Hata("Yönetici gruptan çıkarılamaz. Gerekirse önce \"Yönetici Değiştir\" ile devredin.", 403);
  }
}

async function islem(eylem: string, u: { cihaz: string; ad: string; rol: Rol; durum: string }, g: any) {
  const rol = u.rol;
  // Deneme telefonları (cihaz "test-…") kimseye bildirim göndermez
  const duyur: typeof bildir = (...a) => (u.cihaz.startsWith("test-") ? Promise.resolve({ hedef: 0, basarili: 0 }) : bildir(...a));
  const yonetici = () => { if (rol !== "baskan") throw new Hata("Bu işlemi yalnızca yönetici (YK başkanı) yapabilir.", 403); };
  // Cevap yazma ve yapılma süresi: yönetici ve yönetim kurulu
  const ykVeYonetici = () => { if (rol !== "baskan" && rol !== "yonetim") throw new Hata("Bu işlemi yalnızca yönetici ve yönetim kurulu yapabilir.", 403); };

  // Onay bekleyen telefon yalnızca durumunu sorabilir ve bildirime kaydolabilir
  if (u.durum !== "onayli" && !["durum", "abone_ol", "izin_bildir"].includes(eylem)) {
    throw new Hata("Kaydınız yönetici onayını bekliyor.", 403, { bekliyor: true });
  }

  switch (eylem) {
    case "durum":
      return { rol, durum: u.durum, ad: u.ad, unvan: (u as any).unvan ?? null };

    case "liste": {
      let q = db.from("kayitlar").select("*").order("created_at", { ascending: false }).limit(300);
      if (!YONETIM_ISI_GOREN.includes(rol)) q = q.eq("gizli", false);
      // Onay bekleyen kaydı yalnızca yönetici, yönetim kurulu ve yazan kişi görür
      if (!KAYIT_ONAYLAYAN.includes(rol)) q = q.or(`onay_durumu.eq.onayli,cihaz.eq.${u.cihaz}`);
      const { data, error } = await q;
      if (error) throw error;
      const kayitlar = (data ?? []).map(({ cihaz: c, ...k }: any) => ({ ...k, benim: c === u.cihaz }));
      let bekleyen: number | undefined;
      if (rol === "baskan") {
        const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "bekliyor");
        bekleyen = count ?? 0;
      }
      let ykUyeler: string[] | undefined;
      if (rol === "baskan" || rol === "yonetim") {
        // Yönetici ve yönetim kurulu, müdür ve şefin her kaydı ne zaman gördüğünü de alır.
        // Yönetim kurulu üyelerinin ne zaman gördüğünü yalnızca yönetici alır.
        const ids = kayitlar.map((k: any) => k.id);
        let gq = db.from("goruntulemeler").select("kayit_id, ad, rol, ilk_at").in("kayit_id", ids).order("ilk_at");
        if (rol !== "baskan") gq = gq.in("rol", ["mudur", "sef"]);
        const { data: g } = ids.length ? await gq : { data: [] };
        for (const k of kayitlar as any[]) {
          k.gorenler = (g ?? []).filter((x: any) => x.kayit_id === k.id).map(({ kayit_id: _i, ...x }: any) => x);
        }
        if (rol === "baskan") {
          const { data: yk } = await db.from("uyeler").select("ad").eq("rol", "yonetim").eq("durum", "onayli").order("ad");
          ykUyeler = (yk ?? []).map((x: any) => x.ad);
        }
      }
      const varsayilan_sure = rol === "baskan" || rol === "yonetim" ? await varsayilanSure() : undefined;
      return { kayitlar: await fotoUrlleri(kayitlar), rol, unvan: (u as any).unvan ?? null, bekleyen, ykUyeler, varsayilan_sure };
    }

    case "yukleme_adresi": {
      const yol = `${g.tur === "aidat" ? "aidat" : new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
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
        gizli: !!g.gizli && YONETIM_ISI_GIREN.includes(rol),
        son_tarih: sonGun(new Date(), await varsayilanSure()),
        onay_durumu: onaysizGirer(u) ? "onayli" : "bekliyor",
      };
      if (!kayit.yer || !kayit.sorun) throw new Hata("Yer ve sorun zorunlu.");
      const { data, error } = await db.from("kayitlar").insert(kayit).select().single();
      if (error) throw error;
      if (data.onay_durumu === "bekliyor") {
        await duyur(KAYIT_ONAYLAYAN, `⏳ Onay bekleyen kayıt ${data.no}`, `${u.ad} · ${kayit.yer}: ${kayit.sorun}`.slice(0, 180), { kayitId: data.id });
        const { cihaz: _c, ...donen } = data;
        return { kayit: { ...donen, benim: true } };
      }
      // Yeni sorun bütün gruba, yönetim işi yalnızca yönetim, müdür ve şefe duyurulur
      await duyur(kimeBildir(data), `${data.gizli ? "🔒 Yönetim İş Emri" : "Yeni sorun"} ${data.no}`, `${kayit.yer}: ${kayit.sorun}`.slice(0, 180), { kayitId: data.id });
      const { cihaz: _c, ...donen } = data;
      return { kayit: { ...donen, benim: true } };
    }

    case "kapat": {
      if (!KAPATABILIR.includes(rol)) throw new Hata("Bu işlemi yalnızca yönetici, müdür veya şef yapabilir.", 403);
      const { data, error } = await db.from("kayitlar").update({
        durum: "tamam",
        sonuc: temiz(g.sonuc) || null,
        foto_sonra: temiz(g.foto, 200) || null, // fotoğraf isteğe bağlı
        kapatan: u.ad,
        kapanis_at: new Date().toISOString(),
      }).eq("id", g.id).neq("durum", "tamam").eq("onay_durumu", "onayli").select().single();
      if (error) throw new Hata("Kayıt bulunamadı, onay bekliyor ya da zaten kapatılmış.");
      // Yapılan iş görenlere: fotoğraf varsa bildirimde de görünsün
      const { data: url } = data.foto_sonra
        ? await db.storage.from(BUCKET).createSignedUrl(data.foto_sonra, 60 * 60 * 24 * 7)
        : { data: null };
      await duyur(kimeBildir(data), `Yapıldı • ${data.yer}`.slice(0, 80), (data.sonuc || data.sorun || "").slice(0, 180),
        { kayitId: data.id, resim: url?.signedUrl });
      return { tamam: true };
    }

    case "sure_degistir": {
      ykVeYonetici();
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
      // Müdür, şef ve yönetim kurulunun ilk açışı saklanır; sonraki açışlar ilk zamanı değiştirmez
      if (!["mudur", "sef", "yonetim"].includes(rol)) return { tamam: true };
      await db.from("goruntulemeler").upsert(
        { kayit_id: Number(g.id), cihaz: u.cihaz, ad: u.ad, rol },
        { onConflict: "kayit_id,cihaz", ignoreDuplicates: true },
      );
      return { tamam: true };
    }

    case "cevap_ver": {
      // Yönetici ya da yönetim kurulu işi kapatmadan "Bu iş N gün içinde yapılacaktır." der; son gün bugünden sayılır
      ykVeYonetici();
      const gun = Number(g.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 60) throw new Hata("Süre 1 ile 60 gün arasında olmalı.");
      const yanitMetni = `Bu iş ${gun} gün içinde yapılacaktır.`;
      const { data, error } = await db.from("kayitlar").update({
        yanit: yanitMetni, yanit_veren: u.ad, yanit_at: new Date().toISOString(), son_tarih: sonGun(new Date(), gun),
      }).eq("id", g.id).neq("durum", "tamam").select().single();
      if (error) throw new Hata("Kayıt bulunamadı ya da iş zaten yapıldı.");
      await duyur(kimeBildir(data), `Cevap • ${data.yer}`.slice(0, 80), yanitMetni, { kayitId: data.id });
      return { yanit: data.yanit, yanit_veren: data.yanit_veren, yanit_at: data.yanit_at, son_tarih: data.son_tarih };
    }

    case "gorevler": {
      if (!GOREV_GOREN.includes(rol)) throw new Hata("Görev programını yalnızca yönetici, yönetim kurulu, müdür ve şef görür.", 403);
      const bugun = sonGun(new Date(), 0);
      // Geçmiş günleri yönetici ve yönetim kurulu açabilir; müdür ve şef açamaz
      const gecmisli = rol === "baskan" || rol === "yonetim";
      const gun = gecmisli && /^\d{4}-\d{2}-\d{2}$/.test(String(g.gun ?? "")) && g.gun <= bugun ? String(g.gun) : bugun;
      return { ...(await gorevDurumu(gun, gecmisli)), isaretleyebilir: GOREV_ISARETLEYEN.includes(rol) };
    }

    case "gorev_isaretle": {
      // Yalnızca müdür ve şef, yalnızca bugünün ve bu haftanın kalemlerini işaretler / geri alır
      if (!GOREV_ISARETLEYEN.includes(rol)) throw new Hata("Görevleri yalnızca müdür ve şef işaretleyebilir.", 403);
      const kalem = temiz(g.kalem, 10);
      if (!KALEM_IDLERI.has(kalem)) throw new Hata("Böyle bir görev kalemi yok.");
      const tur = kalem.startsWith("G-") ? "gunluk" : "haftalik";
      const bugun = sonGun(new Date(), 0);
      const donem = tur === "gunluk" ? bugun : haftaBasi(bugun);
      if (g.yapildi) {
        const { error } = await db.from("gorev_isaretleri").upsert(
          { tur, donem, kalem, cihaz: u.cihaz, ad: u.ad, rol },
          { onConflict: "tur,donem,kalem", ignoreDuplicates: true },
        );
        if (error) throw error;
      } else {
        const { error } = await db.from("gorev_isaretleri").delete().eq("tur", tur).eq("donem", donem).eq("kalem", kalem);
        if (error) throw error;
      }
      return { ...(await gorevDurumu(bugun)), isaretleyebilir: true };
    }

    case "varsayilan_sure": {
      ykVeYonetici();
      const gun = Number(g.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 60) throw new Hata("Süre 1 ile 60 gün arasında olmalı.");
      const { error } = await db.from("ayarlar").upsert({ ad: "varsayilan_sure", deger: String(gun) });
      if (error) throw error;
      return { tamam: true };
    }

    case "kayit_onayla": {
      // Yönetici ya da yönetim kurulu üyesi onaylar: kayıt iş listesine düşer, herkes görür.
      // Yapılma süresi onay gününden başlar.
      if (!KAYIT_ONAYLAYAN.includes(rol)) throw new Hata("Kayıtları yalnızca yönetici ve yönetim kurulu onaylar.", 403);
      const { data, error } = await db.from("kayitlar").update({
        onay_durumu: "onayli", onaylayan: u.ad, onaylama_at: new Date().toISOString(),
        son_tarih: sonGun(new Date(), await varsayilanSure()),
      }).eq("id", g.id).eq("onay_durumu", "bekliyor").select().single();
      if (error || !data) throw new Hata("Kayıt bulunamadı ya da zaten onaylanmış.");
      await duyur(kimeBildir(data), `Yeni sorun ${data.no}`, `${data.yer}: ${data.sorun}`.slice(0, 180), { kayitId: data.id });
      return { tamam: true };
    }

    case "kayit_reddet": {
      // Onay bekleyen kaydı yönetici ya da yönetim kurulu reddeder: fotoğrafıyla silinir
      if (!KAYIT_ONAYLAYAN.includes(rol)) throw new Hata("Kayıtları yalnızca yönetici ve yönetim kurulu reddeder.", 403);
      const { data: k } = await db.from("kayitlar").select("id, foto_once, onay_durumu").eq("id", g.id).maybeSingle();
      if (!k || k.onay_durumu !== "bekliyor") throw new Hata("Kayıt bulunamadı ya da zaten onaylanmış.");
      if (k.foto_once) await db.storage.from(BUCKET).remove([k.foto_once]);
      await db.from("kayitlar").delete().eq("id", k.id);
      return { tamam: true };
    }

    // ---------- Aidat ----------
    case "aidat_liste": {
      const { data, error } = await db.from("aidat_resimleri").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      const yollar = (data ?? []).map((x: any) => x.yol);
      const { data: u2 } = yollar.length ? await db.storage.from(BUCKET).createSignedUrls(yollar, 60 * 60 * 6) : { data: [] };
      const harita = new Map((u2 ?? []).map((d: any) => [d.path, d.signedUrl]));
      return {
        resimler: (data ?? []).map((x: any) => ({ id: x.id, baslik: x.baslik, ekleyen: x.ekleyen, created_at: x.created_at, url: harita.get(x.yol) ?? null })),
        ekleyebilir: AIDAT_EKLEYEN.includes(rol),
      };
    }

    case "aidat_ekle": {
      if (!AIDAT_EKLEYEN.includes(rol)) throw new Hata("Aidat resmini yalnızca yönetici ve muhasebe ekler.", 403);
      const yol = temiz(g.yol, 200);
      if (!yol.startsWith("aidat/")) throw new Hata("Resim yüklenemedi, tekrar deneyin.");
      const baslik = temiz(g.baslik, 120);
      const { error } = await db.from("aidat_resimleri").insert({ yol, baslik: baslik || null, ekleyen: u.ad });
      if (error) throw error;
      await duyur("hepsi", "💳 Aidat bilgisi eklendi", `${baslik || "Yıl içindeki ödemeler güncellendi."} Aidat bölümünden bakabilirsiniz.`, { sayfa: "aidat" });
      return { tamam: true };
    }

    case "aidat_sil": {
      if (!AIDAT_EKLEYEN.includes(rol)) throw new Hata("Aidat resmini yalnızca yönetici ve muhasebe siler.", 403);
      const { data: x } = await db.from("aidat_resimleri").select("id, yol").eq("id", g.id).maybeSingle();
      if (!x) throw new Hata("Resim bulunamadı.");
      await db.storage.from(BUCKET).remove([x.yol]);
      await db.from("aidat_resimleri").delete().eq("id", x.id);
      return { tamam: true };
    }

    // ---------- Yönetim iş programı (takvim) ----------
    case "program_liste": {
      if (!PROGRAM_GIREN.includes(rol)) throw new Hata("İş programını yalnızca yönetici, yönetim kurulu, müdür ve şef görür.", 403);
      const tarihMi = (x: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(x ?? ""));
      const bas = tarihMi(g.bas) ? String(g.bas) : sonGun(new Date(), -40);
      const bit = tarihMi(g.bit) ? String(g.bit) : sonGun(new Date(), 40);
      // Tekrarlayanlar başlangıç gününden sonra her dönemde görünür; tek seferlikler yalnızca kendi gününde
      const { data, error } = await db.from("is_programi").select("id, tarih, saat, tekrar, baslik, aciklama, ekleyen, cihaz, created_at")
        .lte("tarih", bit).or(`tekrar.neq.yok,tarih.gte.${bas}`).order("tarih").limit(1000);
      if (error) throw error;
      return { kayitlar: (data ?? []).map(({ cihaz: c, ...x }: any) => ({ ...x, silebilir: rol === "baskan" || c === u.cihaz })) };
    }

    case "program_ekle": {
      if (!PROGRAM_GIREN.includes(rol)) throw new Hata("İş programına yalnızca yönetici, yönetim kurulu, müdür ve şef girer.", 403);
      const tarih = String(g.tarih ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new Hata("Tarih seçin.");
      const tekrar: string = ["yok", "gunluk", "haftalik", "aylik"].includes(g.tekrar) ? g.tekrar : "yok";
      const saat = /^\d{2}:\d{2}$/.test(String(g.saat ?? "")) ? String(g.saat) : null;
      const baslik = temiz(g.baslik, 200);
      if (!baslik) throw new Hata("Yapılacak işi yazın.");
      const { error } = await db.from("is_programi").insert({
        tarih, saat, tekrar, baslik, aciklama: temiz(g.aciklama) || null, ekleyen: u.ad, cihaz: u.cihaz, rol,
      });
      if (error) throw error;
      const ne: Record<string, string> = { yok: "", gunluk: " (her gün)", haftalik: " (her hafta)", aylik: " (her ay)" };
      const [y, a, gn] = tarih.split("-");
      await duyur(PROGRAM_GIREN, "📅 İş programına eklendi", `${gn}.${a}.${y}${saat ? " " + saat : ""}${ne[tekrar]}: ${baslik} · ${u.ad}`.slice(0, 180), { sayfa: "program" });
      return { tamam: true };
    }

    case "program_sil": {
      if (!PROGRAM_GIREN.includes(rol)) throw new Hata("Yetkiniz yok.", 403);
      const { data: x } = await db.from("is_programi").select("id, cihaz").eq("id", g.id).maybeSingle();
      if (!x) throw new Hata("Kayıt bulunamadı.");
      if (rol !== "baskan" && x.cihaz !== u.cihaz) throw new Hata("Yalnızca kendi girdiğinizi silebilirsiniz; yönetici her kaydı silebilir.", 403);
      await db.from("is_programi").delete().eq("id", x.id);
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
      await db.from("uyeler").update({ bildirim_izni: "granted" }).eq("cihaz", u.cihaz);
      return { tamam: true };
    }

    case "izin_bildir": {
      // Telefonun bildirim izni; yönetici üye listesinde kimin bildirim alamadığını görür
      const izin = ["granted", "denied", "default", "ios-tarayici", "desteklenmiyor"].includes(g.izin) ? g.izin : null;
      await db.from("uyeler").update({ bildirim_izni: izin }).eq("cihaz", u.cihaz);
      return { tamam: true };
    }

    // ---------- Yönetici (YK başkanı) ----------
    case "uye_listesi": {
      yonetici();
      const { data, error } = await db.from("uyeler")
        .select("cihaz, ad, rol, unvan, durum, ortak_no, telefon, created_at, onay_at, son_gorulme, bildirim_izni").order("created_at", { ascending: false });
      if (error) throw error;
      const { data: ab } = await db.from("abonelikler").select("cihaz");
      const aboneler = new Set((ab ?? []).map((x: any) => x.cihaz));
      // Ortak başvurusunu resmi ortak listesiyle karşılaştır: aynı ortak no + listedeki telefonlardan biri
      const nolar = [...new Set((data ?? []).map((x: any) => x.ortak_no).filter(Boolean))];
      const { data: rehber } = nolar.length ? await db.from("ortak_rehberi").select("no, ad, telefonlar").in("no", nolar) : { data: [] };
      const rh = new Map((rehber ?? []).map((r: any) => [r.no, r]));
      const son10 = (t: string) => String(t ?? "").replace(/\D/g, "").slice(-10);
      const eslesme = (x: any) => {
        if (!x.ortak_no) return undefined;
        const r: any = rh.get(x.ortak_no);
        if (!r) return { uyuyor: false, liste_ad: null };
        return { uyuyor: r.telefonlar.some((t: string) => son10(t) === son10(x.telefon)), liste_ad: r.ad };
      };
      return { uyeler: (data ?? []).map((x: any) => ({ ...x, eslesme: eslesme(x), bildirim: aboneler.has(x.cihaz), ben: x.cihaz === u.cihaz })) };
    }

    case "rehber_ara": {
      // Yönetici davet göndermek için resmi ortak listesinde numara ya da adla arar
      yonetici();
      const q = temiz(g.q, 60);
      if (!q) return { sonuc: [] };
      let sorgu = db.from("ortak_rehberi").select("no, ad, telefonlar").order("no").limit(20);
      sorgu = /^\d+$/.test(q) ? sorgu.eq("no", Number(q)) : sorgu.ilike("ad", `%${q.replace(/[%_\\]/g, "").toLocaleUpperCase("tr")}%`);
      const { data, error } = await sorgu;
      if (error) throw error;
      const nolar = (data ?? []).map((r: any) => r.no);
      const { data: kayitli } = nolar.length
        ? await db.from("uyeler").select("ortak_no, durum").in("ortak_no", nolar).neq("durum", "cikarildi")
        : { data: [] };
      const durum = new Map((kayitli ?? []).map((k: any) => [k.ortak_no, k.durum]));
      return { sonuc: (data ?? []).map((r: any) => ({ ...r, durum: durum.get(r.no) ?? null })) };
    }

    case "uye_onayla":
    case "uye_cikar":
    case "uye_geri_al": {
      yonetici();
      const hedef = temiz(g.hedef, 80);
      if (hedef === u.cihaz) throw new Hata("Kendi telefonunuzu değiştiremezsiniz.");
      const durum = eylem === "uye_cikar" ? "cikarildi" : "onayli";
      if (durum === "cikarildi") await yoneticiyeDokunma(hedef);
      if (durum === "onayli") {
        const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "onayli");
        if ((count ?? 0) >= MAKS_UYE) throw new Hata(`Grup dolu (${MAKS_UYE} kişi). Yeni üye için önce birini çıkarın.`);
      }
      const { data, error } = await db.from("uyeler")
        .update({ durum, onay_at: durum === "onayli" ? new Date().toISOString() : null })
        .eq("cihaz", hedef).select("ad, ortak_no").maybeSingle();
      if (error) throw error;
      if (!data) throw new Hata("Üye bulunamadı.");
      // Bir ortaklık numarasında tek kişi: onaylanan kayıt aynı numaralı eski kayıtların yerine geçer
      if (durum === "onayli" && data.ortak_no) {
        const { data: eskiler } = await db.from("uyeler").select("cihaz").eq("ortak_no", data.ortak_no).neq("cihaz", hedef);
        const ec = (eskiler ?? []).map((e: any) => e.cihaz).filter((c: string) => c !== u.cihaz);
        if (ec.length) {
          await db.from("abonelikler").delete().in("cihaz", ec);
          await db.from("uyeler").delete().in("cihaz", ec);
        }
      }
      if (durum === "cikarildi") {
        await db.from("abonelikler").delete().eq("cihaz", hedef);
      } else {
        await duyur({ cihaz: hedef }, "Gruba kabul edildiniz", "Sporkent İşletme Kooperatifi SAHA TAKİP uygulamasını kullanmaya başlayabilirsiniz.");
      }
      return { tamam: true };
    }

    case "uye_sil": {
      // Reddedilen başvuruyu ya da çıkarılan üyeyi listeden tamamen kaldırır (tekrar kodla başvurabilir)
      yonetici();
      const hedef = temiz(g.hedef, 80);
      if (hedef === u.cihaz) throw new Hata("Kendi telefonunuzu silemezsiniz.");
      await yoneticiyeDokunma(hedef);
      await db.from("abonelikler").delete().eq("cihaz", hedef);
      await db.from("uyeler").delete().eq("cihaz", hedef);
      return { tamam: true };
    }

    case "yonetici_degistir": {
      // Yöneticilik devri: seçilen üye YK başkanı olur, bütün eski yönetici telefonları seçilen göreve iner.
      // Eski yönetici kodla geri giremesin diye yönetici kodu yenilenir; yeni yönetici ayarlarda görür.
      yonetici();
      const hedef = temiz(g.hedef, 80);
      const eskiRol = g.eski_rol === "uye" ? "uye" : "yonetim";
      const { data: yeni } = await db.from("uyeler").select("cihaz, ad, rol, durum").eq("cihaz", hedef).maybeSingle();
      if (!yeni || yeni.durum !== "onayli") throw new Hata("Yeni yönetici gruptaki onaylı biri olmalı.");
      if (yeni.rol === "baskan") throw new Hata("Bu kişi zaten yönetici.");
      const { data: eskiler } = await db.from("uyeler").select("cihaz").eq("rol", "baskan");
      const eskiCihazlar = (eskiler ?? []).map((x: any) => x.cihaz);
      // Önce yeni yönetici atanır; bir adım yarıda kalsa bile grup yöneticisiz kalmaz
      const { error: e1 } = await db.from("uyeler").update({ rol: "baskan" }).eq("cihaz", hedef);
      if (e1) throw e1;
      await db.from("abonelikler").update({ rol: "baskan" }).eq("cihaz", hedef);
      const { error: e2 } = await db.from("uyeler").update({ rol: eskiRol }).in("cihaz", eskiCihazlar);
      if (e2) throw e2;
      await db.from("abonelikler").update({ rol: eskiRol }).in("cihaz", eskiCihazlar);
      const yeniKod = "baskan-sk-" + String(crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000);
      await db.from("ayarlar").upsert({ ad: "kod_baskan", deger: yeniKod });
      await duyur({ cihaz: hedef }, "Yönetici oldunuz",
        `${u.ad} yöneticiliği size devretti. Üyeler ve ayarlar artık sizde.`, { sayfa: "uyeler" });
      return { rol: eskiRol };
    }

    case "tg_listesi": {
      yonetici();
      const { data, error } = await db.from("tg_uyeleri").select("ad, unvan, kod, rol").order("rol", { ascending: false }).order("id");
      if (error) throw error;
      const { data: k } = await db.from("uyeler").select("ad").in("rol", ["uye", "yonetim"]).eq("durum", "onayli");
      const giren = new Set((k ?? []).map((x: any) => x.ad));
      return { tg: (data ?? []).map((t: any) => ({ ...t, kullaniliyor: giren.has(t.ad) })) };
    }

    case "ortak_listesi": {
      yonetici();
      const { data, error } = await db.from("ortaklar").select("no, sifre").order("no");
      if (error) throw error;
      const { data: k } = await db.from("uyeler").select("ad").like("ad", "Ortak %");
      const kullanan = new Set((k ?? []).map((x: any) => x.ad));
      return { ortaklar: (data ?? []).map((o: any) => ({ ...o, kullaniliyor: kullanan.has(`Ortak ${o.no}`) })) };
    }

    case "ortak_ekle": {
      // Sıradaki numarayla yeni ortak hesabı ve 6 haneli şifre
      yonetici();
      const { data: son } = await db.from("ortaklar").select("no").order("no", { ascending: false }).limit(1).maybeSingle();
      const no = (son?.no ?? 0) + 1;
      for (let i = 0; i < 5; i++) {
        const sifre = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        const { error } = await db.from("ortaklar").insert({ no, sifre });
        if (!error) return { no, sifre };
      }
      throw new Hata("Şifre üretilemedi, tekrar deneyin.");
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
    .neq("durum", "tamam").eq("onay_durumu", "onayli").lt("son_tarih", bugun).order("son_tarih");
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
    if (g.eylem === "gorev_hatirlat") {
      if (!CRON_ANAHTARI || g.cron !== CRON_ANAHTARI) throw new Hata("Yetkisiz.", 401);
      return yanit(await gorevHatirlat());
    }
    if (g.eylem === "giris") return yanit(await giris(g));
    if (g.eylem === "ortak_kayit") return yanit(await ortakKayit(g));
    const u = await kimlik(g);
    return yanit(await islem(String(g.eylem), u, g));
  } catch (e: any) {
    console.error(e);
    if (e instanceof Hata) return yanit({ hata: e.message, ...e.ek }, e.status);
    return yanit({ hata: "Sunucu hatası, tekrar deneyin." }, 500);
  }
});
