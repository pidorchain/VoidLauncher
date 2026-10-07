'use strict';
// Статистика игры: суммарное время и история последних сессий. Без зависимостей от Electron.
const MIN = 15;      // сессии короче 15 секунд — это сбой запуска, а не игра: не считаем
const MAX = 200;     // сколько сессий храним (общее время хранится отдельно и не обрезается)
const DAY = 864e5;

// Приводит данные из launcher.json к нужному виду (старые файлы без статистики и повреждённые записи)
function init(S) {
  S.sessions = (Array.isArray(S.sessions) ? S.sessions : []).filter(x => x && Number.isFinite(x.t) && Number.isFinite(x.d) && x.d > 0).slice(0, MAX);
  S.playSec = Math.max(0, +S.playSec || 0); S.playCount = Math.max(0, Math.floor(+S.playCount || 0));
}

// r = { t0, version, name, server, recorded? }. Возвращает true, если сессия записана. Повторный вызов для той же сессии ничего не делает.
function record(S, r, end) {
  if (r.recorded) return false;
  r.recorded = true;
  const d = Math.round((end - r.t0) / 1000);
  if (!(d >= MIN)) return false;
  S.sessions.unshift({ t: r.t0, d, v: String(r.version || ''), a: String(r.name || ''), s: String(r.server || '') });
  if (S.sessions.length > MAX) S.sessions.length = MAX;
  S.playSec += d; S.playCount++;
  return true;
}

function summary(S, now, n = 8) {
  const from = now - 7 * DAY;
  return {
    totalSec: S.playSec, count: S.playCount,
    weekSec: S.sessions.reduce((a, x) => x.t + x.d * 1000 >= from ? a + x.d : a, 0),
    sessions: S.sessions.slice(0, n)
  };
}

module.exports = { init, record, summary, MIN, MAX };
