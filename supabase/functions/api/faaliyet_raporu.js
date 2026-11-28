// Aylık Faaliyet Raporu: o ay yapılan bütün işler (Saha Takip + YK iş emirleri) ve İş Programı'nda yapılanlar,
// liste + fotoğraflı ayrıntı olarak A4 PDF. Bağımlılıklar dışarıdan verilir (sunucu: npm:pdf-lib; deneme: node).
// d = { PDFDocument, rgb, fontkit, fontNormal, fontKalin, logo? }
// veri = { ayAdi, hazirlanma, isler: [...], program: [...] }, foto = async (yol) => Uint8Array | null

const A4 = [595.28, 841.89], KENAR = 40, GEN = A4[0] - 2 * KENAR;
const TR_SAAT = 3 * 3600e3;
const trTarih = (t, saat = true) => {
  if (!t) return "—";
  const d = new Date(Date.parse(t) + TR_SAAT), iki = (n) => String(n).padStart(2, "0");
  return `${iki(d.getUTCDate())}.${iki(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}${saat ? ` ${iki(d.getUTCHours())}:${iki(d.getUTCMinutes())}` : ""}`;
};

export async function raporPdf(d, veri, foto) {
  const { PDFDocument, rgb } = d;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(d.fontkit);
  // veri.tur: "tum" (hepsi + İş Programı), "yk" (YK Saha Takip + İş Programı), "saha" (Saha Takip); kişi adları yazılmaz
  const tur = veri.tur || "tum";
  const ad = { tum: "Aylık Faaliyet Raporu", yk: "YK Saha Takip Faaliyet Raporu", saha: "Saha Takip Faaliyet Raporu" }[tur];
  const programVar = tur !== "saha";
  pdf.setTitle(`Sporkent Asistan - ${ad} - ${veri.ayAdi}`);
  pdf.setAuthor("Sporkent İşletme Kooperatifi");
  const N = await pdf.embedFont(d.fontNormal, { subset: true });
  const K = await pdf.embedFont(d.fontKalin, { subset: true });
  const R = {
    mavi: rgb(0.169, 0.435, 0.576), koyu: rgb(0.11, 0.17, 0.15), soluk: rgb(0.38, 0.44, 0.42), cizgi: rgb(0.83, 0.87, 0.86),
    zebra: rgb(0.95, 0.97, 0.97), beyaz: rgb(1, 1, 1), notMavi: rgb(0.08, 0.40, 0.75), yesil: rgb(0.18, 0.49, 0.2), kirmizi: rgb(0.7, 0.14, 0.09),
    acikMavi: rgb(0.86, 0.92, 0.95), turuncu: rgb(0.9, 0.32, 0),
  };
  let sayfa, y;
  const yeniSayfa = () => { sayfa = pdf.addPage(A4); y = A4[1] - KENAR; };
  const yer = (h) => { if (y - h < KENAR + 24) { yeniSayfa(); return true; } return false; };

  // Metni verilen genişliğe böler (satır sonlarını korur)
  const sar = (metin, f, b, w) => {
    const satirlar = [];
    // Yazı tipinde olmayan emoji ve işaretler PDF'te boş kutu olur: çıkarılır
    const temiz = String(metin ?? "").replace(/\r/g, "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, "");
    for (const par of temiz.split("\n")) {
      let s = "";
      for (const kelime of par.split(/\s+/).filter(Boolean)) {
        const aday = s ? s + " " + kelime : kelime;
        if (f.widthOfTextAtSize(aday, b) <= w) { s = aday; continue; }
        if (s) satirlar.push(s);
        // Tek kelime satıra sığmıyorsa harf harf böl
        let k = kelime;
        while (f.widthOfTextAtSize(k, b) > w) {
          let i = k.length; while (i > 1 && f.widthOfTextAtSize(k.slice(0, i), b) > w) i--;
          satirlar.push(k.slice(0, i)); k = k.slice(i);
        }
        s = k;
      }
      satirlar.push(s);
    }
    return satirlar;
  };
  const yaz = (metin, x, f, b, renk, w, aralik = 1.3) => {
    const sat = sar(metin, f, b, w);
    for (const s of sat) { yer(b * aralik); sayfa.drawText(s, { x, y: y - b, size: b, font: f, color: renk }); y -= b * aralik; }
    return sat.length;
  };
  const yukseklik = (metin, f, b, w, aralik = 1.3) => sar(metin, f, b, w).length * b * aralik;

  // ---- Kapak ----
  yeniSayfa();
  sayfa.drawRectangle({ x: 0, y: A4[1] - 150, width: A4[0], height: 150, color: R.mavi });
  if (d.logo) {
    try {
      const im = await pdf.embedPng(d.logo); const h = 58, w = (im.width / im.height) * h;
      sayfa.drawImage(im, { x: KENAR, y: A4[1] - 30 - h, width: w, height: h, opacity: 0.95 });
    } catch { /* logo yoksa yalnızca yazı */ }
  }
  sayfa.drawText(ad.toLocaleUpperCase("tr"), { x: KENAR, y: A4[1] - 118, size: 24, font: K, color: R.beyaz });
  sayfa.drawText(veri.ayAdi, { x: KENAR, y: A4[1] - 140, size: 15, font: N, color: R.beyaz });
  const sag = "Sporkent İşletme Kooperatifi";
  sayfa.drawText(sag, { x: A4[0] - KENAR - N.widthOfTextAtSize(sag, 11), y: A4[1] - 140, size: 11, font: N, color: R.beyaz });
  y = A4[1] - 175;

  const saha = veri.isler.filter((x) => !x.gizli), yk = veri.isler.filter((x) => x.gizli);
  const kutular = tur === "tum" ? [[veri.isler.length, "Yapılan iş (toplam)"], [saha.length, "Saha Takip"], [yk.length, "YK Saha Takip"], [veri.program.length, "İş Programı'nda yapılan"]]
    : tur === "yk" ? [[yk.length, "YK Saha Takip'te yapılan iş"], [veri.program.length, "İş Programı'nda yapılan"]]
    : [[saha.length, "Saha Takip'te yapılan iş"]];
  const kw = (GEN - (kutular.length - 1) * 10) / kutular.length;
  kutular.forEach(([n, ad], i) => {
    const x = KENAR + i * (kw + 10);
    sayfa.drawRectangle({ x, y: y - 62, width: kw, height: 62, color: R.acikMavi, borderColor: R.mavi, borderWidth: 1 });
    const s = String(n);
    sayfa.drawText(s, { x: x + kw / 2 - K.widthOfTextAtSize(s, 22) / 2, y: y - 32, size: 22, font: K, color: R.mavi });
    const sat = sar(ad, N, 9, kw - 8);
    sat.forEach((t, j) => sayfa.drawText(t, { x: x + kw / 2 - N.widthOfTextAtSize(t, 9) / 2, y: y - 46 - j * 10, size: 9, font: N, color: R.koyu }));
  });
  y -= 80;
  const kapsam = { tum: "Saha Takip ve YK Saha Takip bölümlerinde", yk: "YK Saha Takip bölümünde", saha: "Saha Takip bölümünde" }[tur];
  yaz(`Bu rapor ${veri.ayAdi} ayında Sporkent Asistan programının ${kapsam} “Yapıldı” olarak kapatılan işleri içerir: önce kısa liste, ardından her işin fotoğrafları ve notlarıyla ayrıntısı. Hazırlanma: ${trTarih(veri.hazirlanma)}.`, KENAR, N, 10, R.soluk, GEN);
  y -= 10;

  // ---- Kısa liste ----
  const sutun = [["#", 22], ["Kayıt no", 62], ["Yer", 130], ["Yapılan iş", GEN - 22 - 62 - 130 - 78], ["Yapıldı", 78]];
  const baslikSatiri = () => {
    yer(22);
    sayfa.drawRectangle({ x: KENAR, y: y - 20, width: GEN, height: 20, color: R.mavi });
    let x = KENAR + 4;
    for (const [ad, w] of sutun) { sayfa.drawText(ad, { x, y: y - 14, size: 9, font: K, color: R.beyaz }); x += w; }
    y -= 20;
  };
  const bolumBasligi = (metin) => {
    yer(90); y -= 8;
    sayfa.drawText(metin, { x: KENAR, y: y - 14, size: 14, font: K, color: R.mavi });
    y -= 18; sayfa.drawLine({ start: { x: KENAR, y }, end: { x: KENAR + GEN, y }, thickness: 1.5, color: R.mavi }); y -= 8;
  };
  bolumBasligi("1. Yapılan işler listesi");
  if (!veri.isler.length) yaz("Bu ay “Yapıldı” olarak kapatılan iş yok.", KENAR, N, 11, R.soluk, GEN);
  else {
    baslikSatiri();
    veri.isler.forEach((x, i) => {
      const hucre = [String(i + 1), x.no || "", `${x.yer || ""}${x.gizli && tur === "tum" ? " (YK)" : ""}`, x.sorun || "", trTarih(x.kapanis_at)];
      const satirlar = hucre.map((h, j) => sar(h, N, 8.5, sutun[j][1] - 6).slice(0, 4));
      const h = Math.max(...satirlar.map((s) => s.length)) * 11 + 6;
      if (yer(h)) baslikSatiri();
      if (i % 2) sayfa.drawRectangle({ x: KENAR, y: y - h, width: GEN, height: h, color: R.zebra });
      let xx = KENAR + 4;
      satirlar.forEach((s, j) => { s.forEach((t, k) => sayfa.drawText(t, { x: xx, y: y - 11 - k * 11, size: 8.5, font: j === 1 ? K : N, color: R.koyu })); xx += sutun[j][1]; });
      y -= h;
      sayfa.drawLine({ start: { x: KENAR, y }, end: { x: KENAR + GEN, y }, thickness: 0.5, color: R.cizgi });
    });
  }

  // ---- Ayrıntılar (fotoğraflı) ----
  if (veri.isler.length) {
    yeniSayfa();
    bolumBasligi("2. İşlerin ayrıntısı, fotoğrafları ve notları");
  }
  for (const [i, x] of veri.isler.entries()) {
    const alanlar = [
      ["Bölüm", x.gizli ? "Yönetim Kurulu iş emri (YK Saha Takip)" : "Saha Takip"],
      ["Bölge / yer", [x.bolge, x.yer].filter(Boolean).join(" · ")],
      ["Bildirildi", trTarih(x.created_at)],
      ["Yapıldı", trTarih(x.kapanis_at)],
      ["Süre", (() => { const g = Math.max(0, Math.round((Date.parse(x.kapanis_at) - Date.parse(x.created_at)) / 864e5)); return g ? `${g} günde yapıldı` : "Aynı gün yapıldı"; })()],
    ];
    const fotolar = [];
    for (const [yol, ad] of [[x.foto_once, "Önce (sorun)"], [x.foto_sonra, "Sonra (yapıldı)"]]) {
      if (!yol) { fotolar.push({ ad, im: null }); continue; }
      let im = null;
      try { const b = await foto(yol); if (b) { try { im = await pdf.embedJpg(b); } catch { im = await pdf.embedPng(b); } } } catch { im = null; }
      fotolar.push({ ad, im });
    }
    const fotoVar = fotolar.some((f) => f.im);
    const fw = (GEN - 12) / 2, fh = 180;
    const hMetin = 26 + yukseklik(x.sorun, N, 10.5, GEN - 16) + alanlar.length * 14 + (x.sonuc ? yukseklik(x.sonuc, K, 10.5, GEN - 70) + 8 : 0);
    yer(hMetin + (fotoVar ? fh + 24 : 0) + 14);
    // Başlık bandı
    sayfa.drawRectangle({ x: KENAR, y: y - 22, width: GEN, height: 22, color: x.gizli ? R.turuncu : R.mavi });
    sayfa.drawText(`${i + 1}. ${x.no || ""}  ·  ${x.yer || ""}`, { x: KENAR + 8, y: y - 15.5, size: 11.5, font: K, color: R.beyaz });
    y -= 28;
    yaz(x.sorun, KENAR + 8, N, 10.5, R.koyu, GEN - 16);
    y -= 2;
    for (const [ad, deger] of alanlar) {
      yer(14);
      sayfa.drawText(ad, { x: KENAR + 8, y: y - 10, size: 9.5, font: N, color: R.soluk });
      sayfa.drawText(String(deger), { x: KENAR + 90, y: y - 10, size: 9.5, font: N, color: R.koyu });
      y -= 14;
    }
    if (x.sonuc) {
      yer(16);
      sayfa.drawText("Not", { x: KENAR + 8, y: y - 10.5, size: 10.5, font: K, color: R.notMavi });
      yaz(x.sonuc, KENAR + 90, K, 10.5, R.notMavi, GEN - 98);
      y -= 4;
    }
    if (fotoVar) {
      yer(fh + 24); y -= 4;
      fotolar.forEach((f, j) => {
        const fx = KENAR + j * (fw + 12);
        sayfa.drawRectangle({ x: fx, y: y - fh, width: fw, height: fh, color: R.zebra, borderColor: R.cizgi, borderWidth: 0.5 });
        if (f.im) {
          const o = Math.min(fw / f.im.width, fh / f.im.height), w = f.im.width * o, h = f.im.height * o;
          sayfa.drawImage(f.im, { x: fx + (fw - w) / 2, y: y - fh + (fh - h) / 2, width: w, height: h });
        } else {
          const t = "Fotoğraf yok"; sayfa.drawText(t, { x: fx + fw / 2 - N.widthOfTextAtSize(t, 10) / 2, y: y - fh / 2, size: 10, font: N, color: R.soluk });
        }
        sayfa.drawText(f.ad, { x: fx, y: y - fh - 12, size: 9, font: N, color: R.soluk });
      });
      y -= fh + 18;
    }
    y -= 6; yer(2);
    sayfa.drawLine({ start: { x: KENAR, y }, end: { x: KENAR + GEN, y }, thickness: 0.8, color: R.cizgi }); y -= 10;
  }

  // ---- İş Programı ----
  if (programVar) {
  bolumBasligi(`${veri.isler.length ? 3 : 2}. İş Programı'nda yapılan işler`);
  if (!veri.program.length) yaz("Bu ay İş Programı'nda “Yapıldı” işaretlenen iş yok.", KENAR, N, 11, R.soluk, GEN);
  }
  for (const [i, p] of (programVar ? veri.program : []).entries()) {
    const metin = [p.baslik, p.aciklama].filter(Boolean).join("\n");
    yer(yukseklik(metin, N, 10, GEN - 150) + 18);
    sayfa.drawText(`${i + 1}.`, { x: KENAR, y: y - 10, size: 10, font: K, color: R.mavi });
    const ust = y;
    yaz(metin, KENAR + 20, N, 10, R.koyu, GEN - 150);
    sayfa.drawText("Yapıldı", { x: KENAR + GEN - 120, y: ust - 10, size: 9, font: K, color: R.yesil });
    sayfa.drawText(trTarih(p.yapildi_at), { x: KENAR + GEN - 120, y: ust - 22, size: 9, font: N, color: R.soluk });
    y = Math.min(y, ust - 26) - 4;
    sayfa.drawLine({ start: { x: KENAR, y }, end: { x: KENAR + GEN, y }, thickness: 0.5, color: R.cizgi }); y -= 6;
  }

  // ---- Alt bilgi ----
  const sayfalar = pdf.getPages();
  sayfalar.forEach((s, i) => {
    s.drawText(`Sporkent Asistan · ${ad} · ${veri.ayAdi}`, { x: KENAR, y: 22, size: 8, font: N, color: R.soluk });
    const t = `Sayfa ${i + 1} / ${sayfalar.length}`;
    s.drawText(t, { x: A4[0] - KENAR - N.widthOfTextAtSize(t, 8), y: 22, size: 8, font: N, color: R.soluk });
  });
  return await pdf.save();
}
