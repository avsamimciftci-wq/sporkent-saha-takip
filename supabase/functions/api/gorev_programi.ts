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
      harf: "A", baslik: "Sabah saha denetimi ve turu", saat: "08.30–10.00", kalemler: [
        { id: "G-A1", baslik: "Tam saha devriyesi", aciklama: "Sitenin ana ve ara yolları, park alanları ve ortak kullanım alanları araçla dolaşılarak gözle kontrol edilir." },
        { id: "G-A2", baslik: "Gece oluşan hasar ve aksaklıklar", aciklama: "Gece meydana gelmiş olabilecek devrilme, kırılma, hasar, çöp birikmesi ve uygunsuz park gibi durumlar tespit edilir; gerekli müdahale için ilgili personele görev verilir." },
        { id: "G-A3", baslik: "Sahil, iskele ve plaj", aciklama: "Sahil, iskele ve plaj öncelikli olarak denetlenir. Şezlongların düzeni, hizası ve temizliği kontrol edilir; ihtiyaç varsa yıkama ve temizlik talimatı verilir." },
        { id: "G-A4", baslik: "Duşlar ve soyunma kabinleri", aciklama: "Duşlar, soyunma kabinleri, duş başlıkları, vanalar ve su akışı kontrol edilir. Çalışmayan duşlar aynı saat içinde teknik personele bildirilir ve müdahalenin takibi yapılır." },
        { id: "G-A5", baslik: "WC ve hijyen alanları", aciklama: "Temizlik, sabun, kâğıt havlu ve dezenfektan ikmali ile koku kontrolü yapılır; eksiklikler giderilmek üzere ilgili personele bildirilir." },
        { id: "G-A6", baslik: "Deniz güvenliği", aciklama: "Emniyet halatları, yüzer emniyet elemanları (flatörler) ve şamandıralar gözle kontrol edilir." },
        { id: "G-A7", baslik: "Aydınlatma ve elektrik", aciklama: "Sokak armatürleri ve bahçe aydınlatmaları kontrol edilir. Yanmayan armatürler, kırık aydınlatmalar ve açıkta veya hasarlı elektrik/pano kapakları kayıt altına alınarak teknik personele bildirilir." },
      ],
    },
    {
      harf: "B", baslik: "Personel sevk ve idaresi", saat: "10.30–10.45", kalemler: [
        { id: "G-B1", baslik: "Gün başı değerlendirmesi", aciklama: "Bahçıvan, teknik personel, güvenlik ve temizlik personeliyle yaklaşık 15 dakikalık gün başı değerlendirmesi yapılır." },
        { id: "G-B2", baslik: "Görev dağıtımı", aciklama: "Sabah denetiminde tespit edilen işler, sorumlu personel ve mümkünse tamamlanma zamanı belirtilerek görev/emir şeklinde dağıtılır." },
        { id: "G-B3", baslik: "Personel bildirimleri", aciklama: "Personelin saha gözlemleri, talepleri, şikâyetleri ve eksik malzeme bildirimleri dinlenir; gerekli konular çözüme bağlanmak üzere kayıt altına alınır." },
      ],
    },
    {
      harf: "C", baslik: "Gün içi saha takibi ve idari işler", saat: "13.00–17.00", kalemler: [
        { id: "G-C1", baslik: "Peyzaj ve sulama", aciklama: "Kuruyan ağaç ve bitkiler, çim alanlardaki sararma veya hastalık belirtileri ve sulama fıskiyelerinin çalışması kontrol edilir." },
        { id: "G-C2", baslik: "Budama, gübreleme, ilaçlama", aciklama: "Mevsim şartlarına göre budama, gübreleme veya ilaçlama ihtiyacı belirlenir; uygulamaların ilgili personel tarafından planlı biçimde yapılması takip edilir." },
        { id: "G-C3", baslik: "Güvenlik ve giriş-çıkış", aciklama: "Güvenlik kulübeleri ve bariyer sistemleri denetlenir; ziyaretçi kayıt defterleri incelenir." },
        { id: "G-C4", baslik: "Ortakların arıza ve talepleri", aciklama: "Ortaklardan gelen arıza ve talepler değerlendirilir. Uygun bulunan işler ilgili personele iş emri olarak verilir; gün içinde sonuçlandırılması veya sonuçlandırılamama nedeni takip edilir." },
        { id: "G-C5", baslik: "Sabah verilen görevlerin takibi", aciklama: "Sabah verilen görevlerin tamamlanma durumu kontrol edilir. Tamamlanmayan işler, gerekçesi ve izlenecek işlemle birlikte takip listesinde tutulur." },
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
      harf: "B", baslik: "Peyzaj ve ortak alanların kapsamlı denetimi", kalemler: [
        { id: "H-B1", baslik: "Çim biçme ve kenar düzeltme", aciklama: "Sitenin tamamı için belirlenen çim biçme programına uyulup uyulmadığı sahada kontrol edilir." },
        { id: "H-B2", baslik: "Gübreleme ve ilaçlama", aciklama: "Ağaç ve süs bitkileri için öngörülen periyodik gübreleme ve ilaçlama planının uygulanma durumu takip edilir." },
        { id: "H-B3", baslik: "Ortak alan temizliği", aciklama: "İskele ahşaplarının yıkanması ve yürüyüş yollarının tazyikli suyla temizlenmesi gibi kapsamlı temizlik işleri denetlenir." },
      ],
    },
    {
      harf: "C", baslik: "Personel, stok ve idari değerlendirme", kalemler: [
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
