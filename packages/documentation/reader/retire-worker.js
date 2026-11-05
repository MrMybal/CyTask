// One-time retirement of the previous HTTP-only help cache.
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith("cytask-help-"))await caches.delete(name);
 await self.registration.unregister();
 for(const client of await self.clients.matchAll({type:"window",includeUncontrolled:true}))
  if(client.url.startsWith(self.registration.scope))await client.navigate(client.url);
})()));
