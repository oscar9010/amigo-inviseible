const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

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
