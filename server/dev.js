// `npm run dev` only: live reload for the browser.
// node --watch restarts the server when server code changes; this module reloads open pages when
// public/ files change (CSS is swapped in place, no reload) and after the server comes back up.
// If you were in game, the reloaded page drops you straight back in with the same hero.
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const ASSET = /\.(html|css|js|json|png|jpe?g|gif|svg|webp|mp3|ogg|wav)$/i;

const CLIENT = `(() => {
  const s = io('/__dev', { forceNew: true, transports: ['websocket'] });
  let wasDown = false;
  const reload = () => { sessionStorage.setItem('cr_dev_rejoin', '1'); location.reload(); };
  s.on('disconnect', () => { wasDown = true; });
  s.on('connect', () => { if (wasDown) reload(); }); // server restarted with new code
  s.on('change', ({ file }) => {
    if (!file.endsWith('.css')) return reload();
    for (const l of document.querySelectorAll('link[rel=stylesheet]')) {
      const url = new URL(l.href);
      if (url.origin !== location.origin) continue;
      url.searchParams.set('v', Date.now());
      l.href = url.href;
    }
    console.log('[dev] reloaded ' + file);
  });
})();`;

module.exports = function setupDev(app, io) {
  app.get(['/', '/index.html'], (req, res) => {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    res.type('html').set('Cache-Control', 'no-store').send(html.replace('</body>', '  <script src="/__dev.js"></script>\n</body>'));
  });
  app.get('/__dev.js', (req, res) => res.type('js').send(CLIENT));

  const nsp = io.of('/__dev');
  let timer = null, changed = new Set();
  fs.watch(PUBLIC, { recursive: true }, (_ev, file) => {
    if (!file || !ASSET.test(file)) return; // skip folders and editor temp/backup files
    changed.add(file.replace(/\\/g, '/'));
    clearTimeout(timer);
    timer = setTimeout(() => { // editors fire several events per save
      const files = [...changed];
      changed = new Set();
      const file = files.find((f) => !f.endsWith('.css')) || files[0];
      console.log(`[dev] ${files.join(', ')} changed, reloading browsers`);
      nsp.emit('change', { file });
    }, 120);
  });
  console.log('Dev mode: server restarts on server code changes, browsers reload on public/ changes.');
};
