// Sporkent Saha Takip: tek sayfa uygulama.
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

  async function fotoYukle(blob) {
    const { yol, adres } = await api("yukleme_adresi");
    const r = await fetch(adres, { method: "PUT", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: blob });
    if (!r.ok) throw new Error("Fotoğraf yüklenemedi, tekrar deneyin.");
    return yol;
  }

  // ---------- Yardımcılar ----------
  const kac = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tarihSaat = (t) => t ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const bugun = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const DURUM = { acik: "Açık", devam: "Açık", tamam: "Yapıldı" };
  const DURUM_ROZET = { acik: "oncelikli", devam: "oncelikli", tamam: "tamam" };
  const ROL_ADI = { baskan: "YK Başkanı (Yönetici)", mudur: "Müdür", sef: "Şef", yonetim: "Yönetim Kurulu", uye: "Grup üyesi" };
  const KAPATABILIR = ["baskan", "mudur", "sef"];
  const kapatabilir = () => KAPATABILIR.includes(oturum?.rol);
  const yonetici = () => oturum?.rol === "baskan";
  const onayli = () => oturum?.anahtar && oturum.durum === "onayli";

  let mesajZamani;
  function mesaj(metin) {
    const m = $("#mesaj"); m.textContent = metin; m.hidden = false;
    clearTimeout(mesajZamani); mesajZamani = setTimeout(() => (m.hidden = true), 3500);
  }

  // Fotoğrafı telefonda küçültür: uzun kenar en fazla 1280 px, JPEG.
  async function kucult(dosya) {
    const img = await new Promise((ok, hata) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => hata(new Error("Fotoğraf okunamadı."));
      i.src = URL.createObjectURL(dosya);
    });
    const oran = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * oran); c.height = Math.round(img.naturalHeight * oran);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.72));
  }

  function fotoSecici(girdi, onizleme, yazi) {
    let blob = null;
    girdi.addEventListener("change", async () => {
      const f = girdi.files?.[0]; if (!f) return;
      try {
        blob = await kucult(f);
        onizleme.src = URL.createObjectURL(blob); onizleme.hidden = false;
        if (yazi) yazi.textContent = "📷 Fotoğrafı değiştir";
      } catch (e) { mesaj(e.message); }
    });
    return { al: () => blob, sifirla: () => { blob = null; girdi.value = ""; onizleme.hidden = true; if (yazi) yazi.textContent = "📷 Fotoğraf çek"; } };
  }

  // Sesle yazma: tarayıcı destekliyorsa Türkçe dinler, metni kutuya ekler.
  function mikrofonBagla(dugme, kutu, ipucu) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { dugme.hidden = true; ipucu.textContent = "Konuşarak yazmak için klavyedeki mikrofon tuşuna basın."; return; }
    let tanima = null;
    dugme.addEventListener("click", () => {
      if (tanima) { tanima.stop(); return; }
      tanima = new SR(); tanima.lang = "tr-TR"; tanima.interimResults = false; tanima.continuous = true;
      const bas = kutu.value.trim();
      let eklenen = "";
      tanima.onresult = (e) => {
        eklenen = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
        kutu.value = (bas ? bas + " " : "") + eklenen;
      };
      tanima.onerror = (e) => { if (e.error === "not-allowed") mesaj("Mikrofon izni verilmedi. Klavyedeki mikrofonu kullanın."); };
      tanima.onend = () => { dugme.classList.remove("dinliyor"); tanima = null; };
      dugme.classList.add("dinliyor");
      try { tanima.start(); } catch { dugme.classList.remove("dinliyor"); tanima = null; }
    });
  }

  // ---------- Ekranlar ----------
  function goster(ad) {
    for (const e of document.querySelectorAll(".ekran")) e.hidden = e.id !== "ekran-" + ad;
    window.scrollTo(0, 0);
  }

  let bekleyenSayisi = 0;
  async function yenile() {
    if (!onayli()) return;
    try {
      const r = await api("liste");
      kayitlar = r.kayitlar || [];
      // Yönetici başka bir telefondan rolü değiştirilmişse güncel rolü kullan
      if (r.rol && r.rol !== oturum.rol) { oturum.rol = r.rol; sakla.koy("sk_oturum", oturum); }
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
  const anahtar = (k) => k.id + ":" + (k.durum === "tamam" ? "t" : "a");

  function yenileriAc() {
    const gorulen = sakla.al("sk_gorulen");
    const yeniler = gorulen ? kayitlar.filter((k) => !gorulen.includes(anahtar(k))) : [];
    sakla.koy("sk_gorulen", kayitlar.map(anahtar).slice(0, 500));
    if (!yeniler.length) return;
    sesCal();
    const en = yeniler.sort((a, b) => (b.kapanis_at || b.created_at).localeCompare(a.kapanis_at || a.created_at))[0];
    const baslik = en.durum === "tamam" ? `Yapıldı: ${en.yer}` : `Yeni sorun: ${en.yer}`;
    // Yeni kayıt formu doluyken yazılanı kaybettirme, sadece haber ver
    if (!$("#ekran-yeni").hidden || ($("#kapat-form") && !$("#ekran-detay").hidden)) return mesaj(baslik);
    detayGoster(en.id);
    mesaj(yeniler.length > 1 ? `${baslik} (+${yeniler.length - 1} yeni)` : baslik);
  }

  let sesBaglam = null;
  function sesAc() {
    try {
      sesBaglam = sesBaglam || new (window.AudioContext || window.webkitAudioContext)();
      if (sesBaglam.state === "suspended") sesBaglam.resume();
    } catch {}
  }
  function sesCal() {
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
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
  const gecikti = (k) => k.durum !== "tamam" && k.son_tarih && gunFarki(k.son_tarih) < 0;
  // Kaydın açıldığı gün (İstanbul) ile son gün arasındaki gün sayısı
  const acilisGunu = (k) => new Date(Date.parse(k.created_at) + 3 * 3600e3).toISOString().slice(0, 10);
  const sureGun = (k) => k.son_tarih ? Math.round((Date.parse(k.son_tarih) - Date.parse(acilisGunu(k))) / 864e5) : null;
  function sureYazisi(k) {
    if (k.durum === "tamam" || !k.son_tarih) return "";
    const f = gunFarki(k.son_tarih);
    if (f < 0) return `<span class="sure gecikmis">⚠ ${-f} gün gecikti</span>`;
    if (f === 0) return `<span class="sure son-gun">⏰ Bugün son gün</span>`;
    return `<span class="sure">⏰ ${f} gün kaldı</span>`;
  }

  function listeCiz() {
    const acik = kayitlar.filter((k) => k.durum !== "tamam").length;
    const yapilan = kayitlar.filter((k) => k.durum === "tamam").length;
    const geciken = kayitlar.filter(gecikti).length;
    $("#ozet").innerHTML = `
      <button data-filtre="acik" class="ozet-yapilmayan ${filtre === "acik" ? "secili" : ""}"><b>${acik}</b><span>Henüz yapılmayanlar</span></button>
      <button data-filtre="tamam" class="ozet-yapilan ${filtre === "tamam" ? "secili" : ""}"><b>${yapilan}</b><span>Yapılanlar</span></button>`;
    const uyari = $("#gecikme-uyari");
    uyari.hidden = !geciken;
    uyari.textContent = `⚠ ${geciken} iş süresi içinde yapılmadı`;
    $("#gorunurluk").textContent = kapatabilir()
      ? `${ROL_ADI[oturum.rol]}: sorunları fotoğrafla "Yapıldı" olarak kapatabilirsiniz.`
      : "Bildirilen sorunları ve yapılan işleri gruptaki herkes görür.";
    const yd = $("#yonetim-ac");
    yd.hidden = !yonetici();
    yd.textContent = bekleyenSayisi ? `👥 Üyeler ve ayarlar · ${bekleyenSayisi} onay bekliyor` : "👥 Üyeler ve ayarlar";
    yd.classList.toggle("uyari", bekleyenSayisi > 0);

    const gorunen = kayitlar
      .filter((k) => (filtre === "tamam" ? k.durum === "tamam" : k.durum !== "tamam"))
      // Yapılmayanlar: gecikenler ve son günü yakın olanlar üstte. Yapılanlar: en yeni üstte.
      .sort((a, b) => filtre === "tamam"
        ? b.kapanis_at.localeCompare(a.kapanis_at)
        : (a.son_tarih || "9999").localeCompare(b.son_tarih || "9999") || a.created_at.localeCompare(b.created_at));

    $("#liste").innerHTML = gorunen.length ? gorunen.map((k) => `
      <button class="satir ${gecikti(k) ? "gecikti" : ""}" data-id="${k.id}">
        ${(k.foto_sonra_url || k.foto_once_url) ? `<img src="${kac(k.foto_sonra_url || k.foto_once_url)}" alt="" loading="lazy">` : `<span class="bos-foto">📝</span>`}
        <span>
          <span class="satir-ust">
            <span>${kac(k.no)}</span>
            <span class="rozet ${DURUM_ROZET[k.durum]}">${DURUM[k.durum]}</span>
            ${sureYazisi(k)}
          </span>
          <span class="satir-yer" style="display:block">${kac(k.yer)}</span>
          <span class="satir-sorun">${kac(k.sorun)}</span>
        </span>
      </button>`).join("") : `<p class="bos">${filtre === "tamam" ? "Henüz yapılan iş yok." : "Henüz yapılmayan iş yok. 👍"}</p>`;
  }

  const fotoKutu = (url, yazi, bos) => `<figure>${url
    ? `<a href="${kac(url)}" target="_blank" rel="noopener"><img src="${kac(url)}" alt="${yazi}"></a>`
    : `<div class="foto-bos">${bos}</div>`}<figcaption>${yazi}</figcaption></figure>`;

  function detayGoster(id) {
    const k = kayitlar.find((x) => x.id === id);
    if (!k) return;
    if (location.hash !== "#kayit-" + id) history.replaceState(null, "", "#kayit-" + id);
    const kapat = kapatabilir() && k.durum !== "tamam";
    $("#detay").innerHTML = `
      <div class="detay-ust">
        <button class="geri" data-geri>← Liste</button>
        <span class="rozet ${DURUM_ROZET[k.durum]}">${DURUM[k.durum]}</span>
      </div>
      <h1>${kac(k.yer)}</h1>
      <p style="margin:0 0 6px">${kac(k.sorun)}</p>
      <div class="fotolar">
        ${fotoKutu(k.foto_once_url, "Sorun", "Fotoğraf yok")}
        ${fotoKutu(k.foto_sonra_url, "Yapıldı", "Henüz yapılmadı")}
      </div>
      <dl class="alanlar">
        <dt>Kayıt no</dt><dd>${kac(k.no)}</dd>
        <dt>Bildiren</dt><dd>${kac(k.bildiren)}</dd>
        <dt>Bildirim</dt><dd>${tarihSaat(k.created_at)}</dd>
        ${k.son_tarih ? `<dt>Son gün</dt><dd>${new Date(k.son_tarih + "T00:00:00").toLocaleDateString("tr-TR")} ${sureYazisi(k)}</dd>` : ""}
        ${k.durum === "tamam" ? `
        <dt>Yapan</dt><dd>${kac(k.kapatan || "—")}</dd>
        <dt>Yapıldı</dt><dd>${tarihSaat(k.kapanis_at)}</dd>
        ${k.sonuc ? `<dt>Not</dt><dd>${kac(k.sonuc)}</dd>` : ""}` : ""}
      </dl>
      ${kapat ? `
      <form class="islem" id="kapat-form">
        <h2>Sorunu giderdiniz mi?</h2>
        <div class="foto-alan">
          <img id="sonra-onizleme" alt="" hidden>
          <label class="foto-dugme"><input id="sonra-foto" type="file" accept="image/*" capture="environment" hidden><span id="sonra-yazi">📷 Yapılan işin fotoğrafını çek</span></label>
        </div>
        <label>Not (isteğe bağlı)
          <div class="ses-satir">
            <textarea name="sonuc" rows="2" maxlength="2000" placeholder="Örn. Batarya değiştirildi"></textarea>
            <button type="button" class="mikrofon" id="sonra-mikrofon">🎤</button>
          </div>
          <small class="ipucu" id="sonra-ipucu"></small>
        </label>
        <button class="ana-dugme" type="submit">✔ Yapıldı</button>
      </form>` : ""}
      ${yonetici() && k.durum !== "tamam" ? `
      <div class="islem">
        <h2>Yapılma süresi</h2>
        <div class="sure-sec">
          ${[1, 2, 3, 5, 7, 10, 15, 30].map((g) => `<button type="button" data-gun="${g}" class="${sureGun(k) === g ? "secili" : ""}">${g} gün</button>`).join("")}
        </div>
        <small class="ipucu">Kaydın açıldığı günden itibaren sayılır. Süre dolunca iş listede yanıp söner.</small>
      </div>` : ""}
      ${yonetici() ? `
      <div class="islem">
        <button type="button" class="ikincil tehlike" id="kayit-sil" style="width:100%">🗑 Bu kaydı sil</button>
        <small class="ipucu">Yalnızca yönetici görür. Uygun olmayan kaydı fotoğraflarıyla birlikte herkesten kaldırır.</small>
      </div>` : ""}`;
    goster("detay");
    if (kapat) kapatBagla(k);
    $(".sure-sec")?.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-gun]"); if (!b) return;
      b.disabled = true;
      try {
        const r = await api("sure_degistir", { id: k.id, gun: Number(b.dataset.gun) });
        k.son_tarih = r.son_tarih;
        listeCiz(); detayGoster(k.id);
        mesaj(`Yapılma süresi ${b.dataset.gun} gün olarak ayarlandı.`);
      } catch (err) { mesaj(err.message); b.disabled = false; }
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
    const foto = fotoSecici($("#sonra-foto"), $("#sonra-onizleme"), $("#sonra-yazi"));
    mikrofonBagla($("#sonra-mikrofon"), form.querySelector("textarea"), $("#sonra-ipucu"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!foto.al()) return mesaj("Önce yapılan işin fotoğrafını çekin.");
      const d = form.querySelector("button[type=submit]");
      d.disabled = true; d.textContent = "Gönderiliyor…";
      try {
        const yol = await fotoYukle(foto.al());
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
  const iosTarayicida = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone;

  function bildirimKutusu() {
    const kutu = $("#bildirim-kutu");
    if (!oturum?.vapid) { kutu.hidden = true; return; }
    if (iosTarayicida()) {
      $("#bildirim-metin").textContent = "iPhone'da bildirim için: Paylaş ⬆︎ → “Ana Ekrana Ekle”, sonra uygulamayı ana ekrandan açın.";
      $("#bildirim-ac").hidden = true; kutu.hidden = false; return;
    }
    if (!bildirimDestek()) { kutu.hidden = true; return; }
    kutu.hidden = Notification.permission === "granted";
    // İzin varsa her açılışta sunucuya yeniden kaydol: kayıt silinmişse kendiliğinden düzelir
    if (Notification.permission === "granted") bildirimAc(true);
  }

  function base64Bayt(s) {
    const p = "=".repeat((4 - (s.length % 4)) % 4);
    const b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }

  async function bildirimAc(sessiz) {
    try {
      const izin = await Notification.requestPermission();
      if (izin !== "granted") { if (!sessiz) mesaj("Bildirim izni verilmedi. Telefon ayarlarından açabilirsiniz."); return; }
      const kayit = await navigator.serviceWorker.ready;
      let abonelik = await kayit.pushManager.getSubscription();
      if (!abonelik) abonelik = await kayit.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Bayt(oturum.vapid) });
      await api("abone_ol", { abonelik: abonelik.toJSON() });
      sakla.koy("sk_abone", oturum.rol);
      $("#bildirim-kutu").hidden = true;
      if (!sessiz) mesaj("Bildirimler açıldı.");
    } catch (e) { if (!sessiz) mesaj("Bildirim açılamadı: " + e.message); }
  }

  // ---------- Giriş / onay bekleme / çıkış ----------
  function cikisYap() {
    oturum = null; sakla.sil("sk_oturum"); sakla.sil("sk_abone"); sakla.sil("sk_gorulen");
    kayitlar = []; bekleyenSayisi = 0; clearInterval(bekleZamani); goster("giris");
  }

  // Kodu girdikten sonra yönetici onaylayana kadar bu ekran görünür; onaylanınca kendiliğinden açılır.
  let bekleZamani = null;
  function bekleEkrani() {
    goster("bekle");
    $("#bekle-ad").textContent = oturum.ad;
    $("#bekle-rol").textContent = ROL_ADI[oturum.rol] || "";
    bildirimKutusu();
    clearInterval(bekleZamani);
    bekleZamani = setInterval(durumKontrol, 10000);
  }

  async function durumKontrol() {
    if (!oturum?.anahtar) return clearInterval(bekleZamani);
    try {
      const r = await api("durum");
      if (r.durum === "onayli") {
        clearInterval(bekleZamani);
        Object.assign(oturum, { durum: "onayli", rol: r.rol });
        sakla.koy("sk_oturum", oturum);
        await basla();
        mesaj("Gruba kabul edildiniz.");
      }
    } catch {}
  }

  async function girisYap(ad, kod) {
    const r = await api("giris", { ad, kod });
    oturum = { ad, rol: r.rol, durum: r.durum, anahtar: r.anahtar, vapid: r.vapid };
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
        if (!document.hidden) bildirimleriTemizle();
        if (e.data.sayfa === "uyeler") yonetimAc(); else yenile();
      });
    }
    if (!oturum) return goster("giris");
    // Eski sürümden kalan oturum (kodla çalışıyordu): bir kez kodla katılım isteği gönder
    if (!oturum.anahtar) {
      if (!oturum.kod) return cikisYap();
      try { await girisYap(oturum.ad, oturum.kod); } catch { return cikisYap(); }
    }
    if (oturum.durum !== "onayli") return bekleEkrani();
    clearInterval(bekleZamani);
    bildirimleriTemizle();
    goster("liste");
    bildirimKutusu();
    await yenile();
    if (location.hash === "#uyeler" && yonetici()) return yonetimAc();
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
  const ROL_SIRASI = ["baskan", "mudur", "sef", "yonetim", "uye"];
  const MAKS_UYE = 50; // sunucudaki sınırla aynı
  const sonGorulme = (t) => t ? "Son görülme: " + tarihSaat(t) : "";

  async function yonetimAc() {
    if (!yonetici()) return;
    if (location.hash !== "#uyeler") history.replaceState(null, "", "#uyeler");
    goster("yonetim");
    $("#yonetim").innerHTML = `<p class="bos">Yükleniyor…</p>`;
    try {
      const [{ uyeler }, { kodlar, varsayilan_sure }] = await Promise.all([api("uye_listesi"), api("kodlar")]);
      yonetimCiz(uyeler, kodlar, varsayilan_sure);
    } catch (e) { $("#yonetim").innerHTML = `<p class="hata">${kac(e.message)}</p>`; }
  }

  function uyeSatiri(u, dugmeler) {
    return `<div class="uye">
      <div><b>${kac(u.ad)}</b>${u.ben ? " (siz)" : ""}<br><small>${kac(ROL_ADI[u.rol] || u.rol)} · ${kac(sonGorulme(u.son_gorulme) || "Başvuru: " + tarihSaat(u.created_at))}</small></div>
      <div class="uye-dugmeler">${u.ben ? "" : dugmeler}</div>
    </div>`;
  }

  function yonetimCiz(uyeler, kodlar, varsSure) {
    const bekleyen = uyeler.filter((u) => u.durum === "bekliyor");
    const gruptakiler = uyeler.filter((u) => u.durum === "onayli")
      .sort((a, b) => ROL_SIRASI.indexOf(a.rol) - ROL_SIRASI.indexOf(b.rol) || a.ad.localeCompare(b.ad, "tr"));
    const cikan = uyeler.filter((u) => u.durum === "cikarildi");
    bekleyenSayisi = bekleyen.length;
    const d = (eylem, hedef, yazi, sinif = "") => `<button class="kucuk-dugme ${sinif}" data-eylem="${eylem}" data-hedef="${kac(hedef)}">${yazi}</button>`;
    $("#yonetim").innerHTML = `
      <div class="detay-ust"><button class="geri" data-geri>← Liste</button></div>
      <h1>Üyeler ve ayarlar</h1>

      <h2>Onay bekleyenler (${bekleyen.length})</h2>
      ${bekleyen.length ? bekleyen.map((u) => uyeSatiri(u, d("uye_onayla", u.cihaz, "✔ Onayla") + d("uye_sil", u.cihaz, "Reddet", "tehlike"))).join("")
        : `<p class="ipucu">Onay bekleyen kimse yok.</p>`}

      <h2>Gruptakiler (${gruptakiler.length} / ${MAKS_UYE})</h2>
      ${gruptakiler.map((u) => uyeSatiri(u, d("uye_cikar", u.cihaz, "Çıkar", "tehlike"))).join("")}

      ${cikan.length ? `<h2>Çıkarılanlar (${cikan.length})</h2>
      <p class="ipucu">Bu telefonlar kodu bilse de gruba giremez.</p>
      ${cikan.map((u) => uyeSatiri(u, d("uye_geri_al", u.cihaz, "Geri al") + d("uye_sil", u.cihaz, "Sil", "tehlike"))).join("")}` : ""}

      <h2>Yeni işlerin yapılma süresi</h2>
      <div class="uye">
        <div><b>${varsSure} gün</b><br><small>Her yeni kayda kendiliğinden verilir. Kayıt içinden tek tek değiştirebilirsiniz.</small></div>
        <div class="uye-dugmeler">${d("varsayilan_sure", "", "Değiştir")}</div>
      </div>

      <h2>Giriş kodları</h2>
      <p class="ipucu">Kodu değiştirmek gruptakileri çıkarmaz; yalnızca yeni katılacaklar yeni kodu kullanır.</p>
      ${ROL_SIRASI.map((r) => `<div class="uye">
        <div><b>${kac(ROL_ADI[r])}</b><br><code>${kac(kodlar[r] || "—")}</code></div>
        <div class="uye-dugmeler">${d("kod_degistir", r, "Değiştir")}</div>
      </div>`).join("")}

      <h2>Tüm kayıtları sil</h2>
      <p class="ipucu">Bütün sorunlar ve fotoğraflar kalıcı olarak silinir, numaralar 001'den başlar. Üyeler silinmez. Geri alınamaz.</p>
      <button class="ikincil tehlike" style="width:100%" data-eylem="hepsini_sil">Tüm kayıtları sil</button>`;
  }

  $("#yonetim").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-eylem]"); if (!b) return;
    const { eylem, hedef } = b.dataset;
    let veri = { hedef };
    const ad = b.closest(".uye")?.querySelector("b")?.textContent || "";
    if (eylem === "uye_cikar" && !confirm(`${ad} gruptan çıkarılsın mı? Bu telefon bir daha giremez (geri alabilirsiniz).`)) return;
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

  $("#yonetim-ac").addEventListener("click", yonetimAc);

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

  $("#bildirim-ac").addEventListener("click", () => bildirimAc(false));
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
  const yeniFoto = fotoSecici($("#yeni-foto"), $("#yeni-foto-onizleme"), $("#yeni-foto-yazi"));
  mikrofonBagla($("#mikrofon"), yeniForm.querySelector("textarea"), $("#mikrofon-ipucu"));

  $("#yeni-ac").addEventListener("click", () => { yeniForm.reset(); yeniFoto.sifirla(); goster("yeni"); });

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
      });
      mesaj(`Kayıt ${r.kayit.no} açıldı. Müdüre bildirildi.`);
      // Kendi açtığımız kayıt için pencere açılmasın
      sakla.koy("sk_gorulen", [anahtar(r.kayit), ...(sakla.al("sk_gorulen") || [])]);
      goster("liste");
      await yenile();
    } catch (err) {
      hata.textContent = err.message; hata.hidden = false;
    } finally { d.disabled = false; d.textContent = "Gönder"; }
  });

  // Bildirime dokununca ilgili kayıt açılsın (uygulama zaten açıkken de)
  window.addEventListener("hashchange", async () => {
    if (!onayli()) return;
    if (location.hash === "#uyeler") return yonetimAc();
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
