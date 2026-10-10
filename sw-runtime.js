const manifest=self.ATLAS_CACHE_MANIFEST;
if(!manifest || !manifest.cache || !Array.isArray(manifest.assets)) throw new Error('ATLAS cache manifest missing');
const CACHE=manifest.cache;
const ASSETS=manifest.assets;

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE)
    .then(c=>c.addAll(ASSETS))
    .then(()=>self.skipWaiting())
    .catch(err=>caches.delete(CACHE).then(()=>{throw err;}))
));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin){ e.respondWith(Promise.resolve(Response.error())); return; }
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
    if(!r || !r.ok) return r;
    const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return r;
  })));
});
