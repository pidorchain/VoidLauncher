// Скины: проверка PNG, загрузка скина по нику, работа с профилем Microsoft (скин и плащ).
// Модуль без зависимостей от Electron — подключается из main.js.
const UA = { 'User-Agent': 'VoidLauncher/skins' };
const MAX_BYTES = 200 * 1024;

// data:image/png;base64,... → Buffer; проверяем сигнатуру PNG и размер 64×64 (в библиотеке храним только такие)
function parseDataUrl(u) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ''));
  if (!m) throw new Error('type');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new Error('big');
  const d = pngSize(buf);
  if (!d || d.w !== 64 || d.h !== 64) throw new Error('size');
  return buf;
}
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const toDataUrl = buf => 'data:image/png;base64,' + buf.toString('base64');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async url => {
  let r;
  for (let i = 0; i < 3; i++) { // 429/5xx — коротко ждём и пробуем ещё раз
    r = await fetch(url, { headers: UA });
    if (r.status !== 429 && r.status < 500) break;
    await sleep(700 * (i + 1));
  }
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};

// профиль по UUID → { skin: dataURL|null, model, capeUrl }
async function byUuid(id) {
  const p = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
  const prop = p && (p.properties || []).find(x => x.name === 'textures');
  if (!prop) return null;
  const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures || {};
  const out = { name: p.name, model: tex.SKIN && tex.SKIN.metadata && tex.SKIN.metadata.model === 'slim' ? 'slim' : 'classic', skin: null, capeUrl: tex.CAPE ? tex.CAPE.url : '' };
  // sessionserver отдаёт ссылку вида http://textures.minecraft.net/texture/... (http!) — принимаем оба варианта и всегда качаем по https
  const su = tex.SKIN && String(tex.SKIN.url || '');
  if (su && /^https?:\/\/textures\.minecraft\.net\//i.test(su)) {
    const r = await fetch(su.replace(/^http:/i, 'https:'), { headers: UA });
    if (r.ok) out.skin = Buffer.from(await r.arrayBuffer());
  }
  if (out.capeUrl) out.capeUrl = String(out.capeUrl).replace(/^http:/i, 'https:');
  return out;
}
// ник → профиль (только лицензионные ники существуют в Mojang)
async function byName(name) {
  name = String(name || '').trim();
  if (!/^\w{3,16}$/.test(name)) throw new Error('nick');
  const q = encodeURIComponent(name);
  let j = null;
  try { j = await getJson('https://api.minecraftservices.com/minecraft/profile/lookup/name/' + q); } catch {}
  if (!j || !j.id) j = await getJson('https://api.mojang.com/users/profiles/minecraft/' + q);
  if (!j || !j.id) throw new Error('nouser');
  return byUuid(j.id);
}

// ---- API профиля Microsoft (нужен access_token) ----
const MS = 'https://api.minecraftservices.com/minecraft/profile';
const hdr = t => ({ ...UA, Authorization: 'Bearer ' + t });
async function msErrText(r) { try { const j = await r.json(); return j.errorMessage || j.error || ''; } catch { return ''; } }

async function msUpload(token, png, model) {
  const fd = new FormData();
  fd.append('variant', model === 'slim' ? 'slim' : 'classic');
  fd.append('file', new Blob([png], { type: 'image/png' }), 'skin.png');
  const r = await fetch(MS + '/skins', { method: 'POST', headers: hdr(token), body: fd });
  if (!r.ok) { const e = new Error(r.status === 429 ? 'rate' : r.status === 401 ? 'auth' : 'api'); e.detail = await msErrText(r); throw e; }
  return true;
}
async function msProfile(token) {
  const r = await fetch(MS, { headers: hdr(token) });
  if (!r.ok) { const e = new Error(r.status === 401 ? 'auth' : 'api'); throw e; }
  const j = await r.json();
  return { capes: (j.capes || []).map(c => ({ id: c.id, alias: c.alias, active: c.state === 'ACTIVE' })), skins: j.skins || [] };
}
async function msCape(token, capeId) {
  const r = capeId
    ? await fetch(MS + '/capes/active', { method: 'PUT', headers: { ...hdr(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) })
    : await fetch(MS + '/capes/active', { method: 'DELETE', headers: hdr(token) });
  if (!r.ok) { const e = new Error(r.status === 401 ? 'auth' : 'api'); e.detail = await msErrText(r); throw e; }
  return true;
}

module.exports = { parseDataUrl, pngSize, toDataUrl, byUuid, byName, msUpload, msProfile, msCape };
