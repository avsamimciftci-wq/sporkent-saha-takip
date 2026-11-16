// Sporkent SAHA TAKİP: haftalık yedek.
// Kodları, veritabanının bütün tablolarını, fotoğrafları ve gizli dosyaları
// OneDrive › SPORKENT İŞLETME KOOPERATİFİ › SAHA TAKİP PROGRAMI YEDEĞİ › <tarih> klasörüne kopyalar.
// Windows Görev Zamanlayıcı her hafta çalıştırır; elle de çalıştırılabilir:  node yedekle.mjs
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PROJE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = "inhqkwuvlxhabkiulyrd";
const URL = `https://${REF}.supabase.co`;
const KOK = path.join(process.env.USERPROFILE || "C:/Users/HP", "OneDrive", "SPORKENT İŞLETME KOOPERATİFİ", "SAHA TAKİP PROGRAMI YEDEĞİ");
const TABLOLAR = ["ayarlar", "uyeler", "abonelikler", "kayitlar", "goruntulemeler", "gorev_isaretleri",
  "ortaklar", "tg_uyeleri", "aidat_resimleri", "is_programi", "bildirim_gunlugu", "ortak_rehberi", "davet_kodlari"];
const SAYACLI = ["kayitlar", "aidat_resimleri", "is_programi", "tg_uyeleri", "bildirim_gunlugu", "davet_kodlari"];

const tarih = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Türkiye günü
const HEDEF = path.join(KOK, tarih);
const GUNLUK = path.join(KOK, "yedek-gunlugu.txt");
const yaz = (m) => { const s = `${new Date().toLocaleString("tr-TR")}  ${m}`; console.log(s); fs.appendFileSync(GUNLUK, s + "\r\n"); };
const calistir = (k) => execSync(k, { cwd: PROJE, stdio: ["ignore", "pipe", "pipe"], shell: true }).toString();

async function main() {
  fs.mkdirSync(KOK, { recursive: true });
  const d1 = path.join(HEDEF, "1-Program kodları"), d2 = path.join(HEDEF, "2-Veritabanı"),
    d3 = path.join(HEDEF, "3-Fotoğraflar"), d4 = path.join(HEDEF, "4-Gizli şifreler ve kodlar");
  for (const d of [d1, d2, d3, d4]) fs.mkdirSync(d, { recursive: true });

  // 1. Kodlar ve bütün geçmiş
  for (const f of calistir("git ls-files -z").split("\0").filter(Boolean)) {
    const hedef = path.join(d1, f);
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    fs.copyFileSync(path.join(PROJE, f), hedef);
  }
  const paket = path.join(PROJE, "yedekleme", "kod_gecmisi.bundle");
  calistir(`git bundle create "${paket}" --all`);
  fs.renameSync(paket, path.join(d1, "kod_gecmisi.bundle"));

  // 2. Veritabanı: her tablo JSON + tek seferde geri yükleme komutu
  const ham = calistir(`npx --yes supabase projects api-keys --project-ref ${REF} -o json`);
  const servis = JSON.parse(ham.slice(ham.indexOf("["))).find((k) => k.name === "service_role")?.api_key;
  if (!servis) throw new Error("Supabase servis anahtarı alınamadı (supabase login gerekli olabilir).");
  const h = { apikey: servis, Authorization: `Bearer ${servis}` };
  const geri = ["-- Sporkent SAHA TAKİP: verileri yeni veritabanına geri yükleme", "-- Önce tablolar kurulmuş olmalı (supabase db push).", "begin;"];
  const ozet = {};
  for (const t of TABLOLAR) {
    let veri = [];
    for (let bas = 0; ; bas += 1000) {
      const r = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { ...h, Range: `${bas}-${bas + 999}` } });
      if (!r.ok) throw new Error(`${t} tablosu okunamadı: ${r.status}`);
      const parca = await r.json();
      veri = veri.concat(parca);
      if (parca.length < 1000) break;
    }
    fs.writeFileSync(path.join(d2, `${t}.json`), JSON.stringify(veri, null, 1));
    ozet[t] = veri.length;
    if (veri.length) geri.push(`insert into ${t} select * from json_populate_recordset(null::${t}, '${JSON.stringify(veri).replaceAll("'", "''")}') on conflict do nothing;`);
  }
  for (const t of SAYACLI) geri.push(`select setval(pg_get_serial_sequence('${t}','id'), coalesce((select max(id) from ${t}), 1));`);
  geri.push("commit;");
  fs.writeFileSync(path.join(d2, "geri_yukle.sql"), geri.join("\n") + "\n");
  fs.writeFileSync(path.join(d2, "ozet.json"), JSON.stringify(ozet, null, 1));

  // 3. Fotoğraflar
  const listele = async (onek) => (await fetch(`${URL}/storage/v1/object/list/fotograflar`, {
    method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: onek, limit: 1000 }),
  })).json();
  let foto = 0;
  for (const k of await listele("")) {
    if (k.id) continue;
    for (const f of await listele(k.name + "/")) {
      if (!f.id) continue;
      const r = await fetch(`${URL}/storage/v1/object/fotograflar/${k.name}/${f.name}`, { headers: h });
      if (!r.ok) { yaz(`UYARI: ${k.name}/${f.name} indirilemedi (${r.status})`); continue; }
      fs.mkdirSync(path.join(d3, k.name), { recursive: true });
      fs.writeFileSync(path.join(d3, k.name, f.name), Buffer.from(await r.arrayBuffer()));
      foto++;
    }
  }

  // 4. Gizli dosyalar ve kod listeleri
  for (const f of [".gizli.env", "supabase/functions.env", "Ortak_Sifreleri.csv", "TG_Kodlari.csv", "YK_Kodlari.csv"]) {
    const k = path.join(PROJE, f);
    if (fs.existsSync(k)) fs.copyFileSync(k, path.join(d4, path.basename(f)));
  }

  // Kurulum notu: bir önceki yedekten kopyalanır
  const notAdi = "OKUBENI - Yeniden kurulum.md";
  const onceki = fs.readdirSync(KOK).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x !== tarih && fs.existsSync(path.join(KOK, x, notAdi))).sort().pop();
  if (onceki) {
    const metin = fs.readFileSync(path.join(KOK, onceki, notAdi), "utf8").replace(/Yedek tarihi: [^\n]*/, `Yedek tarihi: ${tarih.split("-").reverse().join(".")}`);
    fs.writeFileSync(path.join(HEDEF, notAdi), metin);
  }

  yaz(`Yedek alındı: ${tarih} · ${Object.values(ozet).reduce((a, b) => a + b, 0)} kayıt (${Object.entries(ozet).map(([t, n]) => `${t} ${n}`).join(", ")}) · ${foto} fotoğraf`);
}

main().catch((e) => { yaz(`HATA: yedek alınamadı: ${e.message}`); process.exit(1); });
