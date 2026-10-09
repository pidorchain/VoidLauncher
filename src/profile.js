// Профиль пользователя: ник + пароль. 8-значный ID выдаёт сервер (server/server.js).
// В launcher.json лежит S.profile = { token, id, nick, createdAt }. Токен — секрет установки, в интерфейс не передаётся.
// Пароль нигде не сохраняется: он уходит на сервер один раз (при входе/регистрации), дальше хватает токена.
const crypto = require('crypto');

const API = (process.env.VOID_API || 'https://admin-1-sqc1.onrender.com').replace(/\/+$/, ''); // ← укажите адрес вашего сервера
const TOKEN_RE = /^[0-9a-f]{64}$/, NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/;
// значки приходят с сервера: проверяем каждое поле, чтобы в интерфейс попало только безопасное
const cleanBadges = a => (Array.isArray(a) ? a : []).slice(0, 50).filter(b => b && typeof b.title === 'string' && typeof b.icon === 'string' && typeof b.color === 'string'
  && b.title.length >= 1 && b.title.length <= 24 && !CTRL_RE.test(b.title) && b.icon.length >= 1 && [...b.icon].length <= 8 && !CTRL_RE.test(b.icon) && /^#[0-9a-fA-F]{6}$/.test(b.color))
  .map(b => ({ id: Number(b.id) || 0, title: b.title, icon: b.icon, color: b.color.toLowerCase() }));
const valid = p => !!p && TOKEN_RE.test(p.token || '') && /^\d{8}$/.test(String(p.id)) && NICK_RE.test(String(p.nick || ''));

function create(S, persist, fetchFn = fetch) {
  // миграция: прошлая версия хранила анонимный ID в S.uid. Токен оставляем — сервер привяжет ник и пароль к тому же ID
  if (!S.profile && S.uid && TOKEN_RE.test(S.uid.token || '')) { S.profile = { token: S.uid.token }; delete S.uid; persist(); }
  else if (S.uid) { delete S.uid; persist(); }

  const pub = () => valid(S.profile)
    ? { registered: true, id: String(S.profile.id), nick: S.profile.nick, since: +S.profile.createdAt || 0, badges: cleanBadges(S.profile.badges) }
    : { registered: false, id: null, nick: null, since: 0, badges: [] };

  async function call(pathname, body) {
    let r; try { r = await fetchFn(API + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); } catch { throw new Error('offline'); }
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(String(j.error || 'server'));
    return j;
  }

  // mode: 'signup' — новый профиль, 'login' — вход в существующий (например, после переустановки)
  async function auth(mode, nick, password) {
    nick = String(nick || '').trim(); password = String(password == null ? '' : password);
    if (!NICK_RE.test(nick)) throw new Error('bad_nick');
    if (mode === 'signup' && (password.length < 6 || password.length > 64)) throw new Error('bad_password');
    if (mode === 'login' && !password) throw new Error('bad_credentials');
    let token = S.profile && S.profile.token; if (!TOKEN_RE.test(token || '')) token = crypto.randomBytes(32).toString('hex');
    if (!S.profile || S.profile.token !== token) { S.profile = { token }; persist(); } // токен сохраняем до ответа: при обрыве связи повтор вернёт тот же результат
    const j = await call(mode === 'login' ? '/api/login' : '/api/signup', { token, nick, password });
    if (!/^\d{8}$/.test(String(j.id)) || !NICK_RE.test(String(j.nick))) throw new Error('server');
    S.profile = { token, id: +j.id, nick: String(j.nick), createdAt: +j.createdAt || 0, badges: cleanBadges(j.badges) }; persist();
    return pub();
  }

  // синхронизация с сервером: админ мог выдать значок или сменить ID. Нет связи — остаются сохранённые данные.
  async function refresh() {
    if (!valid(S.profile)) return pub();
    try {
      const j = await call('/api/me', { token: S.profile.token });
      if (/^\d{8}$/.test(String(j.id)) && NICK_RE.test(String(j.nick || ''))) {
        const next = { token: S.profile.token, id: +j.id, nick: String(j.nick), createdAt: +j.createdAt || S.profile.createdAt || 0, badges: cleanBadges(j.badges) };
        if (JSON.stringify(next) !== JSON.stringify(S.profile)) { S.profile = next; persist(); }
      }
    } catch {}
    return pub();
  }

  function logout() { S.profile = null; persist(); return pub(); }
  return { pub, auth, refresh, logout };
}
module.exports = { create, API, valid };
