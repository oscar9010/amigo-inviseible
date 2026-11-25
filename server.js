const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const { sendWhatsApp, PROVIDER } = require('./whatsapp');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || '34';
const MSG_PER_DAY = Number(process.env.MSG_PER_DAY || 20);

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'amigo.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, budget REAL, currency TEXT DEFAULT 'EUR',
  event_date TEXT, invite_code TEXT UNIQUE, admin_token TEXT UNIQUE,
  drawn_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL, token TEXT UNIQUE, wishlist TEXT DEFAULT '[]',
  giftee_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(group_id, phone));
CREATE TABLE IF NOT EXISTS exclusions (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, a INTEGER, b INTEGER,
  PRIMARY KEY (group_id, a, b));
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_id INTEGER, to_id INTEGER, kind TEXT, body TEXT, status TEXT, error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const tok = (n = 18) => crypto.randomBytes(n).toString('base64url');
const code = () => crypto.randomBytes(5).toString('hex').toUpperCase();

function normPhone(raw) {
  let s = String(raw || '').trim().replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) s = '+' + DEFAULT_CC + s;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
function cleanWishlist(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 30).map(i => {
    const link = str(i.link, 500);
    return { text: str(i.text, 200), link: /^https?:\/\//i.test(link) ? link : '' };
  }).filter(i => i.text);
}
const groupPublic = g => ({
  name: g.name, budget: g.budget, currency: g.currency, date: g.event_date, drawn: !!g.drawn_at,
});
const links = p => `${BASE_URL}/p/${p.token}`;

async function notify(p, title, body) {
  try { await sendWhatsApp(p.phone, title, body); return { ok: true }; }
  catch (e) { console.error('WhatsApp error', e.message); return { ok: false, error: e.message }; }
}

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- Crear grupo ----------
app.post('/api/groups', async (req, res) => {
  const { name, budget, currency, date, organizer } = req.body || {};
  const phone = normPhone(organizer?.phone);
  if (!str(name, 80)) return bad(res, 'Ponle nombre al grupo');
  if (!str(organizer?.name, 60)) return bad(res, 'Escribe tu nombre');
  if (!phone) return bad(res, 'Número de WhatsApp no válido (usa +34…, +57…)');
  const g = db.prepare(`INSERT INTO groups (name,budget,currency,event_date,invite_code,admin_token)
    VALUES (?,?,?,?,?,?) RETURNING *`).get(
    str(name, 80), Number(budget) || null, str(currency, 3) || 'EUR', str(date, 10) || null, code(), tok());
  const p = db.prepare(`INSERT INTO participants (group_id,name,phone,token) VALUES (?,?,?,?) RETURNING *`)
    .get(g.id, str(organizer.name, 60), phone, tok());
  notify(p, `Creaste el grupo ${g.name}`,
    `Tu enlace de participante: ${links(p)} · Panel de organizador: ${BASE_URL}/admin/${g.admin_token} · Invita con: ${BASE_URL}/g/${g.invite_code}`);
  res.json({ adminToken: g.admin_token, token: p.token, inviteCode: g.invite_code });
});

// ---------- Unirse con invitación ----------
const byInvite = c => db.prepare('SELECT * FROM groups WHERE invite_code = ?').get(String(c).toUpperCase());
app.get('/api/invite/:code', (req, res) => {
  const g = byInvite(req.params.code);
  if (!g) return bad(res, 'Invitación no encontrada', 404);
  const n = db.prepare('SELECT COUNT(*) n FROM participants WHERE group_id = ?').get(g.id).n;
  res.json({ ...groupPublic(g), count: n });
});
app.post('/api/invite/:code/join', async (req, res) => {
  const g = byInvite(req.params.code);
  if (!g) return bad(res, 'Invitación no encontrada', 404);
  if (g.drawn_at) return bad(res, 'El sorteo ya se hizo; pide al organizador que lo repita si quieres entrar');
  const name = str(req.body?.name, 60), phone = normPhone(req.body?.phone);
  if (!name) return bad(res, 'Escribe tu nombre');
  if (!phone) return bad(res, 'Número de WhatsApp no válido (usa +34…, +57…)');
  const existing = db.prepare('SELECT * FROM participants WHERE group_id=? AND phone=?').get(g.id, phone);
  if (existing) {
    notify(existing, `Tu enlace de ${g.name}`, `Entra aquí: ${links(existing)}`);
    return bad(res, 'Ese número ya está en el grupo. Te reenviamos tu enlace por WhatsApp.', 409);
  }
  const p = db.prepare(`INSERT INTO participants (group_id,name,phone,token,wishlist) VALUES (?,?,?,?,?) RETURNING *`)
    .get(g.id, name, phone, tok(), JSON.stringify(cleanWishlist(req.body?.wishlist)));
  notify(p, `Te uniste a ${g.name}`, `Guarda este enlace para ver tu sorteo y tu lista: ${links(p)}`);
  res.json({ token: p.token });
});

// ---------- Vista del participante ----------
function loadMe(req, res) {
  const me = db.prepare('SELECT * FROM participants WHERE token = ?').get(req.params.token);
  if (!me) { bad(res, 'Enlace no válido', 404); return null; }
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(me.group_id);
  return { me, g };
}
app.get('/api/me/:token', (req, res) => {
  const ctx = loadMe(req, res); if (!ctx) return;
  const { me, g } = ctx;
  const members = db.prepare('SELECT id,name,wishlist FROM participants WHERE group_id=? ORDER BY id').all(g.id)
    .map(m => ({ id: m.id, name: m.name, wishlist: JSON.parse(m.wishlist), me: m.id === me.id }));
  let giftee = null, santaId = null;
  if (g.drawn_at && me.giftee_id) giftee = members.find(m => m.id === me.giftee_id) || null;
  const santa = db.prepare('SELECT id FROM participants WHERE giftee_id = ?').get(me.id);
  if (santa) santaId = santa.id;
  // Hilo A: yo (santa) ↔ mi amigo/a.  Hilo B: mi santa ↔ yo. Nunca se revela el id del santa.
  const q = db.prepare(`SELECT from_id, body, created_at, status FROM messages
    WHERE group_id=? AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) ORDER BY id`);
  const mapMsg = mine => m => ({ mine: m.from_id === mine, body: m.body, at: m.created_at, status: m.status });
  const toGiftee = giftee ? q.all(g.id, me.id, giftee.id, giftee.id, me.id).map(mapMsg(me.id)) : [];
  const fromSanta = santaId ? q.all(g.id, santaId, me.id, me.id, santaId).map(mapMsg(me.id)) : [];
  res.json({
    group: groupPublic(g), inviteCode: g.invite_code,
    me: { id: me.id, name: me.name, wishlist: JSON.parse(me.wishlist) },
    members, giftee, threads: { toGiftee, fromSanta },
  });
});
app.put('/api/me/:token/wishlist', (req, res) => {
  const ctx = loadMe(req, res); if (!ctx) return;
  const list = cleanWishlist(req.body?.items);
  db.prepare('UPDATE participants SET wishlist=? WHERE id=?').run(JSON.stringify(list), ctx.me.id);
  res.json({ items: list });
});
app.post('/api/me/:token/messages', async (req, res) => {
  const ctx = loadMe(req, res); if (!ctx) return;
  const { me, g } = ctx;
  if (!g.drawn_at) return bad(res, 'Todavía no se ha hecho el sorteo');
  const body = str(req.body?.body, 600);
  if (!body) return bad(res, 'Escribe un mensaje');
  const sent = db.prepare(`SELECT COUNT(*) n FROM messages WHERE from_id=? AND created_at > datetime('now','-1 day')`).get(me.id).n;
  if (sent >= MSG_PER_DAY) return bad(res, `Máximo ${MSG_PER_DAY} mensajes al día`, 429);
  let to, title;
  if (req.body?.to === 'giftee') {
    to = db.prepare('SELECT * FROM participants WHERE id=?').get(me.giftee_id);
    title = `Tu amigo invisible de ${g.name} dice`;
  } else if (req.body?.to === 'santa') {
    to = db.prepare('SELECT * FROM participants WHERE giftee_id=?').get(me.id);
    title = `${me.name} te responde (${g.name})`;
  }
  if (!to) return bad(res, 'Destinatario no encontrado');
  const r = await notify(to, title, `${body} · Responde aquí: ${links(to)}`);
  db.prepare('INSERT INTO messages (group_id,from_id,to_id,kind,body,status,error) VALUES (?,?,?,?,?,?,?)')
    .run(g.id, me.id, to.id, req.body.to, body, r.ok ? 'sent' : 'failed', r.error || null);
  res.json({ ok: r.ok, warning: r.ok ? null : 'Guardado en la app, pero WhatsApp no lo entregó' });
});

// ---------- Organizador ----------
function loadAdmin(req, res) {
  const g = db.prepare('SELECT * FROM groups WHERE admin_token = ?').get(req.params.admin);
  if (!g) bad(res, 'Enlace de organizador no válido', 404);
  return g;
}
app.get('/api/admin/:admin', (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  const people = db.prepare('SELECT id,name,phone,wishlist FROM participants WHERE group_id=? ORDER BY id').all(g.id)
    .map(p => ({ id: p.id, name: p.name, phone: p.phone.slice(0, -4).replace(/\d/g, '•') + p.phone.slice(-4), wishes: JSON.parse(p.wishlist).length }));
  const exclusions = db.prepare('SELECT a,b FROM exclusions WHERE group_id=?').all(g.id);
  res.json({ ...groupPublic(g), inviteCode: g.invite_code, drawnAt: g.drawn_at, people, exclusions, provider: PROVIDER });
});
app.put('/api/admin/:admin', (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  const b = req.body || {};
  db.prepare('UPDATE groups SET name=?, budget=?, currency=?, event_date=? WHERE id=?').run(
    str(b.name, 80) || g.name, Number(b.budget) || null, str(b.currency, 3) || g.currency, str(b.date, 10) || null, g.id);
  res.json({ ok: true });
});
app.delete('/api/admin/:admin/participants/:id', (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  if (g.drawn_at) return bad(res, 'Reinicia el sorteo antes de quitar a alguien');
  db.prepare('DELETE FROM exclusions WHERE group_id=? AND (a=? OR b=?)').run(g.id, req.params.id, req.params.id);
  db.prepare('DELETE FROM participants WHERE id=? AND group_id=?').run(req.params.id, g.id);
  res.json({ ok: true });
});
app.post('/api/admin/:admin/exclusions', (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  let [a, b] = [Number(req.body?.a), Number(req.body?.b)].sort((x, y) => x - y);
  const ok = db.prepare('SELECT COUNT(*) n FROM participants WHERE group_id=? AND id IN (?,?)').get(g.id, a, b).n === 2;
  if (!ok || a === b) return bad(res, 'Elige dos personas distintas');
  if (req.body?.remove) db.prepare('DELETE FROM exclusions WHERE group_id=? AND a=? AND b=?').run(g.id, a, b);
  else db.prepare('INSERT OR IGNORE INTO exclusions VALUES (?,?,?)').run(g.id, a, b);
  res.json({ ok: true });
});

function draw(ids, excl) {
  const banned = new Set(excl.flatMap(({ a, b }) => [`${a}>${b}`, `${b}>${a}`]));
  for (let t = 0; t < 5000; t++) {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]];
    }
    // Un solo ciclo: nadie se regala a sí mismo y no hay parejas cerradas
    const pairs = order.map((id, i) => [id, order[(i + 1) % order.length]]);
    if (pairs.every(([a, b]) => !banned.has(`${a}>${b}`))) return pairs;
  }
  return null;
}
app.post('/api/admin/:admin/draw', async (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  const people = db.prepare('SELECT * FROM participants WHERE group_id=?').all(g.id);
  if (people.length < 3) return bad(res, 'Se necesitan al menos 3 personas');
  const pairs = draw(people.map(p => p.id), db.prepare('SELECT a,b FROM exclusions WHERE group_id=?').all(g.id));
  if (!pairs) return bad(res, 'No hay forma de sortear con esas exclusiones; quita alguna');
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE group_id=?').run(g.id);
    const up = db.prepare('UPDATE participants SET giftee_id=? WHERE id=?');
    pairs.forEach(([a, b]) => up.run(b, a));
    db.prepare("UPDATE groups SET drawn_at=datetime('now') WHERE id=?").run(g.id);
  })();
  let failed = 0;
  for (const p of people) {
    const r = await notify(p, `¡Sorteo hecho en ${g.name}!`, `Entra para ver a quién te tocó (es secreto): ${links(p)}`);
    if (!r.ok) failed++;
  }
  res.json({ ok: true, failed });
});
app.post('/api/admin/:admin/reset', (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  db.transaction(() => {
    db.prepare('UPDATE participants SET giftee_id=NULL WHERE group_id=?').run(g.id);
    db.prepare('DELETE FROM messages WHERE group_id=?').run(g.id);
    db.prepare('UPDATE groups SET drawn_at=NULL WHERE id=?').run(g.id);
  })();
  res.json({ ok: true });
});
app.post('/api/admin/:admin/resend', async (req, res) => {
  const g = loadAdmin(req, res); if (!g) return;
  const people = db.prepare('SELECT * FROM participants WHERE group_id=?').all(g.id);
  let failed = 0;
  for (const p of people) if (!(await notify(p, `Tu enlace de ${g.name}`, `Entra aquí: ${links(p)}`)).ok) failed++;
  res.json({ ok: true, failed });
});

// Rutas de la SPA
app.get(['/g/:x', '/p/:x', '/admin/:x'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) app.listen(PORT, () => console.log(`Amigo invisible en ${BASE_URL} (WhatsApp: ${PROVIDER})`));
module.exports = { app, draw };
