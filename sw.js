// Bildirimleri gösterir ve uygulama kabuğunu önbellekte tutar.
const SURUM = "sk-v34";
const DURUM = "sk-durum"; // sürümden bağımsız küçük kayıt: temizlenmemiş bildirim var mı
const KABUK = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json", "logo.png", "icons/logo-192.png"];

self.addEventListener("install", (e) => {
  // GitHub Pages dosyaları 10 dk tarayıcı önbelleğinde tutar; "reload" ile her zaman sunucudan alınır.
  e.waitUntil(caches.open(SURUM)
    .then((c) => c.addAll(KABUK.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== SURUM && a !== DURUM).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

// Önce ağ, olmazsa önbellek: güncel sürüm her zaman öncelikli.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((r) => {
        const kopya = r.clone();
        caches.open(SURUM).then((c) => c.put(e.request, kopya));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener("push", (e) => {
  let v = {};
  try { v = e.data.json(); } catch { v = { baslik: "Sporkent", govde: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    // Sesli, titreşimli ve dokunulana kadar ekranda kalan bildirim
    await self.registration.showNotification(v.baslik || "Sporkent", {
      body: v.govde || "",
      icon: "icons/logo-192.png",
      badge: "icons/logo-192.png",
      image: v.resim || undefined,
      tag: v.kayitId ? "kayit-" + v.kayitId : "genel-" + Date.now(),
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [300, 100, 300, 100, 300],
      data: { kayitId: v.kayitId, sayfa: v.sayfa },
    });
    await bekleyenVar(true);
    // iPhone ve bilgisayar simgedeki sayıyı kendiliğinden koymaz; bekleyen bildirim kadar yaz
    await sayiyiYaz();
    // Uygulama açıksa haber ver: iş penceresi kendiliğinden açılsın
    const pencereler = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const p of pencereler) p.postMessage({ tip: "bildirim", kayitId: v.kayitId, sayfa: v.sayfa });
  })());
});

// Simgedeki sayı = bildirim çubuğunda bekleyen Sporkent bildirimi (Android bunu kendisi sayar)
async function sayiyiYaz() {
  try {
    const n = (await self.registration.getNotifications()).length;
    if (n) await self.navigator.setAppBadge?.(n); else await self.navigator.clearAppBadge?.();
  } catch {}
}

// Bildirim geldi mi, uygulama açılıp temizlendi mi (kayıt yoksa "geldi" sayılır)
async function bekleyenVar(deger) {
  const c = await caches.open(DURUM);
  if (deger !== undefined) return c.put("bekleyen", new Response(deger ? "1" : "0"));
  const r = await c.match("bekleyen");
  return !r || (await r.text()) === "1";
}

// Uygulama açılınca çubuktaki bildirimleri kapat, simgedeki sayıyı sil
async function temizle() {
  try { for (const b of await self.registration.getNotifications()) b.close(); } catch {}
  try { await self.navigator.clearAppBadge?.(); } catch {}
  // Samsung simgedeki sayıyı bildirimler kapansa da bazen tutuyor; sessiz bir bildirim
  // gösterip hemen kapatmak sayıyı yeniden hesaplatıp sıfırlıyor. Yalnızca bildirim geldiyse.
  try {
    if (!(await bekleyenVar())) return false;
    await self.registration.showNotification("Sporkent", { tag: "sk-temizlik", silent: true, body: "" });
    for (const b of await self.registration.getNotifications({ tag: "sk-temizlik" })) b.close();
    await bekleyenVar(false);
    return true;
  } catch { return false; }
}

self.addEventListener("message", (e) => {
  if (e.data?.tip === "temizle") e.waitUntil(temizle());
});

self.addEventListener("notificationclose", (e) => e.waitUntil(sayiyiYaz()));

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const v = e.notification.data || {};
  const hedef = "./" + (v.sayfa ? "#" + v.sayfa : v.kayitId ? "#kayit-" + v.kayitId : "");
  e.waitUntil((async () => {
    await temizle();
    const pencereler = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const p of pencereler) {
      if ("focus" in p) { p.navigate(hedef); return p.focus(); }
    }
    return clients.openWindow(hedef);
  })());
});
