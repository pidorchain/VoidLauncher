const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { execFile } = require('child_process');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
const javaOk = p => new Promise(r => execFile(p, ['-version'], e => r(!e)));
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const ROOT = path.join(app.getPath('appData'), '.visuals-launcher');
const SF = path.join(ROOT, 'launcher.json');
fs.mkdirSync(ROOT, { recursive: true });

const FLAGS = {
  aikar: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
  light: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+DisableExplicitGC -XX:+PerfDisableSharedMem',
  none: ''
};

const autoRam = Math.min(6144, Math.max(2048, Math.round(os.totalmem() / 1048576 / 2 / 512) * 512));
let S = { accounts: [], active: null, settings: { server: '', ram: autoRam, flags: 'aikar', fab: true, sav: true, java: '', version: '' } };
try { S = { ...S, ...JSON.parse(fs.readFileSync(SF, 'utf8')) }; } catch {}
const persist = () => fs.writeFileSync(SF, JSON.stringify(S, null, 2));
// первый запуск: сразу создаём офлайн-аккаунт по имени пользователя Windows, чтобы можно было играть без настройки
if (!S.accounts.length) {
  let n = ''; try { n = os.userInfo().username.replace(/[^\w]/g, '').slice(0, 16); } catch {}
  const id = crypto.randomUUID(); S.accounts.push({ id, name: n.length >= 3 ? n : 'Player', type: 'offline' }); S.active = id; persist();
}
const pub = () => ({ accounts: S.accounts.map(({ refresh, ...a }) => a), active: S.active, settings: S.settings, totalMem: Math.floor(os.totalmem() / 1048576) });

let win; const running = new Map();
// частые события (прогресс, лог) не чаще раза в 100–150 мс — иначе интерфейс захлёбывается
const THROTTLE = { progress: 100, log: 150 }, tLast = {}, tTimer = {}, tData = {};
const send = (c, d) => {
  if (!win || win.isDestroyed()) return;
  const ms = THROTTLE[c];
  if (!ms) return win.webContents.send(c, d);
  const now = Date.now(); tData[c] = d;
  if (now - (tLast[c] || 0) >= ms) { clearTimeout(tTimer[c]); tTimer[c] = null; tLast[c] = now; win.webContents.send(c, d); }
  else if (!tTimer[c]) tTimer[c] = setTimeout(() => { tTimer[c] = null; tLast[c] = Date.now(); if (win && !win.isDestroyed()) win.webContents.send(c, tData[c]); }, ms - (now - tLast[c]));
};
const sendList = () => send('list', [...running.values()].map(r => ({ pid: r.pid, name: r.name, version: r.version })));

function createWindow() {
  win = new BrowserWindow({ title: 'VoidLauncher', icon: path.join(__dirname, 'src', 'icon.png'), width: 980, height: 520, minWidth: 820, minHeight: 480, frame: false, backgroundColor: '#0b1410',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: true, spellcheck: false } });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('win', (_, a) => a === 'min' ? win.minimize() : win.close());
ipcMain.handle('open', () => shell.openPath(ROOT));
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('ext', (_, u) => /^https:\/\//.test(u) && shell.openExternal(u));
ipcMain.handle('state', () => pub());
ipcMain.handle('save', (_, s) => { S.settings = { ...S.settings, ...s }; persist(); return pub(); });
ipcMain.handle('versions', async () => {
  try {
    const m = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).json();
    return m.versions.filter(v => v.type === 'release').slice(0, 40).map(v => v.id);
  } catch { return ['1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2']; }
});

// ---- accounts ----
ipcMain.handle('addOffline', (_, name) => {
  name = String(name || '').trim().replace(/[^\w]/g, '').slice(0, 16);
  if (name.length < 3) throw new Error('Ник: 3–16 символов (буквы, цифры, _)');
  const id = crypto.randomUUID();
  S.accounts.push({ id, name, type: 'offline' }); S.active = id; persist(); return pub();
});
const msErr = e => {
  const t = String((e && (e.message || e.ts || e.name)) || (typeof e === 'string' ? e : '') || JSON.stringify(e || {}));
  const map = [['closed|cancel', 'Окно входа закрыто — попробуйте ещё раз'], ['userNotFound', 'У этого Microsoft-аккаунта нет профиля Xbox. Создайте его на xbox.com и повторите'],
    ['child', 'Детский аккаунт: родитель должен разрешить игру в семейной группе Microsoft'], ['bannedCountry', 'В вашей стране Xbox Live недоступен'],
    ['profile|entitle', 'На этом аккаунте нет Minecraft Java Edition (игра не куплена)'], ['ENOTFOUND|ETIMEDOUT|network|fetch', 'Нет соединения с серверами Microsoft']];
  for (const [k, v] of map) if (new RegExp(k, 'i').test(t)) return v;
  return 'Не удалось войти в Microsoft: ' + t.slice(0, 140);
};
ipcMain.handle('addMs', async () => {
  try {
    const xbox = await new Auth('select_account').launch('electron');
    const mc = await xbox.getMinecraft();
    if (!mc || !mc.profile || !mc.profile.name) throw new Error('profile');
    const id = mc.profile.id;
    S.accounts = S.accounts.filter(a => a.id !== id);
    S.accounts.push({ id, name: mc.profile.name, type: 'microsoft', refresh: xbox.save() });
    S.active = id; persist(); return pub();
  } catch (e) { console.error('MS login error:', e); throw new Error(msErr(e)); }
});
ipcMain.handle('remove', (_, id) => {
  S.accounts = S.accounts.filter(a => a.id !== id);
  if (S.active === id) S.active = S.accounts[0]?.id || null;
  persist(); return pub();
});
ipcMain.handle('select', (_, id) => { S.active = id; persist(); return pub(); });

async function authFor(acc) {
  if (acc.type === 'offline') return Authenticator.getAuth(acc.name);
  let xbox; try { xbox = await new Auth('select_account').refresh(acc.refresh); } catch { throw new Error('Сессия Microsoft истекла — войдите в аккаунт заново'); }
  acc.refresh = xbox.save(); persist();
  return (await xbox.getMinecraft()).mclc();
}

// ---- Fabric + оптимизирующие моды ----
const dl = async (url, file) => { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(file + '.part', Buffer.from(await r.arrayBuffer())); await fs.promises.rename(file + '.part', file); };
async function ensureFabric(mc, gdir) {
  const lv = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mc}`)).json();
  if (!lv.length) throw new Error('Fabric не поддерживает ' + mc);
  const loader = lv[0].loader.version, id = `fabric-loader-${loader}-${mc}`;
  const f = path.join(ROOT, 'versions', id, id + '.json');
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`)).text()); }
  const md = path.join(gdir, 'mods'), mf = path.join(md, '.managed.json'); let M = {};
  try { M = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
  for (const slug of ['fabric-api', 'sodium', 'lithium', 'ferrite-core']) {
    try {
      const q = `https://api.modrinth.com/v2/project/${slug}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${mc}"]`)}`;
      const v0 = (await (await fetch(q)).json())[0], file = (v0?.files || []).find(x => x.primary) || v0?.files?.[0];
      if (!file) continue;
      const dest = path.join(md, file.filename);
      if (M[slug] && M[slug] !== file.filename) fs.rmSync(path.join(md, M[slug]), { force: true }); // убираем старую версию мода — дубликаты роняют игру
      if (!fs.existsSync(dest)) { send('progress', { pct: 0, text: 'Мод: ' + slug }); await dl(file.url, dest); }
      M[slug] = file.filename;
    } catch {}
  }
  fs.mkdirSync(md, { recursive: true }); fs.writeFileSync(mf, JSON.stringify(M));
  const vj = path.join(ROOT, 'versions', mc, mc + '.jar'), cj = path.join(ROOT, 'versions', id, id + '.jar');
  if (fs.existsSync(vj) && !fs.existsSync(cj)) fs.copyFileSync(vj, cj);
  return id;
}


// ---- авто-установка Java и версий ----
const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
let MAN;
async function javaMajor(v) {
  try {
    MAN = MAN || await (await fetch(MANIFEST)).json();
    const j = await (await fetch(MAN.versions.find(x => x.id === v).url)).json();
    return j.javaVersion?.majorVersion || 8;
  } catch { const m = +v.split('.')[1] || 0, p = +v.split('.')[2] || 0; return m >= 21 || (m === 20 && p >= 5) ? 21 : m >= 17 ? 17 : 8; }
}
async function dlp(url, file, label) {
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = +r.headers.get('content-length') || 0; let got = 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ws = fs.createWriteStream(file);
  for await (const c of r.body) {
    if (!ws.write(c)) await new Promise(res => ws.once('drain', res)); // не копим данные в памяти
    got += c.length; if (total) send('progress', { pct: Math.round(got / total * 100), text: label + ' ' + Math.round(got / 1048576) + ' МБ' });
  }
  await new Promise(res => ws.end(res));
}
function findJava(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const r = findJava(p); if (r) return r; }
    else if (e.name === (process.platform === 'win32' ? 'java.exe' : 'java') && path.basename(d) === 'bin') return p;
  }
  return null;
}
async function ensureJava(major) {
  const dir = path.join(ROOT, 'runtime', 'java-' + major);
  let j = fs.existsSync(dir) && findJava(dir); if (j) return j;
  const osn = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform], ar = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const f = path.join(ROOT, 'runtime', `java-${major}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`);
  try { await dlp(`https://api.adoptium.net/v3/binary/latest/${major}/ga/${osn}/${ar}/jre/hotspot/normal/eclipse`, f, 'Java ' + major); }
  catch { throw new Error('Не удалось скачать Java ' + major + ' — проверьте интернет'); }
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  send('progress', { pct: 100, text: 'Распаковка Java…' });
  try { await new Promise((res, rej) => execFile('tar', ['-xf', f, '-C', dir], e => e ? rej(e) : res())); }
  catch { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('Не удалось распаковать Java'); }
  fs.rmSync(f, { force: true });
  j = findJava(dir); if (!j) throw new Error('Java не найдена после распаковки'); return j;
}
const isInstalled = v => fs.existsSync(path.join(ROOT, 'versions', v, v + '.jar'));
const installing = new Set();
ipcMain.handle('installed', (_, v) => isInstalled(v));
const installVer = async (v, fab) => {
  if (installing.has(v)) return false; installing.add(v);
  try {
    send('progress', { pct: 0, text: 'Подготовка Java…' });
    const jp = S.settings.java || await ensureJava(await javaMajor(v));
    for (let i = 0; i < 3 && !isInstalled(v); i++) { // до 3 попыток при обрыве сети
      const l = new Client();
      l.on('progress', e => send('progress', { pct: e.total ? Math.round(e.task / e.total * 100) : 0, text: `Установка ${v}: ${e.type}` }));
      const proc = await l.launch({ authorization: await Authenticator.getAuth('Installer'), root: ROOT, version: { number: v, type: 'release' },
        memory: { max: '512M', min: '256M' }, javaPath: jp, overrides: { detached: false, gameDirectory: path.join(ROOT, 'instances', '_install') } }).catch(() => null);
      if (proc) proc.kill(); // файлы скачаны — пробный процесс не нужен
    }
    if (!isInstalled(v)) throw new Error('Не удалось установить ' + v + ' — проверьте интернет');
    if (fab) { const g = path.join(ROOT, 'instances', v + '-fabric'); fs.mkdirSync(g, { recursive: true }); send('progress', { pct: 0, text: 'Fabric и моды…' }); try { await ensureFabric(v, g); } catch (e) { send('log', e.message); } }
    send('progress', { pct: 100, text: 'Версия ' + v + ' установлена' });
    return true;
  } finally { installing.delete(v); }
};
ipcMain.handle('install', (_, v, f) => installVer(v, f));


// ---- моды с Modrinth ----
const UA = { 'User-Agent': 'pidorchain/VoidLauncher/1.5.1 (t.me/v0idlauncher)' };
const mrj = async u => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error('Modrinth: ошибка ' + r.status); return r.json(); };
const modDir = v => path.join(ROOT, 'instances', v + '-fabric', 'mods');
const userFile = v => path.join(modDir(v), '.user.json');
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
ipcMain.handle('modsSearch', async (_, q, v) => {
  const facets = [['project_type:mod'], ['categories:fabric'], ['versions:' + v]];
  const url = `https://api.modrinth.com/v2/search?limit=20&index=${q ? 'relevance' : 'downloads'}&query=${encodeURIComponent(q || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  return (await mrj(url)).hits.map(h => ({ id: h.project_id, slug: h.slug, title: h.title, desc: h.description, icon: h.icon_url, dl: h.downloads }));
});
async function putMod(ref, v, U, depth = 0, seen = new Set()) {
  if (seen.has(ref) || depth > 3) return []; seen.add(ref);
  const meta = await mrj('https://api.modrinth.com/v2/project/' + ref);
  if (readJ(path.join(modDir(v), '.managed.json'))[meta.slug]) return []; // уже стоит как авто-мод (Sodium, Fabric API…)
  const vs = await mrj(`https://api.modrinth.com/v2/project/${meta.id}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${v}"]`)}`);
  if (!vs[0]) throw new Error(`${meta.title}: нет версии под ${v}`);
  const file = vs[0].files.find(f => f.primary) || vs[0].files[0], done = [];
  for (const d of vs[0].dependencies || []) if (d.dependency_type === 'required' && d.project_id) done.push(...await putMod(d.project_id, v, U, depth + 1, seen));
  const md = modDir(v); fs.mkdirSync(md, { recursive: true });
  if (U[meta.id]?.file && U[meta.id].file !== file.filename) fs.rmSync(path.join(md, U[meta.id].file), { force: true });
  const dest = path.join(md, file.filename);
  if (!fs.existsSync(dest)) await dl(file.url, dest);
  U[meta.id] = { file: file.filename, title: meta.title, dep: depth > 0 };
  done.push(meta.title); return done;
}
ipcMain.handle('modsInstall', async (_, slug, v) => { const U = readJ(userFile(v)); const done = await putMod(slug, v, U); fs.writeFileSync(userFile(v), JSON.stringify(U)); return done; });
ipcMain.handle('modsList', (_, v) => {
  const U = readJ(userFile(v)), M = readJ(path.join(modDir(v), '.managed.json'));
  return [...Object.entries(M).map(([s, f]) => ({ id: 'auto:' + s, title: s, file: f, auto: true })), ...Object.entries(U).map(([id, x]) => ({ id, title: x.title, file: x.file, dep: x.dep }))];
});
ipcMain.handle('modsRemove', (_, id, v) => { const U = readJ(userFile(v)); if (U[id]) { fs.rmSync(path.join(modDir(v), U[id].file), { force: true }); delete U[id]; fs.writeFileSync(userFile(v), JSON.stringify(U)); } return true; });

// ---- запуск (можно запускать несколько аккаунтов параллельно) ----
const startGame = async (o) => {
  const acc = S.accounts.find(a => a.id === S.active);
  if (!acc) throw new Error('Выберите аккаунт');
  S.settings = { ...S.settings, ...o }; persist();
  const st = S.settings;
  if (installing.has(st.version)) throw new Error('Версия ещё устанавливается');
  if (!isInstalled(st.version)) await installVer(st.version, false);
  const useFab = st.fab && !(S.broken || {})[st.version];
  let jp = st.java;
  if (jp) { if (!await javaOk(jp)) throw new Error('Java по указанному пути не запускается'); }
  else { send('progress', { pct: 0, text: 'Подготовка Java…' }); jp = await ensureJava(await javaMajor(st.version)); }
  const gdir = path.join(ROOT, 'instances', st.version + (useFab ? '-fabric' : '-vanilla'));
  fs.mkdirSync(gdir, { recursive: true });
  const version = { number: st.version, type: 'release' };
  if (useFab) { send('progress', { pct: 0, text: 'Fabric и моды…' }); try { version.custom = await ensureFabric(st.version, gdir); } catch (e) { send('log', e.message); } }
  const l = new Client();
  l.on('progress', e => send('progress', { pct: e.total ? Math.round(e.task / e.total * 100) : 0, text: 'Загрузка: ' + e.type }));
  l.on('debug', m => send('log', String(m).slice(0, 120)));
  l.on('data', m => send('log', String(m).trim().slice(0, 120)));
  const proc = await l.launch({
    authorization: await authFor(acc), root: ROOT, version,
    memory: { max: st.ram + 'M', min: Math.min(st.ram, 2048) + 'M' },
    javaPath: jp, overrides: { gameDirectory: gdir },
    ...(st.server ? { server: { host: st.server.split(':')[0], port: st.server.split(':')[1] || '25565' } } : {}),
    customArgs: FLAGS[st.flags].split(' ').filter(Boolean)
  });
  if (!proc) throw new Error('Не удалось запустить (проверьте установленную Java)');
  running.set(proc.pid, { pid: proc.pid, name: acc.name, version: st.version });
  const t0 = Date.now();
  proc.on('close', code => {
    running.delete(proc.pid); sendList();
    if (code && version.custom && Date.now() - t0 < 25000) { // Fabric упал на старте — автоматически запускаем чистую игру
      (S.broken = S.broken || {})[st.version] = true; persist(); send('log', 'Fabric не запустился — запускаю без модов…');
      startGame({ fab: false }).catch(e => send('log', e.message)); return;
    }
    if (code) send('log', 'Игра закрылась с ошибкой (код ' + code + '). Проверьте моды и Java');
  });
  sendList(); send('progress', { pct: 100, text: 'Игра запущена' });
  return true;
};
ipcMain.handle('launch', (_, o) => startGame(o));

// ---- автообновление лаунчера (GitHub Releases: pidorchain/VoidLauncher) ----
// работает только в установленной версии; portable и запуск из исходников не обновляются
function setupUpdater() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => send('log', 'Найдено обновление лаунчера ' + i.version + ', скачиваю…'));
  autoUpdater.on('update-downloaded', i => {
    send('log', 'Обновление ' + i.version + ' скачано');
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Перезапустить сейчас', 'Позже'], defaultId: 0, cancelId: 1, title: 'VoidLauncher',
      message: 'Доступна новая версия ' + i.version,
      detail: 'Обновление скачано. Перезапустить лаунчер и установить его сейчас? Если выбрать «Позже», оно установится при закрытии.'
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
  });
  autoUpdater.on('error', () => {}); // нет сети или релизов — молча пропускаем
  autoUpdater.checkForUpdates().catch(() => {});
}
app.whenReady().then(() => setTimeout(setupUpdater, 4000));
