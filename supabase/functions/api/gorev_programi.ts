// Site müdürü ve şefin günlük / haftalık görev ve denetim programı.
// Kalem kimlikleri (G-A1, H-B2 …) işaretlerde saklanır: bir kalemin metni değişebilir, kimliği değişmemeli.

export type Kalem = { id: string; baslik: string; aciklama: string };
export type Bolum = { harf: string; baslik: string; saat?: string; kalemler: Kalem[] };
export type Program = { tur: "gunluk" | "haftalik"; baslik: string; giris: string; bolumler: Bolum[] };

export const GUNLUK: Program = {
  tur: "gunluk",
  baslik: "Günlük görev ve denetim programı",
  giris: "Sabah saatlerinde bütün sahaya hâkim olunması, öncelikli alanlardaki eksikliklerin belirlenmesi, personelin görevlendirilmesi ve gün içinde verilen işlerin sonuçlandırılmasının takip edilmesi esasına dayanır.",
  bolumler: [
    {
      harf: "A", baslik: "", kalemler: [
        { id: "G-A1", baslik: "Tam saha devriyesi (08:30-10:00)", aciklama: "Sitenin ana ve ara yolları, park alanları ve ortak kullanım alanları araçla dolaşılarak gözle kontrol edilir." },
        { id: "G-A3", baslik: "Sahil, iskele ve plaj", aciklama: "Sahil, iskele ve plaj öncelikli olarak denetlenir. Şezlongların düzeni, hizası ve temizliği kontrol edilir; ihtiyaç varsa yıkama ve temizlik talimatı verilir." },
        { id: "G-A6", baslik: "Deniz güvenliği", aciklama: "Emniyet halatları, yüzer emniyet elemanları (flatörler) ve şamandıralar gözle kontrol edilir." },
        { id: "G-B1", baslik: "Gün başı değerlendirmesi (10:00-10:15)", aciklama: "Bahçıvan, teknik personel, güvenlik ve temizlik personeliyle yaklaşık 15 dakikalık gün başı değerlendirmesi yapılır." },
        { id: "G-C3", baslik: "Güvenlik ve giriş-çıkış", aciklama: "Güvenlik kulübeleri ve bariyer sistemleri denetlenir; ziyaretçi kayıt defterleri incelenir." },
      ],
    },
  ],
};

export const HAFTALIK: Program = {
  tur: "haftalik",
  baslik: "Haftalık görev ve denetim programı",
  giris: "Günlük kontrollerde fark edilmeyebilecek bakım ihtiyaçlarını önceden belirlemek, koruyucu bakım ve kapsamlı temizlik çalışmalarının planlandığı şekilde yürütülmesini sağlamak amaçlanır.",
  bolumler: [
    {
      harf: "A", baslik: "Teknik altyapı ve tesisat kontrolleri", kalemler: [
        { id: "H-A1", baslik: "Su depoları ve hidrofor sistemleri", aciklama: "Basınç değerleri, klor seviyeleri ve pompaların çalışma durumu kontrol edilir; olağan dışı değerler teknik personele bildirilir." },
        { id: "H-A2", baslik: "Jeneratör ve trafo", aciklama: "Jeneratör yakıt seviyesi ve test çalıştırması kontrol edilir. Trafo ve elektrik panolarının genel durumu gözle incelenir; temizlik ve bakım işlemleri yalnızca yetkili personel tarafından yapılır." },
        { id: "H-A3", baslik: "Arıtma ve pis su sistemleri", aciklama: "Logarlar ve terfi merkezleri tıkanıklık, taşma, koku ve benzeri belirtiler yönünden kontrol edilir." },
      ],
    },
    {
      harf: "B", baslik: "Personel, stok ve idari değerlendirme", kalemler: [
        { id: "H-C1", baslik: "Haftalık ekip değerlendirmesi", aciklama: "Hafta içinde tamamlanan işler, geciken işler, tekrar eden arızalar ve çözüm bekleyen konular gözden geçirilir." },
        { id: "H-C2", baslik: "Stok kontrolü", aciklama: "Temizlik kimyasalları, sarf malzemeleri, ampul, vana ve bahçe gereçleri başta olmak üzere temel malzemelerin stok durumu kontrol edilir." },
        { id: "H-C3", baslik: "Malzeme ihtiyacı bildirimi", aciklama: "Eksilen veya temin edilmesi gereken malzemeler belirlenerek Yönetim Kurulunun onay ve satın alma usulüne uygun şekilde bildirilir." },
      ],
    },
  ],
};

export const KALEM_IDLERI = new Set(
  [GUNLUK, HAFTALIK].flatMap((p) => p.bolumler.flatMap((b) => b.kalemler.map((k) => k.id))),
);
