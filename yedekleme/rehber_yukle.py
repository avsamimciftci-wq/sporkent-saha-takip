# Resmi ortak listesini (Excel) veritabanına yükler. KVKK gereği ad ve telefonlar okunabilir biçimde
# gönderilmez: her biri gizli anahtarlı özete (HMAC-SHA256) çevrilir. Anahtar supabase/functions.env
# içindeki REHBER_ANAHTARI'dır; sunucu da aynı anahtarla özet çıkarıp karşılaştırır.
#
# Kullanım:  python yedekleme/rehber_yukle.py "C:/.../ORTAK ADI TELEFON NO.xlsx"
# Excel sütunları: A ad, B soyad, C gsm, D ortak no, E-G diğer telefonlar
import hashlib, hmac, os, re, subprocess, sys, tempfile
import openpyxl

PROJE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
anahtar = next(l.split("=", 1)[1].strip() for l in open(os.path.join(PROJE, "supabase", "functions.env"), encoding="utf-8")
               if l.startswith("REHBER_ANAHTARI="))

def ozet(metin):
    return hmac.new(anahtar.encode(), metin.encode("utf-8"), hashlib.sha256).hexdigest()

def ad_norm(s):  # sunucudaki adNorm ile aynı: Türkçe büyük harf, tek boşluk
    s = str(s or "").replace("i", "İ").replace("ı", "I").upper()
    return re.sub(r"\s+", " ", s).strip()

def tel_norm(t):  # son 10 hane
    return re.sub(r"\D", "", str(t or ""))[-10:]

ws = openpyxl.load_workbook(sys.argv[1], data_only=True).worksheets[0]
satirlar = []
for r in ws.iter_rows(min_row=2, values_only=True):
    if r[3] is None:
        continue
    ad = ad_norm(" ".join(str(x) for x in (r[0], r[1]) if x))
    teller = []
    for t in (r[2], r[4], r[5], r[6]):
        n = tel_norm(t)
        if len(n) >= 7 and ozet(n) not in teller:
            teller.append(ozet(n))
    satirlar.append(f"({int(r[3])}, '{ozet(ad)}', array[{','.join(repr(t) for t in teller)}]::text[])")

sql = ("begin; delete from ortak_rehberi;\ninsert into ortak_rehberi(no, ad_ozet, tel_ozetleri) values\n"
       + ",\n".join(satirlar) + ";\ncommit;\n"
       "select json_build_object('yuklenen', count(*)) r from ortak_rehberi;\n")
fd, yol = tempfile.mkstemp(suffix=".sql")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(sql)
try:
    p = subprocess.run(f'npx --yes supabase db query --linked -f "{yol}" --yes', shell=True, cwd=PROJE,
                       capture_output=True, stdin=subprocess.DEVNULL)
    cikti = p.stdout.decode("utf-8", "replace")
    m = re.search(r'"yuklenen":\s*(\d+)', cikti)
    print("Yüklenen ortak:", m.group(1) if m else "HATA\n" + cikti[-500:] + p.stderr.decode("utf-8", "replace")[-500:])
finally:
    os.remove(yol)
