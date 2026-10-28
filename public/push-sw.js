/* Nest buzzes. Loaded into the service worker (vite.config.ts → workbox.importScripts).
   The helper (worker/) sends a locked message; the phone opens it here and shows it. */
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "Nest", body: event.data ? event.data.text() : "" }; }
  const opts = {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: d.url || "/" },
    timestamp: Date.now(),
  };
  if (d.tag) { opts.tag = d.tag; opts.renotify = true; }
  // iPhones require every push to show something, so this always shows.
  event.waitUntil(self.registration.showNotification(d.title || "Nest", opts));
});

/* Tap a buzz: bring Nest forward and open the right place (Body for rest, Shutdown at night). */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        try { await w.focus(); } catch (e) { /* not allowed to focus */ }
        w.postMessage({ type: "nest-open", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
