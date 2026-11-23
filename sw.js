// Bildirimleri gÃ¶sterir ve uygulama kabuÄŸunu Ã¶nbellekte tutar.
const SURUM = "sk-v170";
const DURUM = "sk-durum"; // sÃ¼rÃ¼mden baÄŸÄ±msÄ±z kÃ¼Ã§Ã¼k kayÄ±t: temizlenmemiÅŸ bildirim var mÄ±
const KABUK = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json", "logo.png", "icons/logo-192.png"];

self.addEventListener("install", (e) => {
  // GitHub Pages dosyalarÄ± 10 dk tarayÄ±cÄ± Ã¶nbelleÄŸinde tutar; "reload" ile her zaman sunucudan alÄ±nÄ±r.
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

// Ã–nce aÄŸ, olmazsa Ã¶nbellek: gÃ¼ncel sÃ¼rÃ¼m her zaman Ã¶ncelikli.
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
    // Sesli, titreÅŸimli ve dokunulana kadar ekranda kalan bildirim
    await self.registration.showNotification(v.baslik || "Sporkent", {
      body: v.govde || "",
      icon: "icons/logo-192.png",
      badge: "icons/logo-192.png",
      image: v.resim || undefined,
      tag: v.kayitId ? "kayit-" + v.kayitId : "genel-" + Date.now(),
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [500, 150, 500, 150, 500, 150, 800],
      data: { kayitId: v.kayitId, sayfa: v.sayfa },
    });
    await bekleyenVar(true);
    // iPhone ve bilgisayar simgedeki sayÄ±yÄ± kendiliÄŸinden koymaz; bekleyen bildirim kadar yaz
    await sayiyiYaz();
    // Uygulama aÃ§Ä±ksa haber ver: iÅŸ penceresi kendiliÄŸinden aÃ§Ä±lsÄ±n
    const pencereler = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const p of pencereler) p.postMessage({ tip: "bildirim", kayitId: v.kayitId, sayfa: v.sayfa });
  })());
});

// Simgedeki sayÄ± = bildirim Ã§ubuÄŸunda bekleyen Sporkent bildirimi (Android bunu kendisi sayar)
async function sayiyiYaz() {
  try {
    const n = (await self.registration.getNotifications()).length;
    if (n) await self.navigator.setAppBadge?.(n); else await self.navigator.clearAppBadge?.();
  } catch {}
}

// Bildirim geldi mi, uygulama aÃ§Ä±lÄ±p temizlendi mi (kayÄ±t yoksa "geldi" sayÄ±lÄ±r)
async function bekleyenVar(deger) {
  const c = await caches.open(DURUM);
  if (deger !== undefined) return c.put("bekleyen", new Response(deger ? "1" : "0"));
  const r = await c.match("bekleyen");
  return !r || (await r.text()) === "1";
}

// Uygulama aÃ§Ä±lÄ±nca Ã§ubuktaki bildirimleri kapat, simgedeki sayÄ±yÄ± sil
async function temizle() {
  try { for (const b of await self.registration.getNotifications()) b.close(); } catch {}
  try { await self.navigator.clearAppBadge?.(); } catch {}
  // Samsung simgedeki sayÄ±yÄ± bildirimler kapansa da bazen tutuyor; sessiz bir bildirim
  // gÃ¶sterip hemen kapatmak sayÄ±yÄ± yeniden hesaplatÄ±p sÄ±fÄ±rlÄ±yor. YalnÄ±zca bildirim geldiyse.
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
