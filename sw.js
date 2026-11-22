// Offline support: every page is cached on first visit, pages refresh from the network when online.
const VERSION = 'ctl-v8';
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "ctl-notice.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
  "rhc-simulator/",
  "ecg-simulator/",
  "pv-loop-simulator/",
  "heart-sounds/",
  "ticker-talks/",
  "ticker-talks/01-STEMI-4-hours-from-the-cath-lab.html",
  "ticker-talks/02-Severe-aortic-stenosis.html",
  "ticker-talks/03-Rheumatic-mitral-stenosis.html",
  "ticker-talks/04-Primary-mitral-regurgitation.html",
  "ticker-talks/05-Functional-mitral-regurgitation.html",
  "ticker-talks/06-Aortic-regurgitation.html",
  "ticker-talks/07-HOCM.html",
  "ticker-talks/08-Acute-decompensated-heart-failure.html",
  "ticker-talks/09-Chronic-HFrEF.html",
  "ticker-talks/10-AF-rapid-ventricular-response.html",
  "ticker-talks/11-SVT-AVNRT.html",
  "ticker-talks/12-Wide-complex-tachycardia.html",
  "ticker-talks/13-Bradycardia-AV-block.html",
  "ticker-talks/14-Cardiogenic-shock.html",
  "ticker-talks/15-NSTE-ACS.html",
  "ticker-talks/16-Cardiac-tamponade.html",
  "ticker-talks/17-Aortic-dissection.html",
  "ticker-talks/18-Syncope.html",
  "ticker-talks/19-Post-cardiac-arrest-care.html",
  "ticker-talks/20-Acute-pericarditis.html"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;

  if (req.mode === 'navigate' || url.origin === location.origin) {
    // Network first so updates appear straight away; cache when offline.
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./'))));
    return;
  }
  // Fonts: cache first.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
  })));
});
