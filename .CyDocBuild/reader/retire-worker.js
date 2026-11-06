self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('cytask-help-'))await caches.delete(key);
  await self.registration.unregister();
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(client.url.startsWith(self.registration.scope))await client.navigate(client.url);
})()));
