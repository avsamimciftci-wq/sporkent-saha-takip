// Sporkent Saha Takip: tek sayfa uygulama.
(() => {
  "use strict";

  const AYAR = window.SPORKENT || {};
  const DEMO = !AYAR.supabaseUrl || !AYAR.anonKey;
  const $ = (s, kok = document) => kok.querySelector(s);

  // ---------- Yerel saklama (gizli pencerede atılabilir, hep try/catch) ----------
  const sakla = {
    al(k, v = null) { try { const x = localStorage.getItem(k); return x === null ? v : JSON.parse(x); } catch { return v; } },
    koy(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    sil(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let cihaz = sakla.al("sk_cihaz");
  if (!cihaz) { cihaz = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); sakla.koy("sk_cihaz", cihaz); }

  let oturum = sakla.al("sk_oturum"); // { ad, kod, rol, vapid }
  let kayitlar = [];
  let filtre = "acik";

  // ---------- Sunucu ----------
  async function api(eylem, veri = {}) {
    const govde = { eylem, kod: oturum?.kod, cihaz, ...veri };
    if (DEMO) return demoApi(govde);
    const r = await fetch(`${AYAR.supabaseUrl}/functions/v1/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: AYAR.anonKey, Authorization: `Bearer ${AYAR.anonKey}` },
      body: JSON.stringify(govde),
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.hata || "Bağlantı hatası, tekrar deneyin.");
    return j;
  }

  async function fotoYukle(blob) {
    if (DEMO) {
      const yol = "demo/" + Date.now() + Math.random().toString(36).slice(2);
      const veri = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
      sakla.koy("sk_demo_foto_" + yol, veri);
      return yol;
    }
    const { yol, adres } = await api("yukleme_adresi");
    const r = await fetch(adres, { method: "PUT", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: blob });
    if (!r.ok) throw new Error("Fotoğraf yüklenemedi, tekrar deneyin.");
    return yol;
  }

  // Deneme modu: aynı işlemleri bu cihazda taklit eder.
  // Gerçek kodlar yalnızca sunucudadır; bunlar sadece denemeye özeldir.
  const DEMO_UYE = "deneme", DEMO_MUDUR = "deneme-mudur", DEMO_SEF = "deneme-sef", DEMO_YONETIM = "deneme-yonetim";
  function demoApi(g) {
    const kod = String(g.kod || "").trim().toLowerCase();
    const rol = { [DEMO_MUDUR]: "mudur", [DEMO_SEF]: "sef", [DEMO_YONETIM]: "yonetim", [DEMO_UYE]: "uye" }[kod];
    if (!rol) throw new Error("Kod hatalı.");
    const liste = sakla.al("sk_demo_kayitlar", []);
    const kaydet = () => sakla.koy("sk_demo_kayitlar", liste);
    const bul = () => { const k = liste.find((x) => x.id === g.id); if (!k) throw new Error("Kayıt bulunamadı."); return k; };
    const url = (p) => (p ? sakla.al("sk_demo_foto_" + p) : null);
    switch (g.eylem) {
      case "giris": return { rol, vapid: null };
      case "liste": return { kayitlar: liste.slice().reverse()
        .filter((k) => rol !== "uye" || k.durum === "tamam" || k.cihaz === g.cihaz)
        .map((k) => ({ ...k, foto_once_url: url(k.foto_once), foto_sonra_url: url(k.foto_sonra) })) };
      case "yeni": {
        const id = (liste.at(-1)?.id || 0) + 1;
        const k = { id, no: new Date().getFullYear() + "-" + String(id).padStart(3, "0"), created_at: new Date().toISOString(),
          bildiren: g.bildiren, cihaz: g.cihaz, yer: g.yer, sorun: g.sorun, durum: "acik", foto_once: g.foto || null };
        liste.push(k); kaydet(); return { kayit: k };
      }
      case "kapat": {
        if (!KAPATABILIR.includes(rol)) throw new Error("Bu işlemi yalnızca müdür veya şef yapabilir.");
        if (!g.foto) throw new Error("Yapılan işin fotoğrafını çekin.");
        const k = bul(); Object.assign(k, { durum: "tamam", sonuc: g.sonuc || null, foto_sonra: g.foto, kapatan: g.ad, kapanis_at: new Date().toISOString() }); kaydet(); return { kayit: k };
      }
      case "abone_ol": return { tamam: true };
    }
    throw new Error("Bilinmeyen işlem.");
  }

  // ---------- Yardımcılar ----------
  const kac = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tarihSaat = (t) => t ? new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const bugun = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const DURUM = { acik: "Açık", devam: "Açık", tamam: "Yapıldı" };
  const DURUM_ROZET = { acik: "oncelikli", devam: "oncelikli", tamam: "tamam" };
  const ROL_ADI = { mudur: "Müdür", sef: "Şef", yonetim: "Yönetim Kurulu", uye: "Grup üyesi" };
  const KAPATABILIR = ["mudur", "sef"];
  const kapatabilir = () => KAPATABILIR.includes(oturum?.rol);
  const hepsiniGorur = () => oturum?.rol && oturum.rol !== "uye";

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
    $("#cikis").hidden = ad === "giris";
    window.scrollTo(0, 0);
  }

  async function yenile() {
    try {
      kayitlar = (await api("liste")).kayitlar || [];
      listeCiz();
    } catch (e) {
      if (/Kod hatalı/.test(e.message)) return cikisYap();
      mesaj(e.message);
    }
  }

  function listeCiz() {
    const acik = kayitlar.filter((k) => k.durum !== "tamam").length;
    const yapilan = kayitlar.filter((k) => k.durum === "tamam").length;
    const bugunKapanan = kayitlar.filter((k) => k.kapanis_at && k.kapanis_at.slice(0, 10) === bugun()).length;
    $("#ozet").innerHTML = `
      <div><b>${acik}</b><span>${hepsiniGorur() ? "Açık sorun" : "Bildirdiğim açık"}</span></div>
      <div><b>${bugunKapanan}</b><span>Bugün yapılan</span></div>
      <div><b>${yapilan}</b><span>Toplam yapılan</span></div>`;
    $("#gorunurluk").textContent = hepsiniGorur()
      ? `${ROL_ADI[oturum.rol]} olarak tüm sorunları görüyorsunuz.`
      : "Bildirdiğiniz sorunları yalnızca siz, müdür, şef ve yönetim kurulu görür. Yapılan işleri herkes görür.";

    const gorunen = kayitlar
      .filter((k) => filtre === "hepsi" || (filtre === "tamam" ? k.durum === "tamam" : k.durum !== "tamam"))
      .sort((a, b) => filtre === "acik"
        ? a.created_at.localeCompare(b.created_at)
        : (b.kapanis_at || b.created_at).localeCompare(a.kapanis_at || a.created_at));

    $("#liste").innerHTML = gorunen.length ? gorunen.map((k) => `
      <button class="satir" data-id="${k.id}">
        ${(k.foto_sonra_url || k.foto_once_url) ? `<img src="${kac(k.foto_sonra_url || k.foto_once_url)}" alt="" loading="lazy">` : `<span class="bos-foto">📝</span>`}
        <span>
          <span class="satir-ust">
            <span>${kac(k.no)}</span>
            <span class="rozet ${DURUM_ROZET[k.durum]}">${DURUM[k.durum]}</span>
          </span>
          <span class="satir-yer" style="display:block">${kac(k.yer)}</span>
          <span class="satir-sorun">${kac(k.sorun)}</span>
        </span>
      </button>`).join("") : `<p class="bos">Bu bölümde kayıt yok.</p>`;
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
      </form>` : ""}`;
    goster("detay");
    if (kapat) kapatBagla(k);
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
        await yenile();
        detayGoster(k.id);
        mesaj("Yapıldı olarak gönderildi. Gruptaki herkes görecek.");
      } catch (err) { mesaj(err.message); d.disabled = false; d.textContent = "✔ Yapıldı"; }
    });
  }

  // ---------- Bildirimler ----------
  const bildirimDestek = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const iosTarayicida = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone;

  function bildirimKutusu() {
    const kutu = $("#bildirim-kutu");
    if (DEMO || !oturum?.vapid) { kutu.hidden = true; return; }
    if (iosTarayicida()) {
      $("#bildirim-metin").textContent = "iPhone'da bildirim için: Paylaş ⬆︎ → “Ana Ekrana Ekle”, sonra uygulamayı ana ekrandan açın.";
      $("#bildirim-ac").hidden = true; kutu.hidden = false; return;
    }
    if (!bildirimDestek()) { kutu.hidden = true; return; }
    kutu.hidden = Notification.permission === "granted" && sakla.al("sk_abone") === oturum.rol;
    if (Notification.permission === "granted" && sakla.al("sk_abone") !== oturum.rol) bildirimAc(true);
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

  // ---------- Giriş / çıkış ----------
  function cikisYap() {
    oturum = null; sakla.sil("sk_oturum"); sakla.sil("sk_abone");
    kayitlar = []; goster("giris");
  }

  async function basla() {
    $("#demo-uyari").hidden = !DEMO;
    if ("serviceWorker" in navigator) {
      // Yeni sürüm yüklenince sayfayı bir kez yenile, eski ekran kalmasın.
      const ilkKontrol = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (ilkKontrol) location.reload(); });
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((k) => k.update()).catch(() => {});
    }
    if (!oturum) return goster("giris");
    $("#yeni-ac").textContent = "+ Yeni kayıt";
    goster("liste");
    bildirimKutusu();
    await yenile();
    const m = location.hash.match(/^#kayit-(\d+)$/);
    if (m) detayGoster(Number(m[1]));
  }

  $("#giris-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const hata = $("#giris-hata"); hata.hidden = true;
    const d = e.target.querySelector("button"); d.disabled = true;
    try {
      oturum = { ad: String(f.get("ad")).trim(), kod: String(f.get("kod")).trim() };
      const r = await api("giris");
      oturum.rol = r.rol; oturum.vapid = r.vapid;
      sakla.koy("sk_oturum", oturum);
      await basla();
      mesaj(r.rol === "uye" ? "Hoş geldiniz." : `${ROL_ADI[r.rol]} olarak giriş yapıldı.`);
    } catch (err) {
      oturum = null; hata.textContent = err.message; hata.hidden = false;
    } finally { d.disabled = false; }
  });

  $("#cikis").addEventListener("click", () => { if (confirm("Çıkış yapılsın mı?")) cikisYap(); });

  $("#sekmeler").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-filtre]"); if (!b) return;
    filtre = b.dataset.filtre;
    for (const x of document.querySelectorAll("#sekmeler button")) x.classList.toggle("secili", x === b);
    listeCiz();
  });

  $("#liste").addEventListener("click", (e) => {
    const s = e.target.closest(".satir"); if (s) detayGoster(Number(s.dataset.id));
  });

  $("#bildirim-ac").addEventListener("click", () => bildirimAc(false));

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
      filtre = "acik";
      for (const x of document.querySelectorAll("#sekmeler button")) x.classList.toggle("secili", x.dataset.filtre === "acik");
      goster("liste");
      await yenile();
    } catch (err) {
      hata.textContent = err.message; hata.hidden = false;
    } finally { d.disabled = false; d.textContent = "Gönder"; }
  });

  // Bildirime dokununca ilgili kayıt açılsın (uygulama zaten açıkken de)
  window.addEventListener("hashchange", async () => {
    const m = location.hash.match(/^#kayit-(\d+)$/);
    if (!m || !oturum) return;
    if (!kayitlar.some((k) => k.id === Number(m[1]))) await yenile();
    detayGoster(Number(m[1]));
  });

  // Uygulamaya dönüldüğünde listeyi tazele
  document.addEventListener("visibilitychange", () => { if (!document.hidden && oturum && !$("#ekran-liste").hidden) yenile(); });

  basla();
})();
