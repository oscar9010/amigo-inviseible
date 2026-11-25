// Envío de WhatsApp desde el número de la app.
// WA_PROVIDER = meta | twilio | console (por defecto: console, solo imprime en el log)

const PROVIDER = (process.env.WA_PROVIDER || 'console').toLowerCase();

// Meta no admite saltos de línea, tabs ni >4 espacios seguidos en variables de plantilla
function clean(s, max = 900) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, max);
}

async function sendMeta(to, title, body) {
  const v = process.env.META_GRAPH_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${v}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'template',
      template: {
        name: process.env.META_TEMPLATE || 'amigo_invisible_aviso',
        language: { code: process.env.META_TEMPLATE_LANG || 'es' },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: clean(title, 120) }, { type: 'text', text: clean(body) }],
        }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendTwilio(to, title, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({ From: `whatsapp:${process.env.TWILIO_FROM}`, To: `whatsapp:${to}` });
  if (process.env.TWILIO_CONTENT_SID) {
    // Plantilla aprobada: {{1}} = título, {{2}} = texto
    form.set('ContentSid', process.env.TWILIO_CONTENT_SID);
    form.set('ContentVariables', JSON.stringify({ 1: clean(title, 120), 2: clean(body) }));
  } else {
    form.set('Body', `${title}\n\n${body}`); // sandbox / ventana de 24 h
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendWhatsApp(to, title, body) {
  if (PROVIDER === 'meta') return sendMeta(to, title, body);
  if (PROVIDER === 'twilio') return sendTwilio(to, title, body);
  console.log(`[whatsapp → ${to}] ${title} | ${body}`);
}

module.exports = { sendWhatsApp, PROVIDER };
