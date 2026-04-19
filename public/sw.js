// Minimalni service worker — potreban za PWA install dugme u Chrome
const CACHE_NAME = "ecom-tracker-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through — ne keširamo app shell da uvek imamo najnoviju verziju
  // Samo bi trebalo da ovaj worker postoji da bi PWA bila installable
});

// Primi push notifikacije
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || "eCom Tracker", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: [200, 100, 200],
        data: data.url || "/",
        tag: data.tag || "ecom",
      })
    );
  } catch (e) { console.error(e); }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clis) => {
      if (clis.length > 0) return clis[0].focus();
      return self.clients.openWindow(event.notification.data || "/");
    })
  );
});
