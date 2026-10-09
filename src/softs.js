'use strict';
// «Софты»: моды, которые лаунчер берёт из GitHub Releases вашего репозитория и кладёт в папку mods.
// Чтобы добавить ещё один софт — допишите объект в SOFTS (перезапуск лаунчера не нужен только для самих релизов:
// новая версия в репозитории подхватывается сама, jar ищется в последнем релизе по маске asset).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const { Readable } = require('stream'), { pipeline } = require('stream/promises');

const SOFTS = [
  {
    id: 'soft',                                  // латиница/цифры, по нему хранится состояние
    title: 'Snouxe Client',                       // название на карточке
    desc: { ru: 'Клиент для Minecraft', en: 'Client for Minecraft' },
    repo: 'pidorchain/soft',                     // владелец/репозиторий
    asset: /^snouxe-2\.0-recode\.jar$/i,       // какие файлы релиза ставить в mods (подходят ВСЕ, что совпали с маской); остальные файлы релиза игнорируются
    count: 1,                                    // сколько файлов должно быть в релизе; если меньше — релиз считается неполным
    versions: ['1.21.4'],                        // для каких версий Minecraft подходит; null — для любых
    // Проверка ключа перед запуском: { asset: /key.*\.exe$/i } — лаунчер скачает этот файл из релиза, запустит
    // и продолжит, только если он завершится с кодом 0. null — без проверки.
    check: null,
    color: ['#4ade80', '#22d3ee']                // цвета иконки
  }
];

const NAME_OK = /^[\w .+()\-]{1,120}$/;          // без путей и странных символов
const safeName = n => typeof n === 'string' && NAME_OK.test(n) && !n.includes('..') && n !== '.' ? n : '';

// URL файла релиза обязан вести именно в releases/download нашего репозитория
const urlOk = (u, repo) => {
  try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'github.com' && x.pathname.startsWith(`/${repo}/releases/download/`); }
  catch { return false; }
};

// ответ API releases/latest → { tag, name, assets: [{ name, size, url, sha256 }] } (только проверенные записи)
function parseRelease(raw, repo) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.assets)) return null;
  const assets = raw.assets.map(a => {
    const name = safeName(a && a.name), m = /^sha256:([0-9a-f]{64})$/i.exec(String((a && a.digest) || ''));
    return name && a.state !== 'open' && urlOk(a.browser_download_url, repo) && Number.isFinite(+a.size) && +a.size > 0
      ? { name, size: +a.size, url: a.browser_download_url, sha256: m ? m[1].toLowerCase() : '' } : null;
  }).filter(Boolean);
  return { tag: String(raw.tag_name || '').slice(0, 60), name: String(raw.name || raw.tag_name || '').slice(0, 120), assets };
}
const pick = (rel, re) => (rel && rel.assets.find(a => re.test(a.name))) || null;
// все файлы релиза под маску; null, если их меньше need (неполный релиз не ставим — иначе получим половину клиента)
const pickAll = (rel, re, need = 1) => { const l = rel ? rel.assets.filter(a => re.test(a.name)) : []; return l.length >= need ? l : null; };

// Скачивание: во временный .part, проверка размера и SHA-256 (если известна), потом переименование. fetchFn нужен для тестов.
async function download(asset, dest, o = {}) {
  const f = o.fetchFn || fetch, ac = new AbortController(), to = setTimeout(() => ac.abort(), o.timeout || 120000);
  const tmp = dest + '.part'; fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const r = await f(asset.url, { headers: o.headers || {}, signal: ac.signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
    const h = crypto.createHash('sha256'); let got = 0;
    const src = Readable.fromWeb ? Readable.fromWeb(r.body) : r.body;
    src.on('data', c => { h.update(c); got += c.length; if (o.onProgress) o.onProgress(Math.min(100, Math.round(got / asset.size * 100))); });
    await pipeline(src, fs.createWriteStream(tmp));
    if (got !== asset.size) throw new Error('size');
    if (asset.sha256 && h.digest('hex') !== asset.sha256) throw new Error('hash');
    if (o.validate) await o.validate(tmp); // например, убедиться, что это настоящий jar, а не страница с ошибкой
    fs.renameSync(tmp, dest);
    return dest;
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  finally { clearTimeout(to); }
}

// Запуск файла проверки ключа: ждём завершения, успех — только код 0
function runCheck(file, o = {}) {
  return new Promise((res, rej) => {
    let p; try { p = cp.spawn(file, [], { cwd: path.dirname(file), windowsHide: false, stdio: 'ignore', ...(o.spawnOpts || {}) }); } catch (e) { return rej(e); }
    const to = setTimeout(() => { try { p.kill(); } catch {} res(-1); }, o.timeout || 10 * 60 * 1000);
    p.once('error', e => { clearTimeout(to); rej(e); });
    p.once('close', code => { clearTimeout(to); res(code === null ? -1 : code); });
  });
}

module.exports = { SOFTS, safeName, urlOk, parseRelease, pick, pickAll, download, runCheck };
