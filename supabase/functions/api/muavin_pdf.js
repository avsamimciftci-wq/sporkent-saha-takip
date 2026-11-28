// Ortak muavini (Muhasebe İletişim Programı'nın faiz dökümü) → yatay A4 PDF.
// 1. bölüm: Hesap Dökümü + toplamlar; 2. bölüm: Kalem Faizleri. Bağımlılıklar dışarıdan verilir (sunucu: npm:pdf-lib).
// d = { PDFDocument, rgb, fontkit, fontNormal, fontKalin, logo? }
// m = { ortak_no, hesap, ad, bilgi: {hesap_tarihi, faiz_orani, mahsup}, satirlar: [...], toplam: {...}, kalemler: [...] }

const SAYFA = [841.89, 595.28], KENAR = 32, GEN = SAYFA[0] - 2 * KENAR;
const para = (n) => n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? ""
  : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Bakiye: artı borç (B), eksi alacak (A)
const bakiye = (n) => n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? ""
  : Number(n) === 0 ? "0,00" : `${para(Math.abs(Number(n)))} ${Number(n) > 0 ? "B" : "A"}`;
// Yazı tipinde olmayan emoji ve işaretler boş kutu olur: çıkarılır
const temiz = (s) => String(s ?? "").replace(/\r/g, "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, "");

export async function muavinPdf(d, m, uretim) {
  const { PDFDocument, rgb } = d;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(d.fontkit);
  pdf.setTitle(`Sporkent - ${m.ortak_no} No'lu Ortak Hesap Dökümü`);
  pdf.setAuthor("Sporkent İşletme Kooperatifi");
  const N = await pdf.embedFont(d.fontNormal, { subset: true });
  const K = await pdf.embedFont(d.fontKalin, { subset: true });
  const R = {
    mavi: rgb(0.169, 0.435, 0.576), koyu: rgb(0.11, 0.17, 0.15), soluk: rgb(0.38, 0.44, 0.42), cizgi: rgb(0.83, 0.87, 0.86),
    zebra: rgb(0.95, 0.97, 0.97), beyaz: rgb(1, 1, 1), basBg: rgb(0.86, 0.92, 0.95), kirmizi: rgb(0.7, 0.14, 0.09), yesil: rgb(0.18, 0.49, 0.2),
  };
  let logo = null;
  if (d.logo) { try { logo = await pdf.embedPng(d.logo); } catch { logo = null; } }

  const sar = (metin, f, b, w) => {
    const satirlar = [];
    for (const par of temiz(metin).split("\n")) {
      let s = "";
      for (const kelime of par.split(/\s+/).filter(Boolean)) {
        const aday = s ? s + " " + kelime : kelime;
        if (f.widthOfTextAtSize(aday, b) <= w) { s = aday; continue; }
        if (s) satirlar.push(s);
        let k = kelime;
        while (f.widthOfTextAtSize(k, b) > w) {
          let i = k.length; while (i > 1 && f.widthOfTextAtSize(k.slice(0, i), b) > w) i--;
          satirlar.push(k.slice(0, i)); k = k.slice(i);
        }
        s = k;
      }
      satirlar.push(s);
    }
    return satirlar.length ? satirlar : [""];
  };

  let sayfa, y;
  const sayfalar = [];
  // Her sayfanın üstünde kooperatif ve ortak bilgisi
  const yeniSayfa = (baslik) => {
    sayfa = pdf.addPage(SAYFA); sayfalar.push(sayfa);
    const h = 62;
    sayfa.drawRectangle({ x: 0, y: SAYFA[1] - h, width: SAYFA[0], height: h, color: R.mavi });
    let x = KENAR;
    if (logo) { const lh = 38, lw = (logo.width / logo.height) * lh; sayfa.drawImage(logo, { x, y: SAYFA[1] - 12 - lh, width: lw, height: lh, opacity: 0.95 }); x += lw + 16; }
    sayfa.drawText(baslik, { x, y: SAYFA[1] - 30, size: 16, font: K, color: R.beyaz });
    sayfa.drawText(`${m.ortak_no} No'lu Ortak · ${temiz(m.ad)}`, { x, y: SAYFA[1] - 49, size: 11, font: N, color: R.beyaz });
    const sag = "Sporkent İşletme Kooperatifi";
    sayfa.drawText(sag, { x: SAYFA[0] - KENAR - K.widthOfTextAtSize(sag, 11), y: SAYFA[1] - 30, size: 11, font: K, color: R.beyaz });
    const ht = `Hesap tarihi: ${temiz(m.bilgi?.hesap_tarihi || "—")}`;
    sayfa.drawText(ht, { x: SAYFA[0] - KENAR - N.widthOfTextAtSize(ht, 10), y: SAYFA[1] - 49, size: 10, font: N, color: R.beyaz });
    y = SAYFA[1] - h - 16;
  };

  // Tablo: başlık satırı sayfa bölündükçe tekrarlanır
  const tablo = (baslik, kolonlar, satirlar, bicim) => {
    const B = 7.6, SAT = B * 1.28, PAD = 3.2;
    const basCiz = () => {
      const hh = 16;
      sayfa.drawRectangle({ x: KENAR, y: y - hh, width: GEN, height: hh, color: R.basBg });
      let x = KENAR;
      for (const k of kolonlar) {
        const tw = K.widthOfTextAtSize(k.ad, 7.8);
        sayfa.drawText(k.ad, { x: k.sag ? x + k.w - PAD - tw : x + PAD, y: y - 11, size: 7.8, font: K, color: R.koyu });
        x += k.w;
      }
      y -= hh;
    };
    yeniSayfa(baslik); basCiz();
    satirlar.forEach((s, i) => {
      const hucre = kolonlar.map((k) => sar(k.deger(s), s.kalin ? K : N, B, k.w - 2 * PAD));
      const h = Math.max(...hucre.map((x) => x.length)) * SAT + 2 * PAD;
      if (y - h < KENAR + 18) { yeniSayfa(baslik); basCiz(); }
      if (s.kalin) sayfa.drawRectangle({ x: KENAR, y: y - h, width: GEN, height: h, color: R.basBg });
      else if (i % 2) sayfa.drawRectangle({ x: KENAR, y: y - h, width: GEN, height: h, color: R.zebra });
      let x = KENAR;
      kolonlar.forEach((k, j) => {
        hucre[j].forEach((metin, n) => {
          const f = s.kalin ? K : N, tw = f.widthOfTextAtSize(metin, B);
          const renk = bicim?.(k, s) || R.koyu;
          sayfa.drawText(metin, { x: k.sag ? x + k.w - PAD - tw : x + PAD, y: y - PAD - B - n * SAT + 1, size: B, font: f, color: renk });
        });
        x += k.w;
      });
      y -= h;
      sayfa.drawLine({ start: { x: KENAR, y }, end: { x: KENAR + GEN, y }, thickness: 0.4, color: R.cizgi });
    });
  };

  // ---- 1. Hesap Dökümü ----
  const s1 = [
    { ad: "Tarih", w: 58, deger: (s) => s.tarih },
    { ad: "Açıklama", w: 222, deger: (s) => s.aciklama },
    { ad: "Borç", w: 72, sag: true, deger: (s) => para(s.borc) },
    { ad: "Faiz", w: 62, sag: true, deger: (s) => para(s.faiz) },
    { ad: "Ödeme", w: 72, sag: true, deger: (s) => para(s.odeme) },
    { ad: "Bakiye", w: 82, sag: true, deger: (s) => bakiye(s.bakiye) },
  ];
  s1.push({ ad: "Not", w: GEN - s1.reduce((a, k) => a + k.w, 0), deger: (s) => s.not });
  const t = m.toplam || {};
  const satir1 = [...(m.satirlar || []),
    { kalin: true, tarih: "", aciklama: "TOPLAM", borc: t.borc, faiz: t.faiz, odeme: t.odeme, bakiye: t.bakiye, not: "" }];
  tablo("ORTAK HESAP DÖKÜMÜ", s1, satir1, (k, s) => k.ad === "Bakiye" && Number(s.bakiye) < 0 ? R.yesil : null);

  // Özet ve hesap bilgisi
  const ozet = [
    ["Güncel bakiye", bakiye(t.bakiye)],
    ["Ödenmemiş anapara", para(t.odenmemis_anapara)],
    ["Ödenmemiş faiz", para(t.odenmemis_faiz)],
  ];
  const bilgi = [
    ["Aylık faiz oranı", m.bilgi?.faiz_orani !== undefined && m.bilgi?.faiz_orani !== "" ? `%${temiz(m.bilgi.faiz_orani)}` : "—"],
    ["Mahsup sırası", temiz(m.bilgi?.mahsup || "—")],
  ];
  const kutuH = 18 + ozet.length * 15;
  if (y - kutuH - 14 < KENAR + 18) yeniSayfa("ORTAK HESAP DÖKÜMÜ");
  y -= 14;
  sayfa.drawRectangle({ x: KENAR, y: y - kutuH, width: 300, height: kutuH, borderColor: R.mavi, borderWidth: 1, color: R.beyaz });
  ozet.forEach(([a, b], i) => {
    const yy = y - 18 - i * 15;
    sayfa.drawText(a, { x: KENAR + 10, y: yy, size: 10, font: i ? N : K, color: R.koyu });
    const tw = K.widthOfTextAtSize(b, 10);
    sayfa.drawText(b, { x: KENAR + 290 - tw, y: yy, size: 10, font: K, color: i === 0 && Number(t.bakiye) > 0 ? R.kirmizi : R.koyu });
  });
  bilgi.forEach(([a, b], i) => {
    sayfa.drawText(`${a}: ${b}`, { x: KENAR + 320, y: y - 18 - i * 15, size: 9, font: N, color: R.soluk });
  });
  y -= kutuH;

  // ---- 2. Kalem Faizleri ----
  if ((m.kalemler || []).length) {
    const s2 = [
      { ad: "Tarih", w: 58, deger: (s) => s.tarih },
      { ad: "Kalem", w: 250, deger: (s) => s.kalem },
      { ad: "Tutar", w: 74, sag: true, deger: (s) => para(s.tutar) },
      { ad: "Faiz", w: 40, deger: (s) => s.faizli },
      { ad: "Faiz başlangıcı", w: 82, deger: (s) => s.faiz_baslangic },
      { ad: "Faizli gün", w: 58, sag: true, deger: (s) => s.faizli_gun === null || s.faizli_gun === undefined ? "" : String(s.faizli_gun) },
      { ad: "İşletilen faiz", w: 80, sag: true, deger: (s) => para(s.isletilen_faiz) },
    ];
    s2.push({ ad: "Ödenmemiş anapara", w: GEN - s2.reduce((a, k) => a + k.w, 0), sag: true, deger: (s) => para(s.odenmemis_anapara) });
    tablo("KALEM FAİZLERİ", s2, m.kalemler, null);
  }

  // Alt bilgi: sayfa numarası ve gizlilik notu
  sayfalar.forEach((p, i) => {
    const not = `Bu belge yalnızca ${m.ortak_no} No'lu ortağın kendi hesabını gösterir; üçüncü kişilerle paylaşılmamalıdır. · Sporkent Asistan · ${uretim}`;
    p.drawText(temiz(not), { x: KENAR, y: 16, size: 7, font: N, color: R.soluk });
    const sn = `Sayfa ${i + 1} / ${sayfalar.length}`;
    p.drawText(sn, { x: SAYFA[0] - KENAR - N.widthOfTextAtSize(sn, 7.5), y: 16, size: 7.5, font: N, color: R.soluk });
  });
  return await pdf.save();
}
