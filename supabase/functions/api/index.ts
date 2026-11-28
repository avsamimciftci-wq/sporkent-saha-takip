// SPORKENT ASİSTAN: tek API ucu.
// Giriş kodu yalnızca gruba katılırken kullanılır; yönetici (YK başkanı) onaylayınca telefon
// kendi gizli anahtarıyla çalışır. Tarayıcıya hiçbir tablo açık değildir.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { GUNLUK, HAFTALIK, KALEM_IDLERI } from "./gorev_programi.ts";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { raporPdf } from "./faaliyet_raporu.js";
import { ROBOTO_KALIN, ROBOTO_NORMAL } from "./fontlar.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE") ?? "";
const BUCKET = "fotograflar";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  // Apple (iPhone) ".local" gibi geçersiz adresi "BadJwtToken" diye reddeder: gerçek bir https adresi olmalı
  webpush.setVapidDetails("https://avsamimciftci-wq.github.io/sporkent-saha-takip/", VAPID_PUBLIC, VAPID_PRIVATE);
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
// restoran: restoran yetkilisi; şahsi kodla girer, yalnızca Restoran bölümünü görür ve yönetir
type Rol = "baskan" | "mudur" | "sef" | "yonetim" | "muhasebe" | "uye" | "restoran";
const ROLLER: Rol[] = ["baskan", "mudur", "sef", "yonetim", "muhasebe", "uye"];
const KAPATABILIR: Rol[] = ["baskan", "mudur", "sef"];
// Yönetim işleri: yönetici ve yönetim kurulu girer; yalnızca bu dört görev görür, bildirim de yalnızca onlara gider
// YK iş emrini verenler: yönetici, yönetim kurulu, muhasebe, müdür (şef veremez, yalnızca görür ve kapatır)
const YONETIM_ISI_GIREN: Rol[] = ["baskan", "yonetim", "muhasebe", "mudur", "sef"];
const YONETIM_ISI_GOREN: Rol[] = ["baskan", "yonetim", "muhasebe", "mudur", "sef"];
// Muhasebe bölümü: yalnızca yönetim görür; muhasebe ve yönetici paylaşır
const MUHASEBE_GOREN: Rol[] = ["baskan", "yonetim", "muhasebe"];
const MUHASEBE_PAYLASAN: Rol[] = ["muhasebe"]; // yalnızca muhasebeci paylaşır
const MUHASEBE_SILEN: Rol[] = ["baskan", "muhasebe"]; // yönetici uygun görmediğini silebilir
// "Aylık Masraflar Listesi": her ayın ilk günü muhasebe paylaşır (bir önceki ayın masrafları); başlığıyla tanınır
const MASRAF_BASLIK = "Aylık Masraflar Listesi";
const AY_AD = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const oncekiAyAdi = (gun: string) => { const [y, a] = gun.split("-").map(Number); const o = a === 1 ? 12 : a - 1; return `${AY_AD[o - 1]} ${a === 1 ? y - 1 : y}`; };
// Bu ay (Türkiye saatiyle) masraf listesi paylaşıldı mı
// Resmî tatiller: sabit günler her yıl; dinî bayramlar (arife yarım gün sayılmaz) yıl yıl eklenmeli
const SABIT_TATIL = ["01-01", "04-23", "05-01", "05-19", "07-15", "08-30", "10-29"];
const DINI_TATIL = new Set([
  "2026-03-20", "2026-03-21", "2026-03-22", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", // Ramazan, Kurban 2026
  "2027-03-09", "2027-03-10", "2027-03-11", "2027-05-16", "2027-05-17", "2027-05-18", "2027-05-19", // Ramazan, Kurban 2027
]);
const tatilMi = (gun: string) => {
  const hg = new Date(gun + "T00:00:00Z").getUTCDay();
  return hg === 0 || hg === 6 || SABIT_TATIL.includes(gun.slice(5)) || DINI_TATIL.has(gun);
};
// Ayın ilk iş günü: 1'i cumartesi, pazar ya da resmî tatilse sonraki ilk iş günü
const ilkIsGunu = (ay: string) => {
  let g = `${ay}-01`;
  while (tatilMi(g)) g = new Date(Date.parse(g + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
  return g;
};
async function masrafDurumu() {
  const bugun = sonGun(new Date(), 0), [y, a] = bugun.split("-").map(Number);
  const bas = new Date(Date.UTC(y, a - 1, 1) - 3 * 3600e3).toISOString();
  const { data } = await db.from("restoran_paylasim").select("id, created_at").eq("bolum", "muhasebe").like("metin", `${MASRAF_BASLIK} ·%`)
    .gte("created_at", bas).order("created_at", { ascending: false }).limit(1);
  const gun = ilkIsGunu(bugun.slice(0, 7));
  return { ay: bugun.slice(0, 7), liste_ayi: oncekiAyAdi(bugun), paylasildi_at: data?.[0]?.created_at ?? null, bugun, gun, bugun_gunu: bugun === gun };
}
// Bu roller YK iş emrinin süresini görmez ve seçmez; süreyi yönetici ve yönetim kurulu belirler
const SURE_GORMEYEN: Rol[] = ["mudur", "sef", "muhasebe"];
const kimeBildir = (k: { gizli?: boolean }): Hedef => (k.gizli ? YONETIM_ISI_GOREN : "hepsi");

// ---------- E-posta ----------
// Plaka girişi talepleri bu adrese gider.
const PLAKA_EPOSTA = "kooperatif@sporkentsitesi.com";
// Resend (resend.com) ile gönderim: sunucu sırlarında RESEND_API_KEY tanımlıysa e-posta sunucudan gider.
// Tanımlı değilse false döner; uygulama o zaman telefonun e-posta uygulamasını hazır metinle açar.
async function epostaGonder(kime: string, konu: string, metin: string): Promise<boolean> {
  const anahtar = Deno.env.get("RESEND_API_KEY");
  if (!anahtar) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${anahtar}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("EPOSTA_GONDEREN") ?? "SPORKENT ASİSTAN <onboarding@resend.dev>", to: [kime], subject: konu, text: metin }),
    });
    return r.ok;
  } catch { return false; }
}

// ---------- Parsel temsilcileri ----------
// Ortak numarası aralığındaki temsilci: bu ortağın Saha Takip kaydı önce ona düşer
async function temsilciBul(no: number | null | undefined) {
  if (!no) return null;
  const { data } = await db.from("parsel_temsilcileri").select("*").lte("no_bas", no).gte("no_bit", no).order("id").limit(1).maybeSingle();
  return data as any;
}
// Kullanıcının temsilcisi olduğu parseller (temsilci, şahsi koduyla giren TG üyesidir; adı eşleşir)
async function temsilcilikleri(u: any): Promise<any[]> {
  if (u.rol !== "uye" || u.ortak_no) return [];
  const { data } = await db.from("parsel_temsilcileri").select("*").eq("ad", u.ad).order("id");
  return data ?? [];
}
async function temsilciGorunumu(liste: any[]) {
  const yollar = liste.map((t) => t.resim).filter(Boolean);
  const { data } = yollar.length ? await db.storage.from(BUCKET).createSignedUrls(yollar, 60 * 60 * 6) : { data: [] };
  const harita = new Map((data ?? []).map((d: any) => [d.path, d.signedUrl]));
  return liste.map((t) => ({ id: t.id, baslik: t.baslik, ad: t.ad, telefon: t.telefon, no_bas: t.no_bas, no_bit: t.no_bit, resim_url: t.resim ? harita.get(t.resim) ?? null : null }));
}
// Katılım başvurusu: ortağın kendisi ("12 No'lu Ortak") ya da yakını ("12 No'lu Ortağın Yakını").
// Parselinde temsilci varsa onay / ret YALNIZCA o temsilcinindir; temsilci yoksa yöneticinin.
const katilimBasvurusu = (x: any) => x?.rol === "uye" && !!x?.ortak_no && /No'lu (Ortak$|Ortağın Yakını)/.test(x?.unvan ?? "");
async function temsilciAraliklari() {
  const { data } = await db.from("parsel_temsilcileri").select("no_bas, no_bit");
  return (data ?? []) as { no_bas: number; no_bit: number }[];
}
const aralikta = (ar: { no_bas: number; no_bit: number }[], no: number) => ar.some((t) => no >= t.no_bas && no <= t.no_bit);
// Yöneticinin onayına düşmeyen (parsel temsilcisinin onaylayacağı) bekleyen başvuru mu
const temsilciOnaylar = (x: any, ar: { no_bas: number; no_bit: number }[]) => x?.durum === "bekliyor" && katilimBasvurusu(x) && aralikta(ar, x.ortak_no);

// Temsilcinin parsellerindeki onay bekleyen katılım başvuruları (ortaklar ve yakınları)
async function yakinBasvurulari(temsil: any[]) {
  const { data } = await db.from("uyeler").select("cihaz, ad, rol, unvan, ortak_no, telefon, durum, created_at")
    .eq("durum", "bekliyor").eq("rol", "uye").not("ortak_no", "is", null).order("created_at");
  const kapsar = (no: number) => temsil.some((t) => no >= t.no_bas && no <= t.no_bit);
  const liste = (data ?? []).filter((x: any) => katilimBasvurusu(x) && kapsar(x.ortak_no));
  const nolar = [...new Set(liste.map((x: any) => x.ortak_no))];
  const { data: rh } = nolar.length ? await db.from("ortak_rehberi").select("no, ad_ozet, tel_ozetleri").in("no", nolar) : { data: [] };
  const rehber = new Map((rh ?? []).map((r: any) => [r.no, r]));
  const sonuc = [];
  for (const x of liste) {
    const ortakAdi = String(x.ad).replace(/\s*\(yakını\)$/i, "");
    const e = await listeyleKarsilastir(rehber.get(x.ortak_no), ortakAdi, x.telefon);
    sonuc.push({ cihaz: x.cihaz, ad: x.ad, ortak_no: x.ortak_no, telefon: x.telefon, created_at: x.created_at,
      yakin: /Yakını/.test(x.unvan ?? ""), ad_uyuyor: e.ad_uyuyor, tel_uyuyor: e.uyuyor });
  }
  return sonuc;
}
// Temsilcinin telefonlarına bildirim
async function temsilciyeBildir(t: any, baslik: string, govde: string, ek: { kayitId?: number; sayfa?: string } = {}) {
  const { data } = await db.from("uyeler").select("cihaz").eq("ad", t.ad).eq("rol", "uye").is("ortak_no", null).eq("durum", "onayli");
  for (const x of data ?? []) await bildir({ cihaz: x.cihaz }, baslik, govde, ek);
}
const MAKS_UYE = 800; // başkan dahil onaylı üye sınırı (400 ortak, bir kısmı iki telefondan; TG, YK ve görevliler)
// Bu dört görevin yazdığı kayıt doğrudan iş listesine düşer; diğerlerininki (TG üyesi, muhasebe)
// önce yönetici / yönetim kurulu onayını bekler, onaylanınca herkes görür.
// Kaydı onay beklemeden iş listesine düşenler. TG üyeleri (rolü "uye", unvanı TG…) de onaysız girer;
// yalnızca düz ortakların kaydı yönetici ya da YK onayı bekler.
const ONAYSIZ_GIREN: Rol[] = ["baskan", "yonetim", "mudur", "sef", "muhasebe"];
const onaysizGirer = (u: any) => ONAYSIZ_GIREN.includes(u.rol) || (u.rol === "uye" && !u.ortak_no && /^TG/.test(u.unvan ?? ""));
const KAYIT_ONAYLAYAN: Rol[] = ["baskan", "yonetim"];
// Aidat resmini yönetici ve muhasebe ekler; iş programına bu dört görev girer
// Aidat resmini yalnızca yönetici ekler ve siler; herkes görür
const AIDAT_EKLEYEN: Rol[] = ["baskan"];
const PROGRAM_GIREN: Rol[] = ["baskan", "yonetim", "mudur", "sef"];
const ROL_ADI: Record<Rol, string> = {
  baskan: "YK Başkanı", mudur: "Müdür", sef: "Şef", yonetim: "Yönetim Kurulu", muhasebe: "Muhasebe", uye: "TG Üyesi", restoran: "Restoran Yetkilisi",
};
// Restoran yetkilisinin yapabileceği işlemler (başka hiçbir bölüme erişemez)
const RESTORAN_ISLEMLERI = ["durum", "abone_ol", "izin_bildir", "liste", "yukleme_adresi", "restoran_liste", "restoran_paylas", "restoran_sil", "restoran_tel", "duyuru_liste", "kullanim"];
// Kullanım raporunda sayılan bölümler (uygulamadaki ekran adları)
const KULLANIM_BOLUMLERI = ["acilis", "ana", "duyuru", "parsel", "saha", "restoran", "yonetim", "aidat", "plaka", "iletisim", "sokaklar", "servis",
  "yakinlar", "uyeler", "rapor", "yksaha", "program", "devriye", "gorevler", "faaliyet", "muhasebe"];

const temiz = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

// Cihaz kimliği: telefonun ürettiği rastgele değer (UUID). Filtre metinlerine girdiği için biçimi sıkı denetlenir.
const CIHAZ_BICIM = /^[A-Za-z0-9.-]{8,80}$/;
function cihazAl(v: unknown): string {
  const c = temiz(v, 80);
  if (!CIHAZ_BICIM.test(c)) throw new Hata("Cihaz bilgisi geçersiz. Uygulamayı kapatıp yeniden açın.", 400);
  return c;
}
// Deneme telefonları: öneki sunucu sırrıdır (TEST_ONEK); istemci "test-" yazarak gizli moda geçemez
const TEST_ONEK = Deno.env.get("TEST_ONEK") ?? "";
const testCihaz = (c: unknown) => TEST_ONEK.length >= 12 && String(c ?? "").startsWith(TEST_ONEK);
// Sırları sabit zamanlı karşılaştır
function esitMi(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Tahmin edilemez kod: karışmayan 31 harf/rakamdan 12 karakter (~59 bit), okunsun diye 4'erli gruplar
function gucluKod(onek: string) {
  const A = "abcdefghjkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint32Array(12));
  const k = Array.from(r, (x) => A[x % A.length]).join("");
  return `${onek}-${k.slice(0, 4)}-${k.slice(4, 8)}-${k.slice(8)}`;
}

// ---------- Kodla girişte deneme sınırı ----------
// Telefon başına 5, internet adresi başına 10 hatalı deneme → 30 dk kilit; tüm sistemde 1 saatte 100 hata → 1 saat kilit.
const DENEME = { c: { sinir: 5, dk: 30 }, ip: { sinir: 10, dk: 30 }, genel: { sinir: 100, dk: 60 } } as const;
const denemeAnahtarlari = (cihaz: string, ip: string) => [["c", "c:" + cihaz], ["ip", "ip:" + ip], ["genel", "genel"]] as const;
async function denemeKontrol(cihaz: string, ip: string) {
  const { data } = await db.from("giris_denemeleri").select("anahtar, kilit_bitis").in("anahtar", denemeAnahtarlari(cihaz, ip).map((x) => x[1]));
  const kilit = (data ?? []).map((x: any) => x.kilit_bitis ? Date.parse(x.kilit_bitis) : 0).reduce((a, b) => Math.max(a, b), 0);
  if (kilit > Date.now()) {
    const dk = Math.ceil((kilit - Date.now()) / 60000);
    throw new Hata(`Çok fazla hatalı deneme yapıldı. ${dk} dakika sonra tekrar deneyin.`, 429);
  }
}
async function denemeHata(cihaz: string, ip: string) {
  const simdi = Date.now();
  for (const [tur, anahtar] of denemeAnahtarlari(cihaz, ip)) {
    const { data: x } = await db.from("giris_denemeleri").select("hata, guncel").eq("anahtar", anahtar).maybeSingle();
    // Son hatadan 1 saat geçtiyse sayaç sıfırdan başlar
    const onceki = x && simdi - Date.parse(x.guncel) < 3600_000 ? x.hata : 0;
    const hata = onceki + 1, k = DENEME[tur];
    const kilitle = hata >= k.sinir;
    await db.from("giris_denemeleri").upsert({ anahtar, hata: kilitle ? 0 : hata, guncel: new Date(simdi).toISOString(),
      kilit_bitis: kilitle ? new Date(simdi + k.dk * 60000).toISOString() : null });
  }
}
async function denemeTemizle(cihaz: string) {
  await db.from("giris_denemeleri").delete().eq("anahtar", "c:" + cihaz);
}

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
  for (const r of ROLLER) if (r !== "uye" && r !== "yonetim" && hepsi[r] && esitMi(k, hepsi[r].toLowerCase())) return r;
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
    // Günlük: o gün devriye yapan kişi sayısı (müdür ve şef)
    const { data: dk } = await db.from("devriye_turlari").select("gun, ad").gte("gun", gunEkle(bugun, -13));
    const ugranan = (d: string) => new Set((dk ?? []).filter((x: any) => x.gun === d).map((x: any) => x.ad)).size;
    gunler = Array.from({ length: 14 }, (_, i) => gunEkle(bugun, -i)).map((d) => ({ donem: d, yapilan: ugranan(d) }));
    haftalar = Array.from({ length: 8 }, (_, i) => gunEkle(haftaBasi(bugun), -7 * i)).map((d) => ({ donem: d, yapilan: say("haftalik", d) }));
  }
  return {
    program: { gunluk: GUNLUK, haftalik: HAFTALIK },
    gun, hafta, bugun, buHafta: haftaBasi(bugun),
    isaretler: (isaretler ?? []).filter((x: any) => KALEM_IDLERI.has(x.kalem)),
    gecmisGorur: gecmisli,
    gecmis: { gunler, haftalar, gunlukToplam: await devriyeciSayisi(), haftalikToplam: kalemSayisi(HAFTALIK) },
  };
}
const devriyeciSayisi = async () => {
  const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).in("rol", ["mudur", "sef"]).eq("durum", "onayli");
  return count ?? 0;
};

async function gorevHatirlat() {
  const bugun = sonGun(new Date(), 0);
  const sonuc: Record<string, unknown> = {};
  sonuc.gunluk = await bildir(GOREV_ISARETLEYEN, "📍 Günlük devriye",
    `Devriyeye çıkarken uygulamada "Devriyeyi Başlat"a, bitince "Devriyeyi Bitir"e basın.`, { sayfa: "gorevler" });
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

// Program açılınca gösterilen "Yenilikler" penceresi: son 14 günün kayıt dışındaki gelişmeleri (bildirimi gidenler).
// Kişinin kendi yaptığı iş kendisine yenilik sayılmaz. a: telefonun "gördüm" diye hatırladığı anahtar
async function yenilikBul(u: any, rol: Rol) {
  const once = new Date(Date.now() - 14 * 864e5).toISOString();
  const kisa = (t: unknown) => String(t ?? "").slice(0, 160);
  const bos = Promise.resolve({ data: [] as any[] });
  const son = (tablo: string, alan: string, zaman = "created_at") =>
    db.from(tablo).select(alan).gte(zaman, once).order(zaman, { ascending: false }).limit(20) as any;
  const [pay, aidat, prog, uye, plaka, dev] = await Promise.all([
    son("restoran_paylasim", "id, bolum, tur, metin, rol, cihaz, created_at"),
    rol === "restoran" ? bos : son("aidat_resimleri", "id, baslik, ekleyen, created_at"),
    PROGRAM_GIREN.includes(rol) ? son("is_programi", "id, tarih, saat, baslik, ekleyen, cihaz, created_at") : bos,
    rol === "baskan" ? son("uyeler", "cihaz, ad, rol, unvan, durum, created_at, onay_at") : bos,
    rol === "baskan" || rol === "muhasebe" ? son("plaka_talepleri", "id, cihaz, ad, plaka, created_at") : bos,
    rol === "baskan" ? son("devriye_turlari", "id, cihaz, ad, basla, bitis, mesafe_m", "bitis") : bos,
  ]);
  const y: any[] = [];
  const baska = (x: any) => x.cihaz !== u.cihaz && !testCihaz(String(x.cihaz ?? ""));
  for (const x of (pay.data ?? []).filter(baska)) {
    if (x.bolum === "muhasebe") {
      if (MUHASEBE_GOREN.includes(rol)) y.push({ a: "m" + x.id, tip: "muhasebe", at: x.created_at,
        metin: kisa(x.metin) || ({ gorsel: "Resim paylaşıldı.", pdf: "PDF belge paylaşıldı." } as any)[x.tur] || "Yeni paylaşım." });
      continue;
    }
    const duyuru = x.bolum === "duyuru";
    y.push({ a: (duyuru ? "d" : "r") + x.id, tip: duyuru ? "duyuru" : "restoran", at: x.created_at,
      metin: kisa(x.metin) || ({ gorsel: "Resim paylaşıldı.", pdf: "PDF belge paylaşıldı." } as any)[x.tur] || "Yeni paylaşım." });
  }
  for (const x of (aidat.data ?? []).filter((x: any) => x.ekleyen !== u.ad)) y.push({ a: "a" + x.id, tip: "aidat", at: x.created_at, metin: kisa(x.baslik) || "Yıl içindeki ödemeler güncellendi." });
  for (const x of (prog.data ?? []).filter(baska)) {
    const [yil, ay, gun] = String(x.tarih).split("-");
    y.push({ a: "p" + x.id, tip: "program", at: x.created_at, metin: kisa(`${gun}.${ay}.${yil}${x.saat ? " " + String(x.saat).slice(0, 5) : ""}: ${x.baslik} · ${x.ekleyen}`) });
  }
  const uyeAr = (uye.data ?? []).length ? await temsilciAraliklari() : [];
  for (const x of (uye.data ?? []).filter(baska)) {
    const kim = `${x.ad} (${x.unvan || ROL_ADI[x.rol as Rol] || x.rol})`;
    if (x.durum === "bekliyor" && !temsilciOnaylar(x, uyeAr)) y.push({ a: "ub" + x.cihaz.slice(0, 12), tip: "uyebekler", at: x.created_at, metin: kisa(`${kim} katılmak istiyor.`) });
    else if (x.durum === "onayli" && x.rol !== "baskan") y.push({ a: "uk" + x.cihaz.slice(0, 12), tip: "uye", at: x.onay_at ?? x.created_at, metin: kisa(`${kim} programa katıldı.`) });
  }
  for (const x of (plaka.data ?? []).filter(baska)) y.push({ a: "pl" + x.id, tip: "plaka", at: x.created_at, metin: kisa(`${x.plaka} · ${x.ad}`) });
  for (const x of (dev.data ?? []).filter(baska)) {
    y.push({ a: "dv" + x.id, tip: "devriye", at: x.bitis, metin: `${x.ad} · ${Math.max(1, Math.round((Date.parse(x.bitis) - Date.parse(x.basla)) / 60000))} dk · ${((x.mesafe_m ?? 0) / 1000).toFixed(1).replace(".", ",")} km` });
  }
  return y;
}

// Plaka-Kimlik Bildirimi: bildirenin ortaklık numarası ve cep telefonu.
// Ortakta kayıttan, yöneticide ayarlardan; TG ve YK üyelerinin kaydında yoktur: ilk bildirimde yazdıkları hatırlanır.
const PLAKA_BILDIREN = (u: any, rol: Rol) => rol === "baskan" || rol === "yonetim" || (rol === "uye" && (!!u.ortak_no || /^TG/.test(u.unvan ?? "")));
async function plakaKimlik(u: any, rol: Rol): Promise<{ no: number | null; tel: string | null }> {
  let no: number | null = u.ortak_no ?? null, tel: string | null = u.telefon ?? null;
  if (rol === "baskan" && (!no || !tel)) {
    const { data: yp } = await db.from("ayarlar").select("deger").eq("ad", "yonetici_plaka").maybeSingle();
    try { const x = JSON.parse(String(yp?.deger ?? "{}")); no ??= Number(x.no) || null; tel ??= x.tel || null; } catch { /* bozuk kayıt: boş kalır */ }
  }
  if (!no || !tel) {
    const { data: son } = await db.from("plaka_talepleri").select("ortak_no, telefon").or(`cihaz.eq.${u.cihaz},ad.eq."${String(u.ad).replace(/["\\]/g, "")}"`)
      .not("ortak_no", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    no ??= son?.ortak_no ?? null; tel ??= son?.telefon ?? null;
  }
  return { no, tel };
}
const telDuzelt = (ham: string) => {
  let d = ham.replace(/\D/g, "");
  if (d.startsWith("90") && d.length === 12) d = d.slice(2); else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (/^[2-5]\d{9}$/.test(d)) return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  if (/^(\+|00)/.test(ham) && d.replace(/^00/, "").length >= 9 && d.length <= 15) return "+" + d.replace(/^00/, "");
  return "";
};

type Hedef = Rol[] | "hepsi" | { cihaz: string };

async function bildir(hedef: Hedef, baslik: string, govde: string, ek: { kayitId?: number; resim?: string | null; sayfa?: string; haric?: string } = {}) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { hedef: 0, basarili: 0 };
  let q = db.from("abonelikler").select("endpoint, abonelik, rol");
  if (Array.isArray(hedef)) q = q.in("rol", hedef);
  else if (hedef !== "hepsi") q = q.eq("cihaz", hedef.cihaz);
  if (ek.haric) q = q.neq("cihaz", ek.haric);
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
async function giris(g: any, ip: string) {
  let rol: Rol | null = null;
  const cihaz = cihazAl(g.cihaz);
  await denemeKontrol(cihaz, ip);
  let ad = temiz(g.ad, 80);
  // "Ortak 12" + kendi şifresi: TG üyesi olarak katılır (onay kuralı aynı)
  const m = ad.match(/^ortak\s*-?\s*(\d{1,4})$/i);
  const sifre = temiz(g.kod, 60);
  // Eski "Ortak N + şifre" girişi kapandı: ortaklar artık yöneticinin gönderdiği davet koduyla kayıt olur
  if (m) throw new Hata("Ortak girişi artık şifreyle yapılmıyor. Ortak kaydı ekranında, yönetimin size gönderdiği davet koduyla kayıt olun.", 401);
  // TG Başkanı, TG üyeleri ve YK üyeleri: kişiye özel kod; ad, unvan ve görev listeden gelir, onay beklemez
  let tg: { ad: string; unvan: string; rol: Rol } | null = null;
  if (!rol && sifre) {
    const { data: t } = await db.from("tg_uyeleri").select("ad, unvan, rol").eq("kod", sifre.toUpperCase().replace(/\s+/g, "")).maybeSingle();
    if (t) { tg = t; rol = t.rol; ad = t.ad; }
  }
  if (!rol) rol = await rolBul(g.kod);
  if (!rol) { await denemeHata(cihaz, ip); throw new Hata("Kullanıcı adı ya da şifre / kod hatalı.", 401); }
  await denemeTemizle(cihaz);
  if (!ad) throw new Hata("Ad ve cihaz bilgisi gerekli.");

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

  if (durum === "bekliyor" && !testCihaz(cihaz)) {
    await bildir(["baskan"], "Onay bekleyen üye", `${ad} (${ROL_ADI[rol]}) gruba katılmak istiyor.`, { sayfa: "uyeler" });
  }
  // Şahsi koduyla ilk kez giren (TG / YK üyesi, restoran yetkilisi…) yöneticiye bildirilir; yeniden girişler ve yönetici hariç
  if (durum === "onayli" && rol !== "baskan" && var_?.durum !== "onayli" && !eskiOnayli && !testCihaz(cihaz)) {
    await katildiBildir(ad, tg?.unvan ?? ROL_ADI[rol]);
  }
  return { rol, durum, anahtar, ad, unvan: tg?.unvan ?? null, vapid: VAPID_PUBLIC || null };
}

// Programa yeni katılan (onay beklemeden giren) yöneticiye bildirilir; toplam kişi sayısıyla
async function katildiBildir(ad: string, kim: string) {
  const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "onayli").not("cihaz", "like", "test-%");
  await bildir(["baskan"], "✅ Programa yeni katılım", `${ad} (${kim}) SPORKENT ASİSTAN'a katıldı. Toplam ${count ?? "?"} kişi.`, { sayfa: "uyeler" });
}

const adNorm = (s: string) => String(s ?? "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
const telNorm = (t: string) => String(t ?? "").replace(/\D/g, "").slice(-10);

// KVKK: resmi ortak listesinde ad ve telefonlar okunabilir değil, gizli anahtarlı özet (HMAC-SHA256)
// olarak durur. Karşılaştırma için başvurudaki bilgi de aynı anahtarla özetlenir (yedekleme/rehber_yukle.py ile aynı).
const REHBER_ANAHTARI = Deno.env.get("REHBER_ANAHTARI") ?? "";
let rehberAnahtar: CryptoKey | null = null;
async function rehberOzeti(metin: string) {
  if (!REHBER_ANAHTARI) throw new Error("REHBER_ANAHTARI tanımlı değil");
  rehberAnahtar ??= await crypto.subtle.importKey("raw", new TextEncoder().encode(REHBER_ANAHTARI), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const imza = await crypto.subtle.sign("HMAC", rehberAnahtar, new TextEncoder().encode(metin));
  return [...new Uint8Array(imza)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Başvurunun listeyle karşılaştırılması: telefon listedekilerden biri mi, ad listedekiyle aynı mı
async function listeyleKarsilastir(r: any, ad: string, telefon: string) {
  if (!r) return { listede: false, uyuyor: false, ad_uyuyor: false };
  const tel = telNorm(telefon);
  return {
    listede: true,
    uyuyor: tel.length >= 7 && r.tel_ozetleri.includes(await rehberOzeti(tel)),
    ad_uyuyor: r.ad_ozet === await rehberOzeti(adNorm(ad)),
  };
}

// ---------- Devriye ----------
const DEVRIYE_ISARETLEYEN: Rol[] = ["mudur", "sef"];
const DEVRIYE_SAKLAMA_GUN = 365;
const trSaati = () => { const d = new Date(Date.now() + 3 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60; };
// İki konum arası mesafe (metre)
function mesafeM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
// ---------- Devriye izi: "Devriyeyi Başlat" ile "Devriyeyi Bitir" arası konum ----------
const IZ_DOGRULUK_M = 30;     // bundan kötü doğruluktaki nokta kaydedilmez
const IZ_KOPUK_SN = 90;       // iki nokta arası bundan uzunsa çizgi kopuk çizilir, mesafeye katılmaz
const IZ_SESSIZ_DK = 30;      // bu kadar süre nokta gelmeyen açık devriye kendiliğinden kapanır
const IZ_IZLEYEN: Rol[] = ["baskan", "yonetim"];
const saatMetni = (t: string | number | Date) => new Date(t).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
// Mesai saatleri ayarlanabilir (ayarlar: devriye_mesai = "08:00-18:00")
async function mesaiAraligi() {
  const { data } = await db.from("ayarlar").select("deger").eq("ad", "devriye_mesai").maybeSingle();
  const m = String(data?.deger ?? "").match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  const [a, b, c, d] = m ? m.slice(1).map(Number) : [8, 0, 18, 0];
  const iki = (x: number) => String(x).padStart(2, "0");
  return { bas: a + b / 60, bit: c + d / 60, metin: `${iki(a)}:${iki(b)}–${iki(c)}:${iki(d)}`, ham: `${iki(a)}:${iki(b)}-${iki(c)}:${iki(d)}` };
}
const mesaiIcinde = (m: { bas: number; bit: number }) => { const h = trSaati(); return h >= m.bas && h < m.bit; };
// Site sınırı: yöneticinin çizdiği çokgen (ayarlar: devriye_sinir = [[enlem, boylam], ...]).
// Konum sınırın içindeyse ya da kenara 30 m'den yakınsa kaydedilir (telefon konumu kenarda sapabilir).
const SINIR_PAYI_M = 30;
type Sinir = number[][];
async function siteSiniri(): Promise<Sinir | null> {
  const { data } = await db.from("ayarlar").select("deger").eq("ad", "devriye_sinir").maybeSingle();
  try { const x = JSON.parse(String(data?.deger ?? "")); return Array.isArray(x) && x.length >= 3 ? x : null; } catch { return null; }
}
function sinirIcinde(sn: Sinir, lat: number, lng: number) {
  let ic = false;
  for (let i = 0, j = sn.length - 1; i < sn.length; j = i++) {
    const [yi, xi] = sn[i], [yj, xj] = sn[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ic = !ic;
  }
  return ic;
}
function sinirKenari(sn: Sinir, lat: number, lng: number) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let en = Infinity;
  for (let i = 0; i < sn.length; i++) {
    const a = sn[i], b = sn[(i + 1) % sn.length];
    const ax = (a[1] - lng) * kx, ay = (a[0] - lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    en = Math.min(en, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return en;
}
const alanda = (sn: Sinir | null, lat: number, lng: number) => !sn || sinirIcinde(sn, lat, lng) || sinirKenari(sn, lat, lng) <= SINIR_PAYI_M;
async function turIzleri(ids: number[]) {
  const tum: any[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("devriye_izleri").select("tur_id, zaman, lat, lng, kopuk").in("tur_id", ids).order("zaman").range(i, i + 999);
    if (error) throw error;
    tum.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return tum;
}
function izMesafe(iz: { zaman: string; lat: number; lng: number; kopuk: boolean }[]) {
  let m = 0;
  for (let i = 1; i < iz.length; i++) {
    if (iz[i].kopuk || Date.parse(iz[i].zaman) - Date.parse(iz[i - 1].zaman) > IZ_KOPUK_SN * 1000) continue;
    m += mesafeM(iz[i - 1], iz[i]);
  }
  return Math.round(m);
}
// Devriyeyi kapatır, mesafeyi hesaplar ve yöneticiye bildirir
async function turKapat(tur: any, neden: string, bitisIstenen?: number, kesinti?: number) {
  const iz = await turIzleri([tur.id]);
  const basla = Date.parse(tur.basla), simdi = Date.now();
  const sonNokta = iz.length ? Date.parse(iz[iz.length - 1].zaman) : basla;
  let bitis = neden === "kullanici" ? (Number.isFinite(bitisIstenen) ? Math.min(simdi, Math.max(basla, Number(bitisIstenen))) : simdi) : Math.max(basla, sonNokta);
  if (neden === "mesai" && Number.isFinite(bitisIstenen)) bitis = Math.min(simdi, Math.max(basla, Number(bitisIstenen)));
  const guncel = {
    bitis: new Date(bitis).toISOString(), bitis_nedeni: neden, mesafe_m: izMesafe(iz), nokta_sayisi: iz.length,
    kesinti_sn: Math.max(tur.kesinti_sn ?? 0, Math.min(86400, Math.round(Number(kesinti) || 0))),
  };
  const { data, error } = await db.from("devriye_turlari").update(guncel).eq("id", tur.id).is("bitis", null).select().maybeSingle();
  if (error) throw error;
  if (!data) return (await db.from("devriye_turlari").select("*").eq("id", tur.id).maybeSingle()).data; // başkası kapatmış
  if (!testCihaz(String(tur.cihaz))) {
    const dk = Math.max(1, Math.round((bitis - basla) / 60000));
    const ek = neden === "kullanici" ? "" : neden === "mesai" ? " (mesai bitince kendiliğinden durdu)" : " (uzun süre konum gelmediği için kendiliğinden kapandı)";
    await bildir(["baskan"], "🚶 Devriye tamamlandı",
      `${tur.ad}: ${saatMetni(basla)} – ${saatMetni(bitis)} · ${dk} dk · ${(guncel.mesafe_m / 1000).toFixed(1).replace(".", ",")} km${ek}`,
      { sayfa: "gorevler" }).catch(() => {});
  }
  return data;
}
// Unutulan devriyeler: gün değiştiyse, mesai bittiyse ya da uzun süre nokta gelmediyse kapanır
async function acikTurlariKapat() {
  const { data } = await db.from("devriye_turlari").select("*").is("bitis", null);
  if (!data?.length) return;
  const bugun = sonGun(new Date(), 0), m = await mesaiAraligi(), simdi = Date.now();
  for (const t of data) {
    const { data: son } = await db.from("devriye_izleri").select("zaman").eq("tur_id", t.id).order("zaman", { ascending: false }).limit(1).maybeSingle();
    const sonAn = son ? Date.parse(son.zaman) : Date.parse(t.basla);
    if (t.gun !== bugun || !mesaiIcinde(m)) await turKapat(t, "mesai");
    else if (simdi - sonAn > IZ_SESSIZ_DK * 60000) await turKapat(t, "otomatik");
  }
}

// Günlük devriye ekranı: devriye izleri
async function devriyeVerisi(istenen: string, u: { cihaz: string; rol: Rol }) {
  const bugun = sonGun(new Date(), 0);
  const gun = /^\d{4}-\d{2}-\d{2}$/.test(istenen) && istenen <= bugun ? istenen : bugun;
  const izleyen = IZ_IZLEYEN.includes(u.rol), yapan = DEVRIYE_ISARETLEYEN.includes(u.rol);
  await acikTurlariKapat().catch(() => {});
  let q = db.from("devriye_turlari").select("id, cihaz, ad, rol, basla, bitis, bitis_nedeni, mesafe_m, nokta_sayisi, kesinti_sn, cihaz_turu, ekran").eq("gun", gun).order("basla");
  if (!izleyen) q = q.eq("cihaz", u.cihaz); // müdür ve şef yalnızca kendi devriyesini görür
  const { data: turlar, error: e2 } = (izleyen || yapan) ? await q : { data: [], error: null };
  if (e2) throw e2;
  const izler = turlar?.length ? await turIzleri(turlar.map((t: any) => t.id)) : [];
  const m = await mesaiAraligi();
  const { data: kisiler } = izleyen ? await db.from("uyeler").select("ad, rol").in("rol", DEVRIYE_ISARETLEYEN).eq("durum", "onayli").order("rol").order("ad") : { data: [] };
  return {
    gun, bugun, sinir: await siteSiniri(),
    turlar: (turlar ?? []).map(({ cihaz: c, ...t }: any) => ({
      ...t, benim: c === u.cihaz,
      iz: izler.filter((x: any) => x.tur_id === t.id).map((x: any) => [Date.parse(x.zaman), x.lat, x.lng, x.kopuk ? 1 : 0]),
    })),
    kisiler: [...new Map((kisiler ?? []).map((k: any) => [k.ad, k])).values()],
    mesai: { metin: m.metin, ham: m.ham, bas: m.bas, bit: m.bit }, mesaide: mesaiIcinde(m),
    isaretleyebilir: yapan && gun === bugun, izleyen,
    mesaiAyarlar: u.rol === "baskan",
  };
}

// ---------- Davet kodu ----------
const DAVET_GUN = 14, DAVET_DENEME = 5;
const davetOzeti = (no: number, kod: string) => rehberOzeti(`davet:${no}:${kod}`);
async function davetKoduUret(no: number, olusturan: string) {
  const sayi = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const kod = String(sayi).padStart(6, "0");
  // Aynı ortağa önceden verilmiş, kullanılmamış kodlar geçersiz olur: geçerli olan yalnızca son kod
  await db.from("davet_kodlari").update({ son_tarih: new Date().toISOString() }).eq("ortak_no", no).is("kullanildi_at", null);
  const { error } = await db.from("davet_kodlari").insert({
    ortak_no: no, kod_ozet: await davetOzeti(no, kod), olusturan,
    son_tarih: new Date(Date.now() + DAVET_GUN * 864e5).toISOString(),
  });
  if (error) throw error;
  return kod;
}
// Kodu doğrular; doğruysa kaydın kimliğini döndürür (kayıt başarılı olunca "kullanıldı" işaretlenir)
async function davetKoduDogrula(no: number, kod: string) {
  if (!kod) throw new Hata("Size gönderilen davet mesajındaki 6 haneli kodu yazın.");
  const { data: d } = await db.from("davet_kodlari").select("id, kod_ozet, deneme")
    .eq("ortak_no", no).is("kullanildi_at", null).gt("son_tarih", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!d || d.deneme >= DAVET_DENEME) {
    throw new Hata("Bu ortak numarası için geçerli bir davet kodu yok. Kooperatif yönetiminden davet isteyin.", 403);
  }
  if (!/^\d{6}$/.test(kod) || d.kod_ozet !== await davetOzeti(no, kod)) {
    await db.from("davet_kodlari").update({ deneme: d.deneme + 1 }).eq("id", d.id);
    const kalan = DAVET_DENEME - d.deneme - 1;
    throw new Hata(kalan > 0 ? `Davet kodu hatalı. Size gönderilen mesajdaki 6 haneli kodu yazın (${kalan} deneme hakkınız kaldı).`
      : "Davet kodu çok kez hatalı yazıldı ve geçersiz oldu. Kooperatif yönetiminden yeni davet isteyin.", 403);
  }
  return d.id as number;
}

// Ortak kaydı: şifre ve davet kodu yok. Ad soyad, ortaklık numarası ve cep telefonu; telefon kooperatif kayıtlarıyla
// eşleşirse hemen girer, eşleşmezse yönetici onaylayınca girer. (Davet kodu yazılırsa yine geçerlidir.)
async function ortakKayit(g: any) {
  // Ortağın yakını (eşi, çocuğu, damadı, misafiri…): ortağın adını ve numarasını, kendi telefonunu yazar.
  // Uygulamada "Ahmet Yılmaz (yakını)" diye görünür.
  const yakinlik = g.yakin === true || g.yakin === "true";
  const yazilanAd = temiz(g.ad_soyad, 80).replace(/\s+/g, " ").replace(/\s*\(yakını\)$/i, "");
  const ad = yakinlik ? `${yazilanAd} (yakını)` : yazilanAd;
  const no = Number(temiz(g.ortak_no, 6));
  const ham = temiz(g.telefon, 30);
  let tel = ham.replace(/\D/g, "");
  const cihaz = cihazAl(g.cihaz);
  if (yazilanAd.split(" ").length < 2) throw new Hata(yakinlik ? "Ortağın adını ve soyadını birlikte yazın." : "Adınızı ve soyadınızı birlikte yazın.");
  if (!Number.isInteger(no) || no < 1 || no > 9999) throw new Hata(yakinlik ? "Ortağın ortaklık numarasını doğru yazın." : "Ortaklık numaranızı doğru yazın.");
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
  const { data: listede } = await db.from("ortak_rehberi").select("ad_ozet, tel_ozetleri").eq("no", no).maybeSingle();
  // Ortağın kendisi TG/YK üyesiyse yakını yine de ortak numarasıyla katılabilir (yakında bu kontrol yapılmaz)
  let kodlu: any = yakinlik ? null : (kodlular ?? []).find((t: any) => adNorm(t.ad) === adNorm(ad));
  if (!kodlu && listede && !yakinlik) {
    for (const t of kodlular ?? []) if (await rehberOzeti(adNorm(t.ad)) === listede.ad_ozet) { kodlu = t; break; }
  }
  if (kodlu) throw new Hata(`${kodlu.unvan} olduğunuzdan size verilen şahsi kodunuz ile giriş yapmak zorundasınız. Size gönderilen TG / YK giriş bağlantısını kullanın.`, 403);

  const { data: var_ } = await db.from("uyeler").select("*").eq("cihaz", cihaz).maybeSingle();
  // Erişimi kaldırılmış telefon da yeniden başvurabilir: kayıt baştan onay bekler.
  // Aynı telefon aynı bilgilerle yeniden kayıt olursa durumu korunur; bilgi değişirse yeniden onay bekler
  const ayni = var_ && var_.durum !== "cikarildi" && var_.rol === "uye" && var_.ortak_no === no && var_.ad === ad && var_.telefon === telefon
    && /Yakını/.test(var_.unvan ?? "") === !!yakinlik;
  // Davet kodu artık zorunlu değil: yazıldıysa doğrulanır, yazılmadıysa telefon eşleşmesine bakılır
  const kodYazdi = temiz(g.davet_kodu, 12).replace(/\D/g, "");
  const davetId = ayni && var_.davetli_at ? null : kodYazdi ? await davetKoduDogrula(no, kodYazdi) : null;
  // Yazdığı telefon, kooperatifin ortak listesinde bu numara için kayıtlı telefonlardan biriyse (ya da geçerli davet kodu
  // yazdıysa) yönetici onayı beklemeden hemen girer. Tutmazsa yönetici onayına düşer.
  // Yöneticinin daha önce çıkardığı ortak numarası ve dolu grup otomatik giremez.
  const { uyuyor } = await listeyleKarsilastir(listede, yazilanAd, telefon);
  let otomatik = uyuyor || !!davetId;
  if (otomatik && var_?.durum === "cikarildi") otomatik = false;
  if (otomatik) {
    const { count: cikan } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("ortak_no", no).eq("durum", "cikarildi");
    const { count: onayliSayi } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "onayli");
    if ((cikan ?? 0) > 0 || (onayliSayi ?? 0) >= MAKS_UYE) otomatik = false;
  }
  const durum = ayni && var_.durum === "onayli" ? "onayli" : otomatik ? "onayli" : ayni ? var_.durum : "bekliyor";
  const yeniOnay = durum === "onayli" && var_?.durum !== "onayli";
  const anahtar = var_?.anahtar ?? anahtarUret();
  const unvan = yakinlik ? `${no} No'lu Ortağın Yakını` : `${no} No'lu Ortak`;
  const { error } = await db.from("uyeler").upsert({
    cihaz, anahtar, ad, rol: "uye", durum, unvan, ortak_no: no, telefon,
    onay_at: durum === "onayli" ? (yeniOnay ? new Date().toISOString() : var_.onay_at) : null, son_gorulme: new Date().toISOString(),
    davetli_at: davetId ? new Date().toISOString() : var_?.davetli_at ?? null,
  });
  if (error) throw error;
  if (davetId) await db.from("davet_kodlari").update({ kullanildi_at: new Date().toISOString(), kullanan_cihaz: cihaz }).eq("id", davetId);
  await db.from("abonelikler").update({ rol: "uye" }).eq("cihaz", cihaz);
  if ((durum === "bekliyor" || yeniOnay) && !testCihaz(cihaz)) {
    // Bu ortak numarasıyla zaten girmiş telefonlar uyarılır (başkası onun yerine katılmasın)
    const { data: mevcutlar } = await db.from("uyeler").select("cihaz").eq("ortak_no", no).eq("durum", "onayli").neq("cihaz", cihaz);
    for (const m of mevcutlar ?? []) {
      await bildir({ cihaz: m.cihaz }, "⚠ Numaranızla yeni katılım", yakinlik
        ? `Ortaklığınızın bir yakını ${telefon} numaralı telefondan uygulamaya ${durum === "onayli" ? "katıldı" : "katılmak istiyor"}. Tanımıyorsanız hemen kooperatif yönetimine bildirin.`
        : `${no} numaralı ortaklığınız adına başka bir telefondan uygulamaya katılındı. Siz yapmadıysanız hemen kooperatif yönetimine bildirin.`);
    }
    // Otomatik girenler yöneticiye "katıldı" diye bildirilir.
    if (yeniOnay) await katildiBildir(ad, yakinlik ? `${no} No'lu ortağın yakını` : `${no} No'lu Ortak`);
    // Onay bekleyen yakın parsel temsilcisine (temsilci yoksa yöneticiye), onay bekleyen ortak yöneticiye bildirilir.
    // Onay bekleyen başvuru (ortak ya da yakını) parselin temsilcisine; temsilci yoksa yöneticiye gider
    if (durum === "bekliyor") {
      const t = await temsilciBul(no);
      const govde = yakinlik
        ? `${ad}, ${no} No'lu ortağın yakını olarak katılmak istiyor (${telefon}). Telefonu ortağın kooperatif kayıtlarında yok.`
        : `${ad} (${no} No'lu Ortak, ${telefon}) katılmak istiyor. ${uyuyor ? "🔵 Bilgileri örtüşüyor." : "🔴 Telefonu kooperatif kayıtlarıyla örtüşmüyor!"}`;
      if (t) await temsilciyeBildir(t, yakinlik ? "👨‍👩‍👧 Onayınızı bekleyen ortak yakını" : "🏠 Onayınızı bekleyen ortak", govde, { sayfa: "yakinlar" });
      else await bildir(["baskan"], yakinlik ? "Onay bekleyen ortak yakını" : "Onay bekleyen ortak", govde, { sayfa: "uyeler" });
    }
  }
  return { rol: "uye", durum, anahtar, ad, unvan, vapid: VAPID_PUBLIC || null };
}

// Telefonu gizli anahtarıyla tanı
async function kimlik(g: any) {
  const cihaz = temiz(g.cihaz, 80);
  const anahtar = temiz(g.anahtar, 200);
  if (!cihaz || !anahtar) throw new Hata("Oturum bulunamadı, tekrar giriş yapın.", 401, { cikis: true });
  if (!CIHAZ_BICIM.test(cihaz)) throw new Hata("Oturum geçersiz, tekrar giriş yapın.", 401, { cikis: true });
  const { data: u } = await db.from("uyeler").select("*").eq("cihaz", cihaz).maybeSingle();
  if (!u || !esitMi(String(u.anahtar), anahtar)) throw new Hata("Oturum geçersiz, tekrar giriş yapın.", 401, { cikis: true });
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
    if (k.name === "aidat" || k.name === "devriye" || k.name === "temsilci" || k.name === "restoran") continue; // aidat ve devriye fotoğrafları iş kayıtlarından ayrı, silinmez
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
  // Deneme telefonları (cihaz TEST_ONEK ile başlar) kimseye bildirim göndermez
  const duyur: typeof bildir = (...a) => (testCihaz(u.cihaz) ? Promise.resolve({ hedef: 0, basarili: 0 }) : bildir(...a));
  const yonetici = () => { if (rol !== "baskan") throw new Hata("Bu işlemi yalnızca yönetici (YK başkanı) yapabilir.", 403); };
  // Cevap yazma ve yapılma süresi: yönetici ve yönetim kurulu
  const ykVeYonetici = () => { if (rol !== "baskan" && rol !== "yonetim") throw new Hata("Bu işlemi yalnızca yönetici ve yönetim kurulu yapabilir.", 403); };
  // Onay bekleyen kaydı kim onaylar / reddeder: parsel temsilcisine düşmüşse yalnızca o temsilci,
  // değilse yönetici ve yönetim kurulu
  const onayYetkisi = async (id: unknown) => {
    const { data: k } = await db.from("kayitlar").select("temsilci_id").eq("id", id).maybeSingle();
    if (!k) throw new Hata("Kayıt bulunamadı ya da zaten onaylanmış.");
    if (k.temsilci_id) {
      const tIds = (await temsilcilikleri(u)).map((t) => t.id);
      if (!tIds.includes(k.temsilci_id)) throw new Hata("Bu kaydı yalnızca ortağın parsel temsilcisi onaylar.", 403);
    } else if (!KAYIT_ONAYLAYAN.includes(rol)) throw new Hata("Kayıtları yalnızca yönetici ve yönetim kurulu onaylar.", 403);
  };

  // Onay bekleyen telefon yalnızca durumunu sorabilir ve bildirime kaydolabilir
  if (u.durum !== "onayli" && !["durum", "abone_ol", "izin_bildir"].includes(eylem)) {
    throw new Hata("Kaydınız yönetici onayını bekliyor.", 403, { bekliyor: true });
  }
  if (rol === "restoran" && !RESTORAN_ISLEMLERI.includes(eylem)) throw new Hata("Restoran yetkilisi yalnızca Restoran bölümünü kullanabilir.", 403);
  // Restoranı yöneten: restoran yetkilisi ve yönetici
  const restoranYonetir = () => { if (rol !== "restoran" && rol !== "baskan") throw new Hata("Bu işlemi yalnızca restoran yetkilisi ve yönetici yapabilir.", 403); };

  switch (eylem) {
    case "durum": {
      // Onay bekleyen ortak yakınına: görüşmesi gereken parsel temsilcisinin adı, telefonu ve resmi
      let temsilci: any = null;
      if (u.durum === "bekliyor" && katilimBasvurusu(u)) {
        const t = await temsilciBul((u as any).ortak_no);
        if (t) temsilci = (await temsilciGorunumu([t]))[0];
      }
      // Kullanım raporu: uygulamayı ana ekrana ekleyen ve her açılış (durum açılışta bir kez sorulur)
      if (g.kurulu === true && !(u as any).kurulu) await db.from("uyeler").update({ kurulu: true, kurulu_at: new Date().toISOString() }).eq("cihaz", u.cihaz);
      if (g.acilis === true) await db.rpc("kullanim_say", { p_cihaz: u.cihaz, p_bolum: "acilis" });
      return { rol, durum: u.durum, ad: u.ad, unvan: (u as any).unvan ?? null, temsilci };
    }

    case "liste": {
      // Restoran yetkilisi saha kayıtlarını görmez
      if (rol === "restoran") return { kayitlar: [], rol, unvan: (u as any).unvan ?? null, yenilikler: await yenilikBul(u, rol) };
      let q = db.from("kayitlar").select("*").order("created_at", { ascending: false }).limit(300);
      if (!YONETIM_ISI_GOREN.includes(rol)) q = q.eq("gizli", false);
      // Onay bekleyen kaydı yazan kişi ve onaylayacak olan görür: ortağın kaydını parsel temsilcisi,
      // diğerlerini yönetici ve yönetim kurulu
      const temsil = await temsilcilikleri(u);
      const tIds: number[] = temsil.map((t) => t.id);
      const tKosul = tIds.length ? `,temsilci_id.in.(${tIds.join(",")})` : "";
      q = KAYIT_ONAYLAYAN.includes(rol)
        ? q.or(`onay_durumu.eq.onayli,temsilci_id.is.null,cihaz.eq.${u.cihaz}${tKosul}`)
        : q.or(`onay_durumu.eq.onayli,cihaz.eq.${u.cihaz}${tKosul}`);
      const { data, error } = await q;
      if (error) throw error;
      // Parsel temsilcisi: ortak kendi temsilcisini, temsilci kendi parsellerini, yönetici hepsini görür
      let parsel: any;
      if (rol === "uye" && (u as any).ortak_no) {
        const t = await temsilciBul((u as any).ortak_no);
        parsel = { ortak: true, temsilci: t ? (await temsilciGorunumu([t]))[0] : null };
      } else if (rol === "baskan") {
        const { data: hepsi } = await db.from("parsel_temsilcileri").select("*").order("id");
        parsel = { temsilciler: await temsilciGorunumu(hepsi ?? []), resimEkler: true };
      }
      if (temsil.length) parsel = { ...(parsel ?? {}), temsilcilik: await temsilciGorunumu(temsil) };
      // Parsel temsilcisine: kendi parselindeki ortakların onay bekleyen yakınları
      let bekleyenYakinlar: any[] | undefined;
      if (temsil.length) bekleyenYakinlar = await yakinBasvurulari(temsil);
      const verenler = [...new Set((data ?? []).filter((k: any) => k.gizli && k.cihaz).map((k: any) => k.cihaz))];
      const { data: vr } = verenler.length ? await db.from("uyeler").select("cihaz, rol").in("cihaz", verenler) : { data: [] };
      const verenRol = new Map((vr ?? []).map((x: any) => [x.cihaz, x.rol]));
      const kayitlar = (data ?? []).map(({ cihaz: c, ...k }: any) => {
        const x: any = { ...k, benim: c === u.cihaz };
        if (k.onay_durumu === "bekliyor") x.onaylayabilir = k.temsilci_id ? tIds.includes(k.temsilci_id) : KAYIT_ONAYLAYAN.includes(rol);
        // Bu ortağın parsel temsilcisi: kayda cevap yazabilir
        if (k.temsilci_id && tIds.includes(k.temsilci_id)) x.temsilcisiyim = true;
        // Temsilci-ortak yazışmasını yalnızca ikisi ve yönetici görür
        if (!x.temsilcisiyim && !x.benim && rol !== "baskan") delete x.temsilci_cevaplari;
        if (k.gizli) x.veren_rol = verenRol.get(c) ?? null;
        if (k.gizli && SURE_GORMEYEN.includes(rol)) x.son_tarih = null;
        return x;
      });
      let bekleyen: number | undefined;
      if (rol === "baskan") {
        const { data: bk } = await db.from("uyeler").select("rol, unvan, ortak_no, durum").eq("durum", "bekliyor");
        const ar = await temsilciAraliklari();
        bekleyen = (bk ?? []).filter((x: any) => !temsilciOnaylar(x, ar)).length;
      }
      let ykUyeler: string[] | undefined;
      if (rol === "baskan" || rol === "yonetim") {
        // Yönetici ve yönetim kurulu, müdür ve şefin her kaydı ne zaman gördüğünü de alır.
        // Yönetim kurulu üyelerinin ne zaman gördüğünü yalnızca yönetici alır.
        const ids = kayitlar.map((k: any) => k.id);
        let gq = db.from("goruntulemeler").select("kayit_id, ad, rol, ilk_at").in("kayit_id", ids).order("ilk_at");
        if (rol !== "baskan") gq = gq.in("rol", ["mudur", "sef", "muhasebe"]);
        const { data: g } = ids.length ? await gq : { data: [] };
        for (const k of kayitlar as any[]) {
          k.gorenler = (g ?? []).filter((x: any) => x.kayit_id === k.id).map(({ kayit_id: _i, ...x }: any) => x);
        }
        if (rol === "baskan") {
          const { data: yk } = await db.from("uyeler").select("ad").eq("rol", "yonetim").eq("durum", "onayli").order("ad");
          ykUyeler = (yk ?? []).map((x: any) => x.ad);
        }
      }
      // YK iş emri cevaplarını kimin gördüğü (Yönetim Kurulu bölümündeki herkes görür)
      let cevapKisiler: any[] | undefined;
      if (YONETIM_ISI_GOREN.includes(rol)) {
        const cevapli = (kayitlar as any[]).filter((k) => k.gizli && Array.isArray(k.cevaplar) && k.cevaplar.length);
        if (cevapli.length) {
          const { data: cg } = await db.from("cevap_gorulme").select("kayit_id, sira, ad, rol, ilk_at").in("kayit_id", cevapli.map((k) => k.id)).order("ilk_at");
          for (const k of cevapli) k.cevap_gorenler = (cg ?? []).filter((x: any) => x.kayit_id === k.id).map(({ kayit_id: _i, ...x }: any) => x);
          const { data: kl } = await db.from("uyeler").select("ad, rol, cihaz").in("rol", YONETIM_ISI_GOREN).eq("durum", "onayli");
          const goruldu = new Set<string>();
          cevapKisiler = (kl ?? []).filter((x: any) => !testCihaz(String(x.cihaz)) && !goruldu.has(x.ad) && goruldu.add(x.ad))
            .map(({ ad, rol }: any) => ({ ad, rol }));
        }
      }
      const varsayilan_sure = rol === "baskan" || rol === "yonetim" ? await varsayilanSure() : undefined;
      return { kayitlar: await fotoUrlleri(kayitlar), rol, unvan: (u as any).unvan ?? null, bekleyen, ykUyeler, varsayilan_sure, cevapKisiler, parsel, bekleyenYakinlar,
        yenilikler: await yenilikBul(u, rol).catch(() => []),
        // Yenilikler penceresi ilk kez kurulurken: bu kişinin daha önce açıp gördüğü kayıtlar yeniden gösterilmesin
        gordum: g.ilk ? ((await db.from("goruntulemeler").select("kayit_id, ilk_at").or(`cihaz.eq.${u.cihaz},and(ad.eq."${String(u.ad).replace(/["\\]/g, "")}",rol.eq.${rol})`)).data ?? []) : undefined };
    }

    case "yukleme_adresi": {
      // Duyuru ve restoran paylaşımında PDF de yüklenir; diğer her şey JPEG fotoğraf
      // Duyuru dosyasını yalnızca yönetici yükler
      if (g.tur === "duyuru" || g.tur === "temsilci") yonetici();
      else if (g.tur === "aidat") { if (!AIDAT_EKLEYEN.includes(rol)) throw new Hata("Bu dosyayı yalnızca yönetici yükleyebilir.", 403); }
      else if (g.tur === "restoran") restoranYonetir();
      else if (g.tur === "muhasebe") { if (!MUHASEBE_PAYLASAN.includes(rol)) throw new Hata("Bu dosyayı yalnızca muhasebe yükleyebilir.", 403); }
      else if (g.tur === "devriye") { if (!["baskan", "mudur", "sef"].includes(rol)) throw new Hata("Bu işlem size açık değil.", 403); }
      else if (g.tur !== undefined && g.tur !== null && g.tur !== "") throw new Hata("Geçersiz yükleme türü.");
      const coklu = g.tur === "restoran" || g.tur === "duyuru" || g.tur === "muhasebe";
      const uzanti = coklu && ["jpg", "pdf"].includes(g.uzanti) ? g.uzanti : "jpg";
      const yol = `${g.tur === "aidat" ? "aidat" : g.tur === "temsilci" ? "temsilci" : coklu ? g.tur : g.tur === "devriye" ? "devriye/" + sonGun(new Date(), 0) : new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${uzanti}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(yol);
      if (error) throw error;
      return { yol: data.path, adres: data.signedUrl };
    }

    case "yeni": {
      // Müdür, şef ve muhasebe Saha Takip'e kayıt girmez; yalnızca Yönetim Kurulu bölümünden iş emri verebilir.
      if (["mudur", "sef", "muhasebe"].includes(rol) && !g.gizli) throw new Hata(`${({ mudur: "Müdür", sef: "Şef", muhasebe: "Muhasebe" } as Record<string, string>)[rol]} Saha Takip'e kayıt giremez; Yönetim Kurulu bölümünden iş emri verebilir.`, 403);
      // Ortağın kaydı önce parsel temsilcisinin onayına düşer
      const temsilci = rol === "uye" && (u as any).ortak_no ? await temsilciBul((u as any).ortak_no) : null;
      const kayit = {
        temsilci_id: temsilci?.id ?? null,
        bildiren: u.ad,
        cihaz: u.cihaz,
        yer: temiz(g.yer, 200),
        sorun: temiz(g.sorun),
        foto_once: temiz(g.foto, 200) || null,
        gizli: !!g.gizli && YONETIM_ISI_GIREN.includes(rol),
        // YK iş emrinde süre emri veren tarafından seçilir (1-60 gün); diğer kayıtlarda varsayılan süre
        son_tarih: sonGun(new Date(), !!g.gizli && YONETIM_ISI_GIREN.includes(rol) && !SURE_GORMEYEN.includes(rol) && Number.isInteger(Number(g.sure)) && Number(g.sure) >= 1 && Number(g.sure) <= 60
          ? Number(g.sure) : await varsayilanSure()),
        onay_durumu: temsilci || !onaysizGirer(u) ? "bekliyor" : "onayli",
      };
      if (!kayit.yer || !kayit.sorun) throw new Hata("Yer ve sorun zorunlu.");
      const { data, error } = await db.from("kayitlar").insert(kayit).select().single();
      if (error) throw error;
      if (data.onay_durumu === "bekliyor" && temsilci) {
        if (!testCihaz(u.cihaz)) {
          await temsilciyeBildir(temsilci, `⏳ Onayınızı bekleyen kayıt ${data.no}`, `${u.ad} · ${kayit.yer}: ${kayit.sorun}`.slice(0, 180), { kayitId: data.id });
        }
        const { cihaz: _c, ...donen } = data;
        return { kayit: { ...donen, benim: true }, temsilci_ad: temsilci.ad };
      }
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
      if (rol === "baskan") {
        const { data: kk } = await db.from("kayitlar").select("gizli").eq("id", g.id).maybeSingle();
        if (kk?.gizli) throw new Hata("YK iş emrini yalnızca müdür ya da şef \"Yapıldı\" olarak kapatabilir.", 403);
      }
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
      const { data: k } = await db.from("kayitlar").select("id, created_at, durum, gizli, cihaz, bildiren").eq("id", g.id).maybeSingle();
      if (!k) throw new Hata("Kayıt bulunamadı.");
      if (k.durum === "tamam") throw new Hata("Bu iş zaten yapıldı.");
      // YK iş emrinin süresini yalnızca emri veren değiştirir (yönetici ve diğer YK üyeleri değiştiremez)
      const verenRolu = k.gizli && k.cihaz ? (await db.from("uyeler").select("rol").eq("cihaz", k.cihaz).maybeSingle()).data?.rol : null;
      if (k.gizli && k.cihaz !== u.cihaz && k.bildiren !== u.ad && !SURE_GORMEYEN.includes(verenRolu)) {
        throw new Hata(`Bu YK iş emrinin süresini yalnızca emri veren (${k.bildiren}) değiştirebilir.`, 403);
      }
      const son_tarih = sonGun(k.created_at, gun);
      const { error } = await db.from("kayitlar").update({ son_tarih }).eq("id", k.id);
      if (error) throw error;
      return { son_tarih };
    }

    case "yapildi_goruldu": {
      // Yapılan işi açan ya da yenilik penceresinde gören herkesin ilk görüşü (yönetici "Kimler gördü?" ile bakar)
      const ids = (Array.isArray(g.ids) ? g.ids : [g.id]).map(Number).filter((x: number) => Number.isInteger(x) && x > 0).slice(0, 50);
      if (!ids.length || rol === "baskan") return { tamam: true };
      let q = db.from("kayitlar").select("id").in("id", ids).eq("durum", "tamam");
      if (!YONETIM_ISI_GOREN.includes(rol)) q = q.eq("gizli", false);
      const { data: kk } = await q;
      if (kk?.length) {
        await db.from("yapildi_gorulme").upsert(
          kk.map((k: any) => ({ kayit_id: k.id, cihaz: u.cihaz, ad: u.ad, rol, unvan: u.unvan ?? null })),
          { onConflict: "kayit_id,cihaz", ignoreDuplicates: true },
        );
      }
      return { tamam: true };
    }

    case "yapildi_gorenler": {
      // Yalnızca yönetici: yapılan işi kimler gördü, kimler henüz görmedi
      yonetici();
      const id = Number(g.id);
      const { data: k } = await db.from("kayitlar").select("id, gizli, durum, kapanis_at").eq("id", id).maybeSingle();
      if (!k) throw new Hata("Kayıt bulunamadı.", 404);
      const { data: gr } = await db.from("yapildi_gorulme").select("cihaz, ad, rol, unvan, ilk_at").eq("kayit_id", id).order("ilk_at");
      let uq = db.from("uyeler").select("cihaz, ad, rol, unvan").eq("durum", "onayli").neq("rol", "baskan");
      if (k.gizli) uq = uq.in("rol", YONETIM_ISI_GOREN);
      const { data: uy } = await uq;
      const goren = new Set((gr ?? []).map((x: any) => x.cihaz));
      return {
        gorenler: (gr ?? []).map(({ cihaz: _c, ...x }: any) => x),
        gormeyenler: (uy ?? []).filter((x: any) => !goren.has(x.cihaz)).map(({ cihaz: _c, ...x }: any) => x)
          .sort((a: any, b: any) => String(a.ad).localeCompare(String(b.ad), "tr")),
        kapanis_at: k.kapanis_at,
      };
    }

    case "goruldu": {
      // Müdür, şef, muhasebe ve yönetim kurulunun ilk açışı saklanır; sonraki açışlar ilk zamanı değiştirmez
      if (!["mudur", "sef", "yonetim", "muhasebe"].includes(rol)) return { tamam: true };
      await db.from("goruntulemeler").upsert(
        { kayit_id: Number(g.id), cihaz: u.cihaz, ad: u.ad, rol },
        { onConflict: "kayit_id,cihaz", ignoreDuplicates: true },
      );
      return { tamam: true };
    }

    case "cevap_goruldu": {
      // YK iş emrini açan kişi o ana kadarki cevapları görmüş sayılır; ilk görme zamanı saklanır
      if (!YONETIM_ISI_GOREN.includes(rol)) return { tamam: true };
      const sira = Number(g.sira);
      if (!Number.isInteger(sira) || sira < 1) return { tamam: true };
      await db.from("cevap_gorulme").upsert(
        { kayit_id: Number(g.id), sira, cihaz: u.cihaz, ad: u.ad, rol },
        { onConflict: "kayit_id,sira,cihaz", ignoreDuplicates: true },
      );
      return { tamam: true };
    }

    case "yk_cevap": {
      // YK iş emrine yönetici ya da yönetim kurulu cevap yazar; Yönetim Kurulu bölümündeki herkes görür ve bildirim alır
      ykVeYonetici();
      const metin = temiz(g.metin, 1000);
      if (!metin) throw new Hata("Cevap boş olamaz.");
      const { data: k } = await db.from("kayitlar").select("id, yer, gizli, cevaplar").eq("id", g.id).maybeSingle();
      if (!k || !k.gizli) throw new Hata("YK iş emri bulunamadı.");
      const cevaplar = [...(Array.isArray(k.cevaplar) ? k.cevaplar : []), { ad: u.ad, rol, metin, at: new Date().toISOString() }];
      const { error } = await db.from("kayitlar").update({ cevaplar }).eq("id", k.id);
      if (error) throw error;
      if (!testCihaz(u.cihaz)) {
        await bildir(YONETIM_ISI_GOREN, `💬 YK cevabı • ${k.yer}`.slice(0, 80), `${u.ad}: ${metin}`.slice(0, 200), { kayitId: k.id, haric: u.cihaz });
      }
      return { cevaplar };
    }

    case "temsilci_cevap": {
      // Parsel temsilcisi, parselindeki ortağın kaydına cevap yazar; ortağa bildirim gider
      const metin = temiz(g.metin, 1000);
      if (!metin) throw new Hata("Cevap boş olamaz.");
      const { data: k } = await db.from("kayitlar").select("id, no, yer, cihaz, temsilci_id, temsilci_cevaplari").eq("id", g.id).maybeSingle();
      if (!k || !k.temsilci_id) throw new Hata("Kayıt bulunamadı.");
      const tIds = (await temsilcilikleri(u)).map((t) => t.id);
      if (!tIds.includes(k.temsilci_id)) throw new Hata("Bu kayda yalnızca ortağın parsel temsilcisi cevap yazabilir.", 403);
      const temsilci_cevaplari = [...(Array.isArray(k.temsilci_cevaplari) ? k.temsilci_cevaplari : []), { ad: u.ad, metin, at: new Date().toISOString() }];
      const { error } = await db.from("kayitlar").update({ temsilci_cevaplari }).eq("id", k.id);
      if (error) throw error;
      if (k.cihaz && k.cihaz !== u.cihaz) {
        await duyur({ cihaz: k.cihaz }, `💬 Parsel temsilcinizden cevap ${k.no}`.slice(0, 80), `${u.ad}: ${metin}`.slice(0, 200), { kayitId: k.id });
      }
      return { temsilci_cevaplari };
    }

    case "cevap_ver": {
      // Yönetici ya da yönetim kurulu işi kapatmadan "Bu iş N gün içinde yapılacaktır." der; son gün bugünden sayılır
      ykVeYonetici();
      const gun = Number(g.gun);
      if (!Number.isInteger(gun) || gun < 1 || gun > 60) throw new Hata("Süre 1 ile 60 gün arasında olmalı.");
      const yanitMetni = `Bu iş ${gun} gün içinde yapılacaktır.`;
      const { data, error } = await db.from("kayitlar").update({
        yanit: yanitMetni, yanit_veren: u.ad, yanit_at: new Date().toISOString(), son_tarih: sonGun(new Date(), gun),
      }).eq("id", g.id).neq("durum", "tamam").eq("gizli", false).select().single(); // YK iş emrine cevap yazılmaz
      if (error) throw new Hata("Kayıt bulunamadı, iş zaten yapıldı ya da bu bir YK iş emri.");
      await duyur(kimeBildir(data), `Cevap • ${data.yer}`.slice(0, 80), yanitMetni, { kayitId: data.id });
      return { yanit: data.yanit, yanit_veren: data.yanit_veren, yanit_at: data.yanit_at, son_tarih: data.son_tarih };
    }

    case "gorevler": {
      if (!GOREV_GOREN.includes(rol)) throw new Hata("Görev programını yalnızca yönetici, yönetim kurulu, müdür ve şef görür.", 403);
      const bugun = sonGun(new Date(), 0);
      // Geçmiş günleri yönetici ve yönetim kurulu açabilir; müdür ve şef açamaz
      const gecmisli = rol === "baskan" || rol === "yonetim";
      const gun = gecmisli && /^\d{4}-\d{2}-\d{2}$/.test(String(g.gun ?? "")) && g.gun <= bugun ? String(g.gun) : bugun;
      return { ...(await gorevDurumu(gun, gecmisli)), isaretleyebilir: GOREV_ISARETLEYEN.includes(rol), devriye: await devriyeVerisi(gun, u) };
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
      return { ...(await gorevDurumu(bugun)), isaretleyebilir: true, devriye: await devriyeVerisi(bugun, u) };
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
      // Ortağın kaydını yalnızca kendi parsel temsilcisi onaylar
      await onayYetkisi(g.id);
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
      await onayYetkisi(g.id);
      const { data: k } = await db.from("kayitlar").select("id, no, yer, cihaz, foto_once, onay_durumu, temsilci_id, temsilci_cevaplari").eq("id", g.id).maybeSingle();
      if (!k || k.onay_durumu !== "bekliyor") throw new Hata("Kayıt bulunamadı ya da zaten onaylanmış.");
      if (k.foto_once) await db.storage.from(BUCKET).remove([k.foto_once]);
      await db.from("kayitlar").delete().eq("id", k.id);
      // Temsilci reddettiyse kaydı yazan ortağa haber verilir; reddederken yazdığı cevap (yoksa son cevabı) da gider
      if (k.temsilci_id && k.cihaz && k.cihaz !== u.cihaz) {
        const onceki = Array.isArray(k.temsilci_cevaplari) ? k.temsilci_cevaplari.at(-1)?.metin : "";
        const cevap = temiz(g.metin, 1000) || onceki || "";
        await duyur({ cihaz: k.cihaz }, `❌ Kaydınız reddedildi ${k.no}`.slice(0, 80),
          (cevap ? `${k.yer}: Parsel temsilciniz ${u.ad} kaydınızı reddetti. Cevabı: ${cevap}`
            : `${k.yer}: Parsel temsilciniz ${u.ad} kaydınızı reddetti. Kendisiyle görüşebilirsiniz.`).slice(0, 240), { sayfa: "parsel" });
      }
      return { tamam: true };
    }

    case "plaka_bilgi": {
      // Formda ortaklık numarası / telefon sorulacak mı (kayıtta ya da önceki bildirimde yoksa)
      if (!PLAKA_BILDIREN(u, rol)) throw new Hata("Plaka-Kimlik Bildirimini ortaklar, TG ve YK üyeleri yapar.", 403);
      const k = await plakaKimlik(u, rol), uu = u as any;
      return { ...k, degisir: !uu.ortak_no && rol !== "baskan" };
    }

    case "plaka_talebi": {
      // Ortak (ya da ortağın yakını), TG ve YK üyesi, yönetici kendi aracının ya da yakınının aracının plakasını kooperatife bildirir
      const uu = u as any;
      if (!PLAKA_BILDIREN(u, rol)) throw new Hata("Plaka-Kimlik Bildirimini ortaklar, TG ve YK üyeleri yapar.", 403);
      const arac = g.arac === "yakin" ? "yakin" : g.arac === "kendi" ? "kendi" : "";
      if (!arac) throw new Hata("Önce kendi aracınız mı, yakınınızın aracı mı olduğunu seçin.");
      // "34abc123" → "34 ABC 123": rakam ve harf grupları arasına boşluk
      const plaka = (temiz(g.plaka, 20).toLocaleUpperCase("tr").replace(/[^0-9A-ZÇĞİÖŞÜ]+/g, "").match(/\d+|[A-ZÇĞİÖŞÜ]+/g) ?? []).join(" ");
      if (plaka.replace(/\s/g, "").length < 4 || !/\d/.test(plaka) || !/[A-ZÇĞİÖŞÜ]/.test(plaka)) throw new Hata("Plaka numarasını doğru yazın (örn. 34 ABC 123).");
      // Ad: yakının aracında yakının adı; ortak yakını kendi aracını bildiriyorsa kendi adı (kaydında ortağın adı durur)
      const yakinKayitli = /Yakını/.test(uu.unvan ?? "");
      const adGerek = arac === "yakin" || yakinKayitli;
      const sahibi = adGerek ? temiz(g.arac_sahibi, 80).replace(/\s+/g, " ") : "";
      if (adGerek && sahibi.split(" ").filter(Boolean).length < 2) throw new Hata(arac === "yakin" ? "Aracın sahibi olan yakınınızın adını ve soyadını yazın." : "Adınızı ve soyadınızı yazın.");
      // Telefon yalnızca yakının aracında sorulur (yakınınki); kendi aracında kayıttaki telefon kullanılır
      let sahibiTel = "";
      if (arac === "yakin") {
        sahibiTel = telDuzelt(temiz(g.arac_sahibi_tel, 30));
        if (!sahibiTel) throw new Hata("Yakınınızın cep telefonu numarasını doğru yazın (örn. 0532 123 45 67).");
      }
      // Daire = bildirimi yapanın ortaklık numarası. Ortakta ve yöneticide kayıttan alınır;
      // TG ve YK üyesi ilk bildirimde yazar (sonra hatırlanır, isterse değiştirir)
      let { no: kayitNo, tel: kayitTel } = await plakaKimlik(u, rol);
      if (!uu.ortak_no && rol !== "baskan") {
        if (String(g.daire ?? "").trim()) {
          const n = Number(String(g.daire).replace(/\D/g, ""));
          if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Hata("Ortaklık numaranızı doğru yazın (örn. 12).");
          kayitNo = n;
        }
        if (String(g.kendi_tel ?? "").trim()) {
          kayitTel = telDuzelt(temiz(g.kendi_tel, 30));
          if (!kayitTel) throw new Hata("Cep telefonunuzu doğru yazın (örn. 0532 123 45 67).");
        }
      }
      if (!kayitNo) throw new Hata("Ortaklık numaranızı yazın.");
      if (arac === "kendi" && !kayitTel) throw new Hata("Cep telefonunuzu yazın.");
      const kimlik = uu.ortak_no ? `${uu.ortak_no} No'lu Ortak` : `${uu.unvan || ROL_ADI[rol]}, ${kayitNo} No'lu Ortak`;
      const { data: t, error } = await db.from("plaka_talepleri").insert({
        cihaz: u.cihaz, ad: u.ad, ortak_no: kayitNo, telefon: kayitTel, arac, plaka, arac_sahibi: sahibi || null, arac_sahibi_tel: sahibiTel || null,
      }).select("id, created_at").single();
      if (error) throw error;
      const konu = `Plaka-Kimlik Bildirimi: ${plaka} (${kimlik})`;
      // E-postadaki sıra kooperatifin araç listesiyle aynı: Plaka, Adı, Soyadı, Gsm, Daire
      const kelimeler = (adGerek ? sahibi : u.ad.replace(/\s*\(yakını\)$/i, "")).split(/\s+/).filter(Boolean)
        .map((k: string) => k.charAt(0).toLocaleUpperCase("tr") + k.slice(1).toLocaleLowerCase("tr"));
      const soyad = kelimeler.length > 1 ? kelimeler.pop() : "";
      const metin = [
        `Plaka: ${plaka.replace(/\s/g, "")}`,
        `Adı: ${kelimeler.join(" ")}`,
        `Soyadı: ${soyad || "-"}`,
        `Gsm: ${(arac === "yakin" ? sahibiTel : kayitTel ?? "-").replace(/\s/g, "")}`,
        `Daire: ${kayitNo ? `SPORKENT${String(kayitNo).padStart(3, "0")}` : "-"}`,
        "",
        `Araç: ${arac === "kendi" ? "Bildirenin kendi aracı" : "Bildirenin yakınının aracı"}`,
        `Bildiren: ${u.ad} (${uu.unvan ?? kimlik})`,
        `SPORKENT ASİSTAN · Talep no: ${t.id} · ${new Date(t.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`,
      ].join("\n");
      const gitti = await epostaGonder(PLAKA_EPOSTA, konu, metin);
      if (gitti) await db.from("plaka_talepleri").update({ eposta_gitti: true }).eq("id", t.id);
      await duyur(["baskan", "muhasebe"], "🚗 Plaka-Kimlik Bildirimi", `${plaka} · ${u.ad} (${kimlik})${arac === "yakin" ? " · yakınının aracı" : ""}`);
      return { tamam: true, eposta: gitti, kime: PLAKA_EPOSTA, konu, metin, no: kayitNo, tel: kayitTel };
    }

    case "yakin_onayla":
    case "yakin_reddet": {
      // Katılım başvurusunu (ortak ya da yakını) parselin temsilcisi onaylar / reddeder; temsilci yoksa yönetici
      const hedef = temiz(g.hedef, 80);
      const { data: y } = await db.from("uyeler").select("cihaz, ad, rol, ortak_no, unvan, durum").eq("cihaz", hedef).maybeSingle();
      if (!y || !katilimBasvurusu(y) || y.durum !== "bekliyor") throw new Hata("Başvuru bulunamadı ya da zaten sonuçlandı.");
      const temsilciVar = aralikta(await temsilciAraliklari(), y.ortak_no);
      if (temsilciVar) {
        const temsil = await temsilcilikleri(u);
        if (!temsil.some((t) => y.ortak_no >= t.no_bas && y.ortak_no <= t.no_bit)) throw new Hata("Bu başvuruyu yalnızca ortağın parsel temsilcisi onaylar.", 403);
      } else if (rol !== "baskan") throw new Hata("Bu parselde temsilci olmadığından başvuruyu yönetici onaylar.", 403);
      if (eylem === "yakin_onayla") {
        const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "onayli");
        if ((count ?? 0) >= MAKS_UYE) throw new Hata(`Grup dolu (${MAKS_UYE} kişi).`);
        await db.from("uyeler").update({ durum: "onayli", onay_at: new Date().toISOString() }).eq("cihaz", hedef);
        await duyur({ cihaz: hedef }, "Gruba kabul edildiniz", "SPORKENT ASİSTAN uygulamasını kullanmaya başlayabilirsiniz.");
        // Temsilci onayladıysa yönetici de haberdar olur (yöneticinin kendi onayında gerek yok)
        if (rol !== "baskan" && !testCihaz(u.cihaz)) await katildiBildir(y.ad, `${/Yakını/.test(y.unvan ?? "") ? `${y.ortak_no} No'lu ortağın yakını` : `${y.ortak_no} No'lu Ortak`}, temsilci ${u.ad} onayladı`);
      } else {
        await db.from("abonelikler").delete().eq("cihaz", hedef);
        await db.from("uyeler").delete().eq("cihaz", hedef);
      }
      return { tamam: true };
    }

    case "temsilci_resim": {
      // Parsel temsilcisinin resmini yalnızca yönetici ekler / değiştirir
      yonetici();
      const yol = temiz(g.yol, 200);
      if (!yol.startsWith("temsilci/")) throw new Hata("Resim yüklenemedi, tekrar deneyin.");
      const { data: t } = await db.from("parsel_temsilcileri").select("id, resim").eq("id", g.id).maybeSingle();
      if (!t) throw new Hata("Parsel temsilcisi bulunamadı.");
      await db.from("parsel_temsilcileri").update({ resim: yol }).eq("id", t.id);
      if (t.resim) await db.storage.from(BUCKET).remove([t.resim]);
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
      if (!AIDAT_EKLEYEN.includes(rol)) throw new Hata("Aidat resmini yalnızca yönetici ekler.", 403);
      const yol = temiz(g.yol, 200);
      if (!yol.startsWith("aidat/")) throw new Hata("Resim yüklenemedi, tekrar deneyin.");
      const baslik = temiz(g.baslik, 120);
      const { error } = await db.from("aidat_resimleri").insert({ yol, baslik: baslik || null, ekleyen: u.ad });
      if (error) throw error;
      await duyur("hepsi", "💳 Aidat bilgisi eklendi", `${baslik || "Yıl içindeki ödemeler güncellendi."} Aidat bölümünden bakabilirsiniz.`, { sayfa: "aidat" });
      return { tamam: true };
    }

    case "aidat_sil": {
      if (!AIDAT_EKLEYEN.includes(rol)) throw new Hata("Aidat resmini yalnızca yönetici siler.", 403);
      const { data: x } = await db.from("aidat_resimleri").select("id, yol").eq("id", g.id).maybeSingle();
      if (!x) throw new Hata("Resim bulunamadı.");
      await db.storage.from(BUCKET).remove([x.yol]);
      await db.from("aidat_resimleri").delete().eq("id", x.id);
      return { tamam: true };
    }

    // ---------- Restoran: paylaşımlar (görsel, metin, PDF) ve sipariş telefonu ----------
    // ---------- Duyurular: yalnızca yönetici paylaşır, herkes görür, her paylaşım herkese bildirilir ----------
    case "duyuru_liste": {
      const { data, error } = await db.from("restoran_paylasim").select("*").eq("bolum", "duyuru").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const yollar = (data ?? []).map((x: any) => x.yol).filter(Boolean);
      const { data: u2 } = yollar.length ? await db.storage.from(BUCKET).createSignedUrls(yollar, 60 * 60 * 6) : { data: [] };
      const harita = new Map((u2 ?? []).map((d: any) => [d.path, d.signedUrl]));
      return {
        paylasimlar: (data ?? []).map((x: any) => ({ id: x.id, tur: x.tur, metin: x.metin, created_at: x.created_at,
          ekleyen: "Kooperatif Yönetimi", url: x.yol ? harita.get(x.yol) ?? null : null })),
        yonetir: rol === "baskan",
      };
    }

    case "duyuru_paylas": {
      yonetici();
      const tur = ["gorsel", "metin", "pdf"].includes(g.tur) ? g.tur : "";
      if (!tur) throw new Hata("Duyuru türünü seçin.");
      const metin = temiz(g.metin, 3000);
      const yol = tur === "metin" ? null : temiz(g.yol, 200);
      if (tur === "metin" && !metin) throw new Hata("Duyuru metnini yazın.");
      if (tur !== "metin" && !yol?.startsWith("duyuru/")) throw new Hata("Dosya yüklenemedi, tekrar deneyin.");
      const { data: p, error } = await db.from("restoran_paylasim").insert({ bolum: "duyuru", tur, metin: metin || null, yol, ekleyen: u.ad, rol, cihaz: u.cihaz }).select("id").single();
      if (error) throw error;
      let resim: string | null = null;
      if (tur === "gorsel" && yol) { const { data: s } = await db.storage.from(BUCKET).createSignedUrl(yol, 60 * 60 * 24); resim = s?.signedUrl ?? null; }
      const ek = { gorsel: " (görsel)", metin: "", pdf: " (PDF)" }[tur as "gorsel"];
      // Gönderen yönetici de alır: duyurunun gittiğini kendi telefonunda görür
      const giden = await duyur("hepsi", `📢 Duyuru${ek}`, (metin || "Duyurular bölümünde yeni bir duyuru var.").slice(0, 180), { sayfa: "duyuru", resim });
      return { id: p.id, ...giden };
    }

    case "duyuru_sil": {
      yonetici();
      const { data: x } = await db.from("restoran_paylasim").select("id, yol").eq("id", g.id).eq("bolum", "duyuru").maybeSingle();
      if (!x) throw new Hata("Duyuru bulunamadı.");
      if (x.yol) await db.storage.from(BUCKET).remove([x.yol]);
      await db.from("restoran_paylasim").delete().eq("id", x.id);
      return { tamam: true };
    }

    // ---------- Kullanım: bölüm açılışlarını sayar; rapor yalnızca yöneticide ----------
    case "kullanim": {
      const bolum = temiz(g.bolum, 30);
      if (KULLANIM_BOLUMLERI.includes(bolum) && bolum !== "acilis") await db.rpc("kullanim_say", { p_cihaz: u.cihaz, p_bolum: bolum });
      return { tamam: true };
    }

    case "kullanim_raporu": {
      yonetici();
      const gun = [1, 7, 30, 90, 365].includes(Number(g.gun)) ? Number(g.gun) : 30;
      const simdi = Date.now();
      const bas = new Date(simdi + 3 * 3600e3 - (gun - 1) * 86400e3).toISOString().slice(0, 10); // Türkiye günü
      const { data: uy, error } = await db.from("uyeler").select("cihaz, ad, rol, unvan, durum, created_at, son_gorulme, kurulu").neq("durum", "cikarildi");
      if (error) throw error;
      const kisiler = (uy ?? []).filter((x: any) => !testCihaz(x.cihaz));
      const { data: ab } = await db.from("abonelikler").select("cihaz");
      const aboneler = new Set((ab ?? []).map((x: any) => x.cihaz));
      // Kullanım satırları sayfa sayfa okunur
      let ku: any[] = [];
      for (let i = 0; ; i += 1000) {
        const { data: p, error: e2 } = await db.from("kullanim").select("cihaz, bolum, sayi").gte("gun", bas).range(i, i + 999);
        if (e2) throw e2;
        ku = ku.concat(p ?? []);
        if ((p ?? []).length < 1000) break;
      }
      ku = ku.filter((x) => !testCihaz(x.cihaz));
      const bolumler: Record<string, { acilis: number; kisi: Set<string> }> = {};
      const kisiAcilis = new Map<string, number>(), kisiBolum = new Map<string, Record<string, number>>();
      for (const x of ku) {
        if (x.bolum === "acilis") { kisiAcilis.set(x.cihaz, (kisiAcilis.get(x.cihaz) ?? 0) + x.sayi); continue; }
        if (x.bolum === "ana") continue;
        (bolumler[x.bolum] ??= { acilis: 0, kisi: new Set() }).acilis += x.sayi;
        bolumler[x.bolum].kisi.add(x.cihaz);
        const kb = kisiBolum.get(x.cihaz) ?? {}; kb[x.bolum] = (kb[x.bolum] ?? 0) + x.sayi; kisiBolum.set(x.cihaz, kb);
      }
      const once = (s: number) => kisiler.filter((x: any) => x.durum === "onayli" && x.son_gorulme && simdi - Date.parse(x.son_gorulme) < s * 3600e3).length;
      return {
        gun,
        ozet: {
          kayitli: kisiler.filter((x: any) => x.durum === "onayli").length,
          bekleyen: kisiler.filter((x: any) => x.durum === "bekliyor").length,
          kurulu: kisiler.filter((x: any) => x.durum === "onayli" && x.kurulu).length,
          bildirim: kisiler.filter((x: any) => x.durum === "onayli" && aboneler.has(x.cihaz)).length,
          aktif_24s: once(24), aktif_7g: once(24 * 7), aktif_30g: once(24 * 30),
          donemde_acan: kisiAcilis.size,
          acilis: [...kisiAcilis.values()].reduce((a, b) => a + b, 0),
        },
        roller: Object.entries(kisiler.filter((x: any) => x.durum === "onayli").reduce((m: Record<string, number>, x: any) => {
          const un = x.unvan ?? "";
          const k = /Yakını/.test(un) ? "Ortak yakını" : /No'lu Ortak$/.test(un) ? "Ortak" : un || (ROL_ADI[x.rol as Rol] ?? x.rol);
          m[k] = (m[k] ?? 0) + 1; return m;
        }, {})).sort((a, b) => b[1] - a[1]),
        bolumler: Object.entries(bolumler).map(([b, v]) => ({ bolum: b, acilis: v.acilis, kisi: v.kisi.size })).sort((a, b) => b.acilis - a.acilis),
        kisiler: kisiler.filter((x: any) => x.durum === "onayli")
          .map((x: any) => {
            const kb = kisiBolum.get(x.cihaz) ?? {};
            const enCok = Object.entries(kb).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
            return { ad: x.ad, unvan: x.unvan ?? ROL_ADI[x.rol as Rol] ?? x.rol, son_gorulme: x.son_gorulme, kayit: x.created_at,
              kurulu: !!x.kurulu, bildirim: aboneler.has(x.cihaz), acilis: kisiAcilis.get(x.cihaz) ?? 0, en_cok: enCok };
          })
          .sort((a: any, b: any) => (Date.parse(b.son_gorulme ?? 0) || 0) - (Date.parse(a.son_gorulme ?? 0) || 0)),
      };
    }

    // ---------- Muhasebe: yönetim görür; muhasebe ve yönetici paylaşır (görsel, metin, PDF) ----------
    case "muhasebe_liste": {
      if (!MUHASEBE_GOREN.includes(rol)) throw new Hata("Muhasebe bölümünü yalnızca yönetici, yönetim kurulu ve muhasebe görür.", 403);
      const { data, error } = await db.from("restoran_paylasim").select("*").eq("bolum", "muhasebe").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const yollar = (data ?? []).map((x: any) => x.yol).filter(Boolean);
      const { data: u2 } = yollar.length ? await db.storage.from(BUCKET).createSignedUrls(yollar, 60 * 60 * 6) : { data: [] };
      const harita = new Map((u2 ?? []).map((d: any) => [d.path, d.signedUrl]));
      return {
        paylasimlar: (data ?? []).map((x: any) => ({ id: x.id, tur: x.tur, metin: x.metin, created_at: x.created_at,
          ekleyen: x.rol === "baskan" ? "Kooperatif Yönetimi" : "Muhasebe", url: x.yol ? harita.get(x.yol) ?? null : null })),
        yonetir: MUHASEBE_PAYLASAN.includes(rol),
        silebilir: MUHASEBE_SILEN.includes(rol),
        masraf: await masrafDurumu(),
      };
    }

    case "muhasebe_paylas": {
      if (!MUHASEBE_PAYLASAN.includes(rol)) throw new Hata("Muhasebe bölümünde yalnızca muhasebe paylaşım yapar.", 403);
      const tur = ["gorsel", "metin", "pdf"].includes(g.tur) ? g.tur : "";
      if (!tur) throw new Hata("Paylaşım türünü seçin.");
      const masraf = !!g.masraf;
      const ek = temiz(g.metin, 2900);
      // Masraf listesinin başlığı sunucuda yazılır: "Aylık Masraflar Listesi · Kasım 2026"
      const metin = masraf ? `${MASRAF_BASLIK} · ${oncekiAyAdi(sonGun(new Date(), 0))}${ek ? "\n" + ek : ""}` : ek;
      const yol = tur === "metin" ? null : temiz(g.yol, 200);
      if (tur === "metin" && !metin) throw new Hata("Paylaşılacak metni yazın.");
      if (tur !== "metin" && !yol?.startsWith("muhasebe/")) throw new Hata("Dosya yüklenemedi, tekrar deneyin.");
      const { data: p, error } = await db.from("restoran_paylasim").insert({ bolum: "muhasebe", tur, metin: metin || null, yol, ekleyen: u.ad, rol, cihaz: u.cihaz }).select("id").single();
      if (error) throw error;
      const ad = { gorsel: "📷 Yeni görsel", metin: "📝 Yeni not", pdf: "📄 Yeni PDF" }[tur as "gorsel"];
      let resim: string | null = null;
      if (tur === "gorsel" && yol) { const { data: s } = await db.storage.from(BUCKET).createSignedUrl(yol, 60 * 60 * 24); resim = s?.signedUrl ?? null; }
      const giden = await duyur(MUHASEBE_GOREN, masraf ? "📋 Aylık Masraflar Listesi paylaşıldı" : `🧾 Muhasebe: ${ad}`, (metin || "Muhasebe bölümünde yeni bir paylaşım var.").slice(0, 180), { sayfa: "muhasebe", resim });
      return { id: p.id, ...giden };
    }

    case "muhasebe_sil": {
      if (!MUHASEBE_SILEN.includes(rol)) throw new Hata("Yalnızca muhasebe ve yönetici silebilir.", 403);
      const { data: x } = await db.from("restoran_paylasim").select("id, yol").eq("id", g.id).eq("bolum", "muhasebe").maybeSingle();
      if (!x) throw new Hata("Paylaşım bulunamadı.");
      if (x.yol) await db.storage.from(BUCKET).remove([x.yol]);
      await db.from("restoran_paylasim").delete().eq("id", x.id);
      return { tamam: true };
    }

    case "restoran_liste": {
      const { data, error } = await db.from("restoran_paylasim").select("*").eq("bolum", "restoran").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const yollar = (data ?? []).map((x: any) => x.yol).filter(Boolean);
      const { data: u2 } = yollar.length ? await db.storage.from(BUCKET).createSignedUrls(yollar, 60 * 60 * 6) : { data: [] };
      const harita = new Map((u2 ?? []).map((d: any) => [d.path, d.signedUrl]));
      const { data: ayar } = await db.from("ayarlar").select("deger").eq("ad", "restoran_tel").maybeSingle();
      return {
        paylasimlar: (data ?? []).map((x: any) => ({ id: x.id, tur: x.tur, metin: x.metin, created_at: x.created_at,
          ekleyen: x.rol === "baskan" ? "Kooperatif Yönetimi" : "Restoran", url: x.yol ? harita.get(x.yol) ?? null : null })),
        tel: ayar?.deger ?? "",
        yonetir: rol === "baskan" || rol === "restoran",
      };
    }

    case "restoran_paylas": {
      restoranYonetir();
      const tur = ["gorsel", "metin", "pdf"].includes(g.tur) ? g.tur : "";
      if (!tur) throw new Hata("Paylaşım türünü seçin.");
      const metin = temiz(g.metin, 3000);
      const yol = tur === "metin" ? null : temiz(g.yol, 200);
      if (tur === "metin" && !metin) throw new Hata("Paylaşılacak metni yazın.");
      if (tur !== "metin" && !yol?.startsWith("restoran/")) throw new Hata("Dosya yüklenemedi, tekrar deneyin.");
      const { data: p, error } = await db.from("restoran_paylasim").insert({ tur, metin: metin || null, yol, ekleyen: u.ad, rol, cihaz: u.cihaz }).select("id").single();
      if (error) throw error;
      // Uygulamayı kullanan herkese (ortak yakınları dahil) sesli bildirim; görselde resim de görünür
      const ad = { gorsel: "📷 Yeni görsel", metin: "📝 Yeni duyuru", pdf: "📄 Yeni PDF" }[tur as "gorsel"];
      let resim: string | null = null;
      if (tur === "gorsel" && yol) { const { data: s } = await db.storage.from(BUCKET).createSignedUrl(yol, 60 * 60 * 24); resim = s?.signedUrl ?? null; }
      // Paylaşan kişi de alır: paylaşımın gittiğini kendi telefonunda görür
      const giden = await duyur("hepsi", `🍽️ Restoran: ${ad}`, (metin || "Restoran bölümünde yeni bir paylaşım var.").slice(0, 180), { sayfa: "restoran", resim });
      return { id: p.id, ...giden };
    }

    case "restoran_sil": {
      // Restoran yetkilisi ve yönetici her paylaşımı silebilir
      restoranYonetir();
      const { data: x } = await db.from("restoran_paylasim").select("id, yol").eq("id", g.id).eq("bolum", "restoran").maybeSingle();
      if (!x) throw new Hata("Paylaşım bulunamadı.");
      if (x.yol) await db.storage.from(BUCKET).remove([x.yol]);
      await db.from("restoran_paylasim").delete().eq("id", x.id);
      return { tamam: true };
    }

    case "restoran_tel": {
      restoranYonetir();
      const ham = temiz(g.tel, 30);
      let d = ham.replace(/\D/g, "");
      if (d.startsWith("90") && d.length === 12) d = d.slice(2); else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
      if (!/^[2-5]\d{9}$/.test(d)) throw new Hata("Telefon numarasını doğru yazın (örn. 0532 123 45 67).");
      const tel = `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
      await db.from("ayarlar").upsert({ ad: "restoran_tel", deger: tel });
      return { tel };
    }

    // ---------- Yönetim iş programı (takvim) ----------
    case "program_liste": {
      if (!PROGRAM_GIREN.includes(rol)) throw new Hata("İş programını yalnızca yönetici, yönetim kurulu, müdür ve şef görür.", 403);
      const tarihMi = (x: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(x ?? ""));
      const bas = tarihMi(g.bas) ? String(g.bas) : sonGun(new Date(), -40);
      const bit = tarihMi(g.bit) ? String(g.bit) : sonGun(new Date(), 40);
      // Tekrarlayanlar başlangıç gününden sonra her dönemde görünür; tek seferlikler yalnızca kendi gününde
      const { data, error } = await db.from("is_programi").select("id, tarih, saat, tekrar, baslik, aciklama, ekleyen, cihaz, created_at, yapildi_at, yapildi_gun, yapan")
        .lte("tarih", bit).or(`tekrar.neq.yok,tarih.gte.${bas}`).order("tarih").limit(1000);
      if (error) throw error;
      return { kayitlar: (data ?? []).map(({ cihaz: c, ...x }: any) => ({ ...x, silebilir: rol === "baskan" || c === u.cihaz })) };
    }

    case "program_ekle": {
      if (!PROGRAM_GIREN.includes(rol)) throw new Hata("İş programına yalnızca yönetici, yönetim kurulu, müdür ve şef girer.", 403);
      const tarih = String(g.tarih ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new Hata("Tarih seçin.");
      const tekrar: string = ["yok", "gunluk", "haftalik", "aylik", "hafta"].includes(g.tekrar) ? g.tekrar : "yok";
      const saat = /^\d{2}:\d{2}$/.test(String(g.saat ?? "")) ? String(g.saat) : null;
      const baslik = temiz(g.baslik, 1000);
      if (!baslik) throw new Hata("Yapılacak işi yazın.");
      const { error } = await db.from("is_programi").insert({
        tarih, saat, tekrar, baslik, aciklama: temiz(g.aciklama) || null, ekleyen: u.ad, cihaz: u.cihaz, rol,
      });
      if (error) throw error;
      const ne: Record<string, string> = { yok: "", gunluk: " (her gün)", haftalik: " (her hafta)", aylik: " (her ay)", hafta: " (bu hafta, pazar hariç her gün)" };
      const [y, a, gn] = tarih.split("-");
      await duyur(PROGRAM_GIREN, "📅 İş programına eklendi", `${gn}.${a}.${y}${saat ? " " + saat : ""}${ne[tekrar]}: ${baslik} · ${u.ad}`.slice(0, 180), { sayfa: "program" });
      return { tamam: true };
    }

    case "program_yapildi": {
      // Tek günlük ya da "bu hafta" işi yapıldı: o güne yazılır, haftanın diğer günlerinden kalkar
      if (!PROGRAM_GIREN.includes(rol)) throw new Hata("Yetkiniz yok.", 403);
      const geri = !!g.geri;
      const { data: x } = await db.from("is_programi").select("id, tekrar, baslik, yapildi_at, yapan_cihaz").eq("id", g.id).maybeSingle();
      if (!x) throw new Hata("Kayıt bulunamadı.");
      if (!["yok", "hafta"].includes(x.tekrar)) throw new Hata("Her gün / her hafta tekrarlanan işler “Yapıldı” yapılamaz.");
      if (geri) {
        if (!x.yapildi_at) return { tamam: true };
        if (rol !== "baskan" && x.yapan_cihaz !== u.cihaz) throw new Hata("“Yapıldı”yı yalnızca işaretleyen kişi ya da yönetici geri alabilir.", 403);
        await db.from("is_programi").update({ yapildi_at: null, yapildi_gun: null, yapan: null, yapan_cihaz: null }).eq("id", x.id);
        return { tamam: true };
      }
      if (x.yapildi_at) throw new Hata("Bu iş zaten yapıldı olarak işaretlenmiş.");
      await db.from("is_programi").update({ yapildi_at: new Date().toISOString(), yapildi_gun: sonGun(new Date(), 0), yapan: u.ad, yapan_cihaz: u.cihaz }).eq("id", x.id);
      await duyur(PROGRAM_GIREN, "✅ İş programında yapıldı", `${x.baslik} · ${u.ad}`.slice(0, 180), { sayfa: "program", haric: u.cihaz });
      return { tamam: true };
    }

    // ---------- Aylık Faaliyet Raporu (yalnızca yönetici) ----------
    case "faaliyet_raporlari": {
      yonetici();
      const { data } = await db.from("faaliyet_raporlari").select("ay, yol, is_sayisi, program_sayisi, olusturma").order("ay", { ascending: false }).limit(60);
      const liste = await Promise.all((data ?? []).map(async (r: any) =>
        ({ ay: r.ay, is_sayisi: r.is_sayisi, program_sayisi: r.program_sayisi, olusturma: r.olusturma, linkler: await raporLinkleri(r.ay) })));
      return { raporlar: liste, bu_ay: sonGun(new Date(), 0).slice(0, 7) };
    }

    case "faaliyet_raporu_hazirla": {
      yonetici();
      const buAy = sonGun(new Date(), 0).slice(0, 7);
      const ay = /^\d{4}-\d{2}$/.test(String(g.ay ?? "")) ? String(g.ay) : buAy;
      if (ay > buAy) throw new Hata("Gelecek ayın raporu hazırlanamaz.");
      const r = await aylikRaporHazirla(ay, false);
      return { ay: r.ay, ayAdi: r.ayAdi, is_sayisi: r.is_sayisi, program_sayisi: r.program_sayisi, linkler: await raporLinkleri(ay) };
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
      let { data, error } = await db.from("uyeler")
        .select("cihaz, ad, rol, unvan, durum, ortak_no, telefon, davetli_at, created_at, onay_at, son_gorulme, bildirim_izni").order("created_at", { ascending: false });
      if (error) throw error;
      const { data: ab } = await db.from("abonelikler").select("cihaz");
      const aboneler = new Set((ab ?? []).map((x: any) => x.cihaz));
      // Parselinde temsilci olan bekleyen başvurular yöneticinin listesine gelmez (onay / ret temsilcinin)
      const uyeAr = await temsilciAraliklari();
      data = (data ?? []).filter((x: any) => !temsilciOnaylar(x, uyeAr));
      // Ortak başvurusunu resmi ortak listesiyle karşılaştır: aynı ortak no + listedeki telefonlardan biri
      const nolar = [...new Set((data ?? []).map((x: any) => x.ortak_no).filter(Boolean))];
      const { data: rehber } = nolar.length ? await db.from("ortak_rehberi").select("no, ad_ozet, tel_ozetleri").in("no", nolar) : { data: [] };
      const rh = new Map((rehber ?? []).map((r: any) => [r.no, r]));
      const liste = await Promise.all((data ?? []).map(async (x: any) => ({
        ...x,
        eslesme: x.ortak_no ? await listeyleKarsilastir(rh.get(x.ortak_no), x.ad, x.telefon) : undefined,
        bildirim: aboneler.has(x.cihaz), ben: x.cihaz === u.cihaz,
      })));
      return { uyeler: liste };
    }

    case "rehber_ara": {
      // Yönetici davet için ortak numarasıyla ya da telefonla arar. Listede telefon okunabilir değil;
      // yazılan telefonun özeti çıkarılıp listedeki özetlerle karşılaştırılır.
      yonetici();
      // İsimle: yazılan her kelime (ad, soyad) listedeki kelime özetleriyle karşılaştırılır; kelimenin tamamı yazılmalı
      const ham = temiz(g.q, 60);
      const q = ham.replace(/\D/g, "");
      const kelimeler = /\p{L}/u.test(ham) ? adNorm(ham.replace(/[^\p{L}\s]/gu, " ")).split(" ").filter(Boolean) : [];
      if (!kelimeler.length && !q) return { sonuc: [] };
      const { data, error } = kelimeler.length
        ? await db.from("ortak_rehberi").select("no").contains("kelime_ozetleri", await Promise.all(kelimeler.map(rehberOzeti))).order("no").limit(30)
        : q.length >= 7
        ? await db.from("ortak_rehberi").select("no").contains("tel_ozetleri", [await rehberOzeti(telNorm(q))]).order("no")
        : await db.from("ortak_rehberi").select("no").eq("no", Number(q));
      if (error) throw error;
      const nolar = (data ?? []).map((r: any) => r.no);
      const { data: kayitli } = nolar.length
        ? await db.from("uyeler").select("ortak_no, durum").in("ortak_no", nolar).neq("durum", "cikarildi")
        : { data: [] };
      const durum = new Map((kayitli ?? []).map((k: any) => [k.ortak_no, k.durum]));
      return { sonuc: (data ?? []).map((r: any) => ({ ...r, durum: durum.get(r.no) ?? null })) };
    }

    case "tur_basla": {
      if (!DEVRIYE_ISARETLEYEN.includes(rol)) throw new Hata("Devriyeyi yalnızca müdür ve şef başlatır.", 403);
      const m = await mesaiAraligi();
      if (!mesaiIcinde(m)) throw new Hata(`Devriye yalnızca mesai saatlerinde (${m.metin}) başlatılabilir.`, 403);
      await acikTurlariKapat().catch(() => {});
      const { data: acik } = await db.from("devriye_turlari").select("*").eq("cihaz", u.cihaz).is("bitis", null).maybeSingle();
      if (acik) return { tur: acik, devam: true };
      const { data, error } = await db.from("devriye_turlari").insert({ cihaz: u.cihaz, ad: u.ad, rol, gun: sonGun(new Date(), 0), cihaz_turu: temiz(g.cihaz_turu, 60) || null }).select().single();
      if (error) throw error;
      return { tur: data };
    }

    case "tur_nokta": {
      // Telefonda biriken konum noktaları topluca gelir (internet kesilirse sonradan)
      if (!DEVRIYE_ISARETLEYEN.includes(rol)) throw new Hata("Yetkisiz.", 403);
      const { data: tur } = await db.from("devriye_turlari").select("*").eq("id", Number(g.tur_id)).eq("cihaz", u.cihaz).maybeSingle();
      if (!tur) throw new Hata("Devriye bulunamadı.", 404);
      const alt = Date.parse(tur.basla) - 60000, ust = (tur.bitis ? Date.parse(tur.bitis) : Date.now()) + 60000;
      const alan = await siteSiniri();
      const satirlar = (Array.isArray(g.noktalar) ? g.noktalar : []).slice(0, 1000).map((n: any) => ({
        tur_id: tur.id, zaman: Number(n?.z), lat: Number(n?.lat), lng: Number(n?.lng), dogruluk: Math.round(Number(n?.d) || 0), kopuk: !!n?.k,
      })).filter((n: any) => Number.isFinite(n.zaman) && n.zaman >= alt && n.zaman <= ust && Number.isFinite(n.lat) && Number.isFinite(n.lng)
        && n.dogruluk <= IZ_DOGRULUK_M && alanda(alan, n.lat, n.lng))
        .map((n: any) => ({ ...n, zaman: new Date(n.zaman).toISOString() }));
      if (satirlar.length) {
        const { error } = await db.from("devriye_izleri").upsert(satirlar, { onConflict: "tur_id,zaman", ignoreDuplicates: true });
        if (error) throw error;
      }
      return { alinan: satirlar.length };
    }

    case "tur_bitir": {
      if (!DEVRIYE_ISARETLEYEN.includes(rol)) throw new Hata("Yetkisiz.", 403);
      const { data: tur } = await db.from("devriye_turlari").select("*").eq("id", Number(g.tur_id)).eq("cihaz", u.cihaz).maybeSingle();
      if (!tur) throw new Hata("Devriye bulunamadı.", 404);
      if (["kilit", "video", "yok"].includes(g.ekran)) await db.from("devriye_turlari").update({ ekran: g.ekran }).eq("id", tur.id);
      if (tur.bitis) return { tur };
      return { tur: await turKapat(tur, g.neden === "mesai" ? "mesai" : "kullanici", Number(g.bitis), Number(g.kesinti_sn)) };
    }

    case "devriye_mesai": {
      yonetici();
      const bas = temiz(g.bas, 5), bit = temiz(g.bit, 5);
      if (!/^\d{2}:\d{2}$/.test(bas) || !/^\d{2}:\d{2}$/.test(bit) || bas >= bit) throw new Hata("Mesai saatlerini 08:00 ve 18:00 biçiminde, başlangıç bitişten önce olacak şekilde yazın.");
      const { error } = await db.from("ayarlar").upsert({ ad: "devriye_mesai", deger: `${bas}-${bit}` });
      if (error) throw error;
      return { tamam: true };
    }

    case "servis": {
      const { data } = await db.from("servis_guzergah").select("id, cizgi, duraklar, sure_sn, mesafe_m, kaydeden, created_at")
        .eq("aktif", true).order("id", { ascending: false }).limit(1).maybeSingle();
      const { data: st } = await db.from("ayarlar").select("deger").eq("ad", "servis_saatleri").maybeSingle();
      let saatler: string[] = [];
      try { const x = JSON.parse(String(st?.deger ?? "[]")); if (Array.isArray(x)) saatler = x.map(String); } catch { /* bozuk kayıt: boş liste */ }
      return { guzergah: data ?? null, saatler };
    }

    case "servis_saat_kaydet": {
      // Sefer saatlerini yalnızca yönetici değiştirir; "SS:DD" biçiminde, sıralı ve tekrarsız saklanır
      yonetici();
      const ham = (Array.isArray(g.saatler) ? g.saatler : []).map((x: any) => temiz(x, 5));
      if (ham.some((x: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(x))) throw new Hata("Saatleri doğru yazın (örn. 10:00).");
      const saatler = [...new Set<string>(ham)].sort();
      if (!saatler.length) throw new Hata("En az bir sefer saati olmalı.");
      if (saatler.length > 40) throw new Hata("En fazla 40 sefer saati girilebilir.");
      const { error } = await db.from("ayarlar").upsert({ ad: "servis_saatleri", deger: JSON.stringify(saatler) });
      if (error) throw error;
      return { saatler };
    }

    case "servis_kaydet": {
      yonetici();
      const sayi = (x: any) => Number.isFinite(Number(x)) ? Number(x) : NaN;
      const cizgi = (Array.isArray(g.cizgi) ? g.cizgi : []).slice(0, 5000)
        .map((p: any) => [Math.round(sayi(p?.[0]) * 1e6) / 1e6, Math.round(sayi(p?.[1]) * 1e6) / 1e6])
        .filter(([a, b]: number[]) => Math.abs(a) <= 90 && Math.abs(b) <= 180);
      if (cizgi.length < 2) throw new Hata("Güzergah çok kısa; kaydedilemedi.");
      const duraklar = (Array.isArray(g.duraklar) ? g.duraklar : []).slice(0, 60).map((d: any, i: number) => ({
        ad: temiz(d?.ad, 60) || `Durak ${i + 1}`, lat: sayi(d?.lat), lng: sayi(d?.lng), sn: Math.max(0, Math.round(sayi(d?.sn) || 0)),
      })).filter((d: any) => Number.isFinite(d.lat) && Number.isFinite(d.lng)).sort((a: any, b: any) => a.sn - b.sn);
      const sure_sn = Math.max(60, Math.min(6 * 3600, Math.round(sayi(g.sure_sn) || 0)));
      const mesafe_m = Math.max(0, Math.min(200000, Math.round(sayi(g.mesafe_m) || 0)));
      await db.from("servis_guzergah").update({ aktif: false }).eq("aktif", true);
      const { error } = await db.from("servis_guzergah").insert({ cizgi, duraklar, sure_sn, mesafe_m, kaydeden: u.ad });
      if (error) throw error;
      return { tamam: true };
    }

    case "davet_kodu": {
      yonetici();
      const no = Number(temiz(g.ortak_no, 6));
      const { data: r } = await db.from("ortak_rehberi").select("no").eq("no", no).maybeSingle();
      if (!r) throw new Hata("Bu numara ortak listesinde yok.");
      return { kod: await davetKoduUret(no, u.ad), gun: DAVET_GUN };
    }

    case "uye_onayla":
    case "uye_cikar":
    case "uye_geri_al": {
      yonetici();
      const hedef = temiz(g.hedef, 80);
      if (hedef === u.cihaz) throw new Hata("Kendi telefonunuzu değiştiremezsiniz.");
      const durum = eylem === "uye_cikar" ? "cikarildi" : "onayli";
      if (durum === "cikarildi") await yoneticiyeDokunma(hedef);
      if (eylem === "uye_onayla") {
        const { data: on } = await db.from("uyeler").select("rol, unvan, ortak_no, durum").eq("cihaz", hedef).maybeSingle();
        if (temsilciOnaylar(on, await temsilciAraliklari())) throw new Hata("Bu başvuruyu ortağın parsel temsilcisi onaylar.", 403);
      }
      if (durum === "onayli") {
        const { count } = await db.from("uyeler").select("cihaz", { count: "exact", head: true }).eq("durum", "onayli");
        if ((count ?? 0) >= MAKS_UYE) throw new Hata(`Grup dolu (${MAKS_UYE} kişi). Yeni üye için önce birini çıkarın.`);
      }
      const { data, error } = await db.from("uyeler")
        .update({ durum, onay_at: durum === "onayli" ? new Date().toISOString() : null, cikarilma_at: durum === "cikarildi" ? new Date().toISOString() : null })
        .eq("cihaz", hedef).select("ad, ortak_no, unvan").maybeSingle();
      if (error) throw error;
      if (!data) throw new Hata("Üye bulunamadı.");
      // Bir ortak birden fazla telefondan, yakınları da kendi telefonlarından girebilir: onaylamak başka kaydı silmez.
      if (durum === "cikarildi") {
        await db.from("abonelikler").delete().eq("cihaz", hedef);
      } else {
        await duyur({ cihaz: hedef }, "Gruba kabul edildiniz", "SPORKENT ASİSTAN uygulamasını kullanmaya başlayabilirsiniz.");
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
      const yeniKod = gucluKod("baskan");
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

// KVKK saklama süresi: çıkarılan üye 90 gün, onaylanmadan bekleyen başvuru 30 gün sonra kendiliğinden silinir
const CIKARILAN_SAKLAMA_GUN = 90, BASVURU_SAKLAMA_GUN = 30;
async function eskiUyeleriSil() {
  const once = (gun: number) => new Date(Date.now() - gun * 864e5).toISOString();
  const { data: a } = await db.from("uyeler").select("cihaz").eq("durum", "cikarildi").lt("cikarilma_at", once(CIKARILAN_SAKLAMA_GUN));
  const { data: b } = await db.from("uyeler").select("cihaz").eq("durum", "bekliyor").lt("created_at", once(BASVURU_SAKLAMA_GUN));
  const cihazlar = [...(a ?? []), ...(b ?? [])].map((x: any) => x.cihaz);
  if (cihazlar.length) {
    await db.from("abonelikler").delete().in("cihaz", cihazlar);
    await db.from("uyeler").delete().in("cihaz", cihazlar).neq("rol", "baskan");
  }
  return cihazlar.length;
}

async function eskiDevriyeSil() {
  const sinir = sonGun(new Date(Date.now() - DEVRIYE_SAKLAMA_GUN * 864e5), 0);
  await db.from("devriye_turlari").delete().lt("gun", sinir); // izleri de birlikte silinir
}
// ---------- Aylık Faaliyet Raporu ----------
type RaporTur = "tum" | "yk" | "saha";
const RAPOR_TURLERI: RaporTur[] = ["tum", "yk", "saha"];
const raporYolu = (ay: string, tur: RaporTur) => `raporlar/faaliyet-${ay}-${tur}.pdf`;
// Paylaşım linki: WhatsApp'tan gönderilebilsin diye 1 yıl geçerli
const raporLinkleri = async (ay: string) => {
  const { data } = await db.storage.from(BUCKET).createSignedUrls(RAPOR_TURLERI.map((t) => raporYolu(ay, t)), 60 * 60 * 24 * 365);
  return Object.fromEntries(RAPOR_TURLERI.map((t, i) => [t, data?.[i]?.error ? null : data?.[i]?.signedUrl ?? null]));
};
const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
async function aylikRaporHazirla(ay: string, bildirimle: boolean) {
  const [yil, a] = ay.split("-").map(Number);
  const bas = new Date(Date.UTC(yil, a - 1, 1) - 3 * 3600e3).toISOString(); // Türkiye saatiyle ayın başı
  const bit = new Date(Date.UTC(yil, a, 1) - 3 * 3600e3).toISOString();
  const { data: isler, error } = await db.from("kayitlar")
    .select("id, no, yer, bolge, sorun, bildiren, created_at, kapatan, kapanis_at, sonuc, foto_once, foto_sonra, gizli")
    .eq("durum", "tamam").gte("kapanis_at", bas).lt("kapanis_at", bit).order("kapanis_at");
  if (error) throw error;
  const { data: program } = await db.from("is_programi").select("baslik, aciklama, yapan, yapildi_at")
    .gte("yapildi_at", bas).lt("yapildi_at", bit).order("yapildi_at");
  const ayAdi = `${AY_ADLARI[a - 1]} ${yil}`;
  const logo = await fetch("https://avsamimciftci-wq.github.io/sporkent-saha-takip/logo-yatay.png").then((r) => r.ok ? r.arrayBuffer() : null).catch(() => null);
  // Fotoğraflar bir kez indirilir, üç raporda da kullanılır
  const onbellek = new Map<string, Promise<Uint8Array | null>>();
  const foto = (yol: string) => {
    if (!onbellek.has(yol)) onbellek.set(yol, db.storage.from(BUCKET).download(yol).then(async ({ data }) => data ? new Uint8Array(await data.arrayBuffer()) : null));
    return onbellek.get(yol)!;
  };
  const hepsi = isler ?? [];
  const parca: Record<RaporTur, any[]> = { tum: hepsi, yk: hepsi.filter((x: any) => x.gizli), saha: hepsi.filter((x: any) => !x.gizli) };
  for (const tur of RAPOR_TURLERI) {
    const pdf = await raporPdf(
      { PDFDocument, rgb, fontkit, fontNormal: ROBOTO_NORMAL(), fontKalin: ROBOTO_KALIN(), logo: logo ? new Uint8Array(logo) : null },
      { tur, ayAdi, hazirlanma: new Date().toISOString(), isler: parca[tur], program: tur === "saha" ? [] : program ?? [] }, foto,
    );
    const { error: ye } = await db.storage.from(BUCKET).upload(raporYolu(ay, tur), pdf, { contentType: "application/pdf", upsert: true });
    if (ye) throw ye;
  }
  const yol = raporYolu(ay, "tum");
  await db.from("faaliyet_raporlari").upsert({ ay, yol, is_sayisi: hepsi.length, program_sayisi: program?.length ?? 0, olusturma: new Date().toISOString() });
  if (bildirimle) await bildir(["baskan"], `📑 ${ayAdi} faaliyet raporları hazır`, `${hepsi.length} yapılan iş: Tüm, YK Saha Takip ve Saha Takip raporları PDF olarak hazırlandı. Açmak için dokunun.`, { sayfa: "faaliyet" });
  return { ay, ayAdi, yol, is_sayisi: isler?.length ?? 0, program_sayisi: program?.length ?? 0 };
}
// Her akşam çağrılır; yarın ayın 1'iyse bu ayın raporu hazırlanır
async function masrafUyarisi() {
  const m = await masrafDurumu();
  if (!m.bugun_gunu || m.paylasildi_at) return { masraf: m.paylasildi_at ? "paylaşıldı" : "bugün değil", masraf_gunu: m.gun };
  const r = await bildir(MUHASEBE_GOREN, "⚠ Aylık Masraflar Listesi paylaşılmadı",
    `${m.liste_ayi} ayının masraflar listesi bugün (ayın ilk iş günü) Muhasebe bölümünde henüz paylaşılmadı.`, { sayfa: "muhasebe" });
  return { masraf: "uyarı gönderildi", ...r };
}
async function aylikRaporZamani() {
  const uyari = await masrafUyarisi().catch((e) => ({ masraf_hata: String(e) }));
  const bugun = sonGun(new Date(), 0), yarin = sonGun(new Date(), 1);
  if (!yarin.endsWith("-01")) return { atlandi: true, bugun, ...uyari };
  return await aylikRaporHazirla(bugun.slice(0, 7), true);
}

async function gunlukGecikme() {
  // Ayın 1'i sabahı: muhasebeye "bugün Aylık Masraflar Listesi'ni paylaşın" hatırlatması
  await masrafDurumu().then((m) => m.bugun_gunu && !m.paylasildi_at
    ? bildir(["muhasebe"], "📋 Bugün Aylık Masraflar Listesi günü", `${m.liste_ayi} ayının masraflar listesini Muhasebe bölümünde paylaşmayı unutmayın.`, { sayfa: "muhasebe" }) : null).catch(() => {});
  await eskiUyeleriSil().catch(() => {});
  await eskiDevriyeSil().catch(() => {});
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
      if (!CRON_ANAHTARI || !esitMi(String(g.cron ?? ""), CRON_ANAHTARI)) throw new Hata("Yetkisiz.", 401);
      return yanit(await gunlukGecikme());
    }
    if (g.eylem === "aylik_rapor") {
      if (!CRON_ANAHTARI || !esitMi(String(g.cron ?? ""), CRON_ANAHTARI)) throw new Hata("Yetkisiz.", 401);
      return yanit(await aylikRaporZamani());
    }
    if (g.eylem === "gorev_hatirlat") {
      if (!CRON_ANAHTARI || !esitMi(String(g.cron ?? ""), CRON_ANAHTARI)) throw new Hata("Yetkisiz.", 401);
      return yanit(await gorevHatirlat());
    }
    if (g.eylem === "giris") return yanit(await giris(g, (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "?").trim().slice(0, 64)));
    if (g.eylem === "ortak_kayit") return yanit(await ortakKayit(g));
    const u = await kimlik(g);
    return yanit(await islem(String(g.eylem), u, g));
  } catch (e: any) {
    console.error(e);
    if (e instanceof Hata) return yanit({ hata: e.message, ...e.ek }, e.status);
    return yanit({ hata: "Sunucu hatası, tekrar deneyin." }, 500);
  }
});
