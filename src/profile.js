// Профиль пользователя: ник + пароль. ID (1–8 цифр) выдаёт сервер (server/server.js); админ может сменить его и забанить профиль.
// В launcher.json лежит S.profile = { token, id, nick, createdAt }. Токен — секрет установки, в интерфейс не передаётся.
// Пароль нигде не сохраняется: он уходит на сервер один раз (при входе/регистрации), дальше хватает токена.
const crypto = require('crypto'), fs = require('fs'), os = require('os');
const { execFile } = require('child_process');

const API = (process.env.VOID_API || 'https://admin-1-sqc1.onrender.com').replace(/\/+$/, ''); // ← укажите адрес вашего сервера
// Открытый ключ сервера для проверки подписи ответов (Ed25519, SPKI DER в base64): `node server/genkey.js` → PUBLIC_KEY.
// С ключом бан нельзя снять подменой сервера или правкой launcher.json: «не забанен» принимается только с подписью сервера. Пусто = проверка выключена.
const PUBKEY = 'MCowBQYDK2VwAyEAQZ7mFekV4fMP6Wwqi4Bhwlm+Nn/iCyKu7gH3ywdIydM=';
// Сколько часов можно запускать игру без успешной проверки профиля сервером (только когда задан PUBKEY). 0 = без ограничения.
const MAX_OFFLINE_H = 72;
const TOKEN_RE = /^[0-9a-f]{64}$/, NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/, IMG_RE = /^data:image\/png;base64,[A-Za-z0-9+\/]+={0,2}$/;
// значки приходят с сервера: проверяем каждое поле, чтобы в интерфейс попало только безопасное
const cleanBadges = a => (Array.isArray(a) ? a : []).slice(0, 50).filter(b => b && typeof b.title === 'string' && typeof b.icon === 'string' && typeof b.color === 'string'
  && b.title.length >= 1 && b.title.length <= 24 && !CTRL_RE.test(b.title) && b.icon.length >= 1 && [...b.icon].length <= 8 && !CTRL_RE.test(b.icon) && /^#[0-9a-fA-F]{6}$/.test(b.color))
  .map(b => ({ id: Number(b.id) || 0, title: b.title, icon: b.icon, color: b.color.toLowerCase(), image: IMG_RE.test(b.image) && b.image.length <= 48000 ? b.image : '' })); // картинка — только PNG data-URL
const valid = p => !!p && TOKEN_RE.test(p.token || '') && /^\d{1,8}$/.test(String(p.id)) && NICK_RE.test(String(p.nick || ''));

let hwP = null;
// Хеш ID машины (Windows: MachineGuid). Не меняется при переустановке лаунчера: сервер хранит его хеш и по нему сохраняет бан.
function machineId() {
  if (!hwP) hwP = (async () => {
    let raw = '';
    try {
      if (process.platform === 'win32') raw = await new Promise(r => execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, timeout: 5000 }, (e, out) => r(e ? '' : (String(out).match(/MachineGuid\s+REG_SZ\s+(\S+)/i) || [])[1] || '')));
      else for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { raw = fs.readFileSync(f, 'utf8').trim(); } catch {} if (raw) break; }
    } catch {}
    if (!raw) raw = [os.hostname(), os.userInfo().username, (os.cpus()[0] || {}).model || ''].join('|'); // запасной вариант
    return crypto.createHash('sha256').update('void-hw-v1:' + raw).digest('hex');
  })();
  return hwP;
}

function create(S, persist, fetchFn = fetch, opts = {}) {
  const getHw = opts.hw || machineId, maxOfflineH = opts.maxOfflineH !== undefined ? opts.maxOfflineH : MAX_OFFLINE_H;
  const pubKeyB64 = opts.pubKey !== undefined ? opts.pubKey : PUBKEY;
  const pk = pubKeyB64 ? crypto.createPublicKey({ key: Buffer.from(pubKeyB64, 'base64'), format: 'der', type: 'spki' }) : null;
  const signedOk = (j, nonce) => { // ответ сервера подписан, свежий и для нашего запроса (nonce) — иначе его могли подделать или переиграть
    if (!pk) return true;
    try { const ts = +j.ts; return Number.isFinite(ts) && Math.abs(Date.now() - ts) < 10 * 60e3 && typeof j.sig === 'string'
      && crypto.verify(null, Buffer.from(`void1|${j.id}|${nonce}|${ts}|0`), pk, Buffer.from(j.sig, 'base64')); } catch { return false; }
  };
  // миграция: прошлая версия хранила анонимный ID в S.uid. Токен оставляем — сервер привяжет ник и пароль к тому же ID
  if (!S.profile && S.uid && TOKEN_RE.test(S.uid.token || '')) { S.profile = { token: S.uid.token }; delete S.uid; persist(); }
  else if (S.uid) { delete S.uid; persist(); }

  const pub = () => valid(S.profile)
    ? { registered: true, id: String(S.profile.id), nick: S.profile.nick, since: +S.profile.createdAt || 0, badges: cleanBadges(S.profile.badges), banned: !!S.profile.banned, banReason: String(S.profile.banReason || '').slice(0, 200) }
    : { registered: false, id: null, nick: null, since: 0, badges: [], banned: false, banReason: '' };

  async function call(pathname, body) {
    const nonce = crypto.randomBytes(16).toString('hex'); let hw = null; try { hw = await getHw(); } catch {}
    let r; try { r = await fetchFn(API + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, nonce, ...(hw ? { hw } : {}) }), signal: AbortSignal.timeout(8000) }); } catch { throw new Error('offline'); }
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(String(j.error || 'server')); if (typeof j.reason === 'string') e.reason = j.reason.slice(0, 200); throw e; }
    if (!signedOk(j, nonce)) throw new Error('bad_sig');
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
    if (!/^\d{1,8}$/.test(String(j.id)) || !NICK_RE.test(String(j.nick))) throw new Error('server');
    S.profile = { token, id: +j.id, nick: String(j.nick), createdAt: +j.createdAt || 0, badges: cleanBadges(j.badges), checkedAt: Date.now() }; persist();
    return pub();
  }

  // синхронизация с сервером: админ мог выдать значок или сменить ID. Нет связи — остаются сохранённые данные.
  async function refresh() {
    if (!valid(S.profile)) return pub();
    try {
      const j = await call('/api/me', { token: S.profile.token });
      if (/^\d{1,8}$/.test(String(j.id)) && NICK_RE.test(String(j.nick || ''))) {
        const fresh = S.profile.checkedAt && Date.now() - S.profile.checkedAt < 36e5; // отметку проверки обновляем раз в час, чтобы не писать файл каждый раз
        const next = { token: S.profile.token, id: +j.id, nick: String(j.nick), createdAt: +j.createdAt || S.profile.createdAt || 0, badges: cleanBadges(j.badges), checkedAt: fresh ? S.profile.checkedAt : Date.now() };
        if (JSON.stringify(next) !== JSON.stringify(S.profile)) { S.profile = next; persist(); }
      }
    } catch (e) {
      // сервер сообщил о бане: запоминаем (работает и без связи), при разбане следующая синхронизация снимет метку
      if (e && e.message === 'banned') { S.profile = { ...S.profile, banned: true, banReason: e.reason || '' }; persist(); }
    }
    return pub();
  }

  // можно ли сейчас запускать игру: null — да, иначе 'banned' или 'stale' (давно не было проверки сервером)
  const stale = () => !!pk && maxOfflineH > 0 && !(S.profile && S.profile.checkedAt && Date.now() - S.profile.checkedAt < maxOfflineH * 36e5);
  async function gate() {
    if (!valid(S.profile)) return null; // без профиля лаунчер и так закрыт окном регистрации
    if (S.profile.banned || stale()) await refresh(); // вдруг уже разбанили или связь вернулась
    if (S.profile && S.profile.banned) return 'banned';
    return stale() ? 'stale' : null;
  }

  function logout() { S.profile = null; persist(); return pub(); }
  return { pub, auth, refresh, logout, gate };
}
module.exports = { create, API, valid, machineId };
