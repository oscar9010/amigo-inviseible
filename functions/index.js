const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const { onRequest } = require('firebase-functions/v2/https');

initializeApp();

// Manifiesto personal: al instalar la app en la pantalla de inicio, se abre directamente en el enlace de cada participante
exports.manifiesto = onRequest({ region: process.env.FN_REGION || 'us-central1', cors: true, maxInstances: 5 }, (req, res) => {
  const t = String(req.query.t || '');
  let page;
  try { page = new URL(String(req.query.u || '')); } catch { return res.status(400).send('bad request'); }
  const allowed = page.origin === 'https://oscar9010.github.io' || page.hostname === 'localhost';
  if (!allowed || !/^[\w-]{10,60}$/.test(t)) return res.status(400).send('bad request');
  const dir = page.origin + page.pathname.replace(/[^/]*$/, '');
  res.set('Cache-Control', 'public, max-age=300').type('application/manifest+json').send(JSON.stringify({
    id: `${dir}?i=${t}`,
    name: 'Amigo Invisible',
    short_name: 'Amigo',
    start_url: `${page.origin}${page.pathname}?t=${t}`,
    scope: dir,
    display: 'standalone',
    background_color: '#0b3b2e',
    theme_color: '#0b3b2e',
    icons: [
      { src: dir + 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: dir + 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }));
});

// Al llegar un mensaje al chat, avisa por push a los dispositivos de la otra persona (r: 's' = quien regala, 'g' = quien recibe)
exports.avisarMensaje = onDocumentCreated(
  { document: 'chats/{cid}/messages/{mid}', region: process.env.FN_REGION || 'us-central1' },
  async event => {
    const m = event.data?.data();
    if (!m) return;
    const to = m.r === 's' ? 'g' : 's';
    const subs = await getFirestore().collection(`chats/${event.params.cid}/subs`).where('role', '==', to).get();
    if (subs.empty) { console.log('avisos: sin dispositivos suscritos'); return; }
    const body = to === 'g' ? 'Tu amigo invisible te ha escrito 💬' : 'Tu amigo invisible te ha respondido 💬';
    const docs = subs.docs;
    const res = await getMessaging().sendEach(docs.map(d => ({
      token: d.get('token'),
      data: { title: '🎁 Amigo Invisible', body, url: String(d.get('url') || '') },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } },
    })));
    console.log(`avisos: ${res.successCount} enviados, ${res.failureCount} fallidos`, res.responses.filter(r => !r.success).map(r => r.error?.code));
    const dead = [];
    res.responses.forEach((r, i) => {
      if (!r.success && /not-registered|invalid-registration|invalid-argument/.test(r.error?.code || '')) dead.push(docs[i].ref.delete());
    });
    await Promise.all(dead);
  }
);
