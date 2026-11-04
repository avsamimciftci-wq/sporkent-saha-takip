// Bildirimleri gösterir ve uygulama kabuğunu önbellekte tutar.
const SURUM = "sk-v5";
const KABUK = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  // GitHub Pages dosyaları 10 dk tarayıcı önbelleğinde tutar; "reload" ile her zaman sunucudan alınır.
  e.waitUntil(caches.open(SURUM)
    .then((c) => c.addAll(KABUK.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== SURUM).map((a) => caches.delete(a))))
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
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      image: v.resim || undefined,
      tag: v.kayitId ? "kayit-" + v.kayitId : undefined,
      renotify: !!v.kayitId,
      requireInteraction: true,
      silent: false,
      vibrate: [300, 100, 300, 100, 300],
      data: { kayitId: v.kayitId },
    });
    // Uygulama açıksa haber ver: iş penceresi kendiliğinden açılsın
    const pencereler = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const p of pencereler) p.postMessage({ tip: "bildirim", kayitId: v.kayitId });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const hedef = "./" + (e.notification.data?.kayitId ? "#kayit-" + e.notification.data.kayitId : "");
  e.waitUntil((async () => {
    const pencereler = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const p of pencereler) {
      if ("focus" in p) { p.navigate(hedef); return p.focus(); }
    }
    return clients.openWindow(hedef);
  })());
});
