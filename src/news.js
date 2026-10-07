'use strict';
// Новости Minecraft: официальная лента Mojang (та же, что показывает оригинальный лаунчер).
// Модуль не зависит от Electron — его можно тестировать обычным Node.
const URL_NEWS = 'https://launchercontent.mojang.com/news.json';
const BASE = 'https://launchercontent.mojang.com/';
const LIMIT = 8;       // сколько новостей показываем
const TEXT_MAX = 200;  // длина краткого описания

const ENT = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&apos;': "'" };
// описание приходит как HTML — оставляем только текст
const plain = s => String(s == null ? '' : s)
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(?:nbsp|lt|gt|quot|apos|#0?39);/g, m => ENT[m])
  .replace(/&amp;/g, '&') // &amp; раскрываем последним, чтобы не получить двойное раскрытие
  .replace(/\s+/g, ' ').trim();
const cut = (s, n) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;

// относительные ссылки на картинки считаются от launchercontent.mojang.com; пропускаем только https
function https(u) {
  try { const x = new URL(String(u || ''), BASE); return x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; }
}

// Ответ ленты → список { id, title, date, text, img, url } для окна лаунчера. Мусор и повреждённые записи отбрасываются.
function normalize(raw, limit = LIMIT) {
  let list = raw && Array.isArray(raw.entries) ? raw.entries.filter(e => e && typeof e === 'object') : [];
  const java = list.filter(e => /java/i.test(String(e.category || '')));
  if (java.length) list = java; // новости других игр (Legends, Dungeons…) нужны, только если про Java ничего нет
  const ts = e => { const t = Date.parse(e.date); return Number.isFinite(t) ? t : 0; };
  return list
    .map(e => ({
      id: String(e.id || e.title || ''), title: plain(e.title).slice(0, 120), date: String(e.date || '').slice(0, 40), t: ts(e),
      text: cut(plain(e.text), TEXT_MAX), img: https((e.newsPageImage || e.playPageImage || {}).url), url: https(e.readMoreLink)
    }))
    .filter(x => x.title)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
    .map(({ t, ...x }) => x);
}

module.exports = { URL_NEWS, BASE, normalize, plain, https };
