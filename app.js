// SPORKENT ASİSTAN: tek sayfa uygulama.
(() => {
  "use strict";

  const AYAR = window.SPORKENT || {};
  const $ = (s, kok = document) => kok.querySelector(s);

  // ---------- Yerel saklama (gizli pencerede atılabilir, hep try/catch) ----------
  const sakla = {
    al(k, v = null) { try { const x = localStorage.getItem(k); return x === null ? v : JSON.parse(x); } catch { return v; } },
    koy(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    sil(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let cihaz = sakla.al("sk_cihaz");
  if (!cihaz) { cihaz = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); sakla.koy("sk_cihaz", cihaz); }

  // { ad, rol, durum, anahtar, vapid } — giriş kodu saklanmaz, onaydan sonra telefon kendi anahtarıyla çalışır
  let oturum = sakla.al("sk_oturum");
  let kayitlar = [];
  let filtre = "acik";
  // Parsel temsilcisi bilgisi: { ortak, temsilci } ortağa; { temsilciler, resimEkler } yöneticiye; { temsilcilik } temsilciye
  let parsel = sakla.al("sk_parsel");
  let bekleyenYakinlar = []; // parsel temsilcisine: onayını bekleyen ortak yakınları

  // ---------- Sunucu ----------
  class SunucuHatasi extends Error {
    constructor(j) { super(j.hata || "Bağlantı hatası, tekrar deneyin."); this.bekliyor = !!j.bekliyor; this.cikis = !!j.cikis; }
  }

  async function api(eylem, veri = {}) {
    const govde = { eylem, cihaz, anahtar: oturum?.anahtar, ...veri };
    const r = await fetch(`${AYAR.supabaseUrl}/functions/v1/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: AYAR.anonKey, Authorization: `Bearer ${AYAR.anonKey}` },
      body: JSON.stringify(govde),
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) {
      const h = new SunucuHatasi(j);
      if (h.cikis && eylem !== "giris") { cikisYap(); mesaj(h.message); }
      else if (h.bekliyor && oturum) { oturum.durum = "bekliyor"; sakla.koy("sk_oturum", oturum); bekleEkrani(); }
      throw h;
    }
    return j;
  }

  async function fotoYukle(blob, tur) {
    const { yol, adres } = await api("yukleme_adresi", tur ? { tur } : {});
    const r = await fetch(adres, { method: "PUT", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: blob });
    if (!r.ok) throw new Error("Fotoğraf yüklenemedi, tekrar deneyin.");
    return yol;
  }

  // ---------- Yardımcılar ----------
  const kac = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tarihSaat = (t) => t ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const bugun = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const DURUM = { acik: "Henüz yapılmayan", devam: "Henüz yapılmayan", tamam: "Yapıldı" };
  const DURUM_ROZET = { acik: "yapilmayan", devam: "yapilmayan", tamam: "tamam" };
  // Ekranda hitap: "Temsilciler Grubu Üyesi Sayın", "Yönetim Kurulu Üyesi Sayın", "Ortağımız Sayın" …
  function hitap(o = oturum) {
    const un = String(o?.unvan || "");
    if (o?.rol === "baskan") return "Yönetim Kurulu Başkanı Sayın";
    if (o?.rol === "yonetim") return "Yönetim Kurulu Üyesi Sayın";
    if (o?.rol === "uye" && /^TG/i.test(un)) return /başkan/i.test(un) ? "Temsilciler Grubu Başkanı Sayın" : "Temsilciler Grubu Üyesi Sayın";
    if (o?.rol === "uye" && /Yakını/.test(un)) return "Hoş geldiniz,";
    if (o?.rol === "uye") return "Ortağımız Sayın";
    return "Sayın";
  }
  const ROL_ADI = { baskan: "YK Başkanı (Yönetici)", mudur: "Müdür", sef: "Şef", yonetim: "Yönetim Kurulu", muhasebe: "Muhasebe", uye: "Ortak", restoran: "Restoran Yetkilisi" };
  // Yönetici ve yönetim kurulu, TG üyesi / muhasebe kayıtlarını onaylar; bu dört görevin kaydı onaysız düşer
  const kayitOnaylar = () => ["baskan", "yonetim"].includes(oturum?.rol);
  const onayBekliyor = (k) => k.onay_durumu === "bekliyor";
  // Bu kaydı ben onaylayabilir miyim (sunucu söyler: ortağın kaydını parsel temsilcisi, diğerlerini yönetim)
  const benOnaylarim = (k) => onayBekliyor(k) && !!k.onaylayabilir;
  const ortakMi = () => !!parsel?.ortak;
  // Yönetim Kurulu bölümüne girenler; muhasebe orada yalnızca YK Saha Takip'i görür
  const programGorur = () => ["baskan", "yonetim", "mudur", "sef", "muhasebe"].includes(oturum?.rol);
  const gorevGorur = () => ["baskan", "yonetim", "mudur", "sef"].includes(oturum?.rol);
  const KAPATABILIR = ["baskan", "mudur", "sef"];
  const kapatabilir = () => KAPATABILIR.includes(oturum?.rol);
  const yonetici = () => oturum?.rol === "baskan";
  const yeniGirebilir = () => !["mudur", "sef", "muhasebe"].includes(oturum?.rol);
  const yonetimIsiGirebilir = () => ["baskan", "yonetim", "muhasebe", "mudur", "sef"].includes(oturum?.rol);
  const yonetimIsiRozeti = (k) => k.gizli ? `<span class="rozet gizli-rozet">🔒 Yönetim İş Emri</span>` : "";
  const onayli = () => oturum?.anahtar && oturum.durum === "onayli";

  let mesajZamani;
  function mesaj(metin) {
    const m = $("#mesaj"); m.textContent = metin; m.hidden = false;
    clearTimeout(mesajZamani); mesajZamani = setTimeout(() => (m.hidden = true), 3500);
  }

  // Fotoğrafı telefonda küçültür: uzun kenar en fazla 1280 px, JPEG.
  async function kucult(dosya, enUzun = 1280) {
    const img = await new Promise((ok, hata) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => hata(new Error("Fotoğraf okunamadı."));
      i.src = URL.createObjectURL(dosya);
    });
    const oran = Math.min(1, enUzun / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * oran); c.height = Math.round(img.naturalHeight * oran);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return new Promise((ok) => c.toBlob(ok, "image/jpeg", enUzun > 1280 ? 0.85 : 0.72));
  }

  // girdi: kamera girdisi; galeri: (isteğe bağlı) galeriden seçme girdisi
  function fotoSecici(girdi, onizleme, yazi, galeri) {
    let blob = null;
    const girdiler = [girdi, galeri].filter(Boolean);
    for (const g of girdiler) g.addEventListener("change", async () => {
      const f = g.files?.[0]; if (!f) return;
      try {
        blob = await kucult(f);
        onizleme.src = URL.createObjectURL(blob); onizleme.hidden = false;
        if (yazi) yazi.textContent = "📷 Fotoğrafı değiştir";
      } catch (e) { mesaj(e.message); }
    });
    return { al: () => blob, sifirla: () => { blob = null; for (const g of girdiler) g.value = ""; onizleme.hidden = true; if (yazi) yazi.textContent = "📷 Fotoğraf çek"; } };
  }

  // ---------- Ekranlar ----------
  // Ekran → modül (alt menüde hangisi seçili)
  const MODUL = { aidat: "aidat", iletisim: "iletisim", yonetimisleri: "yonetim", program: "yonetim", gorevler: "yonetim", yksaha: "yonetim", sokaklar: "sokaklar", servis: "servis", ana: "" };
  // Alt menünün gerçek yüksekliği (iPhone çentiği ve iki satırlık yazılar dahil): "+ Yeni kayıt" hep menünün üstünde kalsın
  if ("ResizeObserver" in window) new ResizeObserver(() => {
    const m = $("#alt-menu"); if (!m.hidden) document.documentElement.style.setProperty("--menu-h", m.offsetHeight + "px");
  }).observe($("#alt-menu"));

  // Ana sayfa düğmeleri ekrana kaydırmadan sığsın: üst bandın (ve devriye çubuğunun) gerçek yüksekliği
  function ustYukseklik() {
    const iz = $("#iz-cubuk");
    const h = $(".ust").offsetHeight + (iz && !iz.hidden ? iz.offsetHeight : 0);
    document.documentElement.style.setProperty("--ust-h", h + "px");
    // Ekranın gerçek yüksekliği (bazı Android'lerde 100dvh alt çubuğun altını da sayıyor)
    document.documentElement.style.setProperty("--ekran-h", window.innerHeight + "px");
  }
  if ("ResizeObserver" in window) { const ro = new ResizeObserver(ustYukseklik); ro.observe($(".ust")); ro.observe($("#iz-cubuk")); }
  window.addEventListener("resize", ustYukseklik);
  ustYukseklik();

  // Ana sayfa düğmeleri: simge, yazı ve rozet düğmenin çerçevesine sığana kadar küçülür.
  // Telefonların yazı tipi ve emoji boyları farklı olduğundan gerçek ölçüme göre ayarlanır.
  function kutulariSigdir() {
    const ana = $("#ekran-ana");
    if (!ana || ana.hidden) return;
    for (const k of document.querySelectorAll("#ana-kutular .ana-kutu")) {
      if (k.hidden) continue;
      k.style.removeProperty("--olcek");
      const kr = k.getBoundingClientRect();
      if (!kr.height) continue;
      const rg = document.createRange();
      const tasiyor = () => {
        rg.selectNodeContents(k);
        const r = rg.getBoundingClientRect();
        return r.top < kr.top + 3 || r.bottom > kr.bottom - 3 || r.left < kr.left + 2 || r.right > kr.right - 2;
      };
      for (let s = 0.95; s >= 0.3 && tasiyor(); s -= 0.05) k.style.setProperty("--olcek", s.toFixed(2));
    }
  }
  let sigdirSirada = false;
  const sigdirIste = () => { if (sigdirSirada) return; sigdirSirada = true; requestAnimationFrame(() => { sigdirSirada = false; kutulariSigdir(); }); };
  if ("ResizeObserver" in window) new ResizeObserver(sigdirIste).observe($("#ana-kutular"));
  // Rozet yazısı, görünen düğmeler ya da düğme düzeni değişince yeniden ölç (style değişikliği izlenmez: döngü olmaz)
  new MutationObserver(sigdirIste).observe($("#ana-kutular"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"] });
  document.fonts?.ready.then(() => kutulariSigdir());

  // Kullanım raporu: hangi bölüm kaç kez açıldı. Ekranda 1,5 sn kalan bölüm sayılır; aynı bölüm içinde
  // gezinmek (liste → kayıt → liste) tek açılış sayılır, ana sayfaya dönünce sıfırlanır.
  const EKRAN_BOLUM = { liste: "saha", detay: "saha", yeni: "saha", yonetim: "uyeler", yonetimisleri: "yonetim", yksaha: "yksaha", program: "program",
    gorevler: "gorevler", aidat: "aidat", iletisim: "iletisim", parsel: "parsel", restoran: "restoran", plaka: "plaka", yakinlar: "yakinlar",
    sokaklar: "sokaklar", servis: "servis", duyuru: "duyuru", rapor: "rapor" };
  let sonSayilan = null;
  function kullanimSay(ad) {
    if (ad === "ana") { sonSayilan = null; return; }
    const bolum = EKRAN_BOLUM[ad];
    if (!bolum || !oturum?.anahtar || oturum.durum !== "onayli") return;
    setTimeout(() => {
      if (document.getElementById("ekran-" + ad)?.hidden !== false || sonSayilan === bolum) return;
      sonSayilan = bolum;
      api("kullanim", { bolum }).catch(() => {});
    }, 1500);
  }
  function goster(ad) {
    if (ad !== "gorevler" && typeof haritaKapat === "function") haritaKapat();
    if (ad !== "servis" && typeof servisHaritaKapat === "function") servisHaritaKapat();
    setTimeout(() => { if (typeof izCubuk === "function") izCubuk(); }, 0);
    for (const e of document.querySelectorAll(".ekran")) e.hidden = e.id !== "ekran-" + ad;
    kullanimSay(ad);
    document.documentElement.classList.toggle("ana-acik", ad === "ana");
    if (ad === "ana") ustYukseklik();
    // Ana sayfada bölüm düğmeleri büyük kutular olarak görünür; alt menü bölüm sayfalarında çıkar
    const menulu = !["giris", "bekle", "ana"].includes(ad) && onayli();
    $("#ana-don").hidden = !menulu;
    // Alt menü kaldırıldı: bölümlere Ana Sayfa'dan geçilir
    $("#alt-menu").hidden = true;
    document.body.classList.toggle("menulu", false);
    const modul = MODUL[ad] ?? "saha";
    $("#alt-menu [data-modul=yonetim]").hidden = !programGorur();
    for (const b of document.querySelectorAll("#alt-menu [data-modul]")) b.classList.toggle("secili", b.dataset.modul === modul);
    window.scrollTo(0, 0);
  }

  let bekleyenSayisi = 0;
  let varsSure = null; // yeni işlerin yapılma süresi (yönetici ve yönetim kurulu görür)
  async function yenile() {
    if (!onayli()) return;
    try {
      const r = await api("liste");
      kayitlar = r.kayitlar || [];
      ykUyeler = r.ykUyeler || [];
      if (r.varsayilan_sure) varsSure = r.varsayilan_sure;
      cevapKisiler = r.cevapKisiler || [];
      parsel = r.parsel || null; sakla.koy("sk_parsel", parsel);
      if (!$("#ekran-parsel").hidden) parselCiz();
      const oncekiYakin = bekleyenYakinlar.length;
      bekleyenYakinlar = r.bekleyenYakinlar || [];
      if (bekleyenYakinlar.length > oncekiYakin && oncekiYakin >= 0 && r.bekleyenYakinlar) mesaj(`Onayınızı bekleyen ${bekleyenYakinlar.length} ortak yakını var.`);
      if (!$("#ekran-yakinlar").hidden) yakinCiz();
      // Yönetici başka bir telefondan rolü değiştirilmişse güncel rolü kullan
      if (r.rol && r.rol !== oturum.rol) { oturum.rol = r.rol; sakla.koy("sk_oturum", oturum); }
      if ((r.unvan || null) !== (oturum.unvan || null)) { oturum.unvan = r.unvan || null; sakla.koy("sk_oturum", oturum); }
      if (yonetici()) {
        if ((r.bekleyen || 0) > bekleyenSayisi) { sesCal(); mesaj(`Onay bekleyen ${r.bekleyen} kişi var.`); }
        bekleyenSayisi = r.bekleyen || 0;
      }
      listeCiz();
      yenileriAc();
    } catch (e) {
      if (!e.cikis && !e.bekliyor) mesaj(e.message);
    }
  }

  // ---------- Yeni iş gelince: sesli uyarı + pencere kendiliğinden açılır ----------
  // Herkes için: yeni açılan sorunlar ve yeni "yapıldı" işler.
  const anahtar = (k) => k.id + ":" + (k.durum === "tamam" ? "t" : "a") + (k.gizli && k.cevaplar?.length ? ":c" + k.cevaplar.length : "");
  // YK iş emrine gelen cevabı bu telefonda açıp okudu mu (okunmadıysa kırmızı yanıp söner)
  const cevapOkunan = () => sakla.al("sk_cevap_okunan") || {};
  const cevapOkunmadi = (k) => k.gizli && (k.cevaplar?.length || 0) > (cevapOkunan()[k.id] || 0);
  // Cevabı kim gördü: Yönetim Kurulu bölümündeki herkes (cevabı yazan hariç). i: cevabın sırası (1'den)
  let cevapKisiler = [];
  const ROL_KISA = { baskan: "Yönetici", yonetim: "YK", muhasebe: "Muhasebe", mudur: "Müdür", sef: "Şef" };
  const ROL_SIRA = ["mudur", "sef", "muhasebe", "yonetim", "baskan"];
  function cevapGorulme(k, i) {
    const c = k.cevaplar[i - 1];
    return cevapKisiler.filter((x) => x.ad !== c.ad)
      .sort((a, b) => ROL_SIRA.indexOf(a.rol) - ROL_SIRA.indexOf(b.rol) || a.ad.localeCompare(b.ad, "tr"))
      .map((x) => ({ ...x, gordu: (k.cevap_gorenler || []).find((g) => g.ad === x.ad && g.sira >= i) }));
  }
  const kisiAdi = (x) => x.ad === ROL_KISA[x.rol] ? kac(x.ad) : `${kac(x.ad)} (${ROL_KISA[x.rol]})`;
  const cevapGorulmeHtml = (k, i) => {
    const l = cevapGorulme(k, i); if (!l.length) return "";
    return `<div class="cevap-gorulme">👁 ${l.map((x) => x.gordu
      ? `<span class="cg-gordu">${kisiAdi(x)} gördü ✓ ${tarihSaat(x.gordu.ilk_at)}</span>`
      : `<span class="cg-gormedi">${kisiAdi(x)} henüz görmedi</span>`).join("")}</div>`;
  };
  const cevapGorulmeOzet = (k) => {
    const l = cevapGorulme(k, k.cevaplar.length); if (!l.length) return "";
    const n = l.filter((x) => x.gordu).length;
    return `<span class="cevap-ozet">👁 ${n}/${l.length} kişi gördü${n < l.length ? ` · görmeyen: ${l.filter((x) => !x.gordu).map((x) => kac(x.ad)).join(", ")}` : ""}</span>`;
  };
  const cevapGorulduGonderilen = new Set();
  function cevapOkundu(k) {
    if (k.gizli && k.cevaplar?.length && !cevapGorulduGonderilen.has(k.id + ":" + k.cevaplar.length)) {
      const a = k.id + ":" + k.cevaplar.length; cevapGorulduGonderilen.add(a);
      api("cevap_goruldu", { id: k.id, sira: k.cevaplar.length }).catch(() => cevapGorulduGonderilen.delete(a));
    }
    if (!k.gizli || !k.cevaplar?.length) return;
    const o = cevapOkunan(); if ((o[k.id] || 0) >= k.cevaplar.length) return;
    o[k.id] = k.cevaplar.length; sakla.koy("sk_cevap_okunan", o);
  }

  function yenileriAc() {
    const gorulen = sakla.al("sk_gorulen");
    const yeniler = gorulen ? kayitlar.filter((k) => !gorulen.includes(anahtar(k))) : [];
    sakla.koy("sk_gorulen", kayitlar.map(anahtar).slice(0, 500));
    if (!yeniler.length) return;
    // Yeni YK cevabı: daha önce görülmüş iş emrine cevap eklenmiş
    const cevapli = yeniler.filter((k) => k.gizli && k.cevaplar?.length && gorulen.some((x) => x.startsWith(k.id + ":")));
    sesCal(cevapli.length > 0);
    const son = (k) => (cevapli.includes(k) ? k.cevaplar.at(-1).at : k.kapanis_at || k.created_at);
    const en = yeniler.sort((a, b) => son(b).localeCompare(son(a)))[0];
    const baslik = cevapli.includes(en) ? `💬 Yeni cevap: ${en.yer} — ${en.cevaplar.at(-1).ad}: ${en.cevaplar.at(-1).metin}`
      : en.durum === "tamam" ? `Yapıldı: ${en.yer}` : onayBekliyor(en) ? `Onay bekleyen kayıt: ${en.yer}` : `Yeni sorun: ${en.yer}`;
    // Yeni kayıt formu doluyken yazılanı kaybettirme, sadece haber ver
    if (!$("#ekran-yeni").hidden || ($("#kapat-form") && !$("#ekran-detay").hidden)) return mesaj(baslik);
    detayGoster(en.id);
    if (cevapli.includes(en)) setTimeout(() => $(".yk-cevaplar")?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    mesaj(yeniler.length > 1 ? `${baslik} (+${yeniler.length - 1} yeni)` : baslik);
  }

  let sesBaglam = null;
  function sesAc() {
    try {
      sesBaglam = sesBaglam || new (window.AudioContext || window.webkitAudioContext)();
      if (sesBaglam.state === "suspended") sesBaglam.resume();
    } catch {}
  }
  // Ekran birkaç kez yanıp söner (uygulama açıkken gelen yeni iş / iş emri)
  function ekranFlas() {
    const f = document.createElement("div");
    f.className = "ekran-flas";
    f.addEventListener("animationend", () => f.remove());
    document.body.appendChild(f);
  }
  function sesCal(herkeseFlas = false) {
    // Ekran yanıp sönmesi müdür ve şefte; YK cevabı gelince herkeste
    if (herkeseFlas || ["mudur", "sef"].includes(oturum?.rol)) ekranFlas();
    try { navigator.vibrate?.([500, 150, 500, 150, 500, 150, 800]); } catch {}
    if (!sesBaglam) return;
    const t = sesBaglam.currentTime;
    for (const [frek, bas] of [[880, 0], [1175, 0.18], [880, 0.5], [1175, 0.68]]) {
      const o = sesBaglam.createOscillator(), g = sesBaglam.createGain();
      o.frequency.value = frek; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t + bas);
      g.gain.exponentialRampToValueAtTime(0.4, t + bas + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + bas + 0.16);
      o.connect(g).connect(sesBaglam.destination);
      o.start(t + bas); o.stop(t + bas + 0.17);
    }
  }
  // Telefonlar sesi ancak bir dokunuştan sonra izin verir
  document.addEventListener("pointerdown", sesAc);

  // ---------- Yapılma süresi ----------
  // son_tarih "YYYY-MM-DD"; o gün bitene kadar süre var, ertesi gün gecikmiş sayılır.
  const gunFarki = (t) => Math.round((Date.parse(t + "T00:00:00") - Date.parse(bugun() + "T00:00:00")) / 864e5);
  const gecikti = (k) => k.durum !== "tamam" && k.onay_durumu !== "bekliyor" && k.son_tarih && gunFarki(k.son_tarih) < 0;
  // Müdür, şef ve muhasebe YK iş emrinin süresini görmez ve seçmez
  const sureGormez = () => ["mudur", "sef", "muhasebe"].includes(oturum?.rol);
  // Kaydın açıldığı gün (İstanbul) ile son gün arasındaki gün sayısı
  const acilisGunu = (k) => new Date(Date.parse(k.created_at) + 3 * 3600e3).toISOString().slice(0, 10);
  const sureGun = (k) => k.son_tarih ? Math.round((Date.parse(k.son_tarih) - Date.parse(acilisGunu(k))) / 864e5) : null;
  function sureYazisi(k) {
    if (k.durum === "tamam" || !k.son_tarih || onayBekliyor(k) || (k.gizli && sureGormez())) return "";
    const f = gunFarki(k.son_tarih);
    if (f < 0) return `<span class="sure gecikmis">⚠ ${-f} gün gecikti</span>`;
    if (f === 0) return `<span class="sure son-gun">⏰ Bugün son gün</span>`;
    return `<span class="sure">⏰ ${f} gün kaldı</span>`;
  }

  // Yönetici ve yönetim kurulu için: müdür ve şef kaydı ne zaman gördü
  const gorulmeGorur = () => ["baskan", "yonetim"].includes(oturum?.rol);
  const GOREN_ROLLER = [["mudur", "Müdür"], ["sef", "Şef"]];
  const gorenRoller = (k) => k.gizli ? [...GOREN_ROLLER, ["muhasebe", "Muhasebe"]] : GOREN_ROLLER;
  const gorenler = (k, rol) => (k.gorenler || []).filter((g) => g.rol === rol);
  const gorulmeSatiri = (k) => gorenRoller(k)
    .map(([r, ad]) => `${ad} ${gorenler(k, r).length ? "gördü ✓" : "görmedi"}`).join(" · ");
  const gorulmeAlanlari = (k) => gorenRoller(k).map(([r, ad]) => {
    const g = gorenler(k, r);
    return `<dt>${ad}</dt><dd>${g.length
      ? g.map((x) => `👁 ${tarihSaat(x.ilk_at)} gördü (${kac(x.ad)})`).join("<br>")
      : `<span class="gorulmedi">Henüz görmedi</span>`}</dd>`;
  }).join("") + (yonetici() ? ykGorulme(k) : "");
  // Yalnızca yönetici: yönetim kurulu üyelerinin her biri kaydı ne zaman gördü
  let ykUyeler = [];
  const ykGorulme = (k) => {
    const g = gorenler(k, "yonetim");
    const adlar = [...new Set([...ykUyeler, ...g.map((x) => x.ad)])];
    if (!adlar.length) return "";
    return `<dt>Yönetim kurulu</dt><dd>${adlar.map((ad) => {
      const x = g.find((y) => y.ad === ad);
      return x ? `👁 ${tarihSaat(x.ilk_at)} gördü (${kac(ad)})` : `<span class="gorulmedi">${kac(ad)}: henüz görmedi</span>`;
    }).join("<br>")}</dd>`;
  };
  const gorulduGonderilen = new Set();

  // Yönetici / yönetim kurulu için onay bekleyenler iş listesinde değil, ayrı düğmede
  const listede = (k) => !benOnaylarim(k);
  // Yönetici ve yönetim kurulunun verdiği iş emirleri (Yönetim İş Emri) genel listede değil, YK Saha Takip'te
  const genelde = (k) => !k.gizli;

  function listeCiz() {
    const saat = new Date().getHours();
    const selam = saat < 12 ? "Günaydın" : saat < 18 ? "İyi günler" : "İyi akşamlar";
    $("#karsilama").innerHTML = `<span class="k-ikon">👋</span><span><b>${selam}, ${kac(hitap())} ${kac(oturum.ad)}</b><small>${kac(oturum.unvan || ROL_ADI[oturum.rol] || "")} · Sporkent Asistan</small></span>`;
    parselUstCiz();
    const bekleyenKayit = kayitlar.filter(benOnaylarim);
    const ou = $("#onay-uyari");
    ou.hidden = !bekleyenKayit.length;
    ou.classList.toggle("secili", filtre === "onay");
    ou.textContent = filtre === "onay" ? "⏳ Onay bekleyenler gösteriliyor · İş listesine dön" : `⏳ ${bekleyenKayit.length} kayıt onayınızı bekliyor`;
    if (filtre === "onay" && !bekleyenKayit.length) filtre = "acik";
    const genel = kayitlar.filter(genelde);
    const acik = genel.filter((k) => k.durum !== "tamam" && listede(k)).length;
    const yapilan = genel.filter((k) => k.durum === "tamam").length;
    const geciken = genel.filter(gecikti).length;
    // Alt menüdeki Saha Takip düğmesinde yapılmayan iş sayısı
    const sr = $("#saha-rozet");
    sr.textContent = acik > 99 ? "99+" : String(acik);
    sr.hidden = !acik;
    $("#ozet").innerHTML = `
      <button data-filtre="acik" class="ozet-yapilmayan ${filtre === "acik" ? "secili" : ""}"><b>${acik}</b><span>Henüz yapılmayanlar</span></button>
      <button data-filtre="tamam" class="ozet-yapilan ${filtre === "tamam" ? "secili" : ""}"><b>${yapilan}</b><span>Yapılanlar</span></button>`;
    const uyari = $("#gecikme-uyari");
    uyari.hidden = !geciken;
    uyari.textContent = `⚠ ${geciken} iş süresi içinde yapılmadı`;
    $("#gorunurluk").textContent = kapatabilir()
      ? `${ROL_ADI[oturum.rol]}: sorunları fotoğrafla "Yapıldı" olarak kapatabilirsiniz.`
      : "Bildirilen sorunları ve yapılan işleri gruptaki herkes görür.";
    // Müdür ve şef sorun bildirmez, yalnızca "Yapıldı" girer
    $("#yeni-ac").style.display = yeniGirebilir() ? "" : "none";
    if (!$("#ekran-ana").hidden) anaAc(); // ana sayfadaki "onay bekliyor" sayısı güncellensin

    const gorunen = siraya(genel
      .filter((k) => (filtre === "onay" ? benOnaylarim(k) : filtre === "tamam" ? k.durum === "tamam" : k.durum !== "tamam" && listede(k))), filtre);

    $("#liste").innerHTML = gorunen.length ? gorunen.map(satirHtml).join("") : `<p class="bos">${filtre === "tamam" ? "Henüz yapılan iş yok." : filtre === "onay" ? "Onay bekleyen kayıt yok." : "Henüz yapılmayan iş yok. 👍"}</p>`;
    if (!$("#ekran-yksaha").hidden) ykSahaCiz();
    const ykAcik = kayitlar.filter((k) => k.gizli && k.durum !== "tamam").length;
    $("#yksaha-sayi").textContent = ykAcik ? `${ykAcik} iş yapılmadı` : "";
    // Alt menüdeki Yönetim Kurulu düğmesinde yapılmayan iş emri sayısı
    const rozet = $("#yk-rozet");
    rozet.textContent = ykAcik > 99 ? "99+" : String(ykAcik);
    rozet.hidden = !ykAcik;
  }

  // Yapılmayanlar: gecikenler ve son günü yakın olanlar üstte. Yapılanlar: en yeni üstte.
  // Okunmamış YK cevabı olan iş en üstte
  const siraya = (liste, f) => liste.sort((a, b) => (!!cevapOkunmadi(b) - !!cevapOkunmadi(a)) || (f === "tamam"
    ? b.kapanis_at.localeCompare(a.kapanis_at)
    : (a.son_tarih || "9999").localeCompare(b.son_tarih || "9999") || a.created_at.localeCompare(b.created_at)));

  const satirHtml = (k) => `
      <button class="satir ${gecikti(k) ? "gecikti" : ""}" data-id="${k.id}">
        ${(k.foto_sonra_url || k.foto_once_url) ? `<img src="${kac(k.foto_sonra_url || k.foto_once_url)}" alt="" loading="lazy">` : `<span class="bos-foto">📝</span>`}
        <span>
          <span class="satir-ust">
            <span>${kac(k.no)}</span>
            ${onayBekliyor(k) ? `<span class="rozet bekliyor">⏳ Onay bekliyor</span>` : `<span class="rozet ${DURUM_ROZET[k.durum]}">${DURUM[k.durum]}</span>`}
            ${yonetimIsiRozeti(k)}
            ${sureYazisi(k)}
          </span>
          <span class="satir-yer" style="display:block">${kac(k.yer)}</span>
          <span class="satir-sorun">${kac(k.sorun)}</span>
          ${k.yanit && k.durum !== "tamam" ? `<span class="satir-cevap">💬 ${kac(k.yanit)}</span>` : ""}
          ${k.temsilci_cevaplari?.length && (k.benim || k.temsilcisiyim) ? `<span class="satir-cevap">💬 Temsilci ${kac(k.temsilci_cevaplari.at(-1).ad)}: ${kac(k.temsilci_cevaplari.at(-1).metin)}</span>` : ""}
          ${k.gizli && k.cevaplar?.length ? `<span class="satir-cevap yk-cevap-kirmizi"><span class="cevap-verildi">✅ CEVAP VERİLDİ${k.cevaplar.length > 1 ? ` (${k.cevaplar.length})` : ""}${cevapOkunmadi(k) ? " · YENİ" : ""}</span>💬 ${kac(k.cevaplar.at(-1).ad)}: ${kac(k.cevaplar.at(-1).metin)}${cevapGorulmeOzet(k)}</span>` : ""}
          ${gorulmeGorur() && k.durum !== "tamam" ? `<span class="satir-gorulme">👁 ${gorulmeSatiri(k)}</span>` : ""}
        </span>
      </button>`;

  // ---------- YK Saha Takip ----------
  let ykFiltre = "acik";
  function ykSahaAc() {
    if (!programGorur()) return;
    if (location.hash !== "#yk-saha") history.replaceState(history.state, "", "#yk-saha");
    goster("yksaha");
    ykSahaCiz();
  }
  function ykSahaCiz() {
    const yk = kayitlar.filter((k) => k.gizli);
    const acik = yk.filter((k) => k.durum !== "tamam").length;
    const geciken = yk.filter(gecikti).length;
    $("#yk-ozet").innerHTML = `
      <button data-yk-filtre="acik" class="ozet-yapilmayan ${ykFiltre === "acik" ? "secili" : ""}"><b>${acik}</b><span>Henüz yapılmayanlar</span></button>
      <button data-yk-filtre="tamam" class="ozet-yapilan ${ykFiltre === "tamam" ? "secili" : ""}"><b>${yk.length - acik}</b><span>Yapılanlar</span></button>`;
    $("#yk-gecikme").hidden = !geciken;
    $("#yk-gecikme").textContent = `⚠ ${geciken} iş süresi içinde yapılmadı`;
    $("#yk-yeni").hidden = !yonetimIsiGirebilir();
    const gorunen = siraya(yk.filter((k) => (ykFiltre === "tamam" ? k.durum === "tamam" : k.durum !== "tamam")), ykFiltre);
    $("#yk-liste").innerHTML = gorunen.length ? gorunen.map(satirHtml).join("")
      : `<p class="bos">${ykFiltre === "tamam" ? "Henüz yapılan iş emri yok." : "Yapılmayan iş emri yok. 👍"}</p>`;
  }
  $("#ekran-yksaha").addEventListener("click", (e) => {
    const f = e.target.closest("[data-yk-filtre]");
    if (f) { ykFiltre = f.dataset.ykFiltre; return ykSahaCiz(); }
    if (e.target.closest("#yk-gecikme")) { ykFiltre = "acik"; return ykSahaCiz(); }
    const s = e.target.closest(".satir"); if (s) detayGoster(Number(s.dataset.id));
  });
  $("#yksaha-ac").addEventListener("click", () => { ykFiltre = "acik"; history.pushState({ yk: 1 }, "", "#yk-saha"); ykSahaAc(); });

  const fotoKutu = (url, yazi, bos) => `<figure>${url
    ? `<a href="${kac(url)}" target="_blank" rel="noopener"><img src="${kac(url)}" alt="${yazi}"></a>`
    : `<div class="foto-bos">${bos}</div>`}<figcaption>${yazi}</figcaption></figure>`;

  function detayGoster(id) {
    const k = kayitlar.find((x) => x.id === id);
    if (!k) return;
    if (location.hash !== "#kayit-" + id) history.replaceState(null, "", "#kayit-" + id);
    const bekliyor = onayBekliyor(k);
    // YK iş emrini yalnızca müdür ve şef "Yapıldı" yapar; yönetici yalnızca genel işleri kapatabilir
    const kapat = kapatabilir() && k.durum !== "tamam" && !bekliyor && !(k.gizli && !["mudur", "sef"].includes(oturum.rol));
    $("#detay").innerHTML = `
      <div class="detay-ust">
        ${k.gizli && programGorur() ? `<button class="geri" data-geri-yksaha>← Geri</button>` : `<button class="geri" data-geri>← İş Listesini Gör</button>`}
        ${k.durum === "tamam" ? `<span class="rozet ${DURUM_ROZET[k.durum]}">${DURUM[k.durum]}</span>` : ""}
      </div>
      ${benOnaylarim(k) ? `
      <div class="onay-kutu">
        <h2>⏳ Bu kayıt onayınızı bekliyor</h2>
        ${k.temsilci_id ? `<p style="margin:0 0 6px">Parsel temsilcisi olarak <b>${kac(k.bildiren)}</b> ortağımızın kaydı size düştü.</p>` : ""}
        <p style="margin:0 0 10px">Onaylarsanız ${k.temsilci_id ? "genel Saha Takip'e" : "iş listesine"} düşer ve herkes görür. ${k.temsilci_id ? "Onaylamazsanız silinir, ortağa bildirilir." : "Reddederseniz silinir."}</p>
        <div class="dugmeler">
          <button type="button" class="ikincil tehlike" id="kayit-reddet">${k.temsilci_id ? "✖ Onaylamıyorum" : "✖ Reddet"}</button>
          <button type="button" class="ana-dugme" id="kayit-onayla">✔ Onayla</button>
        </div>
        ${k.temsilci_id ? `
        <form id="ret-form" hidden>
          <label>Ortağa cevabınız (isteğe bağlı)
            <textarea name="metin" rows="3" maxlength="1000" placeholder="Neden reddettiğinizi yazabilirsiniz"></textarea>
          </label>
          <div class="dugmeler">
            <button type="button" class="ikincil" id="ret-vazgec">Vazgeç</button>
            <button type="submit" class="ana-dugme tehlike-dolu">✖ Reddet ve Ortağa Bildir</button>
          </div>
          <small class="ipucu">Kayıt silinir; ortağa ret bildirimi gider. Cevap yazdıysanız bildirimde görünür.</small>
        </form>` : ""}
      </div>` : bekliyor && k.temsilci_id ? `<p class="onay-kutu">⏳ Kaydınız parsel temsilcinizin${parsel?.temsilci ? ` (<b>${kac(parsel.temsilci.ad)}</b>)` : ""} onayını bekliyor. Onaylarsa genel Saha Takip'e düşer ve herkes görür.</p>`
        : bekliyor ? `<p class="onay-kutu">⏳ Kaydınız yönetimin onayını bekliyor. Onaylanınca iş listesine düşer ve herkes görür.</p>` : ""}
      ${k.gizli ? `<p class="gizli-not">🔒 YK iş emri: yalnızca yönetici, yönetim kurulu, muhasebe, müdür ve şef görür.</p>` : ""}
      <h1>${kac(k.yer)}</h1>
      <p style="margin:0 0 6px">${kac(k.sorun)}</p>
      <div class="fotolar">
        ${fotoKutu(k.foto_once_url, "Sorun", "Fotoğraf yok")}
        ${fotoKutu(k.foto_sonra_url, "Yapıldı", k.durum === "tamam" ? "Fotoğraf eklenmedi" : "Henüz yapılmadı")}
      </div>
      <dl class="alanlar">
        <dt>Kayıt no</dt><dd>${kac(k.no)}</dd>
        <dt>Bildiren</dt><dd>${kac(k.bildiren)}</dd>
        <dt>Bildirim</dt><dd>${tarihSaat(k.created_at)}</dd>
        ${k.yanit ? `<dt>Cevap</dt><dd>💬 ${kac(k.yanit)}<br><small>${kac(k.yanit_veren || "")} · ${tarihSaat(k.yanit_at)}</small></dd>` : ""}
        ${gorulmeGorur() ? gorulmeAlanlari(k) : ""}
        ${k.son_tarih && !(k.gizli && sureGormez()) ? `<dt>Son gün</dt><dd>${new Date(k.son_tarih + "T00:00:00").toLocaleDateString("tr-TR")} ${sureYazisi(k)}</dd>` : ""}
        ${k.durum === "tamam" ? `
        <dt>Yapan</dt><dd>${kac(k.kapatan || "—")}</dd>
        <dt>Yapıldı</dt><dd>${tarihSaat(k.kapanis_at)}</dd>
        ${k.sonuc ? `<dt>Not</dt><dd>${kac(k.sonuc)}</dd>` : ""}` : ""}
      </dl>
      ${k.gizli ? `
      <div class="islem yk-cevaplar">
        <h2>💬 Cevaplar</h2>
        ${(k.cevaplar || []).length ? k.cevaplar.map((c, i) => `
        <div class="yk-cevap"><span class="cevap-verildi">✅ CEVAP VERİLDİ</span><p>${kac(c.metin)}</p><small>${kac(c.ad)} · ${tarihSaat(c.at)}</small>${cevapGorulmeHtml(k, i + 1)}</div>`).join("")
          : `<p class="ipucu" style="margin:0">Henüz cevap yazılmadı.</p>`}
        ${kayitOnaylar() ? `
        <button type="button" class="ana-dugme" id="yk-cevap-ac">💬 Cevap Ver</button>
        <form id="yk-cevap-form" hidden>
          <textarea name="metin" rows="3" maxlength="1000" required placeholder="Cevabınızı yazın"></textarea>
          <button type="submit" class="ana-dugme">Gönder</button>
          <small class="ipucu">Yönetim Kurulu bölümündeki herkes (yönetici, yönetim kurulu, muhasebe, müdür, şef) görür ve bildirim alır.</small>
        </form>` : ""}
      </div>` : ""}
      ${k.temsilci_id && (k.temsilcisiyim || (k.temsilci_cevaplari?.length && (k.benim || yonetici()))) ? `
      <div class="islem yk-cevaplar">
        <h2>💬 Parsel temsilcisinin cevabı</h2>
        ${(k.temsilci_cevaplari || []).length ? k.temsilci_cevaplari.map((c) => `
        <div class="yk-cevap"><p>${kac(c.metin)}</p><small>${kac(c.ad)} · ${tarihSaat(c.at)}</small></div>`).join("")
          : `<p class="ipucu" style="margin:0">Henüz cevap yazılmadı.</p>`}
        ${k.temsilcisiyim ? `
        <button type="button" class="ana-dugme" id="tm-cevap-ac">💬 Cevap Ver</button>
        <form id="tm-cevap-form" hidden>
          <textarea name="metin" rows="3" maxlength="1000" required placeholder="Ortağa cevabınızı yazın"></textarea>
          <button type="submit" class="ana-dugme">Gönder</button>
          <small class="ipucu">Cevabınız kaydı yazan ortağa bildirim olarak gider.</small>
        </form>` : ""}
      </div>` : ""}
      ${kapat ? `
      <form class="islem" id="kapat-form">
        <h2>Sorunu giderdiniz mi?</h2>
        <div class="foto-alan">
          <img id="sonra-onizleme" alt="" hidden>
          <label class="foto-dugme"><input id="sonra-foto" type="file" accept="image/*" capture="environment" hidden><span id="sonra-yazi">📷 Yapılan işin fotoğrafını çek</span></label>
          <small class="ipucu">Fotoğraf isteğe bağlıdır; fotoğrafsız da "Yapıldı" girebilirsiniz.</small>
          <label class="foto-dugme galeri-dugme"><input id="sonra-galeri" type="file" accept="image/*" hidden><span>🖼️ Galeriden Fotoğraf Yükle</span></label>
        </div>
        <label>Not (isteğe bağlı)
          <textarea name="sonuc" rows="2" maxlength="2000" placeholder="Örn. Batarya değiştirildi"></textarea>
        </label>
        <button class="ana-dugme" type="submit">✔ Yapıldı</button>
      </form>` : ""}
      ${kayitOnaylar() && k.durum !== "tamam" && !bekliyor ? `${k.gizli ? "" /* YK iş emrinde cevap yazılmaz: emri zaten yönetim verdi */ : `
      <div class="islem">
        <h2>Cevap yaz</h2>
        <p class="cevap-cumle">Bu iş <b id="cevap-gun">…</b> gün içinde yapılacaktır.</p>
        <div class="sure-sec" id="cevap-sec">
          ${[1, 2, 3, 5, 7, 10, 15, 30].map((g) => `<button type="button" data-gun="${g}">${g} gün</button>`).join("")}
        </div>
        <button type="button" class="ana-dugme" id="cevap-gonder" disabled>💬 Cevabı gönder</button>
        <small class="ipucu">İş "Yapıldı" olmadan herkese bildirilir. Son gün bugünden itibaren bu süreye göre değişir.</small>
      </div>`}
      <div class="islem">
        <h2>Yapılma süresi</h2>
        ${!k.gizli || k.benim || k.bildiren === oturum.ad || ["mudur", "sef", "muhasebe"].includes(k.veren_rol) ? `
        <div class="sure-sec" id="sure-sec">
          ${[1, 2, 3, 5, 7, 10, 15, 30].map((g) => `<button type="button" data-gun="${g}" class="${sureGun(k) === g ? "secili" : ""}">${g} gün</button>`).join("")}
        </div>
        <small class="ipucu">Kaydın açıldığı günden itibaren sayılır. Süre dolunca iş listede yanıp söner.</small>` : `
        <p class="sure-kilit"><b>${sureGun(k) ?? "—"} gün</b> · 🔒 Bu YK iş emrinin süresini yalnızca emri veren <b>${kac(k.bildiren)}</b> değiştirebilir.</p>`}
        <div class="uye">
          <div><b>Yeni işlerin süresi: ${varsSure ?? "—"} gün</b><br><small>Her yeni kayda kendiliğinden verilir.</small></div>
          <div class="uye-dugmeler"><button type="button" class="kucuk-dugme" id="vars-sure">Değiştir</button></div>
        </div>
      </div>` : ""}
      ${yonetici() ? `
      <div class="islem">
        <button type="button" class="ikincil tehlike" id="kayit-sil" style="width:100%">🗑 Bu kaydı sil</button>
        <small class="ipucu">Yalnızca yönetici görür. Uygun olmayan kaydı fotoğraflarıyla birlikte herkesten kaldırır.</small>
      </div>` : ""}`;
    goster("detay");
    cevapOkundu(k); // açıldı: listede artık yanıp sönmez (bu ekranda okunmamışlar yanıp sönmeye devam eder)
    if (kapat) kapatBagla(k);
    // Müdür ve şef kaydı açınca yönetici görsün (ilk açış saklanır)
    if (["mudur", "sef", "yonetim", "muhasebe"].includes(oturum.rol) && k.durum !== "tamam" && !gorulduGonderilen.has(k.id)) {
      gorulduGonderilen.add(k.id);
      api("goruldu", { id: k.id }).catch(() => gorulduGonderilen.delete(k.id));
    }
    $("#yk-cevap-ac")?.addEventListener("click", (e) => {
      e.target.hidden = true; $("#yk-cevap-form").hidden = false; $("#yk-cevap-form textarea").focus();
    });
    $("#yk-cevap-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = e.target.querySelector("button[type=submit]"), metin = e.target.metin.value.trim();
      if (!metin) return;
      d.disabled = true; d.textContent = "Gönderiliyor…";
      try {
        Object.assign(k, await api("yk_cevap", { id: k.id, metin }));
        sakla.koy("sk_gorulen", [anahtar(k), ...(sakla.al("sk_gorulen") || [])]);
        cevapOkundu(k);
        listeCiz(); detayGoster(k.id);
        mesaj("Cevap gönderildi. Yönetim Kurulu bölümündekilere bildirildi.");
      } catch (err) { mesaj(err.message); d.disabled = false; d.textContent = "Gönder"; }
    });
    $("#tm-cevap-ac")?.addEventListener("click", (e) => {
      e.target.hidden = true; $("#tm-cevap-form").hidden = false; $("#tm-cevap-form textarea").focus();
    });
    $("#tm-cevap-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = e.target.querySelector("button[type=submit]"), metin = e.target.metin.value.trim();
      if (!metin) return;
      d.disabled = true; d.textContent = "Gönderiliyor…";
      try {
        Object.assign(k, await api("temsilci_cevap", { id: k.id, metin }));
        detayGoster(k.id);
        mesaj("Cevabınız ortağa gönderildi.");
      } catch (err) { mesaj(err.message); d.disabled = false; d.textContent = "Gönder"; }
    });
    let cevapGun = null;
    $("#cevap-sec")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-gun]"); if (!b) return;
      cevapGun = Number(b.dataset.gun);
      for (const x of $("#cevap-sec").children) x.classList.toggle("secili", x === b);
      $("#cevap-gun").textContent = cevapGun;
      $("#cevap-gonder").disabled = false;
    });
    $("#cevap-gonder")?.addEventListener("click", async (e) => {
      if (!cevapGun) return;
      e.target.disabled = true; e.target.textContent = "Gönderiliyor…";
      try {
        Object.assign(k, await api("cevap_ver", { id: k.id, gun: cevapGun }));
        listeCiz(); detayGoster(k.id);
        mesaj("Cevap gönderildi. Gruptaki herkes görecek.");
      } catch (err) { mesaj(err.message); e.target.disabled = false; e.target.textContent = "💬 Cevabı gönder"; }
    });
    $("#sure-sec")?.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-gun]"); if (!b) return;
      b.disabled = true;
      try {
        const r = await api("sure_degistir", { id: k.id, gun: Number(b.dataset.gun) });
        k.son_tarih = r.son_tarih;
        listeCiz(); detayGoster(k.id);
        mesaj(`Yapılma süresi ${b.dataset.gun} gün olarak ayarlandı.`);
      } catch (err) { mesaj(err.message); b.disabled = false; }
    });
    $("#vars-sure")?.addEventListener("click", async (e) => {
      const gun = prompt("Yeni işler kaç günde yapılsın? (1 ile 60 arası)", varsSure ?? "");
      if (!gun) return;
      e.target.disabled = true;
      try {
        await api("varsayilan_sure", { gun: Number(gun) });
        varsSure = Number(gun);
        detayGoster(k.id);
        mesaj(`Yeni işlerin süresi ${gun} gün olarak ayarlandı.`);
      } catch (err) { mesaj(err.message); e.target.disabled = false; }
    });
    $("#kayit-onayla")?.addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Onaylanıyor…";
      try {
        await api("kayit_onayla", { id: k.id });
        await yenile();
        if (!kayitlar.some(onayBekliyor)) filtre = "acik";
        detayGoster(k.id);
        mesaj("Onaylandı. İş listesine düştü, herkese bildirildi.");
      } catch (err) { mesaj(err.message); e.target.disabled = false; e.target.textContent = "✔ Onayla"; }
    });
    const reddet = async (d, metin) => {
      d.disabled = true;
      try {
        await api("kayit_reddet", { id: k.id, metin });
        kayitlar = kayitlar.filter((x) => x.id !== k.id);
        history.replaceState(null, "", location.pathname);
        goster("liste"); listeCiz();
        mesaj(k.temsilci_id ? "Kayıt reddedildi. Ortağa bildirim gönderildi." : "Kayıt reddedildi ve silindi.");
      } catch (err) { mesaj(err.message); d.disabled = false; }
    };
    $("#kayit-reddet")?.addEventListener("click", (e) => {
      // Parsel temsilcisi: reddederken ortağa isteğe bağlı cevap yazar
      if ($("#ret-form")) {
        $("#ret-form").hidden = false; e.target.closest(".dugmeler").hidden = true;
        return $("#ret-form textarea").focus();
      }
      if (confirm(`"${k.yer}" kaydı reddedilip silinsin mi?`)) reddet(e.target);
    });
    $("#ret-vazgec")?.addEventListener("click", () => {
      $("#ret-form").hidden = true; $("#kayit-reddet").closest(".dugmeler").hidden = false;
    });
    $("#ret-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      reddet(e.target.querySelector("button[type=submit]"), e.target.metin.value.trim());
    });
    $("#kayit-sil")?.addEventListener("click", async (e) => {
      if (!confirm(`${k.no} numaralı "${k.yer}" kaydı herkesten silinsin mi? Geri alınamaz.`)) return;
      e.target.disabled = true;
      try {
        await api("kayit_sil", { id: k.id });
        kayitlar = kayitlar.filter((x) => x.id !== k.id);
        history.replaceState(null, "", location.pathname);
        goster("liste"); listeCiz();
        mesaj("Kayıt silindi.");
      } catch (err) { mesaj(err.message); e.target.disabled = false; }
    });
  }

  function kapatBagla(k) {
    const form = $("#kapat-form");
    const foto = fotoSecici($("#sonra-foto"), $("#sonra-onizleme"), $("#sonra-yazi"), $("#sonra-galeri"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = form.querySelector("button[type=submit]");
      d.disabled = true; d.textContent = "Gönderiliyor…";
      try {
        // Fotoğraf isteğe bağlı: bazı işlerin fotoğrafı olmaz
        const yol = foto.al() ? await fotoYukle(foto.al()) : null;
        await api("kapat", { id: k.id, foto: yol, sonuc: new FormData(form).get("sonuc"), ad: oturum.ad });
        sakla.koy("sk_gorulen", [k.id + ":t", ...(sakla.al("sk_gorulen") || [])]);
        form.remove();
        await yenile();
        detayGoster(k.id);
        mesaj("Yapıldı olarak gönderildi. Gruptaki herkes görecek.");
      } catch (err) { mesaj(err.message); d.disabled = false; d.textContent = "✔ Yapıldı"; }
    });
  }

  // ---------- Bildirimler ----------
  const bildirimDestek = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  // Uygulama açılınca bildirim çubuğundaki Sporkent bildirimlerini ve simgedeki sayıyı temizle
  async function bildirimleriTemizle() {
    try { await navigator.clearAppBadge?.(); } catch {}
    if (!("serviceWorker" in navigator)) return;
    try {
      const kayit = await navigator.serviceWorker.ready;
      for (const b of await kayit.getNotifications()) b.close();
      // Android sayıyı bildirimlerden alır; kapatmayı bildirimi gösteren servis çalışanı da yapsın
      (navigator.serviceWorker.controller || kayit.active)?.postMessage({ tip: "temizle" });
    } catch {}
  }

  // İzin durumunu sunucuya bildir (yalnızca değişince): yönetici kimin bildirim alamadığını görür
  function izinBildir(izin) {
    if (sakla.al("sk_izin") === izin) return;
    api("izin_bildir", { izin }).then(() => sakla.koy("sk_izin", izin)).catch(() => {});
  }

  // Bu telefonda bildirim açık mı. iPhone izni bazen "reddedildi" bildirdiği hâlde abonelik duruyor:
  // iPhone'da kayıtlı bir abonelik varsa da açık sayılır (kimse yanlışlıkla dışarıda kalmasın)
  async function bildirimAbonelik() {
    try { return (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()) || null; } catch { return null; }
  }
  let izinOnay = false; // düğmeye dokununca telefon "izin verildi" dedi
  async function bildirimAcik() {
    if (!bildirimDestek()) return false;
    if (Notification.permission === "granted" || izinOnay) return true;
    return iosCihaz && !!(await bildirimAbonelik());
  }
  // Bildirimler açılmadan uygulama kullanılamaz. Ana ekrana eklenmemişse zaten kurulum ekranı çıkar; süren devriye bölünmez.
  // Bildirimi hiç desteklemeyen (eski) telefon kilitlenmez: kişinin açma imkânı yok, uygulamayı bildirimsiz kullanır.
  async function bildirimKilidi() {
    const k = $("#bildirim-kilit"), acik = kurulumGerekli() || !bildirimDestek() || izSuruyor() || (await bildirimAcik());
    k.hidden = acik;
    document.body.classList.toggle("kilitli", !acik);
    for (const e of document.body.children) if (e !== k && e.tagName !== "SCRIPT") e.inert = !acik;
    if (!acik) kilitCiz();
    return !acik;
  }
  function kilitCiz() {
    const d = $("#kilit-dugme"), m = $("#kilit-metin");
    if (Notification.permission === "denied") {
      d.textContent = "🔄 Açtım, kontrol et";
      m.innerHTML = `<p>Bildirim izni kapatılmış. Telefonun ayarlarından açın:</p>` + (iosCihaz
        ? `<ol><li>Telefonun <b>Ayarlar</b>'ını açın.</li><li><b>Bildirimler</b>'e dokunun.</li><li>Listeden <b>SPORKENT ASİSTAN</b>'ı (ya da Sporkent'i) bulun.</li><li><b>Bildirimlere İzin Ver</b>'i açın.</li><li>Uygulamayı kapatıp yeniden açın.</li></ol>`
        : `<ol><li>Ana ekrandaki <b>Sporkent</b> simgesine uzun basın.</li><li><b>Uygulama bilgisi</b> (ⓘ) yazısına dokunun.</li><li><b>Bildirimler</b>'e dokunup açın.</li><li>Uygulamayı kapatıp yeniden açın.</li></ol>`);
    } else {
      d.textContent = "🔔 Bildirimleri Aç";
      m.innerHTML = `<p>Duyurular ve haberler size bildirimle ulaşır. Aşağıdaki düğmeye dokunun, çıkan soruya <b>“İzin Ver”</b> deyin.</p>`;
    }
  }
  $("#kilit-dugme").addEventListener("click", async () => {
    const h = $("#kilit-hata"); h.hidden = true;
    // İzin sorusu yalnızca dokunma anında çıkar: öncesinde bekleme olmamalı
    let izin; try { izin = await Notification.requestPermission(); } catch { izin = Notification.permission; }
    if (izin === "granted") izinOnay = true;
    if (await bildirimKilidi()) {
      h.textContent = "Bildirimler hâlâ kapalı. Açmadan programı kullanamazsınız."; h.hidden = false;
      if (oturum?.anahtar) izinBildir(Notification.permission);
    } else if (oturum?.anahtar) bildirimAc(true);
  });
  // Ayarlardan dönünce kilit kendiliğinden kalkar / izin kapatıldıysa yeniden gelir
  document.addEventListener("visibilitychange", () => { if (!document.hidden) bildirimKilidi(); });
  for (const olay of ["pageshow", "focus"]) window.addEventListener(olay, () => bildirimKilidi());
  try { navigator.permissions?.query({ name: "notifications" }).then((x) => { x.onchange = () => { if (x.state !== "granted") izinOnay = false; bildirimKilidi(); }; }).catch(() => {}); } catch {}

  // Açılışta: bildirim açıksa sunucuya yeniden kaydol (kayıt silinmişse kendiliğinden düzelir), kapalıysa yöneticiye bildir
  async function bildirimKutusu() {
    if (!oturum?.vapid) return;
    if (!bildirimDestek()) return izinBildir("desteklenmiyor");
    if (await bildirimAcik()) return bildirimAc(true);
    izinBildir(Notification.permission);
  }

  function base64Bayt(s) {
    const p = "=".repeat((4 - (s.length % 4)) % 4);
    const b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }

  async function bildirimAc(sessiz) {
    try {
      // Sessiz çağrıda izin SORULMAZ: iPhone dokunma dışındaki soruyu reddedebiliyor
      const izin = !sessiz && Notification.permission !== "granted" ? await Notification.requestPermission() : izinOnay ? "granted" : Notification.permission;
      const kayit = await navigator.serviceWorker.ready;
      let abonelik = await kayit.pushManager.getSubscription();
      if (izin !== "granted" && !(iosCihaz && abonelik)) {
        izinBildir(izin);
        if (!sessiz) mesaj("Bildirim izni verilmedi. Telefon ayarlarından açabilirsiniz.");
        return;
      }
      if (!abonelik) abonelik = await kayit.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Bayt(oturum.vapid) });
      await api("abone_ol", { abonelik: abonelik.toJSON() });
      sakla.koy("sk_abone", oturum.rol); sakla.koy("sk_izin", "granted");
      if (!sessiz) mesaj("Bildirimler açıldı.");
    } catch (e) { if (!sessiz) mesaj("Bildirim açılamadı: " + e.message); }
  }

  // ---------- Giriş / onay bekleme / çıkış ----------
  function cikisYap() {
    oturum = null; sakla.sil("sk_oturum"); sakla.sil("sk_abone"); sakla.sil("sk_gorulen"); sakla.sil("sk_parsel"); parsel = null;
    kayitlar = []; bekleyenSayisi = 0; clearInterval(bekleZamani); girisEkrani(); goster("giris");
  }

  // Kodu girdikten sonra yönetici onaylayana kadar bu ekran görünür; onaylanınca kendiliğinden açılır.
  let bekleZamani = null;
  function bekleEkrani() {
    goster("bekle");
    $("#bekle-ad").textContent = oturum.ad;
    $("#bekle-rol").textContent = oturum.unvan || ROL_ADI[oturum.rol] || "";
    // Ortak yakınının başvurusu parsel temsilcisine, diğerleri yöneticiye gider
    const yakin = /Yakını/.test(oturum.unvan || "");
    $("#bekle-not").hidden = !yakin;
    $("#bekle-metin").textContent = yakin
      ? "Parsel temsilciniz onay verdikten sonra uygulama bu telefonda kendiliğinden açılır."
      : "Kaydınız yöneticiye (Yönetim Kurulu Başkanı) iletildi. Onaylandığında bu ekran kendiliğinden açılır.";
    if (!yakin) $("#bekle-temsilci").innerHTML = "";
    $("#bekle-metin").hidden = false;
    bildirimKutusu();
    clearInterval(bekleZamani);
    bekleZamani = setInterval(durumKontrol, 10000);
    if (yakin) durumKontrol(); // temsilci bilgisi hemen gelsin
  }
  // Onay bekleyen yakına parsel temsilcisinin kartı (resim, ad, telefon, Ara / WhatsApp / Mesaj)
  function bekleTemsilciCiz(t) {
    // Temsilci yoksa tek parça not; altında yalnızca müdür ve muhasebenin telefonları
    $("#bekle-not").innerHTML = t
      ? `⚠️ Girilen bilgiler kooperatifteki bilgilerle eşleşmiyor.<br><b>Lütfen parsel temsilciniz ile görüşün.</b>`
      : `⚠️ Girilen bilgiler kooperatifteki bilgilerle eşleşmiyor. Bu ortağın bulunduğu parselde <b>PARSEL TEMSİLCİSİ</b> belirlenmemiş. Bu nedenle <b>Kooperatif yönetimiyle görüşün.</b>`;
    $("#bekle-metin").textContent = "Parsel temsilciniz onay verdikten sonra uygulama bu telefonda kendiliğinden açılır.";
    $("#bekle-metin").hidden = !t;
    $("#bekle-temsilci").innerHTML = t ? temsilciKart(t)
      : `<a class="iletisim-satir" href="tel:+905413253019"><span class="iletisim-ikon ara">📞</span><span><small>Müdür</small><b>0541 325 30 19</b><em>Aramak için dokunun</em></span></a>
        <a class="iletisim-satir" href="tel:+905413253021"><span class="iletisim-ikon ara">📞</span><span><small>Muhasebe</small><b>0541 325 30 21</b><em>Aramak için dokunun</em></span></a>`;
  }

  async function durumKontrol() {
    if (!oturum?.anahtar) return clearInterval(bekleZamani);
    try {
      const r = await api("durum");
      if (r.durum === "bekliyor" && /Yakını/.test(r.unvan || "")) bekleTemsilciCiz(r.temsilci);
      if (r.durum === "onayli") {
        clearInterval(bekleZamani);
        Object.assign(oturum, { durum: "onayli", rol: r.rol });
        sakla.koy("sk_oturum", oturum);
        await basla();
        mesaj("Gruba kabul edildiniz.");
      }
    } catch {}
  }

  // ---------- Giriş ekranı: ana ekrana ekleme, ortak kaydı, görevli girişi ----------
  const ua = navigator.userAgent;
  const iosCihaz = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const androidCihaz = /android/i.test(ua);
  const anaEkranda = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // WhatsApp, Instagram, Facebook gibi uygulamaların içindeki tarayıcı ana ekrana ekleyemez
  const uygulamaIci = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|GSA\//i.test(ua);
  let kurulumIstegi = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); kurulumIstegi = e; });
  window.addEventListener("appinstalled", () => kurAdim(`✅ <b>Eklendi.</b> Şimdi bu sayfayı kapatın ve ana ekrandaki <b>Sporkent</b> simgesine dokunun.`));

  // Telefonda ana ekrana eklenmemiş (tarayıcıda açılmış) uygulama kullanılamaz: ortak, görevli, yönetici herkes için
  // Bilgisayarda (telefon ya da tablet değil) hiç kullanılamaz
  const masaustu = !(iosCihaz || androidCihaz);
  const kurulumGerekli = () => masaustu || !anaEkranda();

  // Linkten gelen seçim (…?giris=ortak / ?giris=tg, eski TG linki …?tg=1).
  // iPhone ana ekran uygulaması Safari'nin hafızasını görmez; orada seçim ekranı çıkar.
  if (/[?&](tg|giris=tg)/.test(location.search)) sakla.koy("sk_tg", 1);
  if (/[?&]giris=ortak/.test(location.search)) sakla.koy("sk_tg", 0);
  // kodla: true = şahsi kodla giriş, false = ortak kaydı, null = önce seçim ekranı
  function girisEkrani(kodla = ({ 1: true, 0: false })[sakla.al("sk_tg")] ?? null) {
    const kurulmali = kurulumGerekli();
    $("#kurulum").hidden = !kurulmali;
    $("#giris-secim").hidden = kurulmali || kodla !== null;
    $("#kayit-form").hidden = kurulmali || kodla !== false;
    $("#giris-form").hidden = kurulmali || kodla !== true;
    kayitModu(!!sakla.al("sk_yakin"));
    // iPhone'da hiçbir site kendini ana ekrana ekleyemez: tuş yerine adımlar hemen görünsün
    if (kurulmali && iosCihaz) { $("#kur-dugme").hidden = true; kurAdim(iosAdimlari()); }
    if (kurulmali && masaustu) {
      $("#kurulum").innerHTML = `<div class="kurulum-simge"><img src="icons/logo-192.png" alt="" width="84" height="84"></div>
        <h1>Telefonunuzdan açın</h1>
        <p class="kurulum-metin">Bu otomasyon <b>yalnızca telefondan</b> kullanılabilir. Bilgisayardan kullanılamaz.</p>
        <p class="kur-adim">Aşağıdaki bağlantıyı telefonunuzda açın, sonra ana ekranınıza ekleyin:<br><b class="masaustu-link">tinyurl.com/sporkent-takip</b></p>`;
    }
  }

  // Kayıt formu iki biçimde: kooperatif ortağı ya da ortağın yakını (eşi, çocuğu, damadı, misafiri…)
  function kayitModu(yakin) {
    $("#kayit-baslik").textContent = yakin ? "Ortak yakını kaydı" : "Ortak kaydı";
    $("#kayit-aciklama").innerHTML = yakin
      ? "Yakını olduğunuz ortağın adını ve ortaklık numarasını, sonra kendi cep telefonunuzu yazın. Telefonunuz ortağın kooperatifteki kaydında varsa uygulama <b>hemen açılır</b>; yoksa parsel temsilcisi onaylayınca açılır."
      : "Bilgilerinizi yazın. Cep telefonunuz kooperatifte kayıtlı numaranızsa uygulama <b>hemen açılır</b>. Şifre ya da kod gerekmez.";
    $("#ad-etiket").textContent = yakin ? "Ortağın adı ve soyadı" : "Adınız ve soyadınız";
    $("#no-etiket").textContent = yakin ? "Ortağın ortaklık numarası" : "Ortaklık numaranız";
    $("#tel-etiket").textContent = yakin ? "Kendi cep telefonunuz" : "Cep telefonunuz";
    $("#kayit-form").ad_soyad.placeholder = yakin ? "Örn. Ahmet Yılmaz (ortağın adı)" : "Örn. Ayşe Yılmaz";
    $("#tel-ipucu").textContent = yakin
      ? "Kendi cep telefonunuzu yazın. Yurt dışı numarası ise başına + koyun (örn. +49 …)."
      : "Kooperatifte kayıtlı cep telefonunuzu yazın. Başka bir numara yazarsanız kaydınız yönetimin onayına gider. Yurt dışı numarası ise başına + koyun (örn. +49 …).";
    $("#mod-degistir").innerHTML = yakin ? "🏠 Kooperatif ortağıysanız <b>buraya dokunun</b>" : "👨‍👩‍👧 Ortağın yakınıysanız (eşi, çocuğu, misafiri…) <b>buraya dokunun</b>";
  }
  $("#mod-degistir").addEventListener("click", () => { const y = !sakla.al("sk_yakin"); sakla.koy("sk_yakin", y ? 1 : 0); kayitModu(y); window.scrollTo(0, 0); });

  function iosAdimlari() {
    if (uygulamaIci) return `<ol class="ios-adim">
        <li>Bu sayfa WhatsApp gibi bir uygulamanın içinde açıldı. Sağ alttaki <b>pusula 🧭</b> ya da <b>⋯</b> simgesine dokunup <b>“Safari'de Aç”</b>ı seçin.</li>
        <li>Safari'de açılınca buradaki adımlar çıkar.</li></ol>`;
    if (/CriOS/i.test(ua)) return `<p class="kur-not">iPhone'da Chrome ile 3 adım:</p><ol class="ios-adim">
        <li>Sağ üstte, adres çubuğundaki <b>Paylaş</b> <span class="paylas-simge">⬆</span> simgesine dokunun.</li>
        <li>Açılan listede <b>“Ana Ekrana Ekle”</b>ye dokunun.</li>
        <li>Sağ üstteki <b>“Ekle”</b>ye dokunun.</li></ol>`;
    // Diğer tarayıcılarda (Edge, Firefox, Opera, DuckDuckGo, Yandex) menüler başka: Safari'ye yönlendir
    if (/EdgiOS|FxiOS|OPiOS|OPT\/|OPX\/|DuckDuckGo|Ddg\/|YaBrowser/i.test(ua)) return `<p class="kur-not">Bu sayfayı <b>Safari ile açın</b>:</p><ol class="ios-adim">
        <li>Aşağıdaki tuşa basın, bağlantı kopyalanır.</li>
        <li>Telefonunuzdaki <b>Safari</b> 🧭 uygulamasını açın.</li>
        <li>Adres çubuğuna basılı tutup <b>“Yapıştır ve Git”</b>e dokunun. Adımlar orada çıkar.</li></ol>
      <button id="link-kopyala" class="ana-dugme" type="button">🔗 Bağlantıyı kopyala</button>`;
    const ekle = `<li>Listeyi yukarı kaydırıp <b>“Ana Ekrana Ekle”</b>ye dokunun.<br><small>Listede yoksa en alttaki <b>“Eylemleri Düzenle”</b>ye dokunup oradan ekleyin.</small></li>
        <li>Sağ üstteki <b>“Ekle”</b>ye dokunun. Sporkent simgesi ana ekranınıza gelir.</li>`;
    const paylas = `<span class="paylas-simge">⬆</span>`;
    const altOrta = `<li>Ekranın en altında, <b>tam ortadaki</b> ${paylas} <b>Paylaş</b> simgesine dokunun.<br><small>Görünmüyorsa sayfayı biraz aşağı çekin.</small></li>`;
    const ucNokta = `<li>Ekranın en altında, sağdaki <b class="ios-uc">⋯</b> (üç nokta) simgesine dokunun.<br><small>⋯ görünmüyor, ${paylas} Paylaş görünüyorsa ona dokunup 3. adıma geçin.</small></li>
        <li>Açılan menüde <b>“Paylaş”</b>a dokunun.</li>`;
    if (/ipad|macintosh/i.test(ua)) return `<p class="kur-not">iPad'de <b>3 adım:</b></p><ol class="ios-adim">
        <li>Sağ üstteki ${paylas} <b>Paylaş</b> simgesine dokunun.</li>${ekle}</ol>`;
    // Safari'nin yeri iOS 26'da değişti. "iPhone OS" numarası orada donuk (18_x) olduğundan Version/ okunur.
    const safari = +(ua.match(/Version\/(\d+)/)?.[1] || 0);
    if (!safari) return `<p class="kur-not">Ekranınızın en altına bakın:</p>
      <p class="kur-not"><b>⋯ (üç nokta) yoksa:</b></p><ol class="ios-adim">${altOrta}${ekle}</ol>
      <p class="kur-not"><b>⋯ (üç nokta) varsa:</b></p><ol class="ios-adim">${ucNokta}${ekle}</ol>`;
    if (safari < 26) return `<p class="kur-not">iPhone'da ekleme, telefonun kendi menüsünden yapılır. <b>3 adım:</b></p>
      <ol class="ios-adim">${altOrta}${ekle}</ol>
      <div class="ios-ok orta">↓</div>`;
    return `<p class="kur-not">iPhone'da ekleme, telefonun kendi menüsünden yapılır. <b>4 adım:</b></p>
      <ol class="ios-adim">${ucNokta}${ekle}</ol>
      <div class="ios-ok">↘</div>`;
  }
  $("#kur-adim").addEventListener("click", async (e) => {
    if (!e.target.closest("#link-kopyala")) return;
    const adres = location.href.split("#")[0];
    try { await navigator.clipboard.writeText(adres); mesaj("Bağlantı kopyalandı. Şimdi Safari'yi açıp yapıştırın."); }
    catch { prompt("Bağlantıyı seçip kopyalayın:", adres); }
  });
  // Şahsi kodla giriş düğmesi ortaklara gösterilmez: TG / YK üyeleri kendi linkiyle gelir.
  // Link bilgisi kaybolursa (iPhone ana ekran uygulaması), giriş ekranlarında üst banttaki logoya art arda 5 kez dokunulunca açılır.
  let gizliDokunus = 0, gizliZaman = null;
  $(".ust").addEventListener("click", () => {
    if (onayli() || !$("#ekran-giris") || $("#ekran-giris").hidden) return;
    gizliDokunus++; clearTimeout(gizliZaman); gizliZaman = setTimeout(() => (gizliDokunus = 0), 2500);
    if (gizliDokunus >= 5) { gizliDokunus = 0; sakla.koy("sk_tg", 1); girisEkrani(true); window.scrollTo(0, 0); }
  });
  $("#kayda-don").addEventListener("click", () => { sakla.sil("sk_tg"); girisEkrani(null); window.scrollTo(0, 0); });
  $("#sec-ortak").addEventListener("click", () => { sakla.koy("sk_tg", 0); sakla.koy("sk_yakin", 0); girisEkrani(false); window.scrollTo(0, 0); });
  $("#sec-tg").addEventListener("click", () => { sakla.koy("sk_tg", 1); sakla.koy("sk_yakin", 0); girisEkrani(true); window.scrollTo(0, 0); });
  $("#sec-yakin").addEventListener("click", () => { sakla.koy("sk_tg", 0); sakla.koy("sk_yakin", 1); girisEkrani(false); window.scrollTo(0, 0); });
  // Davet kodu kutusuna harfli şahsi kod yazılırsa (TG / YK üyesi yanlış forma geldi): şahsi kodla girişe geç
  $("#kayit-form [name=davet_kodu]")?.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    if (!/\p{L}/u.test(v)) return;
    const ad = $("#kayit-form [name=ad_soyad]").value.trim();
    e.target.value = "";
    sakla.koy("sk_tg", 1); girisEkrani(true); window.scrollTo(0, 0);
    const f = $("#giris-form");
    if (ad && !f.ad.value) f.ad.value = ad;
    f.kod.value = v; (f.ad.value ? f.kod : f.ad).focus();
    mesaj("Harfli kod şahsi koddur: şahsi kodla giriş ekranına geçildi.");
  });

  function kurAdim(html) { const k = $("#kur-adim"); k.innerHTML = html; k.hidden = false; }

  $("#kur-dugme").addEventListener("click", async () => {
    const adres = location.href.split("#")[0];
    if (kurulumIstegi) {
      kurulumIstegi.prompt();
      const { outcome } = await kurulumIstegi.userChoice;
      kurulumIstegi = null;
      if (outcome === "accepted") kurAdim(`✅ <b>Ekleniyor…</b> Birkaç saniye sonra bu sayfayı kapatın ve ana ekrandaki <b>Sporkent</b> simgesine dokunun.`);
      else kurAdim(`Eklemediniz. Uygulamayı kullanmak için <b>📲 Ana Ekrana Ekle</b> tuşuna tekrar basıp <b>Yükle</b>'yi seçin.`);
      return;
    }
    if (iosCihaz) return kurAdim(iosAdimlari());
    // Android: Chrome ekleme penceresini açmadıysa (başka tarayıcı, uygulama içi ya da zaten ekli)
    const chrome = `intent://${adres.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
    kurAdim(`<ol>
      <li>Sağ üstteki <b>⋮</b> (üç nokta) menüsüne dokunun.</li>
      <li><b>“Ana ekrana ekle”</b> ya da <b>“Uygulamayı yükle”</b>yi seçin, sonra <b>Ekle / Yükle</b>'ye dokunun.</li>
    </ol>
    <p class="kur-not">Menüde bu seçenek yoksa sayfayı Chrome'da açın:</p>
    <a class="ikincil chrome-ac" href="${chrome}">Chrome'da aç</a>
    <p class="kur-not">Daha önce eklediyseniz ana ekrandaki <b>Sporkent</b> simgesinden açın.</p>`);
  });

  $("#kayit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const hata = $("#kayit-hata"); hata.hidden = true;
    const d = e.target.querySelector("button[type=submit]"); d.disabled = true;
    try {
      const r = await api("ortak_kayit", { ad_soyad: String(f.get("ad_soyad")), ortak_no: String(f.get("ortak_no")), telefon: String(f.get("telefon")),
        yakin: !!sakla.al("sk_yakin") });
      oturum = { ad: r.ad, rol: r.rol, unvan: r.unvan, durum: r.durum, anahtar: r.anahtar, vapid: r.vapid };
      sakla.koy("sk_oturum", oturum);
      await basla();
      if (r.durum === "onayli") mesaj("Hoş geldiniz.");
    } catch (err) {
      oturum = null; hata.textContent = err.message; hata.hidden = false;
    } finally { d.disabled = false; }
  });

  async function girisYap(ad, kod) {
    const r = await api("giris", { ad, kod });
    oturum = { ad: r.ad || ad, rol: r.rol, unvan: r.unvan || null, durum: r.durum, anahtar: r.anahtar, vapid: r.vapid };
    sakla.koy("sk_oturum", oturum);
    return r;
  }

  let swHazir = false;
  async function basla() {
    if (!swHazir && "serviceWorker" in navigator) {
      swHazir = true;
      // Yeni sürüm yüklenince sayfayı bir kez yenile, eski ekran kalmasın.
      const ilkKontrol = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (ilkKontrol) location.reload(); });
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((k) => k.update()).catch(() => {});
      // Uygulama açıkken bildirim gelirse hemen tazele (pencere ve ses yenileriAc'tan)
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data?.tip !== "bildirim" || !oturum) return;
        if (!onayli()) return durumKontrol();
        // Uygulama önündeyken gelen bildirim zaten ekranda açılıyor; çubukta ve simgede birikmesin
        // Duyuru ve restoran bildirimi çubukta kalır: paylaşan kişi de bildirimin geldiğini görür
        if (!document.hidden && !["duyuru", "restoran"].includes(e.data.sayfa)) bildirimleriTemizle();
        if (e.data.sayfa === "uyeler") yonetimAc();
        else if (e.data.sayfa === "aidat") { if (!$("#ekran-aidat").hidden) aidatAc(); }
        else if (e.data.sayfa === "program") { if (!$("#ekran-program").hidden) programAc(); }
        else if (e.data.sayfa === "duyuru" || e.data.sayfa === "restoran") { if (!$("#ekran-" + e.data.sayfa).hidden) paylasimAc(e.data.sayfa); }
        else yenile();
      });
    }
    bildirimKilidi();
    if (!oturum || kurulumGerekli()) { girisEkrani(); return goster("giris"); }
    // Eski sürümden kalan oturum (kodla çalışıyordu): bir kez kodla katılım isteği gönder
    if (!oturum.anahtar) {
      if (!oturum.kod) return cikisYap();
      try { await girisYap(oturum.ad, oturum.kod); } catch { return cikisYap(); }
    }
    if (oturum.durum !== "onayli") return bekleEkrani();
    clearInterval(bekleZamani);
    bildirimleriTemizle();
    try { devriyeDevam(); } catch {}
    // Kullanım raporu için: açılış sayılır, ana ekrana eklenmişse bildirilir
    api("durum", { acilis: true, kurulu: anaEkranda() }).then((r) => {
      if (!r || r.durum !== "onayli") return;
      const once = JSON.stringify([oturum.ad, oturum.rol, oturum.unvan]);
      Object.assign(oturum, { ad: r.ad || oturum.ad, rol: r.rol || oturum.rol, unvan: r.unvan ?? null });
      if (once === JSON.stringify([oturum.ad, oturum.rol, oturum.unvan])) return;
      sakla.koy("sk_oturum", oturum);
      if (!$("#ekran-ana").hidden) anaAc();
    }).catch(() => {});
    if (!location.hash || location.hash === "#ana") anaAc(); else goster("liste");
    bildirimKutusu();
    await yenile();
    if (!location.hash || location.hash === "#ana") return anaAc();
    if (location.hash === "#servis") return servisAc();
    if (location.hash === "#parsel") return parselAc();
    if (location.hash === "#yakinlar") return yakinlarAc();
    if (location.hash === "#plaka") return plakaAc();
    if (location.hash === "#restoran") return restoranAc();
    if (location.hash === "#duyuru") return duyuruAc();
    if (location.hash === "#rapor" && yonetici()) return raporAc();
    if (location.hash === "#uyeler" && yonetici()) return yonetimAc();
    if (location.hash === "#aidat") return aidatAc();
    if (location.hash === "#iletisim") return iletisimAc();
    if (location.hash === "#yonetim-isleri") return yonetimIsleriAc();
    if (location.hash === "#yk-saha") return ykSahaAc();
    if (location.hash === "#program") return programAc();
    if (location.hash === "#sokak-numaralari") return sokaklarAc();
    if (location.hash === "#devriye") return devriyeAc();
    if (location.hash.startsWith("#gorevler")) return gorevlerAc(location.hash === "#gorevler-haftalik" ? "haftalik" : "gunluk");
    const m = location.hash.match(/^#kayit-(\d+)$/);
    if (m) detayGoster(Number(m[1]));
  }

  $("#giris-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const hata = $("#giris-hata"); hata.hidden = true;
    const d = e.target.querySelector("button"); d.disabled = true;
    try {
      const r = await girisYap(String(f.get("ad")).trim(), String(f.get("kod")).trim());
      await basla();
      if (r.durum === "onayli") mesaj(r.rol === "uye" ? "Hoş geldiniz." : `${ROL_ADI[r.rol]} olarak giriş yapıldı.`);
    } catch (err) {
      oturum = null; hata.textContent = err.message; hata.hidden = false;
    } finally { d.disabled = false; }
  });

  // ---------- Yönetici paneli (YK başkanı) ----------
  const ROL_SIRASI = ["baskan", "mudur", "sef", "yonetim", "muhasebe", "uye"];
  const MAKS_UYE = 400; // sunucudaki sınırla aynı
  const sonGorulme = (t) => t ? "Son görülme: " + tarihSaat(t) : "";

  async function yonetimAc() {
    if (!yonetici()) return;
    if (location.hash !== "#uyeler") history.replaceState(null, "", "#uyeler");
    goster("yonetim");
    $("#yonetim").innerHTML = `<p class="bos">Yükleniyor…</p>`;
    try {
      const [{ uyeler }, { kodlar, varsayilan_sure }, { tg }] = await Promise.all([api("uye_listesi"), api("kodlar"), api("tg_listesi")]);
      yonetimCiz(uyeler, kodlar, varsayilan_sure, tg);
    } catch (e) { $("#yonetim").innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }

  function bildirimDurumu(u) {
    if (u.bildirim) return `<br><small class="bildirim-acik">🔔 Bildirim açık</small>`;
    const neden = {
      denied: "telefonda izin reddedilmiş",
      "ios-tarayici": "iPhone'da ana ekrana eklenmemiş",
      desteklenmiyor: "tarayıcı desteklemiyor",
    }[u.bildirim_izni] || "bildirimleri açmamış";
    return `<br><small class="bildirim-kapali">🔕 Bildirim kapalı · ${neden}</small>`;
  }

  function uyeSatiri(u, dugmeler, uyari = "") {
    const tel = u.telefon ? ` · <a href="tel:${kac(u.telefon.replace(/\s/g, ""))}">📞 ${kac(u.telefon)}</a>` : "";
    return `<div class="uye">
      <div><b>${kac(u.ad)}</b>${u.ben ? " (siz)" : ""}<br><small>${kac(u.unvan || ROL_ADI[u.rol] || u.rol)}${tel} · ${kac(sonGorulme(u.son_gorulme) || "Başvuru: " + tarihSaat(u.created_at))}</small>
        ${u.durum === "onayli" ? bildirimDurumu(u) : ""}</div>
      ${uyari ? `<div class="uye-uyari">${uyari}</div>` : ""}
      <div class="uye-dugmeler${uyari ? " altta" : ""}">${u.ben ? "" : dugmeler}</div>
    </div>`;
  }

  function yonetimCiz(uyeler, kodlar, varsSure, tg = []) {
    const bekleyen = uyeler.filter((u) => u.durum === "bekliyor");
    const gruptakiler = uyeler.filter((u) => u.durum === "onayli")
      .sort((a, b) => ROL_SIRASI.indexOf(a.rol) - ROL_SIRASI.indexOf(b.rol) || a.ad.localeCompare(b.ad, "tr"));
    const cikan = uyeler.filter((u) => u.durum === "cikarildi");
    bekleyenSayisi = bekleyen.length;
    // Aynı ortaklık numarasıyla gruptaki biri varsa onaylamadan önce uyar
    const yakinMi = (x) => /Yakını/.test(x.unvan || "");
    const ayniNo = (u) => {
      const ayniNoluar = u.ortak_no ? uyeler.filter((x) => x.cihaz !== u.cihaz && x.ortak_no === u.ortak_no && x.durum !== "cikarildi") : [];
      let ek = "";
      if (yakinMi(u)) {
        // Yakın onaylanınca kimse silinmez; ortağın gruptaki kayıtları bilgi olarak gösterilir
        const ortak = ayniNoluar.filter((x) => !yakinMi(x));
        ek = ortak.length ? `<br><small class="ayni-no">ℹ️ Ortağın kendisi grupta: <b>${ortak.map((x) => kac(x.ad)).join(", ")}</b></small>` : `<br><small class="ayni-no">ℹ️ Bu ortağın kendisi henüz uygulamada değil.</small>`;
      } else {
        // Bir ortak birden fazla telefondan girebilir: onaylamak eski kayıtları silmez
        const k = ayniNoluar.filter((x) => !yakinMi(x));
        ek = k.length ? `<br><small class="ayni-no">ℹ️ Bu ortak başka telefonla da kayıtlı: ${k.map((x) => `<b>${kac(x.ad)}</b>${x.telefon ? " · " + kac(x.telefon) : ""}`).join(", ")}. Onaylamak onu silmez.</small>` : "";
      }
      return eslesmeKutusu(u) + ek;
    };
    // Resmi ortak listesiyle karşılaştırma: mavi örtüşüyor, kırmızı örtüşmüyor
    function eslesmeKutusu(u) {
      const e = u.eslesme;
      if (!e) return "";
      return listeKutusu(u, e) + (u.davetli_at
        ? `<div class="eslesme eslesme-uyuyor">✔ Davet kodu doğru<small>Size gönderdiğiniz kodla kayıt oldu</small></div>` : "");
    }
    function listeKutusu(u, e) {
      if (yakinMi(u)) {
        return e.uyuyor
          ? `<div class="eslesme eslesme-uyuyor">✔ Telefonu ortağın kayıtlarında var<small>${kac(u.ortak_no)} numaralı ortağın listedeki telefonlarından biri</small></div>`
          : `<div class="eslesme eslesme-uymuyor">✖ Telefonu ortağın kayıtlarında yok<small>${e.listede ? "Ortağa sorarak onaylayabilirsiniz" : `${kac(u.ortak_no)} numaralı ortak listede yok`}</small></div>`;
      }
      if (e.uyuyor) return `<div class="eslesme eslesme-uyuyor">✔ Ortağın bilgileri örtüşüyor<small>${kac(u.ortak_no)} numaralı ortağın listedeki telefonu${e.ad_uyuyor ? " ve adı" : ""} ile aynı${e.ad_uyuyor ? "" : " (ad listedekinden farklı yazılmış)"}</small></div>`;
      const neden = e.listede ? `Telefon listedekiyle aynı değil${e.ad_uyuyor ? " (ad tutuyor)" : ", ad da tutmuyor"}` : `${kac(u.ortak_no)} numaralı ortak listede yok`;
      return `<div class="eslesme eslesme-uymuyor">✖ Ortağın bilgileri örtüşmüyor<small>${neden}</small></div>`;
    }
    const d = (eylem, hedef, yazi, sinif = "") => `<button class="kucuk-dugme ${sinif}" data-eylem="${eylem}" data-hedef="${kac(hedef)}">${yazi}</button>`;
    $("#yonetim").innerHTML = `
      <div class="detay-ust"><button class="geri" type="button" data-ana>← Ana Sayfa</button></div>
      <h1>Üyeler ve ayarlar</h1>

      <section class="davet-bolum">
        <h2>📨 Bütün ortakları davet edin</h2>
        <div class="tg-link-kutu">
          <b>🏠 Bütün ortaklar için tek davet mesajı</b>
          <div class="tg-link">${kac(UYGULAMA_ADRESI.replace(/^https:\/\//, ""))}</div>
          <small>Bu mesajı sitenin WhatsApp gruplarına bir kez gönderin. Kod yok: ortak adını, ortak numarasını ve cep telefonunu yazar. Telefonu kooperatif kayıtlarıyla eşleşen ortak <b>hemen girer</b>; eşleşmeyen aşağıdaki “Onay bekleyenler”e düşer.</small>
          <details class="davet-onizle"><summary>Gidecek mesajı göster</summary><pre>${kac(genelDavetMetni)}</pre></details>
          <div class="davet-tel">
            <a class="davet-dugme wa" href="https://wa.me/?text=${encodeURIComponent(genelDavetMetni)}" target="_blank" rel="noopener">WhatsApp</a>
            <a class="davet-dugme sms" href="sms:?&body=${encodeURIComponent(genelDavetMetni)}">SMS</a>
            <button type="button" class="davet-dugme kopya genel-davet-kopyala">📋 Kopyala</button></div>
        </div>
        <h2>Tek bir ortağa davet (isteğe bağlı)</h2>
        <div>
        <p>Ortaklık numarasını (örn. 12), telefon numarasını ya da ortağın adını / soyadını yazın. İsimde kelimenin tamamını yazın (örn. “Yılmaz”). Davet kodu ve mesajı o ortağa göre hazırlanır; WhatsApp ya da SMS açılınca kişiyi rehberinizden seçin.</p>
        <input id="davet-ara" class="davet-ara" type="search" placeholder="Ortak no, telefon ya da isim" autocomplete="off">
        <div id="davet-sonuc"></div>
        </div>
      </section>

      <h2>Onay bekleyenler (${bekleyen.length})</h2>
      ${bekleyen.length ? bekleyen.map((u) => uyeSatiri(u, d("uye_onayla", u.cihaz, "✔ Onayla") + d("uye_sil", u.cihaz, "Reddet", "tehlike"), ayniNo(u))).join("")
        : `<p class="ipucu">Onay bekleyen kimse yok.</p>`}

      <h2>Gruptakiler (${gruptakiler.length} / ${MAKS_UYE})</h2>
      ${gruptakiler.map((u) => uyeSatiri(u, u.rol === "baskan" ? "" : d("uye_cikar", u.cihaz, "Çıkar", "tehlike"))).join("")}

      <h2>Yönetici Değiştir</h2>
      <p class="ipucu">Yöneticilik (YK Başkanı) gruptaki başka bir kişiye devredilir. Sizin ve diğer yönetici telefonlarının yetkisi kalkar, yönetici giriş kodu da yenilenir.</p>
      <button class="ikincil" style="width:100%" id="devret-ac" type="button">👑 Yönetici Değiştir</button>
      <div id="devret" class="devret" hidden>
        <label>Yeni yönetici
          <select id="devret-kim">
            <option value="">Kişi seçin…</option>
            ${gruptakiler.filter((u) => u.rol !== "baskan").map((u) => `<option value="${kac(u.cihaz)}">${kac(u.ad)} (${kac(ROL_ADI[u.rol] || u.rol)})</option>`).join("")}
          </select>
        </label>
        <label>Sizin yeni göreviniz
          <select id="devret-rol">
            <option value="yonetim">Yönetim Kurulu</option>
            <option value="uye">TG Üyesi</option>
          </select>
        </label>
        <button class="ana-dugme" type="button" data-eylem="yonetici_degistir">Yöneticiyi devret</button>
      </div>

      ${cikan.length ? `<h2>Çıkarılanlar (${cikan.length})</h2>
      <p class="ipucu">Bu telefonlar kodu bilse de gruba giremez.</p>
      ${cikan.map((u) => uyeSatiri(u, d("uye_geri_al", u.cihaz, "Geri al") + d("uye_sil", u.cihaz, "Sil", "tehlike"))).join("")}` : ""}

      <h2>Kişisel kodlar: YK ve TG (${tg.length})</h2>
      <p class="ipucu">Her biri kendi adını ve kişisel kodunu yazar; onay beklemeden girer. Yönetim kurulu ve TG üyesi için ortak kod kapalıdır.</p>
      <div class="tg-link-kutu">
        <b>🏅 TG ve YK üyelerine özel davet linki</b>
        <div class="tg-link">${kac(TG_ADRESI.replace(/^https:\/\//, ""))}</div>
        <small>Bu link açılınca ortak kaydı yerine doğrudan <b>şahsi kodla giriş</b> ekranı gelir. Linki gönderin; kişi adını ve aşağıdaki şahsi kodunu yazarak girer.</small>
        <pre hidden>${kac(tgLinkMetni)}</pre>
        <div class="davet-tel">
          <a class="davet-dugme wa" href="https://wa.me/?text=${encodeURIComponent(tgLinkMetni)}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="davet-dugme sms" href="sms:?&body=${encodeURIComponent(tgLinkMetni)}">SMS</a>
          <button type="button" class="davet-dugme kopya tg-link-kopyala">📋 Kopyala</button></div>
      </div>
      <details class="ortak-liste" open>
        <summary>📋 Kişisel kodları göster</summary>
        <table><thead><tr><th>Ad</th><th>Kod</th><th>Durum</th></tr></thead><tbody>
        ${tg.map((t) => `<tr><td>${kac(t.ad)}<br><small>${kac(t.unvan)}</small></td><td><code>${kac(t.kod)}</code></td><td>${t.kullaniliyor ? "✔ Giriş yaptı" : "—"}</td></tr>`).join("")}
        </tbody></table>
      </details>

      <h2>Yeni işlerin yapılma süresi</h2>
      <div class="uye">
        <div><b>${varsSure} gün</b><br><small>Her yeni kayda kendiliğinden verilir. Kayıt içinden tek tek değiştirebilirsiniz.</small></div>
        <div class="uye-dugmeler">${d("varsayilan_sure", "", "Değiştir")}</div>
      </div>

      <h2>Giriş kodları</h2>
      <p class="ipucu">Kodu değiştirmek gruptakileri çıkarmaz; yalnızca yeni katılacaklar yeni kodu kullanır.</p>
      ${ROL_SIRASI.filter((r) => r !== "uye" && r !== "yonetim").map((r) => `<div class="uye">
        <div><b>${kac(ROL_ADI[r])}</b><br><code>${kac(kodlar[r] || "—")}</code></div>
        <div class="uye-dugmeler">${d("kod_degistir", r, "Değiştir")}</div>
      </div>`).join("")}

      <h2>Tüm kayıtları sil</h2>
      <p class="ipucu">Bütün sorunlar ve fotoğraflar kalıcı olarak silinir, numaralar 001'den başlar. Üyeler silinmez. Geri alınamaz.</p>
      <button class="ikincil tehlike" style="width:100%" data-eylem="hepsini_sil">Tüm kayıtları sil</button>`;
  }

  // ---------- Ortağa davet (yönetici) ----------
  const UYGULAMA_ADRESI = "https://tinyurl.com/sporkent-ortak";
  // Bütün ortaklara tek mesaj: kod yok, kooperatifte kayıtlı telefonla hemen girilir
  const genelDavetMetni = `Sayın Ortağımız,

SPORKENT ASİSTAN uygulaması kullanıma açıldı. Kooperatifin duyurularını anında alabilir, sitemizdeki sorunları telefonunuzdan fotoğrafla bildirebilir; yapılan işleri, aidat bilgilerinizi, parsel temsilcinizi ve restoran menüsünü görebilir, araç plakanızı bildirebilirsiniz.

Katılmak için:
1. Bu bağlantıya dokunun: ${UYGULAMA_ADRESI}
2. Açılan sayfada "📲 Ana Ekrana Ekle" düğmesine basın.
3. Telefonunuzun ana ekranındaki Sporkent simgesinden uygulamayı açın ve "Kooperatif Ortağıyım"ı seçin.
4. Adınızı soyadınızı, ortaklık numaranızı ve kooperatifte kayıtlı cep telefonunuzu yazıp "Kayıt ol"a basın.

Telefonunuz kooperatifteki kaydınızla eşleşirse uygulama hemen açılır. Şifre ya da kod gerekmez.

Ortağımızın eşi, çocukları, damadı, gelini ve misafirleri de "Ortağın Yakınıyım"ı seçip ortağın numarasıyla katılabilir.

Sporkent İşletme Kooperatifi Yönetim Kurulu`;
  document.addEventListener("click", async (e) => {
    if (!e.target.closest(".genel-davet-kopyala")) return;
    try { await navigator.clipboard.writeText(genelDavetMetni); mesaj("Genel davet mesajı kopyalandı."); }
    catch { mesaj("Kopyalanamadı; WhatsApp ya da SMS düğmesini kullanın."); }
  });
  const davetMetni = (r) => `Sayın Ortağımız,

SPORKENT ASİSTAN uygulamasına aşağıdaki bağlantıdan katılabilirsiniz:

${UYGULAMA_ADRESI}

1. Bağlantıya dokunun, açılan sayfada "📲 Ana Ekrana Ekle" düğmesine basın.
2. Telefonunuzun ana ekranındaki Sporkent simgesinden uygulamayı açın.
3. "Kooperatif Ortağıyım" seçeneğine dokunun. Adınızı soyadınızı, ortaklık numaranızı (${r.no}), kooperatifte kayıtlı cep telefonu numaranızı ve aşağıdaki davet kodunu yazıp "Kayıt ol"a basın.

Davet kodunuz: ${r.kod.slice(0, 3)} ${r.kod.slice(3)}
(Bu kod yalnızca size özeldir, ${r.gun} gün geçerlidir. Kimseyle paylaşmayın.)

Bilgileriniz onaylandığında uygulama kendiliğinden açılır. Şifre gerekmez.

Sporkent İşletme Kooperatifi Yönetim Kurulu`;

  // Davet kodu: her basışta yeni kod üretilir, öncekiler geçersiz olur
  $("#yonetim").addEventListener("click", async (e) => {
    const b = e.target.closest(".davet-hazirla"); if (!b) return;
    const kutu = b.closest(".davet-kisi"); const no = Number(kutu.dataset.no);
    b.disabled = true;
    try {
      const { kod, gun } = await api("davet_kodu", { ortak_no: no });
      const duz = davetMetni({ no, kod, gun });
      const metin = encodeURIComponent(duz);
      b.textContent = "🔑 Yeni kod hazırla (öncekini geçersiz kılar)";
      kutu.querySelector(".davet-gonder").innerHTML = `<div class="davet-hazir">
          <div class="davet-satir"><span>Link</span><b>${kac(UYGULAMA_ADRESI.replace(/^https:\/\//, ""))}</b></div>
          <div class="davet-satir"><span>Davet kodu</span><b class="davet-kod-sayi">${kod.slice(0, 3)} ${kod.slice(3)}</b></div>
          <small>Link ve kod aşağıdaki mesajın içinde birlikte gider.</small>
        </div>
        <details class="davet-onizle"><summary>Gidecek mesajı göster</summary><pre>${kac(duz)}</pre></details>
        <button type="button" class="ikincil davet-kopyala" style="width:100%;margin-top:8px">📋 Mesajı kopyala</button>
        <div class="davet-tel">
          <a class="davet-dugme wa" href="https://wa.me/?text=${metin}" target="_blank" rel="noopener">WhatsApp ile gönder</a>
          <a class="davet-dugme sms" href="sms:?&body=${metin}">SMS ile gönder</a></div>`;
    } catch (err) { mesaj(err.message); } finally { b.disabled = false; }
  });
  $("#yonetim").addEventListener("click", async (e) => {
    const b = e.target.closest(".davet-kopyala"); if (!b) return;
    const metin = b.closest(".davet-kisi").querySelector(".davet-onizle pre").textContent;
    try { await navigator.clipboard.writeText(metin); mesaj("Mesaj kopyalandı. WhatsApp'ta sohbete yapıştırabilirsiniz."); }
    catch { mesaj("Kopyalanamadı; WhatsApp ya da SMS düğmesini kullanın."); }
  });

  // TG / YK üyesine davet: TG giriş linki + şahsi kod
  const TG_ADRESI = "https://tinyurl.com/sporkent-asistan-tg";
  const tgLinkMetni = `Sayın TG / YK Üyemiz,

SPORKENT ASİSTAN uygulamasına size özel giriş bağlantısı:

${TG_ADRESI}

1. Bağlantıya dokunun, açılan sayfada "📲 Ana Ekrana Ekle" düğmesine basın.
2. Telefonunuzun ana ekranındaki Sporkent simgesinden uygulamayı açın.
3. "Şahsi kodla giriş" ekranı açılır. Adınızı ve size verilen şahsi kodunuzu (harfleriyle birlikte) yazıp "Giriş yap"a basın. Onay beklemeden girersiniz.

(iPhone'da uygulama açılınca bu ekran yerine "Nasıl giriş yapacaksınız?" ekranı gelirse, en üstteki Sporkent logosuna art arda 5 kez dokunun; şahsi kodla giriş ekranı açılır.)

Sporkent İşletme Kooperatifi Yönetim Kurulu`;

  $("#yonetim").addEventListener("click", async (e) => {
    if (!e.target.closest(".tg-link-kopyala")) return;
    try { await navigator.clipboard.writeText(tgLinkMetni); mesaj("TG davet mesajı kopyalandı."); }
    catch { mesaj("Kopyalanamadı; WhatsApp ya da SMS düğmesini kullanın."); }
  });

  let davetZamani = null;
  $("#yonetim").addEventListener("input", (e) => {
    if (e.target.id !== "davet-ara") return;
    clearTimeout(davetZamani);
    const q = e.target.value.trim();
    const kutu = $("#davet-sonuc");
    if (!q) { kutu.innerHTML = ""; return; }
    davetZamani = setTimeout(async () => {
      kutu.innerHTML = `<p class="ipucu">Aranıyor…</p>`;
      try {
        const { sonuc } = await api("rehber_ara", { q });
        if ($("#davet-ara")?.value.trim() !== q) return;
        kutu.innerHTML = sonuc.length ? sonuc.map((r) => {
          const durum = r.durum === "onayli" ? `<span class="davet-durum katildi">✔ Uygulamada</span>`
            : r.durum === "bekliyor" ? `<span class="davet-durum bekliyor">⏳ Onay bekliyor</span>` : "";
          return `<div class="davet-kisi" data-no="${kac(r.no)}">
            <div><b>${kac(r.no)} numaralı ortak</b> ${durum}</div>
            <p class="ipucu">Davet kodu hazırlanınca mesajı bu ortağın <b>kooperatifte kayıtlı telefonuna</b> gönderin.</p>
            <button type="button" class="ikincil davet-hazirla" style="width:100%">🔑 Davet kodu hazırla</button>
            <div class="davet-gonder"></div>
          </div>`;
        }).join("") : `<p class="ipucu">${/\p{L}/u.test(q) ? "Bu isimde ortak bulunamadı. Adın ya da soyadın tamamını, listedeki gibi yazın." : q.replace(/\D/g, "").length >= 7 ? "Bu telefon numarası ortak listesinde kayıtlı değil." : "Bu ortaklık numarası listede yok."}</p>`;
      } catch (err) { kutu.innerHTML = `<p class="hata">${kac(err.message)}</p>`; }
    }, 350);
  });

  $("#yonetim").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-eylem]"); if (!b) return;
    const { eylem, hedef } = b.dataset;
    let veri = { hedef };
    const ad = b.closest(".uye")?.querySelector("b")?.textContent || "";
    if (eylem === "uye_cikar" && !confirm(`${ad} gruptan çıkarılsın mı? Bu telefon bir daha giremez (geri alabilirsiniz).`)) return;
    if (eylem === "yonetici_degistir") {
      const kim = $("#devret-kim");
      if (!kim.value) return mesaj("Yeni yöneticiyi seçin.");
      const kimAd = kim.selectedOptions[0].textContent;
      if (!confirm(`Yöneticilik ${kimAd} kişisine devredilsin mi? Siz artık yönetici olmayacaksınız. Bunu yalnızca yeni yönetici geri verebilir.`)) return;
      b.disabled = true;
      try {
        const r = await api("yonetici_degistir", { hedef: kim.value, eski_rol: $("#devret-rol").value });
        oturum.rol = r.rol; sakla.koy("sk_oturum", oturum);
        history.replaceState(null, "", location.pathname);
        goster("liste"); listeCiz();
        mesaj("Yöneticilik devredildi. Yeni yöneticiye haber gitti.");
      } catch (err) { mesaj(err.message); b.disabled = false; }
      return;
    }
    if (eylem === "uye_sil" && !confirm(`${ad} listeden silinsin mi?`)) return;
    if (eylem === "varsayilan_sure") {
      const gun = prompt("Yeni işler kaç günde yapılsın? (1 ile 60 arası)");
      if (!gun) return;
      veri = { gun: Number(gun) };
    }
    if (eylem === "kod_degistir") {
      const yeni = prompt(`${ROL_ADI[hedef]} için yeni kod (en az 6 karakter, boşluksuz):`);
      if (!yeni) return;
      veri = { rol: hedef, yeni: yeni.trim() };
    }
    if (eylem === "hepsini_sil") {
      const onay = prompt("Bütün kayıtlar ve fotoğraflar silinecek. Onaylamak için büyük harflerle SİL yazın:");
      if (onay === null) return;
      veri = { onay: onay.trim().toLocaleUpperCase("tr-TR") };
    }
    b.disabled = true;
    try {
      await api(eylem, veri);
      mesaj({ uye_onayla: "Onaylandı, kişiye haber gitti.", uye_cikar: "Gruptan çıkarıldı.", uye_geri_al: "Gruba geri alındı.",
        uye_sil: "Silindi.", kod_degistir: "Kod değiştirildi.", hepsini_sil: "Tüm kayıtlar silindi.",
        varsayilan_sure: "Yeni işlerin süresi değiştirildi." }[eylem]);
      if (eylem === "hepsini_sil") { kayitlar = []; sakla.sil("sk_gorulen"); }
      await yonetimAc();
    } catch (err) { mesaj(err.message); b.disabled = false; }
  });



  // ---------- Günlük / haftalık görev programı ----------
  // Müdür ve şef bugünün ve bu haftanın kalemlerini işaretler; yönetici ve yönetim kurulu izler.
  let gorevSekme = "gunluk";
  let gorevVeri = null;
  const gunYazisi = (g) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");
  const saatYazisi = (t) => new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const haftaSonu = (g) => { const d = new Date(g + "T00:00:00"); d.setDate(d.getDate() + 6); return d.toLocaleDateString("tr-TR"); };

  async function gorevlerAc(sekme = gorevSekme, gun) {
    if (!gorevGorur()) return;
    gorevSekme = sekme;
    const hash = sekme === "haftalik" ? "#gorevler-haftalik" : "#gorevler";
    if (location.hash !== hash) history.replaceState(history.state, "", hash);
    goster("gorevler");
    if (!gorevVeri) $("#gorevler").innerHTML = `<p class="bos">Yükleniyor…</p>`;
    try { gorevVeri = await api("gorevler", gun ? { gun } : {}); gorevCiz(); }
    catch (e) { $("#gorevler").innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }

  function gorevCiz() {
    const v = gorevVeri, p = v.program[gorevSekme];
    const gunluk = gorevSekme === "gunluk";
    const donem = gunluk ? v.gun : v.hafta;
    const isaret = new Map(v.isaretler.filter((x) => x.tur === gorevSekme).map((x) => [x.kalem, x]));
    const toplam = gunluk ? v.gecmis.gunlukToplam : v.gecmis.haftalikToplam;
    const guncel = gunluk ? v.gun === v.bugun : v.hafta === v.buHafta;
    const duzenler = v.isaretleyebilir && guncel;
    const dv = v.devriye;
    const ugranan = dv ? new Set(dv.turlar.map((t) => t.ad)).size : 0;
    const sayac = (tur) => tur === "gunluk" ? ugranan : v.isaretler.filter((x) => x.tur === tur).length;
    const yapilan = gunluk ? ugranan : isaret.size;
    let no = 0;
    $("#gorevler").innerHTML = `
      <div class="baslik-cift baslik-satir"><button class="geri" data-geri-yk>← Geri</button>${gunluk
        ? `<h1 class="sayfa-bant bant-gorev">🚶 Müdür/Şef Günlük Devriye</h1>`
        : `<h1 class="sayfa-bant bant-haftalik">🗓️ Haftalık Kontrol</h1>`}</div>
      ${gunluk ? "" : `<p class="gorev-donem">Hafta: ${gunYazisi(donem)} – ${haftaSonu(donem)} · <b>${yapilan} / ${toplam} yapıldı</b></p>
      <div class="gorev-cubuk"><span style="width:${toplam ? Math.round((yapilan / toplam) * 100) : 0}%"></span></div>`}
      ${!guncel ? `<p class="bilgi">Geçmiş ${gunluk ? "gün" : "hafta"}: yalnızca görüntüleme. <button type="button" class="kucuk-dugme" data-gun="">${gunluk ? "Bugüne" : "Bu haftaya"} dön</button></p>` : ""}
      ${gunluk ? devriyeGovde(dv) : `
      ${!v.isaretleyebilir ? `<p class="ipucu">Görevleri müdür ve şef işaretler; siz kimin, ne zaman yaptığını görürsünüz.</p>`
        : `<p class="ipucu">Yaptığınız kalemin üstüne dokunun, "yapıldı" işaretlensin. Yanlışlıkla işaretlediyseniz tekrar dokunun.</p>`}
      <p class="ipucu">${kac(p.giris)}</p>
      ${p.bolumler.map((b) => `
        ${b.baslik ? `<h2 class="gorev-bolum">${b.harf}. ${kac(b.baslik)}${b.saat ? ` <small>(${b.saat})</small>` : ""}</h2>` : ""}
        ${b.kalemler.map((k) => {
          const i = isaret.get(k.id); no++;
          return `<button type="button" class="gorev ${i ? "yapildi" : ""}" data-kalem="${k.id}" ${duzenler ? "" : "disabled"}>
            <span class="gorev-no">${i ? "✓" : no}</span>
            <span><b>${kac(k.baslik)}</b><small>${kac(k.aciklama)}</small>
              ${i ? `<em>✓ Yapıldı · ${kac(i.ad || "")} · ${gunluk ? "" : gunYazisi(i.isaret_at.slice(0, 10)) + " "}${saatYazisi(i.isaret_at)}</em>` : ""}</span>
          </button>`;
        }).join("")}`).join("")}`}
      ${v.gecmisGorur ? `<h2>Geçmiş ${gunluk ? "günler" : "haftalar"}</h2>
      <div class="gorev-gecmis">
        ${(gunluk ? v.gecmis.gunler : v.gecmis.haftalar).map((x) => `<button type="button" data-gun="${x.donem}" class="${x.donem === donem ? "secili" : ""} ${x.yapilan === toplam ? "tam" : x.yapilan ? "" : "bos-gun"}">
          ${gunluk ? gunYazisi(x.donem).slice(0, 5) : gunYazisi(x.donem).slice(0, 5) + "–" + haftaSonu(x.donem).slice(0, 5)}<br><b>${x.yapilan}/${toplam}</b></button>`).join("")}
      </div>` : ""}`;
    devriyeHaritaKur(gunluk ? dv : null);
  }

  $("#gorevler").addEventListener("click", async (e) => {
    const sekme = e.target.closest("[data-sekme]");
    if (sekme) {
      gorevSekme = sekme.dataset.sekme;
      history.replaceState(history.state, "", gorevSekme === "haftalik" ? "#gorevler-haftalik" : "#gorevler");
      return gorevCiz();
    }
    const gunB = e.target.closest("[data-gun]");
    if (gunB) return gorevlerAc(gorevSekme, gunB.dataset.gun || undefined);
    const b = e.target.closest("[data-kalem]"); if (!b || b.disabled) return;
    const yapildi = !b.classList.contains("yapildi");
    if (!yapildi && !confirm('Bu kalemin "yapıldı" işareti kaldırılsın mı?')) return;
    b.disabled = true;
    try { gorevVeri = await api("gorev_isaretle", { kalem: b.dataset.kalem, yapildi }); gorevCiz(); }
    catch (err) { mesaj(err.message); b.disabled = false; }
  });
  // Eski "#devriye" adresi: Günlük Devriye'ye gider
  const devriyeAc = (gun) => gorevlerAc("gunluk", gun);

  // ---------- Devriye izi: "Devriyeyi Başlat" ile "Devriyeyi Bitir" arasında konum kaydı ----------
  // Konum yalnızca bu aralıkta, mesai saatinde ve devriye alanında alınır. Noktalar telefonda birikir,
  // internet olunca topluca gönderilir. Ekran açık tutulur; uygulama arka plana düşerse kesinti kaydedilir.
  const IZ_ANAHTAR = "sk_devriye_izi", IZ_ARALIK_MS = 12000, IZ_ADIM_M = 10, IZ_DOGRULUK_M = 30, IZ_KOPUK_MS = 90000, IZ_GIZLI_MS = 15000;
  const trSaat = () => { const p = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    return Number(p.find((x) => x.type === "hour").value) % 24 + Number(p.find((x) => x.type === "minute").value) / 60; };
  const mesaiBilgi = () => gorevVeri?.devriye?.mesai || sakla.al("sk_mesai") || { bas: 8, bit: 18, metin: "08:00–18:00" };
  const mesaideMi = () => { const m = mesaiBilgi(), h = trSaat(); return h >= m.bas && h < m.bit; };
  // Site sınırı: yöneticinin çizdiği çokgen [[enlem, boylam], ...]; içinde ya da kenara 30 m'den yakınsa kaydedilir
  const SINIR_PAYI_M = 30;
  const siteSiniri = () => gorevVeri?.devriye?.sinir || sakla.al("sk_sinir") || null;
  function sinirIcinde(sn, lat, lng) {
    let ic = false;
    for (let i = 0, j = sn.length - 1; i < sn.length; j = i++) {
      const [yi, xi] = sn[i], [yj, xj] = sn[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ic = !ic;
    }
    return ic;
  }
  function sinirKenari(sn, lat, lng) {
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
  const alanIcinde = (lat, lng) => { const sn = siteSiniri(); return !sn || sinirIcinde(sn, lat, lng) || sinirKenari(sn, lat, lng) <= SINIR_PAYI_M; };
  const metre = (a, b) => { const kx = 111320 * Math.cos((a[0] * Math.PI) / 180); return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * 110540); };
  const izSure = (ms) => { const dk = Math.max(0, Math.round(ms / 60000)); return dk < 60 ? `${dk} dk` : `${Math.floor(dk / 60)} sa ${dk % 60} dk`; };
  const kmYazisi = (m) => m >= 1000 ? (m / 1000).toFixed(2).replace(".", ",") + " km" : Math.round(m) + " m";

  // iz: { tur, basla, son:[lat,lng,t], kuyruk:[{z,lat,lng,d,k}], cizgi:[[lat,lng,k]], mesafe, sayi, kopukSonraki, kesinti, gizli, bitis, neden, uyarilar:[[bas,bit]] }
  let iz = sakla.al(IZ_ANAHTAR);
  let izIzle = null, izZaman = null, izKilit = null, izGonderiliyor = false, izSonDurum = "";
  const izSakla = () => { if (iz) sakla.koy(IZ_ANAHTAR, iz); else sakla.sil(IZ_ANAHTAR); };
  const izSuruyor = () => !!iz && !iz.bitis;
  const izYapar = () => ["mudur", "sef"].includes(oturum?.rol);

  // Ekranı açık tutma: önce Wake Lock. iPhone'da ana ekran uygulamasında Wake Lock eski iOS sürümlerinde
  // hata vermeden çalışmayabildiği için ayrıca görünmez, sessiz, döngüde oynayan küçük bir video da çalışır.
  let izUyanik = null, izEkranYontemi = "";
  const iPhoneMu = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  function izVideoBaslat() {
    if (!izUyanik) {
      const v = document.createElement("video");
      v.src = "veri/uyanik.mp4"; v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
      v.className = "iz-uyanik"; document.body.appendChild(v); izUyanik = v;
    }
    const p = izUyanik.play();
    if (p) p.then(() => { if (!izKilit || iPhoneMu()) izEkranYontemi = izKilit ? "kilit" : "video"; izDurumYaz(); }).catch(() => {});
  }
  async function izEkranAcik() {
    if (document.visibilityState !== "visible") return;
    try {
      if ("wakeLock" in navigator && !izKilit) {
        izKilit = await navigator.wakeLock.request("screen");
        izKilit.addEventListener("release", () => { izKilit = null; if (!izUyanik || izUyanik.paused) izEkranYontemi = ""; izDurumYaz(); });
      }
    } catch { izKilit = null; }
    if (izKilit) izEkranYontemi = "kilit";
    if (!izKilit || iPhoneMu()) izVideoBaslat();
    izDurumYaz();
  }
  const cihazTuru = () => {
    const u = navigator.userAgent, ios = u.match(/OS (\d+)[_.](\d+)/), an = u.match(/Android (\d+(?:\.\d+)?)/);
    return iPhoneMu() ? `iPhone · iOS ${ios ? ios[1] + "." + ios[2] : "?"}` : an ? `Android ${an[1]}` : "Diğer";
  };
  function izKonum(p) {
    if (!izSuruyor()) return;
    const { latitude: lat, longitude: lng, accuracy } = p.coords;
    if (accuracy > IZ_DOGRULUK_M) { izSonDurum = `Konum zayıf (±${Math.round(accuracy)} m); açık alanda düzelir.`; return izDurumYaz(); }
    if (!alanIcinde(lat, lng)) { iz.kopukSonraki = true; izSonDurum = "Site sınırının dışındasınız; burada konum kaydedilmiyor."; izSakla(); return izDurumYaz(); }
    izSonDurum = "";
    const t = Date.now(), son = iz.son, d = son ? metre(son, [lat, lng]) : Infinity, dt = son ? t - son[2] : Infinity;
    if (!son || (d >= IZ_ADIM_M && dt >= 3000) || dt >= IZ_ARALIK_MS) {
      const kopuk = iz.kopukSonraki || (son && dt > IZ_KOPUK_MS);
      iz.kuyruk.push({ z: t, lat, lng, d: Math.round(accuracy), k: kopuk ? 1 : 0 });
      iz.cizgi.push([lat, lng, kopuk ? 1 : 0]); if (iz.cizgi.length > 4000) iz.cizgi.splice(0, 1000);
      if (son && !kopuk) iz.mesafe += d;
      iz.son = [lat, lng, t]; iz.kopukSonraki = false; iz.sayi++;
      izSakla(); izCanliCiz(lat, lng, kopuk);
    }
    izDurumYaz();
  }
  async function izGonder() {
    if (izGonderiliyor || !iz || !iz.kuyruk.length) return true;
    izGonderiliyor = true;
    const parti = iz.kuyruk.slice(0, 300);
    try {
      await api("tur_nokta", { tur_id: iz.tur, noktalar: parti });
      if (iz) { iz.kuyruk.splice(0, parti.length); iz.cevrimdisi = false; izSakla(); }
      return true;
    } catch { if (iz) iz.cevrimdisi = true; return false; }
    finally { izGonderiliyor = false; izDurumYaz(); }
  }
  function izZamanlayici() {
    clearInterval(izZaman);
    izZaman = setInterval(async () => {
      if (!iz) return clearInterval(izZaman);
      if (izSuruyor() && !mesaideMi()) return devriyeBitir("mesai");
      if (iz.kuyruk.length) await izGonder();
      if (iz?.bitis) izTamamla();
      izDurumYaz();
    }, 20000);
  }
  function izIzlemeyiAc() {
    if (izIzle != null || !navigator.geolocation) return;
    izEkranAcik();
    izIzle = navigator.geolocation.watchPosition(izKonum, (e) => {
      izSonDurum = e.code === 1 ? "Konum izni verilmedi. Telefonun ayarlarından bu uygulamaya konum izni verin." : "Konum alınamadı; açık alanda bekleyin.";
      if (e.code === 1) mesaj(izSonDurum);
      izDurumYaz();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    izZamanlayici(); izCubuk();
  }
  function izIzlemeyiKapat() {
    if (izIzle != null) navigator.geolocation.clearWatch(izIzle);
    izIzle = null;
    try { izKilit?.release(); } catch {} izKilit = null;
    if (izUyanik) { izUyanik.pause(); izUyanik.remove(); izUyanik = null; }
    if (izCanli.ben) { izCanli.ben.remove(); izCanli.ben = null; }
  }
  async function devriyeBaslat(b) {
    if (!navigator.geolocation) return mesaj("Bu telefon konum vermiyor.");
    if (!mesaideMi()) return mesaj(`Devriye yalnızca mesai saatlerinde (${mesaiBilgi().metin}) başlatılabilir.`);
    b.disabled = true; b.textContent = "Başlatılıyor…";
    if (iPhoneMu()) izVideoBaslat(); // iPhone: dokunma anında başlatılmalı
    try {
      const r = await api("tur_basla", { cihaz_turu: cihazTuru() });
      iz = { tur: r.tur.id, basla: Date.parse(r.tur.basla), son: null, kuyruk: [], cizgi: [], mesafe: 0, sayi: 0,
        kopukSonraki: !!r.devam, kesinti: 0, gizli: null, bitis: null, neden: null, uyarilar: [] };
      izSakla(); izIzlemeyiAc();
      mesaj("Devriye başladı. Ekran açık kalsın, uygulamadan çıkmayın.");
      gorevlerAc("gunluk");
    } catch (e) { mesaj(e.message); b.disabled = false; b.textContent = "▶ Devriyeyi Başlat"; }
  }
  async function devriyeBitir(neden = "kullanici") {
    if (!izSuruyor()) return;
    izIzlemeyiKapat();
    iz.bitis = Date.now(); iz.neden = neden; iz.ekran = iz.ekranGordu ? (iz.ekranGordu === "video" ? "video" : "kilit") : "yok"; izSakla();
    if (neden === "mesai") mesaj("Mesai saati bitti; devriye kaydı kendiliğinden durduruldu.");
    await izTamamla(true);
  }
  // Biten devriyenin kalan noktaları ve bitişi gönderilir; internet yoksa sonra yeniden denenir
  async function izTamamla(ekrandan) {
    if (!iz?.bitis || izGonderiliyor) return;
    for (let i = 0; i < 10 && iz?.kuyruk.length; i++) if (!(await izGonder())) break;
    if (iz?.kuyruk.length) { izZamanlayici(); izCubuk(); if (ekrandan) mesaj("Devriye bitti. İnternet gelince bilgiler kendiliğinden gönderilecek."); return gorevCizGuvenli(); }
    try {
      const r = await api("tur_bitir", { tur_id: iz.tur, bitis: iz.bitis, neden: iz.neden, kesinti_sn: Math.round(iz.kesinti), ekran: iz.ekran || "yok" });
      iz = null; izSakla(); clearInterval(izZaman); izCubuk();
      mesaj(`✓ Devriye kaydedildi: ${izSure(Date.parse(r.tur.bitis) - Date.parse(r.tur.basla))} · ${kmYazisi(r.tur.mesafe_m)}. Yöneticiye bildirildi.`);
      if (!$("#ekran-gorevler").hidden) gorevlerAc("gunluk");
    } catch {
      izZamanlayici(); izCubuk();
      if (ekrandan) mesaj("Devriye bitti. İnternet gelince bilgiler kendiliğinden gönderilecek.");
      gorevCizGuvenli();
    }
  }
  const gorevCizGuvenli = () => { if (!$("#ekran-gorevler").hidden && gorevVeri && gorevSekme === "gunluk") gorevCiz(); };
  // Uygulama arka plana düşerse kayıt durur: döndüğünde belirgin uyarı ve kesinti kaydı
  document.addEventListener("visibilitychange", () => {
    if (!izSuruyor()) return;
    if (document.visibilityState === "hidden") { iz.gizli = Date.now(); izSakla(); return; }
    const gizli = iz.gizli; iz.gizli = null;
    if (gizli && Date.now() - gizli > IZ_GIZLI_MS) {
      iz.kesinti += (Date.now() - gizli) / 1000; iz.kopukSonraki = true; iz.uyarilar.push([gizli, Date.now()]);
      izUyari([gizli, Date.now()]);
    }
    izSakla(); izEkranAcik(); izGonder(); izDurumYaz();
  });
  window.addEventListener("online", () => { if (iz) { izGonder(); if (iz.bitis) izTamamla(); } });
  function izUyari([a, b]) {
    try { navigator.vibrate?.([300, 120, 300]); } catch {}
    const k = $("#iz-uyari-perde");
    k.querySelector("p").innerHTML = `Uygulama <b>${saatYazisi(a)} – ${saatYazisi(b)}</b> arasında arka plandaydı ya da ekran kapandı.<br>Bu sürede <b>konum kaydedilemedi</b>; haritada bu aralık boş görünecek.<br><br>Devriye sürerken ekranı açık tutun, başka uygulamaya geçmeyin.`;
    k.hidden = false;
  }
  // Açılışta yarım kalan devriye: aynı gün ve mesaideyse devam eder, değilse kapatılır
  function devriyeDevam() {
    if (!iz || !izYapar()) return;
    if (iz.bitis) return izTamamla();
    const ayniGun = new Date(iz.basla).toDateString() === new Date().toDateString();
    if (!ayniGun || !mesaideMi()) {
      iz.bitis = iz.son?.[2] || iz.basla; iz.neden = "mesai"; izSakla(); return izTamamla();
    }
    if (iz.gizli) { iz.kesinti += (Date.now() - iz.gizli) / 1000; iz.uyarilar.push([iz.gizli, Date.now()]); izUyari([iz.gizli, Date.now()]); iz.gizli = null; }
    iz.kopukSonraki = true; izSakla(); izIzlemeyiAc();
  }
  // Devriye sürerken başka ekrandayken üstte ince kırmızı şerit: dokununca devriyeye döner
  function izCubuk() {
    const c = $("#iz-cubuk"); if (!c) return;
    const goster_ = !!iz && $("#ekran-gorevler").hidden;
    c.hidden = !goster_;
    if (goster_) c.innerHTML = iz.bitis ? "⏳ Devriye bitti · bilgiler gönderilmeyi bekliyor" : `<span class="kayit-nokta"></span> Devriye sürüyor · dönmek için dokunun`;
  }
  function izDurumYaz() {
    izCubuk();
    const k = document.getElementById("iz-durum"); if (!k || !iz) return;
    const ms = (iz.bitis || Date.now()) - iz.basla, s = Math.floor(ms / 1000);
    k.innerHTML = `<b>${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}</b>
      <span>${kmYazisi(iz.mesafe)} · ${iz.sayi} nokta${iz.kuyruk.length ? ` · ${iz.kuyruk.length} gönderilmeyi bekliyor` : ""}</span>
      ${izSonDurum ? `<small class="iz-uyari-satir">${kac(izSonDurum)}</small>` : !iz.son ? `<small>Konum bekleniyor… İlk seferde telefon izin sorarsa <b>İzin ver</b>'e dokunun.</small>` : ""}
      ${iz.cevrimdisi ? `<small class="iz-uyari-satir">İnternet yok: noktalar telefonda saklanıyor, bağlantı gelince gönderilecek.</small>` : ""}
      ${iz.bitis ? "" : izEkranYontemi ? `<small class="iz-ekran-ok">🔆 Ekran açık tutuluyor</small>`
        : `<small class="iz-uyari-satir">⚠ Bu telefon ekranı kendiliğinden açık tutamadı. ${iPhoneMu()
          ? "Ayarlar › Ekran ve Parlaklık › Otomatik Kilit › <b>Hiçbir Zaman</b> yapın (devriyeden sonra eski haline alabilirsiniz)."
          : "Ayarlar › Ekran › Ekran zaman aşımı › <b>10 dakika</b> yapın."}</small>`}`;
    if (izSuruyor() && izEkranYontemi && iz.ekranGordu !== izEkranYontemi && iz.ekranGordu !== "kilit") { iz.ekranGordu = izEkranYontemi; izSakla(); }
  }
  setInterval(() => { if (izSuruyor()) izDurumYaz(); }, 1000);
  $("#iz-uyari-tamam").addEventListener("click", () => { $("#iz-uyari-perde").hidden = true; });
  $("#iz-cubuk").addEventListener("click", () => { history.pushState({ yk: 1 }, "", "#gorevler"); gorevlerAc("gunluk"); });

  // ---------- Devriye haritası ----------
  let leafletYukle = null;
  const leaflet = () => leafletYukle ??= new Promise((ok, red) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "vendor/leaflet/leaflet.js"; js.onload = () => ok(window.L); js.onerror = () => { leafletYukle = null; red(new Error("Harita yüklenemedi.")); };
    document.head.appendChild(js);
  });
  let devHarita = null;
  const izCanli = { cizgi: null, ben: null };
  function haritaKapat() {
    if (devHarita) { devHarita.remove(); devHarita = null; }
    izCanli.cizgi = null; izCanli.ben = null;
  }
  // İz noktalarını kopuk yerlerden bölerek çizgi parçalarına ayırır (kesinti düz çizgiyle birleştirilmez)
  function izParcalari(nokta) {
    const parcalar = []; let p = [];
    nokta.forEach(([t, lat, lng, k], i) => {
      if (i && (k || t - nokta[i - 1][0] > IZ_KOPUK_MS)) { if (p.length) parcalar.push(p); p = []; }
      p.push([lat, lng]);
    });
    if (p.length) parcalar.push(p);
    return parcalar;
  }
  const izGorunen = (v) => v.turlar;
  // İz rengi göreve göre: müdür mavi, şef mor
  const izRengi = (rol) => rol === "sef" ? "#8e24aa" : "#1565c0";
  async function devriyeHaritaKur(v) {
    haritaKapat();
    const kutu = document.getElementById("devriye-harita");
    if (!v || !kutu) return;
    let L;
    try { L = await leaflet(); } catch (e) { kutu.innerHTML = `<p class="hata">${kac(e.message)}</p>`; return; }
    if (!document.body.contains(kutu)) return;
    // Telefonda tek parmak sayfayı kaydırır; harita iki parmakla büyütülüp kaydırılır (+ / − düğmeleri de var)
    const h = L.map(kutu, { zoomControl: true, attributionControl: true, tap: true, zoomSnap: 0.25, zoomDelta: 0.5, dragging: !L.Browser.mobile });
    const sokak = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(h);
    const uydu = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Uydu © Esri" });
    // Sağ üstte yazılı seçici: Harita / Uydu
    const secici = L.control({ position: "topright" });
    secici.onAdd = () => {
      const d = L.DomUtil.create("div", "altlik-sec");
      d.innerHTML = `<button type="button" data-altlik="harita" class="secili">Harita</button><button type="button" data-altlik="uydu">🛰 Uydu</button>`;
      L.DomEvent.disableClickPropagation(d);
      d.addEventListener("click", (e) => {
        const b = e.target.closest("[data-altlik]"); if (!b) return;
        const u = b.dataset.altlik === "uydu";
        if (u) { h.removeLayer(sokak); uydu.addTo(h); } else { h.removeLayer(uydu); sokak.addTo(h); }
        d.querySelectorAll("button").forEach((x) => x.classList.toggle("secili", x === b));
      });
      return d;
    };
    secici.addTo(h);
    const sinir = [];
    // Site sınırı: ince turuncu kesik çizgi
    if (v.sinir) L.polygon(v.sinir, { color: "#ef6c00", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(h);
    // Devriye izleri: mavi çizgi, kesintiler boş
    for (const t of izGorunen(v)) {
      const canli = izSuruyor() && t.benim && t.id === iz.tur;
      const nokta = canli ? [...t.iz, ...iz.kuyruk.map((x) => [x.z, x.lat, x.lng, x.k])] : t.iz;
      const parcalar = izParcalari(nokta.sort((a, b) => a[0] - b[0]));
      parcalar.forEach((p) => { L.polyline(p, { color: izRengi(t.rol), weight: 5, opacity: .9 }).addTo(h); sinir.push(...p); });
      if (nokta.length) {
        L.circleMarker([nokta[0][1], nokta[0][2]], { radius: 7, color: "#fff", weight: 2, fillColor: "#2e7d32", fillOpacity: 1 }).addTo(h)
          .bindPopup(`<b>${kac(t.ad)}</b><br>Başladı: ${saatYazisi(t.basla)}`);
        const s = nokta[nokta.length - 1];
        if (t.bitis) L.circleMarker([s[1], s[2]], { radius: 7, color: "#fff", weight: 2, fillColor: "#c62828", fillOpacity: 1 }).addTo(h)
          .bindPopup(`<b>${kac(t.ad)}</b><br>Bitti: ${saatYazisi(t.bitis)}`);
      }
      if (canli) { izCanli.cizgi = L.polyline([], { color: izRengi(t.rol), weight: 5, opacity: .9 }).addTo(h); izCanli.son = nokta.length ? [nokta[nokta.length - 1][1], nokta[nokta.length - 1][2]] : null; }
    }
    if (izSuruyor() && v.isaretleyebilir && !izCanli.cizgi) izCanli.cizgi = L.polyline([], { color: izRengi(oturum?.rol), weight: 5, opacity: .9 }).addTo(h);
    const hedef = sinir.length ? sinir : v.sinir || [];
    const sigdir = () => { h.invalidateSize(); if (hedef.length) h.fitBounds(hedef, { padding: [28, 28], maxZoom: 18 }); else h.setView([37.136, 27.322], 16); };
    sigdir(); requestAnimationFrame(() => setTimeout(sigdir, 60));
    devHarita = h;
    if (izSuruyor() && iz.son) izCanliCiz(iz.son[0], iz.son[1], false, true);
  }
  // Devriye sürerken yeni nokta haritaya eklenir; mavi nokta müdürün o anki yeri
  function izCanliCiz(lat, lng, kopuk, yalnizIsaret) {
    if (!devHarita || !izCanli.cizgi) return;
    const L = window.L;
    if (!yalnizIsaret) {
      if (kopuk) izCanli.cizgi = L.polyline([], { color: izRengi(oturum?.rol), weight: 5, opacity: .9 }).addTo(devHarita);
      izCanli.cizgi.addLatLng([lat, lng]);
    }
    if (izCanli.ben) izCanli.ben.setLatLng([lat, lng]);
    else izCanli.ben = L.circleMarker([lat, lng], { radius: 9, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(devHarita).bindPopup("Buradasınız");
    devHarita.panTo([lat, lng], { animate: true });
  }
  // ---------- Günlük Devriye ekranı ----------
  const turSatiri = (t, izleyen) => {
    const bas = Date.parse(t.basla), bit = t.bitis ? Date.parse(t.bitis) : null;
    const neden = t.bitis_nedeni === "mesai" ? " · mesai bitince kendiliğinden durdu" : t.bitis_nedeni === "otomatik" ? " · uzun süre konum gelmediği için kapandı" : "";
    return `<div class="iz-tur ${bit ? "" : "suruyor"}">
      <div class="iz-tur-ust"><span class="iz-renk" style="background:${izRengi(t.rol)}"></span>${izleyen ? `<b>${kac(t.ad)}</b> <small>${kac(ROL_ADI[t.rol] || t.rol)}</small>` : `<b>Devriye</b>`}
        <span class="iz-tur-saat">${saatYazisi(bas)} – ${bit ? saatYazisi(bit) : "sürüyor"}</span></div>
      <div class="iz-tur-alt">${bit ? `⏱ ${izSure(bit - bas)} · 🚶 ${kmYazisi(t.mesafe_m)}` : `● Devam ediyor · ${t.iz.length} nokta`}
        ${t.kesinti_sn >= 30 ? ` · <span class="iz-kesinti">⚠ ${izSure(t.kesinti_sn * 1000)} kayıt yapılamadı</span>` : ""}${kac(neden)}</div>
      ${izleyen && t.cihaz_turu ? `<div class="iz-tur-cihaz">📱 ${kac(t.cihaz_turu)}${t.ekran ? ` · ${t.ekran === "yok" ? "⚠ ekran açık tutulamadı" : "🔆 ekran açık tutuldu"}` : ""}</div>` : ""}
    </div>`;
  };
  // Telefona göre bir kerelik ayar bilgisi (iPhone ya da Android)
  const telefonAyarlari = () => iPhoneMu() ? `
    <details class="tel-ayar"><summary>📱 iPhone ayarları (ilk kullanımda bir kez)</summary><ol>
      <li>"Devriyeyi Başlat"a ilk basışta konum izni sorulur: <b>İzin Ver</b>'e dokunun.</li>
      <li>Konum gelmiyorsa: Ayarlar › Gizlilik ve Güvenlik › Konum Servisleri açık olsun; aynı yerde <b>Safari Web Siteleri</b> › <b>Uygulamayı Kullanırken</b> ve <b>Kesin Konum</b> açık olsun.</li>
      <li>Devriyede ekran kararırsa: Ayarlar › Ekran ve Parlaklık › Otomatik Kilit › <b>Hiçbir Zaman</b>.</li>
      <li>Düşük Güç Modu açıksa devriye süresince kapatın (pil simgesi sarıysa açıktır).</li>
      <li>Devriye sürerken başka uygulamaya geçmeyin, telefonu kilitlemeyin.</li></ol></details>` : `
    <details class="tel-ayar"><summary>📱 Android ayarları (ilk kullanımda bir kez)</summary><ol>
      <li>"Devriyeyi Başlat"a ilk basışta konum izni sorulur: <b>Uygulamayı kullanırken</b> ve <b>Tam konum</b>'u seçin.</li>
      <li>Telefonun üstten açılan menüsünde <b>Konum</b> açık olsun.</li>
      <li>Güç tasarrufu modu açıksa devriye süresince kapatın.</li>
      <li>Devriye sürerken başka uygulamaya geçmeyin, telefonu kilitlemeyin.</li></ol></details>`;
  function devriyeGovde(v) {
    if (!v) return `<p class="bos">Yükleniyor…</p>`;
    sakla.koy("sk_mesai", v.mesai); if (v.sinir) sakla.koy("sk_sinir", v.sinir);
    if (v.isaretleyebilir) {
      // Müdür ve şef: yalnızca Başlat / Bitir, harita ve bugünkü kendi devriyeleri
      const kendi = v.turlar.filter((t) => t.benim && !(izSuruyor() && t.id === iz.tur));
      return `
      <div class="iz-kart">
        ${izSuruyor() ? `
          <div class="servis-kayit-bant"><span class="kayit-nokta"></span> DEVRİYE SÜRÜYOR</div>
          <div id="iz-durum" class="iz-durum"></div>
          <button id="iz-bitir" class="ana-dugme iz-bitir" type="button">■ Devriyeyi Bitir</button>
          <p class="iz-not">📱 Ekran açık kalsın, başka uygulamaya geçmeyin. Telefon kilitlenirse ya da uygulamadan çıkılırsa kayıt durur.</p>`
        : iz?.bitis ? `
          <div class="iz-bekliyor">⏳ Devriye bitti. Bilgiler internet gelince kendiliğinden gönderilecek.</div>
          <div id="iz-durum" class="iz-durum"></div>`
        : mesaideMi() ? `<button id="iz-basla" class="ana-dugme iz-basla" type="button">▶ Devriyeyi Başlat</button>
          <p class="iz-not">Devriyeye çıkarken basın. Bitirince "Devriyeyi Bitir"e basın; konum yalnızca bu arada alınır.</p>
          ${telefonAyarlari()}`
        : `<button class="ana-dugme iz-basla" type="button" disabled>🔒 Devriyeyi Başlat</button>
          <p class="iz-neden">Devriye yalnızca mesai saatlerinde (<b>${kac(v.mesai.metin)}</b>) başlatılabilir. Şu an mesai dışı.</p>`}
      </div>
      <div class="devriye-harita" id="devriye-harita" aria-label="Devriye haritası"></div>
      ${kendi.length ? `<h2 class="iz-baslik">Bugünkü devriyeleriniz</h2>${kendi.map((t) => turSatiri(t, false)).join("")}` : ""}`;
    }
    // Yönetici ve yönetim kurulu: gün ve kişi seçilir, iz haritada mavi çizgi
    const gorunen = izGorunen(v);
    return `
      <div class="devriye-harita" id="devriye-harita" aria-label="Devriye haritası"></div>
      ${gorunen.map((t) => turSatiri(t, true)).join("")}
`;
  }


  $("#gorevler").addEventListener("click", async (e) => {
    const bas = e.target.closest("#iz-basla"); if (bas && !bas.disabled) return devriyeBaslat(bas);
    if (e.target.closest("#iz-bitir")) {
      if (!confirm("Devriye bitirilsin mi? Konum kaydı durur.")) return;
      return devriyeBitir("kullanici");
    }
  });

  $("#gorevler").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const d = e.target.querySelector("button[type=submit]"); d.disabled = true;
    try {
      if (e.target.id === "mesai-form") {
        await api("devriye_mesai", { bas: f.get("bas"), bit: f.get("bit") });
        mesaj("Mesai saatleri kaydedildi."); return devriyeAc(gorevVeri?.gun);
      }
    } catch (err) { mesaj(err.message); d.disabled = false; }
  });

  // Yönetim Kurulu ekranından açılan sayfalar geçmişe eklenir: telefonun geri tuşu da Yönetim Kurulu'na döner
  $("#gorevler-ac").addEventListener("click", () => { history.pushState({ yk: 1 }, "", "#gorevler"); gorevlerAc("gunluk"); });
  $("#haftalik-ac").addEventListener("click", () => { history.pushState({ yk: 1 }, "", "#gorevler-haftalik"); gorevlerAc("haftalik"); });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-geri-yksaha]")) return ykSahaAc();
    if (!e.target.closest("[data-geri-yk]")) return;
    if (history.state?.yk) history.back(); else yonetimIsleriAc();
  });

  $("#yonetim").addEventListener("click", (e) => {
    if (e.target.closest("#devret-ac")) $("#devret").hidden = !$("#devret").hidden;
  });

  // ---------- Servis Güzergahı: yönetici servisle bir tur atarken telefon güzergahı ve durakları kaydeder ----------
  // Ham konumlar yalnızca bu telefonda tutulur; "Kaydet"te sadeleştirilmiş çizgi ve duraklar gönderilir.
  var SERVIS_ANAHTAR = "sk_servis_kayit";
  var DURAK_SN = 20, DURAK_M = 15, NOKTA_M = 4, DOGRULUK_M = 40;
  var servisKayit = sakla.al(SERVIS_ANAHTAR);   // { bas, noktalar: [[lat,lng,ms]], duraklar: [{ad,lat,lng,sn}], bitti }
  var servisIzle = null, servisHarita = null, servisCizgi = null, servisBen = null, servisSaat = null, ekranKilidi = null;
  var durgun = null; // { lat, lng, bas, isaretli }
  var servisVeri = null;

  var metreArasi = (a, b) => {
    const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
    return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * 110540);
  };
  var dkYazisi = (sn) => sn < 60 ? `${sn} sn` : `${Math.round(sn / 60)} dk`;
  function sadelestir(ns, tol = NOKTA_M) {   // Douglas-Peucker
    if (ns.length < 3) return ns.slice();
    const kx = 111320 * Math.cos((ns[0][0] * Math.PI) / 180), xy = (p) => [p[1] * kx, p[0] * 110540];
    const tut = new Array(ns.length).fill(false); tut[0] = tut[ns.length - 1] = true;
    const yigin = [[0, ns.length - 1]];
    while (yigin.length) {
      const [i, j] = yigin.pop(); const [ax, ay] = xy(ns[i]), [bx, by] = xy(ns[j]);
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let en = -1, k = -1;
      for (let m = i + 1; m < j; m++) {
        const [px, py] = xy(ns[m]); const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
        const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > en) { en = d; k = m; }
      }
      if (en > tol) { tut[k] = true; yigin.push([i, k], [k, j]); }
    }
    return ns.filter((_, i) => tut[i]);
  }
  var toplamMesafe = (ns) => ns.reduce((t, p, i) => i ? t + metreArasi(ns[i - 1], p) : 0, 0);
  const durakAdi = async (lat, lng, sira) => `Durak ${sira}`;

  var servisSakla = () => sakla.koy(SERVIS_ANAHTAR, servisKayit);

  async function ekranAcikTut() {
    try { if ("wakeLock" in navigator && !ekranKilidi) { ekranKilidi = await navigator.wakeLock.request("screen"); ekranKilidi.addEventListener("release", () => { ekranKilidi = null; }); } } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && servisIzle != null) ekranAcikTut(); });

  function servisKonum(p) {
    if (!servisKayit || servisKayit.bitti) return;
    const { latitude: lat, longitude: lng, accuracy } = p.coords;
    if (accuracy > DOGRULUK_M) { servisDurumYaz(`Konum zayıf (±${Math.round(accuracy)} m), bekleniyor…`); return; }
    const t = Date.now(), yer = [lat, lng], ns = servisKayit.noktalar, son = ns[ns.length - 1];
    if (!son) {
      ns.push([lat, lng, t]);
      durakAdi(lat, lng, 1).then((ad) => { servisKayit.duraklar.unshift({ ad, lat, lng, sn: 0, kalkis: true }); servisSakla(); servisListeYaz(); });
    } else if (metreArasi(son, yer) >= NOKTA_M) { ns.push([lat, lng, t]); servisCizgi?.addLatLng(yer); }
    // Durak: aynı yerde (15 m içinde) 20 saniyeden uzun beklenirse kendiliğinden işaretlenir
    if (durgun && metreArasi([durgun.lat, durgun.lng], yer) <= DURAK_M) {
      if (!durgun.isaretli && t - durgun.bas >= DURAK_SN * 1000) { durgun.isaretli = true; durakEkle(durgun.lat, durgun.lng, durgun.bas); }
    } else durgun = { lat, lng, bas: t, isaretli: false };
    if (servisBen) servisBen.setLatLng(yer); else if (servisHarita) servisBen = window.L.circleMarker(yer, { radius: 9, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }).addTo(servisHarita);
    servisHarita?.panTo(yer, { animate: true });
    servisSakla(); servisDurumYaz();
  }
  async function durakEkle(lat, lng, zaman) {
    const sn = Math.round((zaman - servisKayit.bas) / 1000);
    // Az önce (30 m / 60 sn içinde) işaretlenmiş durağı ikinci kez ekleme
    if (servisKayit.duraklar.some((d) => metreArasi([d.lat, d.lng], [lat, lng]) < 30 && Math.abs(d.sn - sn) < 60)) return false;
    const d = { ad: await durakAdi(lat, lng, servisKayit.duraklar.length + 1), lat, lng, sn };
    servisKayit.duraklar.push(d); servisKayit.duraklar.sort((a, b) => a.sn - b.sn);
    servisSakla(); servisListeYaz();
    if (servisHarita) durakIsareti(d, servisKayit.duraklar.indexOf(d)).addTo(servisHarita);
    return true;
  }
  var durakIsareti = (d, i) => window.L.marker([d.lat, d.lng], { icon: window.L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<div class="hn hn-servis">${i + 1}</div>` }) }).bindPopup(`<b>${i + 1}. ${kac(d.ad)}</b><br>${d.sn ? `Kalkıştan ${dkYazisi(d.sn)} sonra` : "Kalkış"}`);

  function servisBaslat() {
    if (!navigator.geolocation) return mesaj("Bu telefon konum vermiyor.");
    servisKayit = { bas: Date.now(), noktalar: [], duraklar: [], bitti: false }; durgun = null;
    servisSakla(); servisIzlemeyiAc(); servisCiz();
  }
  function servisIzlemeyiAc() {
    if (servisIzle != null) return;
    ekranAcikTut();
    servisIzle = navigator.geolocation.watchPosition(servisKonum, (e) => {
      mesaj(e.code === 1 ? "Konum izni verilmedi. Telefonun ayarlarından bu uygulamaya konum izni verin." : "Konum alınamadı; açık alanda bekleyin.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    clearInterval(servisSaat); servisSaat = setInterval(() => servisDurumYaz(), 1000);
  }
  function servisIzlemeyiKapat() {
    if (servisIzle != null) navigator.geolocation.clearWatch(servisIzle);
    servisIzle = null; clearInterval(servisSaat); servisSaat = null;
    try { ekranKilidi?.release(); } catch {} ekranKilidi = null;
  }
  function servisBitir() {
    if (!servisKayit) return;
    if (servisKayit.noktalar.length < 2) return mesaj("Henüz yol kaydedilmedi. Servis hareket edince çizgi oluşur.");
    servisIzlemeyiKapat();
    servisKayit.bitti = true; servisKayit.son = servisKayit.noktalar[servisKayit.noktalar.length - 1][2];
    servisSakla(); servisCiz();
  }
  function servisKayitSil() { servisIzlemeyiKapat(); servisKayit = null; sakla.sil(SERVIS_ANAHTAR); servisCiz(); }
  async function servisGonder(d) {
    const ns = servisKayit.noktalar.map(([a, b]) => [a, b]);
    const cizgi = sadelestir(ns);
    d.disabled = true;
    try {
      await api("servis_kaydet", { cizgi, duraklar: servisKayit.duraklar.map(({ ad, lat, lng, sn }) => ({ ad, lat, lng, sn })),
        sure_sn: Math.round((servisKayit.son - servisKayit.bas) / 1000), mesafe_m: Math.round(toplamMesafe(ns)) });
      servisKayit = null; sakla.sil(SERVIS_ANAHTAR); servisVeri = null;
      mesaj("Servis güzergahı kaydedildi."); servisAc();
    } catch (e) { mesaj(e.message); d.disabled = false; }
  }

  function servisDurumYaz(not) {
    const k = $("#servis-durum"); if (!k || !servisKayit) return;
    const sn = Math.round(((servisKayit.bitti ? servisKayit.son : Date.now()) - servisKayit.bas) / 1000);
    const m = toplamMesafe(servisKayit.noktalar);
    k.innerHTML = `<b>${String(Math.floor(sn / 60)).padStart(2, "0")}:${String(sn % 60).padStart(2, "0")}</b>
      <span>${m >= 1000 ? (m / 1000).toFixed(2).replace(".", ",") + " km" : Math.round(m) + " m"} · ${servisKayit.duraklar.length} durak</span>
      ${not ? `<small>${kac(not)}</small>` : servisKayit.noktalar.length ? "" : `<small>Konum bekleniyor…</small>`}`;
  }
  function servisListeYaz() {
    const k = $("#servis-duraklar"); if (!k || !servisKayit) return;
    const duzen = servisKayit.bitti;
    k.innerHTML = servisKayit.duraklar.length ? servisKayit.duraklar.map((d, i) => `
      <li><span class="sd-no">${i + 1}</span>
        ${duzen ? `<input data-durak-ad="${i}" value="${kac(d.ad)}" maxlength="60" aria-label="Durak adı">` : `<b>${kac(d.ad)}</b>`}
        <small>${d.sn ? "+" + dkYazisi(d.sn) : "kalkış"}</small>
        ${duzen && i ? `<button type="button" class="sd-sil" data-durak-sil="${i}" aria-label="Durağı sil">✕</button>` : ""}</li>`).join("")
      : `<li class="bos">Henüz durak yok. Servis bir yerde 20 saniyeden uzun durunca kendiliğinden eklenir.</li>`;
  }

  async function servisHaritaKur(cizgi, duraklar, takip) {
    servisHaritaKapat();
    const kutu = $("#servis-harita"); if (!kutu) return;
    let L; try { L = await leaflet(); } catch (e) { kutu.innerHTML = `<p class="hata">${kac(e.message)}</p>`; return; }
    if (!document.body.contains(kutu)) return;
    const h = L.map(kutu, { zoomControl: true, tap: true, zoomSnap: 0.25, zoomDelta: 0.5, dragging: !L.Browser.mobile });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(h);
    servisCizgi = L.polyline(cizgi, { color: "#ef6c00", weight: 6, opacity: .9 }).addTo(h);
    duraklar.forEach((d, i) => durakIsareti(d, i).addTo(h));
    const yer = cizgi.length ? cizgi : [[37.1335, 27.3235]];
    const sigdir = () => { h.invalidateSize(); if (yer.length > 1 && !takip) h.fitBounds(yer, { padding: [26, 26] }); else h.setView(yer[yer.length - 1], 17); };
    sigdir(); requestAnimationFrame(() => setTimeout(sigdir, 60));
    servisHarita = h; servisBen = null;
  }
  function servisHaritaKapat() { if (servisHarita) { servisHarita.remove(); servisHarita = null; servisCizgi = null; servisBen = null; } }

  async function servisAc() {
    if (location.hash !== "#servis") history.replaceState(history.state, "", "#servis");
    goster("servis");
    saatDuzen = null; servisSaatCiz();
    if (servisKayit) return servisCiz();
    $("#servis").innerHTML = `<p class="bos">Yükleniyor…</p>`;
    try {
      const r = await api("servis"); servisVeri = r.guzergah;
      if (Array.isArray(r.saatler)) { sakla.koy("sk_servis_saat", r.saatler); if (!saatDuzen) servisSaatCiz(); }
    } catch (e) { $("#servis").innerHTML = `<p class="hata">${kac(e.message)}</p>`; return; }
    servisCiz();
  }
  // ---------- Sefer saatleri: herkes görür, yönetici değiştirir ----------
  var saatDuzen = null; // düzenlenirken geçici liste
  function servisSaatCiz() {
    const k = $("#servis-saatler"), liste = saatDuzen || sakla.al("sk_servis_saat");
    if (!liste) { k.innerHTML = `<p class="bos">Yükleniyor…</p>`; return; }
    k.innerHTML = saatDuzen ? `
      <ul class="saat-duzen">${liste.map((x) => `<li>${kac(x)}<button type="button" data-saat-sil="${kac(x)}" aria-label="${kac(x)} seferini sil">✖</button></li>`).join("")}</ul>
      <div class="saat-ekle"><input id="saat-yeni" type="time" aria-label="Yeni sefer saati"><button type="button" class="kucuk-dugme" id="saat-ekle">＋ Saat ekle</button></div>
      <div class="dugmeler"><button type="button" class="ikincil" id="saat-vazgec">Vazgeç</button><button type="button" class="ana-dugme" id="saat-kaydet">Kaydet</button></div>` : `
      <ul>${liste.map((x) => `<li>${kac(x)}</li>`).join("")}</ul>
      ${yonetici() ? `<button type="button" class="ikincil saat-degistir" id="saat-degistir">✏️ Saatleri değiştir</button>` : ""}`;
  }
  $("#servis-saatler").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "saat-degistir") { saatDuzen = [...(sakla.al("sk_servis_saat") || [])]; return servisSaatCiz(); }
    if (b.id === "saat-vazgec") { saatDuzen = null; return servisSaatCiz(); }
    if (b.dataset.saatSil) { saatDuzen = saatDuzen.filter((x) => x !== b.dataset.saatSil); return servisSaatCiz(); }
    if (b.id === "saat-ekle") {
      const v = $("#saat-yeni").value.slice(0, 5);
      if (!/^\d\d:\d\d$/.test(v)) return mesaj("Önce eklenecek saati seçin.");
      if (saatDuzen.includes(v)) return mesaj("Bu saat zaten var.");
      saatDuzen = [...saatDuzen, v].sort(); return servisSaatCiz();
    }
    if (b.id === "saat-kaydet") {
      // Seçilip "Saat ekle"ye basılmamış saat kaybolmasın
      if ($("#saat-yeni").value) return mesaj("Seçtiğiniz saati eklemek için önce “Saat ekle”ye basın.");
      b.disabled = true; b.textContent = "Kaydediliyor…";
      try {
        const r = await api("servis_saat_kaydet", { saatler: saatDuzen });
        sakla.koy("sk_servis_saat", r.saatler); saatDuzen = null; servisSaatCiz(); mesaj("Servis saatleri değiştirildi.");
      } catch (err) { mesaj(err.message); b.disabled = false; b.textContent = "Kaydet"; }
    }
  });
  function servisCiz() {
    const k = $("#servis"); if (!k) return;
    if (servisKayit && !servisKayit.bitti) {
      // Kayıt sürüyor (sayfa yenilendiyse kaldığı yerden devam eder)
      k.innerHTML = `
        <div class="servis-kayit-bant"><span class="kayit-nokta"></span> KAYIT SÜRÜYOR</div>
        <div id="servis-durum" class="servis-durum"></div>
        <div id="servis-harita" class="servis-harita"></div>
        <button id="servis-durak" class="ana-dugme servis-durak-dugme" type="button">📍 Burada durak var</button>
        <button id="servis-bitir" class="ana-dugme servis-bitir" type="button">⏹ Turu bitir</button>
        <p class="servis-not">Ekran açık kalsın, uygulamadan çıkmayın. Servis 20 saniyeden uzun durunca durak kendiliğinden eklenir; isterseniz düğmeyle de ekleyebilirsiniz.</p>
        <h3 class="servis-baslik">Duraklar</h3><ol id="servis-duraklar" class="servis-duraklar"></ol>`;
      servisDurumYaz(); servisListeYaz();
      servisHaritaKur(servisKayit.noktalar.map(([a, b]) => [a, b]), servisKayit.duraklar, true);
      servisIzlemeyiAc();
      return;
    }
    if (servisKayit && servisKayit.bitti) {
      // Tur bitti: durak adları düzeltilir, gereksiz durak silinir, sonra kaydedilir
      k.innerHTML = `
        <div class="devriye-ozet tam"><b>✅ Tur tamamlandı</b><span id="servis-durum" class="servis-durum-ic"></span></div>
        <div id="servis-harita" class="servis-harita"></div>
        <h3 class="servis-baslik">Durakları kontrol edin</h3>
        <p class="servis-not">Durak adlarını düzeltebilir, gereksiz olanları ✕ ile silebilirsiniz.</p>
        <ol id="servis-duraklar" class="servis-duraklar"></ol>
        <button id="servis-kaydet" class="ana-dugme" type="button">💾 Güzergahı kaydet</button>
        <button id="servis-yeniden" class="ikincil servis-ikincil" type="button">🔁 Kaydı sil, yeniden kaydet</button>`;
      servisDurumYaz(); servisListeYaz();
      servisHaritaKur(sadelestir(servisKayit.noktalar.map(([a, b]) => [a, b])), servisKayit.duraklar, false);
      return;
    }
    const v = servisVeri;
    k.innerHTML = v ? `
      <div class="devriye-ozet tam"><b>🚐 Bir tur ${dkYazisi(v.sure_sn)} · ${(v.mesafe_m / 1000).toFixed(1).replace(".", ",")} km</b>
        <span>${v.duraklar.length} durak · ${kac(v.kaydeden)} · ${gunYazisi(v.created_at.slice(0, 10))}</span></div>
      <div id="servis-harita" class="servis-harita"></div>
      <h3 class="servis-baslik">Duraklar ve kalkıştan sonraki süre</h3>
      <ol class="servis-duraklar">${v.duraklar.map((d, i) => `<li><span class="sd-no">${i + 1}</span><b>${kac(d.ad)}</b><small>${d.sn ? "+" + dkYazisi(d.sn) : "kalkış"}</small></li>`).join("")}</ol>
      ${yonetici() ? `<p class="servis-not">Ring saatlerini girdiğimizde bu süreler, her sokak için "servis ne zaman geçer" tarifesine dönüşecek.</p>` : ""}
      ${yonetici() ? `<button id="servis-basla" class="ikincil servis-ikincil" type="button">🔴 Yeni tur kaydet (bunun yerine geçer)</button>` : ""}`
      : !yonetici() ? `<div class="servis-bos"><div class="servis-ikon">🚐</div><h2>Servis güzergahı yakında</h2>
        <p class="servis-not">Yönetim servis güzergahını kaydettiğinde burada haritada görünecek.</p></div>`
      : `
      <div class="servis-bos">
        <div class="servis-ikon">🚐</div>
        <h2>Güzergah henüz kaydedilmedi</h2>
        <ol class="servis-adimlar">
          <li>Servise binin, kalkış noktasında <b>Kaydı başlat</b>'a basın.</li>
          <li>Tur boyunca ekran açık kalsın; telefon geçilen yolu çizer.</li>
          <li>Servis 20 saniyeden uzun durduğunda durak kendiliğinden eklenir. İsterseniz <b>Burada durak var</b> düğmesine de basabilirsiniz.</li>
          <li>Kalkış noktasına dönünce <b>Turu bitir</b>, durak adlarını kontrol edip <b>Kaydet</b>.</li>
        </ol>
        <p class="servis-not">Konum yalnızca kayıt sırasında, bu telefonda alınır. Sunucuya sadece güzergah çizgisi ve duraklar gider.</p>
      </div>
      <button id="servis-basla" class="ana-dugme servis-basla" type="button">🔴 Kaydı başlat</button>`;
    if (v) servisHaritaKur(v.cizgi, v.duraklar, false);
  }
  $("#servis").addEventListener("click", async (e) => {
    const d = e.target.closest("button"); if (!d) return;
    if (d.id === "servis-basla") {
      if (servisVeri && !confirm("Yeni kayıt, kayıtlı güzergahın yerine geçecek. Başlatılsın mı?")) return;
      return servisBaslat();
    }
    if (d.id === "servis-durak") {
      const son = servisKayit?.noktalar[servisKayit.noktalar.length - 1];
      if (!son) return mesaj("Konum bekleniyor…");
      return mesaj(await durakEkle(son[0], son[1], Date.now()) ? "Durak eklendi." : "Bu durak az önce eklendi.");
    }
    if (d.id === "servis-bitir") { if (confirm("Tur bitirilsin mi?")) servisBitir(); return; }
    if (d.id === "servis-yeniden") { if (confirm("Bu tur silinsin mi?")) servisKayitSil(); return; }
    if (d.id === "servis-kaydet") return servisGonder(d);
    if (d.dataset.durakSil) { servisKayit.duraklar.splice(Number(d.dataset.durakSil), 1); servisSakla(); servisCiz(); }
  });
  $("#servis").addEventListener("input", (e) => {
    const i = e.target.dataset.durakAd; if (i == null || !servisKayit) return;
    servisKayit.duraklar[Number(i)].ad = e.target.value; servisSakla();
  });

  // ---------- Modüller: alt menü ----------
  function sahaAc() {
    history.replaceState(null, "", location.pathname);
    goster("liste"); listeCiz();
  }
  // Parsel Temsilcisi: ayrı ekran; temsilcinin resmi, adı, telefonu ve iletişim düğmeleri
  function parselAc() {
    if (location.hash !== "#parsel") history.replaceState(null, "", "#parsel");
    goster("parsel"); parselCiz();
  }
  const telefonYaz = (t) => {
    const d = String(t || "").replace(/\D/g, "").replace(/^90(?=5\d{9}$)/, "");
    return /^5\d{9}$/.test(d) ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}` : String(t || "");
  };
  const telefonUluslararasi = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.startsWith("0") ? "90" + d.slice(1) : d.length === 10 ? "90" + d : d; };
  const parselFotoHtml = (t) => t?.resim_url ? `<img src="${kac(t.resim_url)}" alt="${kac(t.ad)}">` : `<span>👤</span>`;
  function temsilciKart(t, resimEkler) {
    const tel = t.telefon ? telefonUluslararasi(t.telefon) : "";
    return `
      <div class="parsel-kart">
        <div class="parsel-kimlik">
          <div class="parsel-resim">${parselFotoHtml(t)}</div>
          <div>
            <small>${kac(t.baslik)}</small>
            <b>${kac(t.ad)}</b>
            ${t.telefon ? `<span class="parsel-tel">📞 ${kac(telefonYaz(t.telefon))}</span>` : ""}
          </div>
        </div>
        ${tel ? `<div class="parsel-dugmeler">
          <a class="parsel-ara" href="tel:+${kac(tel)}">📞 Ara</a>
          <a class="parsel-wp" href="https://wa.me/${kac(tel)}" target="_blank" rel="noopener">💬 WhatsApp</a>
          <a class="parsel-sms" href="sms:+${kac(tel)}">✉️ Mesaj</a>
        </div>` : ""}
        ${resimEkler ? `<label class="foto-dugme parsel-resim-ekle"><input type="file" accept="image/*" data-temsilci-resim="${t.id}" hidden><span>📷 ${t.resim_url ? "Resmi değiştir" : "Resim ekle"}</span></label>
          <small class="ipucu">Ortaklar ${t.no_bas}–${t.no_bit} numaralar. Resim ana sayfadaki "Parsel Temsilcisi" düğmesinde görünür.</small>` : ""}
      </div>`;
  }
  // ---------- Paylaşım bölümleri: Duyurular ve Restoran (görsel, metin, PDF) ----------
  // Duyuruyu yalnızca yönetici, restoran paylaşımını restoran yetkilisi ve yönetici yapar ve siler;
  // herkes görür, her paylaşım uygulamayı kullanan herkese sesli bildirimle duyurulur.
  const PAYLASIM_TURLERI = { gorsel: ["📷", "Görsel", "image/*"], metin: ["📝", "Metin", ""], pdf: ["📄", "PDF", "application/pdf"] };
  const PAYLASIM_BOLUMU = {
    restoran: { ornekMetin: "Örn. Bu akşam balık günü!", ornekAciklama: "Örn. Haftanın menüsü", bos: "Henüz paylaşım yok." },
    duyuru: { ornekMetin: "Örn. Cumartesi günü saat 10.00'da sitede ilaçlama yapılacaktır.", ornekAciklama: "Örn. Genel Kurul daveti", bos: "Henüz duyuru yok." },
  };
  const paylasimTur = { restoran: "gorsel", duyuru: "metin" };
  async function paylasimAc(b) {
    if (location.hash !== "#" + b) history.replaceState(null, "", "#" + b);
    goster(b);
    const kutu = $("#" + b);
    if (!kutu.innerHTML) kutu.innerHTML = `<p class="bos">Yükleniyor…</p>`;
    try { const v = await api(b + "_liste"); paylasimCiz(b, v); if (b === "duyuru") duyuruGorulduIsaretle(v); }
    catch (e) { kutu.innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }
  function restoranAc() { return paylasimAc("restoran"); }
  function duyuruAc() { return paylasimAc("duyuru"); }
  function paylasimHtml(b, p, yonetir) {
    let ic = "";
    if (p.tur === "gorsel") ic = p.url ? `<button type="button" class="aidat-buyut" data-resim="${kac(p.url)}" aria-label="Tam ekran aç"><img src="${kac(p.url)}" alt=""></button>` : `<div class="foto-bos">Görsel açılamadı</div>`;
    else if (p.tur === "pdf") ic = p.url ? `<a class="paylasim-pdf" href="${kac(p.url)}" target="_blank" rel="noopener">📄 PDF'yi aç</a>` : "";
    return `<article class="paylasim${b === "duyuru" ? " duyuru" : ""}">
      <div class="paylasim-ust"><span>${PAYLASIM_TURLERI[p.tur]?.[0] || ""} ${kac(p.ekleyen)} · ${tarihSaat(p.created_at)}</span>
        ${yonetir ? `<button type="button" class="kucuk-dugme tehlike" data-paylasim-sil="${p.id}">🗑 Sil</button>` : ""}</div>
      ${ic}
      ${p.metin ? `<p class="paylasim-metin">${kac(p.metin)}</p>` : ""}
    </article>`;
  }
  function paylasimCiz(b, v) {
    const tur = paylasimTur[b], t = PAYLASIM_TURLERI[tur], ayar = PAYLASIM_BOLUMU[b];
    let siparis = "";
    if (b === "restoran") {
      const uluslar = v.tel ? telefonUluslararasi(v.tel) : "";
      const wpMetin = encodeURIComponent(`Merhaba, Sporkent sitesinden sipariş vermek istiyorum.\n${oturum?.unvan ? oturum.unvan + " · " : ""}${oturum?.ad || ""}\n\nSiparişim:\n`);
      siparis = v.tel ? `<div class="restoran-siparis">
        <small>Sipariş için</small>
        <span class="tel">📞 ${kac(v.tel)}</span>
        <div class="restoran-dugmeler">
          <a class="ara" href="tel:+${kac(uluslar)}">📞 Ara</a>
          <a class="wp" href="https://wa.me/${kac(uluslar)}?text=${wpMetin}" target="_blank" rel="noopener">💬 WhatsApp</a>
        </div>
      </div>` : `<p class="bos">Sipariş telefonu henüz girilmedi.</p>`;
    }
    $("#" + b).innerHTML = `
      ${v.yonetir ? `
      <form class="kart restoran-yonet" data-paylasim-form>
        <b class="restoran-form-baslik">➕ ${b === "duyuru" ? "Yeni duyuru" : "Yeni paylaşım"}</b>
        <div class="restoran-tur">${Object.entries(PAYLASIM_TURLERI).map(([k, [ikon, ad]]) => `<button type="button" data-paylasim-tur="${k}" class="${k === tur ? "secili" : ""}">${ikon}<br>${ad}</button>`).join("")}</div>
        ${tur !== "metin" ? `<label class="foto-dugme"><input data-paylasim-dosya type="file" accept="${t[2]}" hidden><span>${t[0]} ${t[1]} seçin</span></label>
          <p data-paylasim-secilen class="ipucu" hidden></p>` : ""}
        <label>${tur === "metin" ? (b === "duyuru" ? "Duyuru metni" : "Paylaşılacak metin") : "Açıklama (isteğe bağlı)"}
          <textarea name="metin" rows="${tur === "metin" ? 5 : 2}" maxlength="3000" placeholder="${tur === "metin" ? ayar.ornekMetin : ayar.ornekAciklama}"></textarea>
        </label>
        <button class="ana-dugme" type="submit">📣 ${b === "duyuru" ? "Duyur ve herkese bildir" : "Paylaş ve herkese bildir"}</button>
        ${b === "restoran" ? `<details class="restoran-tel-ayar"><summary>📞 Sipariş telefonunu değiştir</summary>
          <input name="tel" type="tel" maxlength="20" value="${kac(v.tel)}" placeholder="0532 123 45 67">
          <button type="button" class="ikincil" data-restoran-tel-kaydet style="width:100%;margin-top:8px">Telefonu kaydet</button>
        </details>` : ""}
      </form>` : ""}
      ${siparis}
      ${v.paylasimlar.length ? v.paylasimlar.map((p) => paylasimHtml(b, p, v.yonetir)).join("") : `<p class="bos">${ayar.bos}</p>`}`;
  }
  // Görsel küçültülüp JPEG olarak, PDF olduğu gibi yüklenir (en fazla 50 MB)
  async function paylasimDosyaYukle(b, f) {
    const tur = paylasimTur[b];
    let blob = f, uzanti, tip;
    if (tur === "gorsel") { blob = await kucult(f, 2400); uzanti = "jpg"; tip = "image/jpeg"; }
    else { uzanti = "pdf"; tip = "application/pdf"; }
    if (blob.size > 50 * 1048576) throw new Error("Dosya çok büyük (en fazla 50 MB).");
    const { yol, adres } = await api("yukleme_adresi", { tur: b, uzanti });
    const r = await fetch(adres, { method: "PUT", headers: { "Content-Type": tip, "x-upsert": "false" }, body: blob });
    if (!r.ok) throw new Error("Dosya yüklenemedi, tekrar deneyin.");
    return yol;
  }
  for (const b of ["restoran", "duyuru"]) {
    const kutu = $("#" + b);
    kutu.addEventListener("click", async (e) => {
      const r = e.target.closest("[data-resim]"); if (r) return resimGoster(r.dataset.resim);
      const tb = e.target.closest("[data-paylasim-tur]");
      if (tb) { paylasimTur[b] = tb.dataset.paylasimTur; return paylasimAc(b); }
      if (e.target.closest("[data-restoran-tel-kaydet]")) {
        try { const x = await api("restoran_tel", { tel: kutu.querySelector("[data-paylasim-form]").tel.value }); mesaj(`Sipariş telefonu kaydedildi: ${x.tel}`); await paylasimAc(b); }
        catch (err) { mesaj(err.message); }
        return;
      }
      const s = e.target.closest("[data-paylasim-sil]"); if (!s) return;
      if (!confirm(b === "duyuru" ? "Bu duyuru herkesten silinsin mi?" : "Bu paylaşım herkesten silinsin mi?")) return;
      s.disabled = true;
      try { await api(b + "_sil", { id: Number(s.dataset.paylasimSil) }); mesaj(b === "duyuru" ? "Duyuru silindi." : "Paylaşım silindi."); await paylasimAc(b); }
      catch (err) { mesaj(err.message); s.disabled = false; }
    });
    kutu.addEventListener("change", (e) => {
      if (!e.target.matches("[data-paylasim-dosya]")) return;
      const f = e.target.files?.[0], y = kutu.querySelector("[data-paylasim-secilen]");
      if (!f) { y.hidden = true; return; }
      y.textContent = `Seçilen: ${f.name} (${(f.size / 1048576).toFixed(1)} MB)`; y.hidden = false;
    });
    kutu.addEventListener("submit", async (e) => {
      if (!e.target.matches("[data-paylasim-form]")) return;
      e.preventDefault();
      const f = e.target, d = f.querySelector("button[type=submit]"), eski = d.textContent, tur = paylasimTur[b];
      const dosya = f.querySelector("[data-paylasim-dosya]")?.files?.[0];
      if (tur !== "metin" && !dosya) return mesaj(`Önce ${PAYLASIM_TURLERI[tur][1].toLocaleLowerCase("tr")} seçin.`);
      d.disabled = true; d.textContent = "Yükleniyor…";
      try {
        const yol = tur === "metin" ? null : await paylasimDosyaYukle(b, dosya);
        d.textContent = "Gönderiliyor…";
        const r = await api(b + "_paylas", { tur, metin: f.metin.value, yol });
        mesaj(b === "duyuru"
          ? (typeof r?.basarili === "number" ? `Duyuru yayımlandı. ${r.basarili} telefona bildirim gönderildi (sizinki dahil).` : "Duyuru yayımlandı. Herkese bildirim gönderildi.")
          : (typeof r?.basarili === "number" ? `Paylaşıldı. ${r.basarili} telefona bildirim gönderildi (sizinki dahil).` : "Paylaşıldı. Herkese bildirim gönderildi."));
        await paylasimAc(b);
      } catch (err) { mesaj(err.message); d.disabled = false; d.textContent = eski; }
    });
  }

  // Ana sayfadaki Duyurular düğmesinde okunmamış duyuru sayısı (dakikada en çok bir kez sorulur)
  let duyuruSon = { zaman: 0, tarihler: [] };
  async function duyuruRozeti() {
    const k = $("#ana-kutular [data-ac=duyuru] small"); if (!k) return;
    const yaz = () => {
      const gorulen = sakla.al("sk_duyuru_gorulen") || "";
      const yeni = duyuruSon.tarihler.filter((t) => t > gorulen).length;
      k.textContent = yeni ? `🔴 ${yeni} yeni duyuru` : "";
    };
    yaz();
    if (Date.now() - duyuruSon.zaman < 60000) return;
    duyuruSon.zaman = Date.now();
    try { duyuruSon.tarihler = (await api("duyuru_liste")).paylasimlar.map((p) => p.created_at); yaz(); } catch {}
  }
  // Duyurular açılınca hepsi okunmuş sayılır
  const duyuruGorulduIsaretle = (v) => { if (v.paylasimlar[0]) sakla.koy("sk_duyuru_gorulen", v.paylasimlar[0].created_at); duyuruSon.tarihler = v.paylasimlar.map((p) => p.created_at); };

  // ---------- Kullanım raporu (yalnızca yönetici) ----------
  const BOLUM_ADI = { duyuru: "📢 Duyurular", parsel: "👤 Parsel Temsilcisi", saha: "🛠️ Saha Takip", restoran: "🍽️ Restoran", yonetim: "🗂️ Yönetim Kurulu",
    aidat: "💳 Aidat", plaka: "🚗 Plaka-Kimlik Bildirimi", iletisim: "☎️ İletişim", sokaklar: "🗺️ Sokak Numaraları", servis: "🚐 Servis",
    yakinlar: "👨‍👩‍👧 Ortak Yakını Onayları", uyeler: "👥 Üyeler ve Ayarlar", rapor: "📊 Kullanım Raporu", yksaha: "🛠️ YK Saha Takip",
    program: "📅 İş Programı", devriye: "🚶 Günlük Devriye", gorevler: "✅ Görevler" };
  const RAPOR_DONEM = { 1: "Bugün", 7: "Son 7 gün", 30: "Son 30 gün", 90: "Son 3 ay", 365: "Son 1 yıl" };
  let raporGun = 30, raporVeri = null, raporAra = "";
  const sonGorulmeKisa = (t) => {
    if (!t) return "Hiç";
    const dk = Math.round((Date.now() - Date.parse(t)) / 60000);
    if (dk < 5) return "Şu an";
    if (dk < 60) return `${dk} dk önce`;
    if (dk < 1440) return `${Math.round(dk / 60)} saat önce`;
    if (dk < 2880) return "Dün";
    return `${Math.round(dk / 1440)} gün önce`;
  };
  async function raporAc() {
    if (!yonetici()) return;
    if (location.hash !== "#rapor") history.replaceState(history.state, "", "#rapor");
    goster("rapor");
    $("#rapor").innerHTML = `<p class="bos">Rapor hazırlanıyor…</p>`;
    try { raporVeri = await api("kullanim_raporu", { gun: raporGun }); raporCiz(); }
    catch (e) { $("#rapor").innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }
  function raporCiz() {
    const v = raporVeri, o = v.ozet;
    const enFazla = Math.max(1, ...v.bolumler.map((b) => b.acilis));
    const ara = raporAra.toLocaleLowerCase("tr");
    const kisiler = v.kisiler.filter((k) => !ara || `${k.ad} ${k.unvan}`.toLocaleLowerCase("tr").includes(ara));
    const kutu = (sayi, ad, alt = "") => `<div class="rapor-kutu"><b>${sayi}</b><span>${ad}</span>${alt ? `<small>${alt}</small>` : ""}</div>`;
    $("#rapor").innerHTML = `
      <div class="rapor-donem">${Object.entries(RAPOR_DONEM).map(([g, ad]) => `<button type="button" data-rapor-gun="${g}" class="${Number(g) === v.gun ? "secili" : ""}">${ad}</button>`).join("")}</div>
      <p class="ipucu rapor-tarih">Rapor tarihi: ${tarihSaat(new Date())} · Dönem: ${RAPOR_DONEM[v.gun]}</p>
      <h3 class="rapor-baslik">Kaç kişi kullanıyor?</h3>
      <div class="rapor-kutular">
        ${kutu(o.kayitli, "Kayıtlı kişi", o.bekleyen ? `+ ${o.bekleyen} onay bekliyor` : "")}
        ${kutu(o.kurulu, "Telefonuna yükleyen", "ana ekrana eklemiş")}
        ${kutu(o.bildirim, "Bildirimi açık")}
        ${kutu(o.aktif_24s, "Son 24 saatte giren")}
        ${kutu(o.aktif_7g, "Son 7 günde giren")}
        ${kutu(o.aktif_30g, "Son 30 günde giren")}
      </div>
      <div class="rapor-kutular iki">
        ${kutu(o.donemde_acan, "Bu dönemde uygulamayı açan")}
        ${kutu(o.acilis, "Bu dönemde toplam açılış")}
      </div>
      <h3 class="rapor-baslik">Kimler kayıtlı?</h3>
      <div class="kart rapor-roller">${v.roller.map(([ad, n]) => `<div><span>${kac(ad)}</span><b>${n}</b></div>`).join("") || `<p class="bos">Kayıt yok.</p>`}</div>
      <h3 class="rapor-baslik">En çok kullanılan bölümler <small>(${RAPOR_DONEM[v.gun].toLocaleLowerCase("tr")})</small></h3>
      <div class="kart rapor-bolumler">${v.bolumler.length ? v.bolumler.map((b, i) => `
        <div class="rapor-bolum">
          <div class="rapor-bolum-ust"><span>${i + 1}. ${BOLUM_ADI[b.bolum] || kac(b.bolum)}</span><b>${b.acilis} açılış · ${b.kisi} kişi</b></div>
          <div class="rapor-cubuk"><i style="width:${Math.max(3, Math.round(b.acilis / enFazla * 100))}%"></i></div>
        </div>`).join("") : `<p class="bos">Bu dönemde henüz kayıtlı kullanım yok. Sayım bu güncellemeyle başladı; birkaç gün içinde dolacak.</p>`}</div>
      <h3 class="rapor-baslik">Kim, ne zaman kullandı? <small>(${v.kisiler.length} kişi)</small></h3>
      <input class="rapor-ara" type="search" placeholder="🔍 İsimle ara" value="${kac(raporAra)}">
      <div class="rapor-kisiler">${kisiler.map((k) => `
        <div class="rapor-kisi">
          <div><b>${kac(k.ad)}</b><small>${kac(k.unvan)}</small></div>
          <div class="rapor-kisi-sag"><span class="${k.son_gorulme && Date.now() - Date.parse(k.son_gorulme) < 7 * 86400e3 ? "aktif" : "pasif"}">${sonGorulmeKisa(k.son_gorulme)}</span>
            <small>${k.kurulu ? "📲" : ""}${k.bildirim ? "🔔" : "🔕"} ${k.acilis ? `${k.acilis} açılış` : ""}${k.en_cok ? ` · ${BOLUM_ADI[k.en_cok] || k.en_cok}` : ""}</small></div>
        </div>`).join("") || `<p class="bos">Bulunamadı.</p>`}</div>
      <p class="ipucu">📲 telefonuna yüklemiş · 🔔 bildirimi açık · 🔕 bildirimi kapalı. "Açılış": seçilen dönemde uygulamayı kaç gün/kez açtığı.</p>
      <button type="button" class="ikincil rapor-yazdir" data-rapor-yazdir>🖨️ Yazdır / PDF olarak kaydet</button>`;
  }
  $("#rapor").addEventListener("click", (e) => {
    const g = e.target.closest("[data-rapor-gun]");
    if (g) { raporGun = Number(g.dataset.raporGun); return raporAc(); }
    if (e.target.closest("[data-rapor-yazdir]")) window.print();
  });
  $("#rapor").addEventListener("input", (e) => {
    if (!e.target.matches(".rapor-ara")) return;
    raporAra = e.target.value;
    const yer = e.target.selectionStart;
    raporCiz();
    const a = $("#rapor .rapor-ara"); a.focus(); a.setSelectionRange(yer, yer);
  });

  // ---------- Ortak: plaka girişi talebi ----------
  function plakaAc() {
    if (location.hash !== "#plaka") history.replaceState(null, "", "#plaka");
    goster("plaka");
  }
  // Ortaklık numarası ve telefon kayıttan alınır, sorulmaz. Yalnızca programda olmayan bilgi sorulur:
  // yakının aracında yakının adı ve telefonu; ortak yakınının kendi aracında kendi adı (kaydında ortağın adı durur)
  function plakaAlanlari() {
    const f = $("#plaka-form"), arac = f.arac.value, yakinArac = arac === "yakin";
    const ad = yakinArac || (arac === "kendi" && /Yakını/.test(oturum?.unvan || ""));
    for (const [alan, kutu, gerek] of [["#plaka-ad-alan", f.arac_sahibi, ad], ["#plaka-tel-alan", f.arac_sahibi_tel, yakinArac]]) {
      $(alan).hidden = !gerek; kutu.required = gerek;
    }
    $("#plaka-ad-etiket").textContent = yakinArac ? "Aracın sahibi olan yakınınızın adı ve soyadı" : "Adınız ve soyadınız";
    $("#plaka-sahibi").hidden = !ad;
  }
  $("#plaka-form").addEventListener("change", (e) => { if (e.target.name === "arac") plakaAlanlari(); });
  $("#plaka-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, d = f.querySelector("button[type=submit]");
    d.disabled = true; d.textContent = "Gönderiliyor…";
    try {
      const r = await api("plaka_talebi", { arac: f.arac.value, plaka: f.plaka.value, arac_sahibi: f.arac_sahibi.value, arac_sahibi_tel: f.arac_sahibi_tel.value });
      if (r.eposta) {
        mesaj("Bildiriminiz kooperatife e-postayla gönderildi.");
      } else {
        // Sunucuda e-posta hizmeti yoksa telefonun e-posta uygulaması hazır metinle açılır
        mesaj("Bildiriminiz kaydedildi. Açılan e-postada “Gönder”e dokunun.");
        location.href = `mailto:${r.kime}?subject=${encodeURIComponent(r.konu)}&body=${encodeURIComponent(r.metin)}`;
      }
      f.reset(); plakaAlanlari();
      setTimeout(anaAc, 1500);
    } catch (err) { mesaj(err.message); }
    finally { d.disabled = false; d.textContent = "📧 Kooperatife Gönder"; }
  });

  // ---------- Parsel temsilcisi: ortak yakınlarının katılma başvuruları ----------
  function yakinlarAc() {
    if (location.hash !== "#yakinlar") history.replaceState(null, "", "#yakinlar");
    goster("yakinlar"); yakinCiz();
  }
  function yakinCiz() {
    const liste = bekleyenYakinlar;
    $("#yakin-liste").innerHTML = liste.length ? liste.map((y) => `
      <div class="yakin-kart">
        <b>${kac(y.ad)}</b>
        <span>${kac(y.ortak_no)} No'lu ortağın yakını · ${tarihSaat(y.created_at)}</span>
        <span class="${y.ad_uyuyor ? "eslesme-uyuyor" : "eslesme-uymuyor"} yakin-eslesme">${y.ad_uyuyor ? "✔ Yazdığı ortak adı kooperatif kaydıyla aynı" : "✖ Yazdığı ortak adı kooperatif kaydından farklı"}</span>
        <span class="eslesme-uymuyor yakin-eslesme">✖ Telefonu ortağın kooperatif kaydında yok</span>
        <a class="yakin-tel" href="tel:${kac(String(y.telefon).replace(/\s/g, ""))}">📞 ${kac(y.telefon)} · Ara</a>
        <div class="dugmeler">
          <button type="button" class="ikincil tehlike" data-yakin-reddet="${kac(y.cihaz)}">✖ Reddet</button>
          <button type="button" class="ana-dugme" data-yakin-onayla="${kac(y.cihaz)}">✔ Onayla</button>
        </div>
      </div>`).join("") : `<p class="bos">Onay bekleyen yakın yok. 👍</p>`;
  }
  $("#yakin-liste").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-yakin-onayla],[data-yakin-reddet]"); if (!b) return;
    const onay = !!b.dataset.yakinOnayla, hedef = b.dataset.yakinOnayla || b.dataset.yakinReddet;
    if (!onay && !confirm("Bu başvuru reddedilsin mi? Kişi uygulamaya giremez.")) return;
    b.disabled = true;
    try {
      await api(onay ? "yakin_onayla" : "yakin_reddet", { hedef });
      await yenile(); yakinCiz();
      mesaj(onay ? "Onaylandı. Uygulama kişinin telefonunda açıldı." : "Başvuru reddedildi.");
    } catch (err) { mesaj(err.message); b.disabled = false; }
  });

  // Parsel Temsilcisi ekranı: ortağa kendi temsilcisi, yöneticiye bütün temsilciler (resim ekleyerek)
  function parselCiz() {
    let html;
    if (ortakMi()) {
      html = parsel.temsilci
        ? temsilciKart(parsel.temsilci) + `<p class="parsel-not">Saha Takip'e yazdığınız yeni kayıt önce parsel temsilcinize gider. Onaylarsa genel Saha Takip'e düşer ve herkes görür.</p>`
        : `<p class="parsel-not">Ortak numaranız için parsel temsilcisi henüz belirlenmedi.</p>`;
    } else if (parsel?.temsilciler) {
      html = parsel.temsilciler.length ? parsel.temsilciler.map((t) => temsilciKart(t, parsel.resimEkler)).join("")
        : `<p class="parsel-not">Henüz parsel temsilcisi tanımlanmadı.</p>`;
    } else html = `<p class="bos">Yükleniyor…</p>`;
    $("#parsel-icerik").innerHTML = html;
  }
  // Saha Takip'te ortağa kısa hatırlatma: yeni kaydı önce temsilcisine gider
  function parselUstCiz() {
    const kutu = $("#parsel-ust");
    const t = ortakMi() ? parsel.temsilci : null;
    kutu.innerHTML = t ? `<p class="parsel-not">Yeni kaydınız önce parsel temsilciniz <b>${kac(t.ad)}</b> onaylayınca genel Saha Takip'e düşer.</p>` : "";
    kutu.hidden = !t;
  }
  $("#parsel-icerik").addEventListener("change", async (e) => {
    const id = e.target.dataset?.temsilciResim; if (!id) return;
    const f = e.target.files?.[0]; if (!f) return;
    const etiket = e.target.nextElementSibling;
    etiket.textContent = "Yükleniyor…";
    try {
      const blob = await kucult(f, 1024);
      const yol = await fotoYukle(blob, "temsilci");
      await api("temsilci_resim", { id: Number(id), yol });
      await yenile();
      parselCiz();
      mesaj("Parsel temsilcisinin resmi eklendi.");
    } catch (err) { mesaj(err.message); etiket.textContent = "📷 Resim ekle"; e.target.value = ""; }
  });
  function yonetimIsleriAc() {
    if (!programGorur()) return;
    for (const id of ["#program-ac", "#gorevler-ac", "#haftalik-ac"]) $(id).hidden = !gorevGorur();
    if (location.hash !== "#yonetim-isleri") history.replaceState(null, "", "#yonetim-isleri");
    goster("yonetimisleri");
  }
  // İletişim açılınca siteyle bağlantı önceden kurulsun: dokununca daha çabuk açılır
  let siteHazir = false;
  function siteyeHazirlan() {
    if (siteHazir) return;
    siteHazir = true;
    for (const rel of ["dns-prefetch", "preconnect"]) {
      const l = document.createElement("link");
      l.rel = rel; l.href = "https://sporkentsitesi.com";
      document.head.appendChild(l);
    }
  }
  function iletisimAc() {
    siteyeHazirlan();
    if (location.hash !== "#iletisim") history.replaceState(null, "", "#iletisim");
    goster("iletisim");
  }
  const MODUL_AC = { duyuru: duyuruAc, rapor: () => raporAc(), restoran: restoranAc, plaka: plakaAc, yakinlar: yakinlarAc, parsel: parselAc, saha: sahaAc, yonetim: yonetimIsleriAc, aidat: aidatAc, iletisim: iletisimAc, sokaklar: sokaklarAc, servis: servisAc, uyeler: () => yonetimAc() };
  $("#alt-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-modul]"); if (!b) return;
    MODUL_AC[b.dataset.modul]();
  });
  document.getElementById("acilis")?.remove(); // eski sürümden kalan açılış ekranı
  // ---------- Ana sayfa: bölümler büyük düğmeler halinde ----------
  function anaAc() {
    if (location.hash !== "#ana") history.replaceState(null, "", "#ana");
    goster("ana");
    $("#ana-hitap").textContent = hitap();
    $("#ana-ad").textContent = oturum?.ad || "";
    $("#ana-kutular [data-ac=yonetim]").hidden = !programGorur();
    // Plaka girişi talebi: yalnızca ortaklar (ve ortak yakınları)
    $("#ana-kutular [data-ac=plaka]").hidden = !ortakMi() && oturum?.rol !== "baskan";
    // Restoran herkese açık (paylaşımları herkese bildirilir)
    $("#ana-kutular [data-ac=restoran]").hidden = false;
    // Parsel temsilcisine: ortak yakını onayları
    const yk = $("#ana-kutular [data-ac=yakinlar]");
    yk.hidden = !parsel?.temsilcilik;
    yk.querySelector("small").textContent = bekleyenYakinlar.length ? `⏳ ${bekleyenYakinlar.length} onay bekliyor` : "Bekleyen yok";
    // Parsel Temsilcisi düğmesi ortaklarda ve yöneticide (resmi o ekler); Saha Takip herkeste ayrı düğme
    const pk = $("#ana-kutular [data-ac=parsel]");
    pk.hidden = !(ortakMi() || yonetici());
    const pt = ortakMi() ? parsel.temsilci : parsel?.temsilciler?.[0];
    $("#ana-parsel-foto").innerHTML = pt?.resim_url ? `<img src="${kac(pt.resim_url)}" alt="">` : "👤";
    pk.querySelector("small").textContent = ortakMi() ? (pt ? `${pt.ad} · ${telefonYaz(pt.telefon)}` : "Henüz belirlenmedi")
      : parsel?.temsilciler?.length ? parsel.temsilciler.map((t) => t.ad).join(", ") : "";
    // Üyeler ve Ayarlar yalnızca yöneticide; onay bekleyen üye varsa sayısı yazar
    $("#ana-kutular [data-ac=uyeler]").hidden = !yonetici();
    $("#ana-kutular [data-ac=rapor]").hidden = !yonetici();
    $("#ana-kutular [data-ac=uyeler] small").textContent = yonetici() && bekleyenSayisi ? `${bekleyenSayisi} onay bekliyor` : "";
    // Restoran yetkilisi yalnızca Restoran bölümünü görür
    // (duyuruları o da görür)
    if (oturum?.rol === "restoran") for (const k of document.querySelectorAll("#ana-kutular .ana-kutu")) k.hidden = !["restoran", "duyuru"].includes(k.dataset.ac);
    duyuruRozeti();
    // Yönetim Kurulu'nu görenlerde o en üstte tam genişlik, Parsel Temsilcisi onun eski yerinde (Restoran'dan sonra) yarım kutu.
    // Ortaklarda Parsel Temsilcisi en üstte tam genişlik kalır.
    const kutular = $("#ana-kutular"), ykKutu = $("#ana-kutular [data-ac=yonetim]"), rsKutu = $("#ana-kutular [data-ac=restoran]");
    const takas = !ykKutu.hidden && !pk.hidden;
    // Servis hep Restoran'ın hemen yanında
    const svKutu = $("#ana-kutular [data-ac=servis]");
    rsKutu.after(svKutu);
    if (takas) {
      kutular.prepend(ykKutu);
      svKutu.after(pk);
      if (!ortakMi() && parsel?.temsilciler?.length) pk.querySelector("small").textContent = `${parsel.temsilciler.length} temsilci`;
    } else {
      kutular.prepend(pk);
      svKutu.after(ykKutu);
    }
    ykKutu.classList.toggle("sabit-tam", takas); ykKutu.classList.toggle("tam", takas);
    pk.classList.toggle("sabit-tam", !takas); pk.classList.toggle("tam", !takas); pk.classList.toggle("yarim", takas);
    // Görünen kutu sayısı tekse son kutu tam genişlik olsun (en üstteki büyük kutu ve Ortak Yakını Onayları hep tam genişlik)
    const gorunen = [...document.querySelectorAll("#ana-kutular .ana-kutu:not(.sabit-tam):not(.ak-yakinlar)")].filter((k) => !k.hidden);
    gorunen.forEach((k, i) => k.classList.toggle("tam", i === gorunen.length - 1 && gorunen.length % 2 === 1));
    for (const [kutu, rozet] of [["saha", "#saha-rozet"], ["yonetim", "#yk-rozet"]]) {
      const r = $(rozet), k = $(`#ana-kutular [data-ac=${kutu}] small`);
      k.textContent = r && !r.hidden && r.textContent ? r.textContent : "";
    }
    // Onayımı bekleyen kayıt (parsel temsilcisi / yönetim) varsa Saha Takip düğmesinde yazsın
    const onayimda = kayitlar.filter(benOnaylarim).length;
    if (onayimda) $("#ana-kutular [data-ac=saha] small").textContent = `⏳ ${onayimda} kayıt onayınızı bekliyor`;
    kutulariSigdir();
  }
  // Ana sayfadan açılan bölüm geçmişe eklenir: telefonun geri tuşu ana sayfaya döner
  const MODUL_ADRES = { duyuru: "duyuru", rapor: "rapor", restoran: "restoran", plaka: "plaka", yakinlar: "yakinlar", parsel: "parsel", saha: "saha", yonetim: "yonetim-isleri", aidat: "aidat", iletisim: "iletisim", sokaklar: "sokak-numaralari", servis: "servis", uyeler: "uyeler" };
  $("#ana-kutular").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ac]"); if (!b) return;
    history.pushState({ ana: 1 }, "", "#" + MODUL_ADRES[b.dataset.ac]);
    MODUL_AC[b.dataset.ac]();
  });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-ana]")) anaAc(); });
  $("#onay-uyari").addEventListener("click", () => { filtre = filtre === "onay" ? "acik" : "onay"; listeCiz(); });

  // ---------- Sokak Numaraları: numaratör resmi, iki parmakla büyütülür ----------
  const NUMARATOR = { genislik: 3685, yukseklik: 5392 };
  let numHarita = null;
  async function sokaklarAc() {
    if (location.hash !== "#sokak-numaralari") history.replaceState(null, "", "#sokak-numaralari");
    goster("sokaklar");
    if (numHarita) { numHarita.invalidateSize(); return; }
    let L;
    try { L = await leaflet(); } catch (e) { $("#numarator").innerHTML = `<p class="hata">${kac(e.message)}</p>`; return; }
    const sinir = [[0, 0], [NUMARATOR.yukseklik, NUMARATOR.genislik]];
    const h = L.map($("#numarator"), { crs: L.CRS.Simple, minZoom: -4, maxZoom: 2, zoomSnap: 0.25, zoomDelta: 0.5,
      attributionControl: false, maxBounds: [[-400, -400], [NUMARATOR.yukseklik + 400, NUMARATOR.genislik + 400]], maxBoundsViscosity: 0.9 });
    // Önce küçük resim anında görünür, büyük resim yüklenince üstüne gelir
    L.imageOverlay("veri/sokak_numarator_kucuk.jpg", sinir).addTo(h);
    L.imageOverlay("veri/sokak_numarator.jpg", sinir).addTo(h);
    const sigdir = () => { h.invalidateSize(); h.fitBounds(sinir); h.setMinZoom(h.getZoom() - 0.5); };
    sigdir(); requestAnimationFrame(() => setTimeout(sigdir, 60));
    numHarita = h;
  }

  // ---------- Aidat: yıl içindeki parasal yükümlülükler (resim) ----------
  async function aidatAc() {
    if (location.hash !== "#aidat") history.replaceState(null, "", "#aidat");
    goster("aidat");
    const kutu = $("#aidat");
    if (!kutu.innerHTML) kutu.innerHTML = `<p class="bos">Yükleniyor…</p>`;
    try { aidatCiz(await api("aidat_liste")); }
    catch (e) { kutu.innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }

  function aidatCiz(v) {
    $("#aidat").innerHTML = `
      <h1 class="modul-baslik">💳 Aidat</h1>
      <p class="modul-alt">Yıl içinde ödenmesi gereken ödemeler. Resme dokunursanız tam ekran açılır, iki parmakla büyütebilirsiniz.</p>
      ${v.resimler.length ? v.resimler.map((x) => `
      <figure class="aidat-resim">
        ${x.url ? `<button type="button" class="aidat-buyut" data-resim="${kac(x.url)}" aria-label="Tam ekran aç"><img src="${kac(x.url)}" alt="${kac(x.baslik || "Aidat")}"></button>` : `<div class="foto-bos">Resim açılamadı</div>`}
        <figcaption><span>${x.baslik ? `<b>${kac(x.baslik)}</b><br>` : ""}${tarihSaat(x.created_at)}</span>
          ${v.ekleyebilir ? `<button type="button" class="kucuk-dugme tehlike" data-aidat-sil="${x.id}">🗑 Sil</button>` : ""}</figcaption>
      </figure>`).join("") : `<p class="bos">Henüz aidat bilgisi eklenmedi.</p>`}
      ${v.ekleyebilir ? `
      <form class="kart aidat-ekle" id="aidat-form">
        <label>Başlık (isteğe bağlı)
          <input name="baslik" maxlength="120" placeholder="Örn. 2027 yılı aidat ve ödemeler">
        </label>
        <label class="foto-dugme"><input id="aidat-dosya" type="file" accept="image/*" hidden><span>➕ Resim ekle</span></label>
        <small class="ipucu">Resmi seçtiğiniz anda eklenir ve herkese bildirilir.</small>
      </form>` : ""}`;
  }

  $("#aidat").addEventListener("change", async (e) => {
    if (e.target.id !== "aidat-dosya") return;
    const f = e.target.files?.[0]; if (!f) return;
    const etiket = e.target.nextElementSibling;
    etiket.textContent = "Yükleniyor…";
    try {
      const blob = await kucult(f, 2400);
      const yol = await fotoYukle(blob, "aidat");
      await api("aidat_ekle", { yol, baslik: $("#aidat-form").baslik.value });
      mesaj("Resim eklendi. Herkese bildirildi.");
      await aidatAc();
    } catch (err) { mesaj(err.message); etiket.textContent = "➕ Resim ekle"; e.target.value = ""; }
  });
  // ---------- Tam ekran resim: iki parmakla büyütülür; telefonun geri tuşu da kapatır ----------
  let resimHarita = null;
  async function resimGoster(url) {
    const kutu = $("#resim-gorucu"); kutu.hidden = false; document.body.classList.add("gorucu-acik");
    history.pushState({ ...(history.state || {}), resim: 1 }, "", location.hash || "#");
    let L; try { L = await leaflet(); } catch (e) { mesaj(e.message); return resimKapat(); }
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch { mesaj("Resim açılamadı."); return resimKapat(); }
    if (kutu.hidden) return;
    if (resimHarita) { resimHarita.remove(); resimHarita = null; }
    const sinir = [[0, 0], [img.naturalHeight, img.naturalWidth]];
    const h = L.map($("#resim-gorucu-alan"), { crs: L.CRS.Simple, attributionControl: false, zoomControl: false, zoomSnap: 0, zoomDelta: 0.5,
      maxBounds: [[-img.naturalHeight * 0.2, -img.naturalWidth * 0.2], [img.naturalHeight * 1.2, img.naturalWidth * 1.2]], maxBoundsViscosity: 0.9 });
    L.imageOverlay(url, sinir).addTo(h);
    // Telefonun genişliğine tam sığan en büyük hali: resim ekran genişliğinde, üstten başlar; aşağı kaydırılır.
    // Tamamını görmek için iki parmakla küçültülebilir, okumak için 4 kata kadar büyütülür.
    const sigdir = () => {
      h.invalidateSize();
      const { x: W, y: H } = h.getSize(); if (!W || !H) return;
      const genislik = Math.log2(W / img.naturalWidth), tamami = Math.min(genislik, Math.log2(H / img.naturalHeight));
      h.setMinZoom(tamami); h.setMaxZoom(genislik + 2);
      const yari = (H / 2) / Math.pow(2, genislik);
      h.setView([Math.max(img.naturalHeight - yari, img.naturalHeight / 2), img.naturalWidth / 2], genislik, { animate: false });
    };
    sigdir(); requestAnimationFrame(() => setTimeout(sigdir, 60));
    resimHarita = h;
  }
  function resimKapat(geriden) {
    const kutu = $("#resim-gorucu"); if (kutu.hidden) return;
    kutu.hidden = true; document.body.classList.remove("gorucu-acik");
    if (resimHarita) { resimHarita.remove(); resimHarita = null; }
    if (!geriden && history.state?.resim) history.back();
  }
  $("#resim-kapat").addEventListener("click", () => resimKapat());
  window.addEventListener("popstate", () => resimKapat(true));

  $("#aidat").addEventListener("click", async (e) => {
    const r = e.target.closest("[data-resim]"); if (r) return resimGoster(r.dataset.resim);
    const b = e.target.closest("[data-aidat-sil]"); if (!b) return;
    if (!confirm("Bu resim herkesten silinsin mi?")) return;
    b.disabled = true;
    try { await api("aidat_sil", { id: Number(b.dataset.aidatSil) }); mesaj("Resim silindi."); await aidatAc(); }
    catch (err) { mesaj(err.message); b.disabled = false; }
  });

  // ---------- Yönetim iş programı (takvim): gün / hafta / ay ----------
  const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const GUNLER = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const TEKRAR = { yok: "", gunluk: "Her gün", haftalik: "Her hafta", aylik: "Her ay" };
  const tGun = (t) => new Date(t + "T00:00:00Z");
  const tYaz = (d) => d.toISOString().slice(0, 10);
  const tEkle = (t, n) => tYaz(new Date(tGun(t).getTime() + n * 864e5));
  const haftaGunu = (t) => (tGun(t).getUTCDay() + 6) % 7; // pazartesi 0
  const ayinGunu = (t) => tGun(t).getUTCDate();
  const ayinSonGunu = (t) => new Date(Date.UTC(tGun(t).getUTCFullYear(), tGun(t).getUTCMonth() + 1, 0)).getUTCDate();
  const uzunTarih = (t) => `${ayinGunu(t)} ${AYLAR[tGun(t).getUTCMonth()]} ${tGun(t).getUTCFullYear()}, ${GUNLER[haftaGunu(t)]}`;
  let progGorunum = "hafta", progTarih = bugun(), progVeri = [], progFormAcik = false;

  // Bir iş o gün yapılacak mı (tekrarlayanlar başladığı günden itibaren)
  function oGunMu(x, gun) {
    if (gun < x.tarih) return false;
    if (x.tekrar === "yok") return gun === x.tarih;
    if (x.tekrar === "gunluk") return true;
    if (x.tekrar === "haftalik") return haftaGunu(gun) === haftaGunu(x.tarih);
    // Her ay: ayın aynı günü; ay o kadar uzun değilse ayın son günü
    return ayinGunu(gun) === Math.min(ayinGunu(x.tarih), ayinSonGunu(gun));
  }
  const gununIsleri = (gun) => progVeri.filter((x) => oGunMu(x, gun)).sort((a, b) => (a.saat || "99").localeCompare(b.saat || "99"));

  function progAralik() {
    if (progGorunum === "yil") { const y = progTarih.slice(0, 4); return [`${y}-01-01`, `${y}-12-31`]; }
    if (progGorunum === "hafta") { const b = tEkle(progTarih, -haftaGunu(progTarih)); return [b, tEkle(b, 6)]; }
    const ilk = progTarih.slice(0, 8) + "01";
    const bas = tEkle(ilk, -haftaGunu(ilk));
    const son = progTarih.slice(0, 8) + String(ayinSonGunu(progTarih)).padStart(2, "0");
    return [bas, tEkle(son, 6 - haftaGunu(son))];
  }

  async function programAc() {
    if (!gorevGorur()) return;
    if (location.hash !== "#program") history.replaceState(history.state, "", "#program");
    goster("program");
    if (!$("#program").innerHTML) $("#program").innerHTML = `<p class="bos">Yükleniyor…</p>`;
    const [bas, bit] = progAralik();
    try { progVeri = (await api("program_liste", { bas, bit })).kayitlar || []; programCiz(); }
    catch (e) { $("#program").innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }

  const isKarti = (x) => `<div class="prog-is">
      ${x.saat ? `<span class="saat">${kac(x.saat)}</span>` : ""}
      <span class="icerik"><b>${kac(x.baslik)}</b>
        ${x.aciklama ? `<small>${kac(x.aciklama)}</small>` : ""}
        <small>${TEKRAR[x.tekrar] ? `🔁 ${TEKRAR[x.tekrar]} · ` : ""}Giren: ${kac(x.ekleyen || "")}</small></span>
      ${x.silebilir ? `<button type="button" class="sil" data-prog-sil="${x.id}" data-tekrar="${x.tekrar}">Sil</button>` : ""}
    </div>`;

  function programCiz() {
    const [bas] = progAralik();
    const bugunT = bugun();
    let etiket, icerik;
    if (progGorunum === "yil") {
      const y = progTarih.slice(0, 4);
      etiket = y;
      const say = Array(12).fill(0);
      for (let g = `${y}-01-01`; g <= `${y}-12-31`; g = tEkle(g, 1)) say[tGun(g).getUTCMonth()] += gununIsleri(g).length;
      const buAy = bugunT.slice(0, 7);
      icerik = `<div class="prog-yil">${AYLAR.map((ad, i) => {
        const ay = `${y}-${String(i + 1).padStart(2, "0")}`;
        return `<button type="button" data-prog-ay="${ay}-01" class="${say[i] ? "dolu" : ""} ${ay === buAy ? "bugun" : ""}"><b>${ad}</b><small>${say[i] ? `${say[i]} iş` : "İş yok"}</small></button>`;
      }).join("")}</div>
        <p class="ipucu" style="font-size:15px">Bir aya dokunun, o ayın takvimi açılsın.</p>`;
    } else if (progGorunum === "hafta") {
      etiket = `${ayinGunu(bas)} ${AYLAR[tGun(bas).getUTCMonth()]} – ${ayinGunu(tEkle(bas, 6))} ${AYLAR[tGun(tEkle(bas, 6)).getUTCMonth()]}`;
      icerik = Array.from({ length: 7 }, (_, i) => tEkle(bas, i)).map((g) => {
        const isler = gununIsleri(g);
        return `<div class="prog-gun"><h3 class="${g === bugunT ? "bugun" : ""}">${GUNLER[haftaGunu(g)]}, ${ayinGunu(g)} ${AYLAR[tGun(g).getUTCMonth()]}</h3>
          ${isler.length ? isler.map(isKarti).join("") : `<p class="prog-bos">İş yok</p>`}</div>`;
      }).join("");
    } else {
      etiket = `${AYLAR[tGun(progTarih).getUTCMonth()]} ${tGun(progTarih).getUTCFullYear()}`;
      const ay = progTarih.slice(0, 7);
      icerik = `<div class="prog-ay">${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((g) => `<span class="gun-adi">${g}</span>`).join("")}
        ${Array.from({ length: Math.round((tGun(progAralik()[1]) - tGun(bas)) / 864e5) + 1 }, (_, i) => tEkle(bas, i)).map((g) => {
          const n = gununIsleri(g).length;
          return `<button type="button" data-prog-gun="${g}" class="${g.slice(0, 7) !== ay ? "disarida" : ""} ${g === bugunT ? "bugun" : ""} ${n ? "dolu" : ""} ${g === progTarih ? "secili" : ""}">${ayinGunu(g)}${n ? `<i>${n}</i>` : ""}</button>`;
        }).join("")}</div>
        <p class="ipucu" style="font-size:15px">Bir güne dokunun, o günün işleri aşağıda görünsün.</p>`;
      // Seçili günün işleri takvimin altında
      if (progTarih.slice(0, 7) === ay) {
        const isler = gununIsleri(progTarih);
        icerik += `<div class="prog-gun"><h3 class="${progTarih === bugunT ? "bugun" : ""}">${uzunTarih(progTarih)}</h3>
          ${isler.length ? isler.map(isKarti).join("") : `<p class="prog-bos">Bu gün için girilmiş iş yok</p>`}</div>`;
      }
    }
    $("#program").innerHTML = `
      <div class="baslik-cift"><button class="geri" data-geri-yk>← Geri</button><h1 class="sayfa-bant bant-program">📅 İş Programı</h1></div>
      <div class="prog-sekme">
        ${[["hafta", "Haftalık"], ["ay", "Aylık"], ["yil", "Yıllık"]].map(([k, ad]) => `<button type="button" data-prog-gorunum="${k}" class="${progGorunum === k ? "secili" : ""}">${ad}</button>`).join("")}
      </div>
      <div class="prog-gezin"><button type="button" data-prog-git="-1" aria-label="Önceki">‹</button><b>${etiket}</b><button type="button" data-prog-git="1" aria-label="Sonraki">›</button></div>
      ${progAralik()[0] <= bugunT && bugunT <= progAralik()[1] ? "" : `<button type="button" class="ikincil prog-bugun" data-prog-bugun>Bugüne dön</button>`}
      ${icerik}
      <button type="button" class="ana-dugme" id="prog-ekle-ac" style="margin-top:8px" ${progFormAcik ? "hidden" : ""}>➕ Yeni iş ekle</button>
      <form id="prog-form" class="prog-form" ${progFormAcik ? "" : "hidden"}>
        <h2 style="margin-top:0">Yeni iş</h2>
        <label>Yapılacak iş
          <textarea name="baslik" class="prog-is-yaz" required rows="6" maxlength="1000" placeholder="Örn. Ağaçlar bugün teslim edilecek"></textarea>
          <small class="ipucu">Konuşarak yazmak için klavyedeki 🎤 mikrofon tuşuna basın.</small>
        </label>
        <div class="dugmeler">
          <button type="button" class="ikincil" id="prog-vazgec">Vazgeç</button>
          <button class="ana-dugme" type="submit">Kaydet</button>
        </div>
      </form>`;
  }

  $("#program").addEventListener("click", async (e) => {
    const t = e.target;
    const gor = t.closest("[data-prog-gorunum]");
    if (gor) { progGorunum = gor.dataset.progGorunum; return programAc(); }
    const git = t.closest("[data-prog-git]");
    if (git) {
      const n = Number(git.dataset.progGit);
      if (progGorunum === "yil") progTarih = `${Number(progTarih.slice(0, 4)) + n}-01-01`;
      else if (progGorunum === "hafta") progTarih = tEkle(progTarih, 7 * n);
      else { const d = tGun(progTarih.slice(0, 8) + "01"); d.setUTCMonth(d.getUTCMonth() + n); progTarih = tYaz(d); }
      return programAc();
    }
    if (t.closest("[data-prog-bugun]")) { progTarih = bugun(); return programAc(); }
    const gun = t.closest("[data-prog-gun]");
    if (gun) {
      const ayDegisti = gun.dataset.progGun.slice(0, 7) !== progTarih.slice(0, 7);
      progTarih = gun.dataset.progGun;
      return ayDegisti ? programAc() : programCiz();
    }
    const ayB = t.closest("[data-prog-ay]");
    if (ayB) { progTarih = ayB.dataset.progAy; progGorunum = "ay"; return programAc(); }
    if (t.closest("#prog-ekle-ac")) {
      progFormAcik = true; $("#prog-form").hidden = false; t.closest("#prog-ekle-ac").hidden = true;
      $("#prog-form").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (t.closest("#prog-vazgec")) { progFormAcik = false; return programCiz(); }
    const sil = t.closest("[data-prog-sil]");
    if (sil) {
      const tekrarli = sil.dataset.tekrar !== "yok";
      if (!confirm(tekrarli ? "Bu tekrarlayan iş bütün günlerden silinsin mi?" : "Bu iş programdan silinsin mi?")) return;
      sil.disabled = true;
      try { await api("program_sil", { id: Number(sil.dataset.progSil) }); mesaj("Silindi."); await programAc(); }
      catch (err) { mesaj(err.message); sil.disabled = false; }
    }
  });
  $("#program").addEventListener("submit", async (e) => {
    if (e.target.id !== "prog-form") return;
    e.preventDefault();
    const f = new FormData(e.target);
    const d = e.target.querySelector("button[type=submit]");
    d.disabled = true; d.textContent = "Kaydediliyor…";
    try {
      // Tarih sorulmaz: iş bugüne yazılır (aylık takvimde bir gün seçiliyse o güne)
      const tarih = progGorunum === "ay" ? progTarih : bugun();
      await api("program_ekle", { baslik: f.get("baslik"), tarih, tekrar: "yok" });
      progFormAcik = false; progTarih = tarih;
      mesaj("İş programına eklendi. Yönetim, müdür ve şefe bildirildi.");
      await programAc();
    } catch (err) { mesaj(err.message); d.disabled = false; d.textContent = "Kaydet"; }
  });
  $("#program-ac").addEventListener("click", () => {
    progGorunum = "hafta"; progTarih = bugun(); progFormAcik = false;
    history.pushState({ yk: 1 }, "", "#program");
    programAc();
  });

  // Çıkış düğmesi yok (kazara basılıyordu). Gerekirse üst yeşil banda 3 saniye basılı tutunca sorulur.
  // Telefonda resme basılı tutmak tarayıcının kendi menüsünü açıp dokunuşu iptal ediyordu;
  // bu yüzden dokunma olayları ayrı dinleniyor ve onay penceresi sayfanın içinde gösteriliyor.
  let logoZamani = null;
  const logo = $(".ust");
  const basla3sn = () => {
    clearTimeout(logoZamani);
    if (!oturum) return;
    logoZamani = setTimeout(() => { logoZamani = null; navigator.vibrate?.(80); $("#cikis-sor").hidden = false; }, 3000);
  };
  const birak = () => { clearTimeout(logoZamani); logoZamani = null; };
  logo.addEventListener("touchstart", basla3sn, { passive: true });
  logo.addEventListener("touchend", birak);
  logo.addEventListener("touchcancel", birak);
  logo.addEventListener("mousedown", basla3sn);
  logo.addEventListener("mouseup", birak);
  logo.addEventListener("mouseleave", birak);
  logo.addEventListener("contextmenu", (e) => e.preventDefault());
  $("#cikis-evet").addEventListener("click", () => { $("#cikis-sor").hidden = true; cikisYap(); });
  $("#cikis-hayir").addEventListener("click", () => { $("#cikis-sor").hidden = true; });


  $("#liste").addEventListener("click", (e) => {
    const s = e.target.closest(".satir"); if (s) detayGoster(Number(s.dataset.id));
  });

  $("#bekle-bildirim").addEventListener("click", () => bildirimAc(false));
  // Yapılanlar / Yapılmayanlar düğmeleri listeyi süzer
  $("#ozet").addEventListener("click", (e) => {
    const k = e.target.closest("[data-filtre]"); if (!k) return;
    filtre = k.dataset.filtre;
    listeCiz();
  });
  $("#gecikme-uyari").addEventListener("click", () => { filtre = "acik"; listeCiz(); });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-geri]")) { history.replaceState(null, "", location.pathname); goster("liste"); listeCiz(); }
  });

  // Yeni kayıt formu
  const yeniForm = $("#yeni-form");
  const yeniFoto = fotoSecici($("#yeni-foto"), $("#yeni-foto-onizleme"), $("#yeni-foto-yazi"), $("#yeni-galeri"));

  // Kaydın türü seçilmez, girildiği yere göre belirlenir:
  // Saha Takip "+ Yeni kayıt" → genel yapılacak iş; Yönetim Kurulu › YK Saha Takip "Yeni iş emri ver" → Yönetim İş Emri
  let yeniTur = "genel";
  // YK iş emri: süre baştan seçilir (varsayılan 2 gün)
  const EMIR_VARSAYILAN_GUN = 2;
  let emirGun = EMIR_VARSAYILAN_GUN;
  function emirSureCiz() {
    $("#emir-sure-sec").innerHTML = [1, 2, 3, 5, 7, 10, 15, 30]
      .map((g) => `<button type="button" data-gun="${g}" class="${g === emirGun ? "secili" : ""}">${g} gün</button>`).join("");
  }
  $("#emir-sure-sec").addEventListener("click", (e) => {
    const b = e.target.closest("[data-gun]"); if (!b) return;
    emirGun = Number(b.dataset.gun); emirSureCiz();
  });
  function yeniFormAc(tur) {
    yeniTur = tur === "yonetim" && yonetimIsiGirebilir() ? "yonetim" : "genel";
    yeniForm.reset(); yeniFoto.sifirla();
    $("#yeni-baslik").textContent = yeniTur === "yonetim" ? "Yeni YK iş emri" : "Yeni kayıt";
    $("#yeni-tur-not").hidden = yeniTur !== "yonetim";
    $("#emir-sure").hidden = yeniTur !== "yonetim" || sureGormez();
    emirGun = EMIR_VARSAYILAN_GUN; emirSureCiz();
    goster("yeni");
  }
  $("#yeni-ac").addEventListener("click", () => { if (yeniGirebilir()) yeniFormAc("genel"); });
  $("#yk-yeni").addEventListener("click", () => yeniFormAc("yonetim"));

  yeniForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = yeniForm.querySelector("button[type=submit]");
    const hata = yeniForm.querySelector(".hata"); hata.hidden = true;
    d.disabled = true; d.textContent = "Gönderiliyor…";
    try {
      const f = new FormData(yeniForm);
      const foto = yeniFoto.al() ? await fotoYukle(yeniFoto.al()) : null;
      const r = await api("yeni", {
        bildiren: oturum.ad, yer: f.get("yer"), sorun: f.get("sorun"), foto,
        gizli: yonetimIsiGirebilir() && yeniTur === "yonetim",
        sure: yonetimIsiGirebilir() && yeniTur === "yonetim" && !sureGormez() ? emirGun : undefined,
      });
      mesaj(r.kayit.onay_durumu === "bekliyor" && r.temsilci_ad ? `Kayıt ${r.kayit.no} parsel temsilcinize (${r.temsilci_ad}) iletildi. Onaylarsa genel Saha Takip'e düşecek.`
        : r.kayit.onay_durumu === "bekliyor" ? `Kayıt ${r.kayit.no} yönetime iletildi. Onaylanınca iş listesine düşecek.`
        : r.kayit.gizli ? `Yönetim İş Emri ${r.kayit.no} açıldı. YK Saha Takip'te görünür; müdür ve şefe bildirildi.` : `Kayıt ${r.kayit.no} açıldı. Müdüre bildirildi.`);
      // Kendi açtığımız kayıt için pencere açılmasın
      sakla.koy("sk_gorulen", [anahtar(r.kayit), ...(sakla.al("sk_gorulen") || [])]);
      if (r.kayit.gizli) { ykFiltre = "acik"; ykSahaAc(); } else goster("liste");
      await yenile();
    } catch (err) {
      hata.textContent = err.message; hata.hidden = false;
    } finally { d.disabled = false; d.textContent = "Gönder"; }
  });

  // Bildirime dokununca ilgili kayıt açılsın (uygulama zaten açıkken de)
  window.addEventListener("hashchange", async () => {
    if (!onayli()) return;
    if (location.hash === "#ana") return anaAc();
    if (location.hash === "#parsel") return parselAc();
    if (location.hash === "#yakinlar") return yakinlarAc();
    if (location.hash === "#plaka") return plakaAc();
    if (location.hash === "#restoran") return restoranAc();
    if (location.hash === "#saha" || (location.hash === "" && $("#ekran-liste").hidden)) return sahaAc();
    if (location.hash === "#servis" && $("#ekran-servis").hidden) return servisAc();
    if (location.hash === "#sokak-numaralari" && $("#ekran-sokaklar").hidden) return sokaklarAc();
    if (location.hash === "#uyeler") return yonetimAc();
    if (location.hash === "#aidat") return aidatAc();
    if (location.hash === "#iletisim") return iletisimAc();
    if (location.hash === "#yonetim-isleri") return yonetimIsleriAc();
    if (location.hash === "#yk-saha") return ykSahaAc();
    if (location.hash === "#program" && $("#ekran-program").hidden) return programAc();
    if (location.hash.startsWith("#gorevler") && $("#ekran-gorevler").hidden) {
      return gorevlerAc(location.hash === "#gorevler-haftalik" ? "haftalik" : "gunluk");
    }
    const m = location.hash.match(/^#kayit-(\d+)$/);
    if (!m) return;
    if (!kayitlar.some((k) => k.id === Number(m[1]))) await yenile();
    detayGoster(Number(m[1]));
  });

  // Uygulamaya dönüldüğünde ve açıkken 20 sn'de bir tazele (bildirim gecikse de yeni iş görünür)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !oturum) return;
    if (onayli()) { bildirimleriTemizle(); yenile(); } else durumKontrol();
  });
  // Simgeden açılınca her zaman visibilitychange gelmeyebiliyor
  for (const olay of ["pageshow", "focus"]) {
    window.addEventListener(olay, () => { if (!document.hidden && onayli()) bildirimleriTemizle(); });
  }
  setInterval(() => { if (!document.hidden && onayli()) yenile(); }, 20000);

  basla();
})();
