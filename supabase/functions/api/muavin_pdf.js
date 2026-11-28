// Ortak muavini (Muhasebe İletişim Programı'nın faiz dökümü) → dikey A4 PDF, yaşlı ortakların da rahat okuyacağı büyük yazıyla.
// Sıra: özet (güncel bakiye en üstte, büyük) → hesap hareketleri → kalem faizleri. Bağımlılıklar dışarıdan verilir (sunucu: npm:pdf-lib).
// d = { PDFDocument, rgb, fontkit, fontNormal, fontKalin, logo? }
// m = { ortak_no, hesap, ad, bilgi: {hesap_tarihi, faiz_orani, mahsup}, satirlar: [...], toplam: {...}, kalemler: [...] }

const SAYFA = [595.28, 841.89], KENAR = 36, GEN = SAYFA[0] - 2 * KENAR;
const bosMu = (n) => n === null || n === undefined || n === "" || !Number.isFinite(Number(n));
const para = (n) => bosMu(n) ? "" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Yazı tipinde olmayan emoji ve işaretler boş kutu olur: çıkarılır
const temiz = (s) => String(s ?? "").replace(/\r/g, "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/→/g, ">");

export async function muavinPdf(d, m, uretim) {
  const { PDFDocument, rgb } = d;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(d.fontkit);
  pdf.setTitle(`Sporkent - ${m.ortak_no} No'lu Ortak Hesap Dökümü`);
  pdf.setAuthor("Sporkent İşletme Kooperatifi");
  const N = await pdf.embedFont(d.fontNormal, { subset: true });
  const K = await pdf.embedFont(d.fontKalin, { subset: true });
  const R = {
    mavi: rgb(0.169, 0.435, 0.576), koyu: rgb(0.08, 0.12, 0.11), soluk: rgb(0.33, 0.38, 0.36), cizgi: rgb(0.78, 0.83, 0.82),
    zebra: rgb(0.95, 0.97, 0.97), beyaz: rgb(1, 1, 1), basBg: rgb(0.86, 0.92, 0.95),
    kirmizi: rgb(0.66, 0.1, 0.07), kirmiziBg: rgb(0.99, 0.92, 0.91), yesil: rgb(0.1, 0.42, 0.15), yesilBg: rgb(0.91, 0.96, 0.91),
  };
  let logo = null;
  if (d.logo) { try { logo = await pdf.embedPng(d.logo); } catch { logo = null; } }
  const t = m.toplam || {};
  const borcMu = (n) => !bosMu(n) && Number(n) > 0, alacakMi = (n) => !bosMu(n) && Number(n) < 0;
  const bakiyeYazi = (n) => bosMu(n) ? "" : Number(n) === 0 ? "0,00" : `${para(Math.abs(Number(n)))} ${Number(n) > 0 ? "B" : "A"}`;

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
      if (s) satirlar.push(s);
    }
    return satirlar;
  };
  const sagaYaz = (p, metin, xSag, yy, f, b, renk) => p.drawText(metin, { x: xSag - f.widthOfTextAtSize(metin, b), y: yy, size: b, font: f, color: renk });

  let sayfa, y;
  const sayfalar = [];
  // İlk sayfada büyük başlık; sonraki sayfalarda ince şerit (kimin dökümü olduğu her sayfada yazar)
  const yeniSayfa = () => {
    sayfa = pdf.addPage(SAYFA); sayfalar.push(sayfa);
    if (sayfalar.length === 1) {
      const h = 84;
      sayfa.drawRectangle({ x: 0, y: SAYFA[1] - h, width: SAYFA[0], height: h, color: R.mavi });
      let x = KENAR;
      if (logo) { const lh = 46, lw = (logo.width / logo.height) * lh; sayfa.drawImage(logo, { x, y: SAYFA[1] - 19 - lh, width: lw, height: lh }); x += lw + 18; }
      sayfa.drawText("HESAP DÖKÜMÜ", { x, y: SAYFA[1] - 42, size: 22, font: K, color: R.beyaz });
      sayfa.drawText("Sporkent İşletme Kooperatifi", { x, y: SAYFA[1] - 64, size: 13, font: N, color: R.beyaz });
      y = SAYFA[1] - h - 24;
    } else {
      const h = 34;
      sayfa.drawRectangle({ x: 0, y: SAYFA[1] - h, width: SAYFA[0], height: h, color: R.mavi });
      sayfa.drawText(`Hesap Dökümü · ${m.ortak_no} No'lu Ortak · ${temiz(m.ad)}`, { x: KENAR, y: SAYFA[1] - 22, size: 12, font: K, color: R.beyaz });
      sagaYaz(sayfa, temiz(m.bilgi?.hesap_tarihi || ""), SAYFA[0] - KENAR, SAYFA[1] - 22, N, 11, R.beyaz);
      y = SAYFA[1] - h - 18;
    }
  };
  const altSinir = KENAR + 26;

  // ---- Kimlik ve özet ----
  yeniSayfa();
  sayfa.drawText(`${m.ortak_no} No'lu Ortak`, { x: KENAR, y: y - 13, size: 13, font: N, color: R.soluk });
  y -= 20;
  for (const s of sar(m.ad, K, 20, GEN)) { sayfa.drawText(s, { x: KENAR, y: y - 20, size: 20, font: K, color: R.koyu }); y -= 26; }
  sayfa.drawText(`Hesap tarihi: ${temiz(m.bilgi?.hesap_tarihi || "—")}`, { x: KENAR, y: y - 13, size: 13, font: N, color: R.koyu });
  y -= 28;

  // Güncel bakiye kutusu: büyük, renkli, "BORÇ / ALACAK" yazıyla
  const borc = borcMu(t.bakiye), alacak = alacakMi(t.bakiye);
  const kH = 74;
  sayfa.drawRectangle({ x: KENAR, y: y - kH, width: GEN, height: kH, color: borc ? R.kirmiziBg : alacak ? R.yesilBg : R.zebra, borderColor: borc ? R.kirmizi : alacak ? R.yesil : R.cizgi, borderWidth: 1.5 });
  sayfa.drawText("Güncel bakiye", { x: KENAR + 16, y: y - 26, size: 14, font: K, color: R.koyu });
  const tutar = bosMu(t.bakiye) ? "—" : `${para(Math.abs(Number(t.bakiye)))} TL`;
  sayfa.drawText(tutar, { x: KENAR + 16, y: y - 58, size: 26, font: K, color: borc ? R.kirmizi : alacak ? R.yesil : R.koyu });
  const etiket = borc ? "BORÇ" : alacak ? "ALACAK" : "BORÇ YOK";
  sagaYaz(sayfa, etiket, KENAR + GEN - 16, y - 58, K, 22, borc ? R.kirmizi : alacak ? R.yesil : R.koyu);
  y -= kH + 14;

  // Ayrıntı satırları
  const ayrinti = [
    ["Ödenmemiş anapara", `${para(t.odenmemis_anapara) || "0,00"} TL`],
    ["Ödenmemiş faiz", `${para(t.odenmemis_faiz) || "0,00"} TL`],
    ["Toplam borç", `${para(t.borc) || "0,00"} TL`],
    ["Toplam faiz", `${para(t.faiz) || "0,00"} TL`],
    ["Toplam ödeme", `${para(t.odeme) || "0,00"} TL`],
  ];
  ayrinti.forEach(([a, b], i) => {
    const yy = y - 15;
    if (i % 2 === 0) sayfa.drawRectangle({ x: KENAR, y: y - 22, width: GEN, height: 22, color: R.zebra });
    sayfa.drawText(a, { x: KENAR + 10, y: yy, size: 13, font: i < 2 ? K : N, color: R.koyu });
    sagaYaz(sayfa, b, KENAR + GEN - 10, yy, K, 13, R.koyu);
    y -= 22;
  });
  y -= 10;
  const bilgi = `Aylık faiz oranı: %${temiz(m.bilgi?.faiz_orani || "—")}  ·  Mahsup sırası: ${temiz(m.bilgi?.mahsup || "—")}`;
  for (const s of sar(bilgi, N, 11, GEN)) { sayfa.drawText(s, { x: KENAR, y: y - 11, size: 11, font: N, color: R.soluk }); y -= 15; }
  y -= 14;

  // ---- Tablo yardımcısı (başlık satırı her sayfada tekrarlanır) ----
  const tablo = (baslik, aciklama, kolonlar, satirlar, b = 11) => {
    const SAT = b * 1.28, PAD = 4.5, NOT_B = b - 1.5;
    const basCiz = () => {
      const hh = 22;
      sayfa.drawRectangle({ x: KENAR, y: y - hh, width: GEN, height: hh, color: R.basBg });
      let x = KENAR;
      for (const k of kolonlar) {
        if (k.sag) sagaYaz(sayfa, k.ad, x + k.w - PAD, y - 15, K, b, R.koyu);
        else sayfa.drawText(k.ad, { x: x + PAD, y: y - 15, size: b, font: K, color: R.koyu });
        x += k.w;
      }
      y -= hh;
    };
    const bolumBasligi = (devam) => {
      sayfa.drawText(baslik + (devam ? " (devam)" : ""), { x: KENAR, y: y - 16, size: 16, font: K, color: R.mavi });
      y -= 24;
      if (!devam && aciklama) { for (const s of sar(aciklama, N, 10, GEN)) { sayfa.drawText(s, { x: KENAR, y: y - 10, size: 10, font: N, color: R.soluk }); y -= 14; } y -= 4; }
      basCiz();
    };
    if (y - 120 < altSinir) yeniSayfa();
    bolumBasligi(false);
    satirlar.forEach((s, i) => {
      const f = s.kalin ? K : N;
      // Tarih ve tutarlar bölünmez (tek satır); açıklamalar sarılır
      const hucre = kolonlar.map((k) => k.tek ? [temiz(k.deger(s))].filter(Boolean) : sar(k.deger(s), f, b, k.w - 2 * PAD));
      const notlar = s.not ? sar(s.not, N, NOT_B, kolonlar.find((k) => k.not).w - 2 * PAD) : [];
      const icerik = Math.max(1, ...hucre.map((x, j) => x.length + (kolonlar[j].not ? notlar.length * (NOT_B * 1.3) / SAT : 0)));
      const h = icerik * SAT + 2 * PAD + 2;
      if (y - h < altSinir) { yeniSayfa(); bolumBasligi(true); }
      if (s.kalin) sayfa.drawRectangle({ x: KENAR, y: y - h, width: GEN, height: h, color: R.basBg });
      else if (i % 2) sayfa.drawRectangle({ x: KENAR, y: y - h, width: GEN, height: h, color: R.zebra });
      let x = KENAR;
      kolonlar.forEach((k, j) => {
        let yy = y - PAD - b;
        const renk = k.renk?.(s) || R.koyu;
        for (const metin of hucre[j]) {
          // Sığmayan tek satırlık hücrede yazı biraz küçülür
          let bb = b; while (k.tek && bb > 7 && f.widthOfTextAtSize(metin, bb) > k.w - 2 * PAD) bb -= 0.25;
          if (k.sag) sagaYaz(sayfa, metin, x + k.w - PAD, yy, f, bb, renk);
          else sayfa.drawText(metin, { x: x + PAD, y: yy, size: bb, font: f, color: renk });
          yy -= SAT;
        }
        if (k.not) for (const metin of notlar) { sayfa.drawText(metin, { x: x + PAD, y: yy + 1, size: NOT_B, font: N, color: R.soluk }); yy -= NOT_B * 1.3; }
        x += k.w;
      });
      y -= h;
      sayfa.drawLine({ start: { x: KENAR, y }, end: { x: KENAR + GEN, y }, thickness: 0.5, color: R.cizgi });
    });
    y -= 18;
  };

  // ---- Hesap hareketleri ----
  const bakiyeRenk = (s) => borcMu(s.bakiye) ? R.kirmizi : alacakMi(s.bakiye) ? R.yesil : null;
  const k1 = [
    { ad: "Tarih", w: 72, tek: true, deger: (s) => s.tarih },
    { ad: "Açıklama", w: 0, not: true, deger: (s) => s.aciklama },
    { ad: "Borç", tek: true, w: 64, sag: true, deger: (s) => para(s.borc) },
    { ad: "Faiz", tek: true, w: 56, sag: true, deger: (s) => para(s.faiz) },
    { ad: "Ödeme", tek: true, w: 64, sag: true, deger: (s) => para(s.odeme) },
    { ad: "Bakiye", tek: true, w: 82, sag: true, deger: (s) => bakiyeYazi(s.bakiye), renk: bakiyeRenk },
  ];
  k1[1].w = GEN - k1.reduce((a, k) => a + k.w, 0);
  tablo("Hesap Hareketleri", "Tutarlar TL'dir. Bakiye sütununda B: borçlu, A: alacaklı (fazla ödeme) demektir. Açıklamaların altındaki gri yazılar muhasebe notudur.", k1,
    [...(m.satirlar || []), { kalin: true, tarih: "", aciklama: "TOPLAM", borc: t.borc, faiz: t.faiz, odeme: t.odeme, bakiye: t.bakiye }]);

  // ---- Kalem faizleri ----
  if ((m.kalemler || []).length) {
    const k2 = [
      { ad: "Tarih", w: 72, tek: true, deger: (s) => s.tarih },
      { ad: "Borç kalemi", w: 0, deger: (s) => `${s.kalem}${/^hay/i.test(s.faizli || "") ? " (faizsiz)" : ""}` },
      { ad: "Tutar", tek: true, w: 66, sag: true, deger: (s) => para(s.tutar) },
      { ad: "Faiz başl.", tek: true, w: 70, deger: (s) => s.faiz_baslangic },
      { ad: "Gün", tek: true, w: 34, sag: true, deger: (s) => bosMu(s.faizli_gun) ? "" : String(s.faizli_gun) },
      { ad: "İşl. faiz", tek: true, w: 58, sag: true, deger: (s) => para(s.isletilen_faiz) },
      { ad: "Kalan", tek: true, w: 62, sag: true, deger: (s) => para(s.odenmemis_anapara) },
    ];
    k2[1].w = GEN - k2.reduce((a, k) => a + k.w, 0);
    tablo("Borç Kalemleri ve Faizleri", "Her borç kalemi için faizin başladığı tarih, faiz işletilen gün sayısı, işletilen faiz ve kalemden henüz ödenmemiş anapara (Kalan).", k2, m.kalemler, 10.5);
  }

  // Alt bilgi: sayfa numarası ve gizlilik notu
  sayfalar.forEach((p, i) => {
    p.drawLine({ start: { x: KENAR, y: 34 }, end: { x: SAYFA[0] - KENAR, y: 34 }, thickness: 0.5, color: R.cizgi });
    p.drawText(temiz(`Bu belge ${m.ortak_no} No'lu ortağın kendi hesabıdır; başkalarıyla paylaşılmamalıdır. · Sporkent Asistan · ${uretim}`), { x: KENAR, y: 20, size: 8.5, font: N, color: R.soluk });
    sagaYaz(p, `Sayfa ${i + 1} / ${sayfalar.length}`, SAYFA[0] - KENAR, 20, K, 10, R.koyu);
  });
  return await pdf.save();
}
