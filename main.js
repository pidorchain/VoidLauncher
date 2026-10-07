const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { execFile } = require('child_process');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
const javaOk = p => new Promise(r => execFile(p, ['-version'], e => r(!e)));
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const I18N = require('./src/i18n.js');
const SRV = require('./src/servers.js');
const STATS = require('./src/stats.js');
const NEWS = require('./src/news.js');
const BK = require('./src/backup.js');
const CR = require('./src/crash.js');
const SK = require('./src/skins.js');

const ROOT = path.join(app.getPath('appData'), '.visuals-launcher');
const SF = path.join(ROOT, 'launcher.json');
fs.mkdirSync(ROOT, { recursive: true });

const FLAGS = {
  aikar: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
  light: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+DisableExplicitGC -XX:+PerfDisableSharedMem',
  none: ''
};

const autoRam = Math.min(6144, Math.max(2048, Math.round(os.totalmem() / 1048576 / 2 / 512) * 512));
let S = { accounts: [], active: null, settings: { server: '', ram: autoRam, flags: 'aikar', loader: 'fabric', sav: true, java: '', version: '', lang: '' } };
try { S = { ...S, ...JSON.parse(fs.readFileSync(SF, 'utf8')) }; } catch {}
if (!Array.isArray(S.skinLib)) S.skinLib = []; // библиотека скинов: [{ id, name, model }], файлы в ROOT/skins/<id>.png
if (!S.skinSel || typeof S.skinSel !== 'object') S.skinSel = {}; // выбранный скин по аккаунтам: { accId: skinId }
if (!Array.isArray(S.servers)) S.servers = []; // список серверов: [{ id, name, addr, fav }]
// загрузчики модов: vanilla / fabric / quilt / forge / neoforge; экземпляр = <версия>-<загрузчик>
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'], LDR_RE = /-(vanilla|fabric|quilt|forge|neoforge)$/;
const instOf = (v, l) => v + '-' + l;
if (!LOADERS.includes(S.settings.loader)) S.settings.loader = S.settings.fab === false ? 'vanilla' : 'fabric'; // раньше был переключатель Fabric
for (const k of Object.keys(S.broken || {})) if (!LDR_RE.test(k)) { S.broken[k + '-fabric'] = S.broken[k]; delete S.broken[k]; } // раньше «сломанным» помечалась версия, а не пара версия+загрузчик
STATS.init(S); // статистика: S.sessions, S.playSec, S.playCount
const persist = () => fs.writeFileSync(SF, JSON.stringify(S, null, 2));
// готовые серверы: один раз добавляются в список (потом их можно удалить — повторно не вернутся)
const SRV_PRESETS = [['ReallyWorld', 'mc.reallyworld.ru'], ['FunTime', 'play.funtime.su'], ['AresMine', 'mc.aresmine.me'], ['HolyWorld', 'mc.holyworld.ru']];
const SRV_OLD = { 'play.reallyworld.ru': 'mc.reallyworld.ru', 'mc.aresmine.ru': 'mc.aresmine.me' }; // исправленные адреса
if ((S.srvPreset || 0) < 2) {
  for (const x of S.servers) if (SRV_OLD[x.addr] && !S.servers.some(y => y.addr === SRV_OLD[x.addr])) x.addr = SRV_OLD[x.addr];
  if (!S.srvPreset) for (const [name, addr] of SRV_PRESETS) if (!S.servers.some(x => x.addr === addr)) S.servers.push({ id: crypto.randomUUID(), name, addr, fav: false });
  S.srvPreset = 2; persist();
}
const T = (k, p) => I18N.t(S.settings.lang || 'ru', k, p); // текст на языке интерфейса
// первый запуск: сразу создаём офлайн-аккаунт по имени пользователя Windows, чтобы можно было играть без настройки
if (!S.accounts.length) {
  let n = ''; try { n = os.userInfo().username.replace(/[^\w]/g, '').slice(0, 16); } catch {}
  const id = crypto.randomUUID(); S.accounts.push({ id, name: n.length >= 3 ? n : 'Player', type: 'offline' }); S.active = id; persist();
}
// пользовательский фон: копия выбранного фото лежит в ROOT/background.<ext>
const BG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
const bgFiles = () => { try { return fs.readdirSync(ROOT).filter(f => /^background\./i.test(f)); } catch { return []; } };
const bgUrl = () => { const f = bgFiles()[0]; if (!f) return ''; try { const p = path.join(ROOT, f); return pathToFileURL(p).href + '?t=' + Math.floor(fs.statSync(p).mtimeMs); } catch { return ''; } };
const pub = () => ({ bgUrl: bgUrl(), accounts: S.accounts.map(({ refresh, ...a }) => a), active: S.active, settings: S.settings, totalMem: Math.floor(os.totalmem() / 1048576) });

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: true, spellcheck: false, v8CacheOptions: 'bypassHeatCheck' } });
  win.setMenuBarVisibility(false);
  // полноэкранный режим: сообщаем интерфейсу, чтобы он растянул меню на весь экран
  const sendFull = () => { if (win && !win.isDestroyed()) win.webContents.send('full', win.isFullScreen()); };
  win.on('enter-full-screen', sendFull); win.on('leave-full-screen', sendFull);
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); } });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}
app.whenReady().then(() => { if (!S.settings.lang) S.settings.lang = I18N.detect(app.getLocale()); createWindow(); });
app.on('window-all-closed', () => app.quit());
// лаунчер закрывают во время игры — записываем сыгранное до этого момента, иначе время потеряется
app.on('before-quit', () => { for (const r of running.values()) recordSession(r); });

ipcMain.handle('win', (_, a) => a === 'min' ? win.minimize() : a === 'full' ? win.setFullScreen(!win.isFullScreen()) : a === 'isfull' ? win.isFullScreen() : win.close());
ipcMain.handle('open', () => shell.openPath(ROOT));
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('ext', (_, u) => /^https:\/\//.test(u) && shell.openExternal(u));
ipcMain.handle('state', () => pub());
ipcMain.handle('bgPick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: BG_EXT }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const src = r.filePaths[0], ext = path.extname(src).toLowerCase().slice(1);
    if (!BG_EXT.includes(ext)) return { error: 'type' };
    if (fs.statSync(src).size > 40 * 1048576) return { error: 'big' };
    for (const f of bgFiles()) fs.unlinkSync(path.join(ROOT, f));
    fs.copyFileSync(src, path.join(ROOT, 'background.' + ext));
    return { url: bgUrl() };
  } catch { return { error: 'fail' }; }
});
ipcMain.handle('bgClear', () => { try { for (const f of bgFiles()) fs.unlinkSync(path.join(ROOT, f)); } catch {} return { url: '' }; });
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
  if (name.length < 3) throw new Error(T('m.nick'));
  const id = crypto.randomUUID();
  S.accounts.push({ id, name, type: 'offline' }); S.active = id; persist(); return pub();
});
const msErr = e => {
  const t = String((e && (e.message || e.ts || e.name)) || (typeof e === 'string' ? e : '') || JSON.stringify(e || {}));
  const map = [['closed|cancel', 'm.ms.closed'], ['userNotFound', 'm.ms.noxbox'], ['child', 'm.ms.child'], ['bannedCountry', 'm.ms.country'],
    ['profile|entitle', 'm.ms.nogame'], ['ENOTFOUND|ETIMEDOUT|network|fetch', 'm.ms.net']];
  for (const [k, v] of map) if (new RegExp(k, 'i').test(t)) return T(v);
  return T('m.ms.other', { t: t.slice(0, 140) });
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
  S.accounts = S.accounts.filter(a => a.id !== id); delete S.skinSel[id];
  if (S.active === id) S.active = S.accounts[0]?.id || null;
  persist(); return pub();
});
ipcMain.handle('select', (_, id) => { S.active = id; persist(); return pub(); });

async function authFor(acc) {
  if (acc.type === 'offline') return Authenticator.getAuth(acc.name);
  let xbox; try { xbox = await new Auth('select_account').refresh(acc.refresh); } catch { throw new Error(T('m.ms.expired')); }
  acc.refresh = xbox.save(); persist();
  return (await xbox.getMinecraft()).mclc();
}

// ---- скины: библиотека, загрузка на аккаунт Microsoft, локальный скин для офлайна ----
const SKIN_DIR = path.join(ROOT, 'skins'), skFile = id => path.join(SKIN_DIR, id + '.png');
const skInLib = id => S.skinLib.find(x => x.id === id);
const skOut = x => { let data = ''; try { data = SK.toDataUrl(fs.readFileSync(skFile(x.id))); } catch {} return { id: x.id, name: x.name, model: x.model, data }; };
const skActive = () => S.accounts.find(a => a.id === S.active);
const skErr = e => { // понятное сообщение вместо кода
  const c = String((e && e.message) || e), map = { type: 'm.sk.type', big: 'm.sk.big', size: 'm.sk.size', nick: 'm.nick', nouser: 'm.sk.nouser', rate: 'm.sk.rate', auth: 'm.ms.expired', msonly: 'm.sk.msonly', noacc: 'm.noacc', many: 'm.sk.many' };
  if (map[c]) return new Error(T(map[c]));
  if (/ENOTFOUND|ETIMEDOUT|network|fetch|ECONN/i.test(c)) return new Error(T('m.ms.net'));
  return new Error(T('m.sk.fail', { e: (e && e.detail) || c.slice(0, 100) }));
};
async function msToken(acc) { // свежий access_token Microsoft-аккаунта
  let xbox; try { xbox = await new Auth('select_account').refresh(acc.refresh); } catch { throw new Error('auth'); }
  acc.refresh = xbox.save(); persist();
  const t = (await xbox.getMinecraft()).mclc().access_token;
  if (!t) throw new Error('auth'); return t;
}
ipcMain.handle('skState', () => ({ lib: S.skinLib.map(skOut), sel: S.skinSel }));
ipcMain.handle('skSave', (_, o) => {
  try {
    o = o || {}; SK.parseDataUrl(o.data);
    const name = String(o.name || '').trim().replace(/[<>]/g, '').slice(0, 24) || 'Skin', model = o.model === 'slim' ? 'slim' : 'classic';
    let x = o.id && skInLib(o.id);
    if (!x) { if (S.skinLib.length >= 60) throw new Error('many'); x = { id: crypto.randomUUID() }; S.skinLib.push(x); }
    x.name = name; x.model = model;
    fs.mkdirSync(SKIN_DIR, { recursive: true }); fs.writeFileSync(skFile(x.id), SK.parseDataUrl(o.data)); persist();
    return { id: x.id, lib: S.skinLib.map(skOut) };
  } catch (e) { throw skErr(e); }
});
ipcMain.handle('skDel', (_, id) => {
  S.skinLib = S.skinLib.filter(x => x.id !== id); for (const k of Object.keys(S.skinSel)) if (S.skinSel[k] === id) delete S.skinSel[k];
  try { fs.rmSync(skFile(id), { force: true }); } catch {} persist();
  return { lib: S.skinLib.map(skOut), sel: S.skinSel };
});
ipcMain.handle('skPick', async () => { // PNG с диска: 64×64 или старый формат 64×32 (его в редакторе дорисуем до 64×64)
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    if (fs.statSync(r.filePaths[0]).size > 2 * 1048576) return { error: T('m.sk.big') };
    const buf = fs.readFileSync(r.filePaths[0]), d = SK.pngSize(buf);
    if (!d) return { error: T('m.sk.type') };
    if (d.w !== 64 || (d.h !== 64 && d.h !== 32)) return { error: T('m.sk.size') };
    return { data: SK.toDataUrl(buf), name: path.basename(r.filePaths[0], path.extname(r.filePaths[0])).slice(0, 24) };
  } catch { return { error: T('m.sk.type') }; }
});
ipcMain.handle('skFetch', async (_, nick) => {
  try {
    const p = await SK.byName(nick); if (!p || !p.skin) throw new Error('nouser');
    return { data: SK.toDataUrl(p.skin), model: p.model, name: p.name };
  } catch (e) { throw skErr(e); }
});
ipcMain.handle('skCurrent', async () => { // текущий скин активного Microsoft-аккаунта
  try {
    const acc = skActive(); if (!acc || acc.type !== 'microsoft') throw new Error('msonly');
    const p = await SK.byUuid(acc.id); if (!p || !p.skin) throw new Error('nouser');
    return { data: SK.toDataUrl(p.skin), model: p.model, name: acc.name };
  } catch (e) { throw skErr(e); }
});
ipcMain.handle('skExport', async (_, id) => {
  const x = skInLib(id); if (!x) return false;
  const r = await dialog.showSaveDialog(win, { defaultPath: x.name.replace(/[\\/:*?"<>|]/g, '_') + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.copyFileSync(skFile(id), r.filePath); return true;
});
ipcMain.handle('skApply', async (_, id) => {
  try {
    const x = skInLib(id), acc = skActive(); if (!x) throw new Error('type'); if (!acc) throw new Error('noacc');
    if (acc.type === 'microsoft') { await SK.msUpload(await msToken(acc), fs.readFileSync(skFile(id)), x.model); S.skinSel[acc.id] = id; persist(); return { mode: 'ms', sel: S.skinSel }; }
    S.skinSel[acc.id] = id; persist(); return { mode: 'offline', sel: S.skinSel }; // офлайн: скин подставится при запуске (см. applyOfflineSkin)
  } catch (e) { throw skErr(e); }
});
ipcMain.handle('skProfile', async () => { // плащи аккаунта Microsoft
  try { const acc = skActive(); if (!acc || acc.type !== 'microsoft') return { capes: [] }; return await SK.msProfile(await msToken(acc)); }
  catch (e) { throw skErr(e); }
});
ipcMain.handle('skCape', async (_, capeId) => {
  try { const acc = skActive(); if (!acc || acc.type !== 'microsoft') throw new Error('msonly'); await SK.msCape(await msToken(acc), capeId || null); return true; }
  catch (e) { throw skErr(e); }
});

// ---- загрузчики модов (Fabric, Quilt, Forge, NeoForge) + оптимизирующие моды ----
const dl = async (url, file) => { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(file + '.part', Buffer.from(await r.arrayBuffer())); await fs.promises.rename(file + '.part', file); };
const LNAME = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const META = { fabric: 'https://meta.fabricmc.net/v2', quilt: 'https://meta.quiltmc.org/v3' }; // Fabric и Quilt: готовый профиль версии отдаёт API
// авто-моды для FPS: проекты на Modrinth и подходящие загрузчики (Quilt запускает и Fabric-моды; вместо Fabric API на Quilt ставится Quilted Fabric API)
const AUTO = {
  fabric: { slugs: ['fabric-api', 'sodium', 'lithium', 'ferrite-core'], ml: ['fabric'] },
  quilt: { slugs: ['quilted-fabric-api', 'sodium', 'lithium', 'ferrite-core'], ml: ['quilt', 'fabric'] },
  neoforge: { slugs: ['sodium', 'lithium', 'ferrite-core'], ml: ['neoforge'] },
  forge: { slugs: ['embeddium', 'ferrite-core'], ml: ['forge'] }
};
const mlQ = (ml, mc) => `loaders=${encodeURIComponent(JSON.stringify(ml))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
const verJson = id => path.join(ROOT, 'versions', id, id + '.json');
async function ensureAuto(loader, mc, gdir) {
  const md = path.join(gdir, 'mods'), mf = path.join(md, '.managed.json'); let M = {};
  try { M = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
  for (const slug of AUTO[loader].slugs) {
    try {
      const v0 = (await (await fetch(`https://api.modrinth.com/v2/project/${slug}/version?${mlQ(AUTO[loader].ml, mc)}`, { headers: UA })).json())[0], file = (v0?.files || []).find(x => x.primary) || v0?.files?.[0];
      if (!file) continue;
      const dest = path.join(md, file.filename);
      if (M[slug] && M[slug] !== file.filename) fs.rmSync(path.join(md, M[slug]), { force: true }); // убираем старую версию мода — дубликаты роняют игру
      if (!fs.existsSync(dest)) { send('progress', { pct: 0, text: T('m.mod', { slug }) }); await dl(file.url, dest); }
      M[slug] = file.filename;
    } catch {}
  }
  fs.mkdirSync(md, { recursive: true }); fs.writeFileSync(mf, JSON.stringify(M));
}
// NeoForge нумерует сборки по версии игры: 1.21.1 → 21.1.x, 1.21 → 21.0.x, а с Minecraft 26.1 → 26.1.0.x
async function neoVersion(mc) {
  const p = mc.split('.').map(Number); let prefix = null;
  if (p[0] >= 26) prefix = `${p[0]}.${p[1] || 0}.${p.length > 2 ? p[2] : 0}.`;
  else if (p[0] === 1 && (p[1] > 20 || (p[1] === 20 && (p[2] || 0) >= 2))) prefix = `${p[1]}.${p[2] || 0}.`; // на 1.20.1 NeoForge не ставим: там лучше Forge
  const bad = () => new Error(T('m.ldr.unsup', { mc, l: 'NeoForge' }));
  if (!prefix) throw bad();
  const all = (await (await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).json()).versions || [];
  let c = all.filter(v => v.startsWith(prefix) && !/alpha|snapshot/i.test(v));
  const st = c.filter(v => !v.includes('-')); if (st.length) c = st; // стабильные сборки важнее beta
  if (!c.length) throw bad();
  const key = v => v.split(/[.-]/).map(x => /^\d+$/.test(x) ? +x : 0);
  c.sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; });
  return c[0];
}
const runInstaller = (jp, jar, name) => new Promise((res, rej) => execFile(jp, ['-jar', jar, '--installClient', ROOT],
  { cwd: ROOT, maxBuffer: 64 * 1048576, timeout: 15 * 60 * 1000, windowsHide: true }, (e, so, se) => {
    if (!e) return res();
    const tail = String(se || so || e.message || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(-2).join(' ');
    rej(new Error(T('m.ldr.instfail', { l: name, e: tail.slice(0, 220) })));
  }));
// Forge и NeoForge ставятся официальным установщиком: он кладёт профиль в versions/ и библиотеки в libraries/
async function installForgeLike(loader, mc, jp) {
  const vdir = path.join(ROOT, 'versions'), ls = () => { try { return fs.readdirSync(vdir); } catch { return []; } };
  let tag, url, expect;
  if (loader === 'forge') {
    const pr = (await (await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).json()).promos || {};
    tag = pr[`${mc}-recommended`] || pr[`${mc}-latest`];
    if (!tag) throw new Error(T('m.ldr.unsup', { mc, l: 'Forge' }));
    expect = `${mc}-forge-${tag}`; url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${tag}/forge-${mc}-${tag}-installer.jar`;
  } else {
    tag = await neoVersion(mc);
    expect = `neoforge-${tag}`; url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${tag}/neoforge-${tag}-installer.jar`;
  }
  const find = () => ls().find(d => d === expect && fs.existsSync(verJson(d))) || ls().find(d => /forge/i.test(d) && d.includes(tag) && fs.existsSync(verJson(d)));
  let id = find(); if (id) return id;
  const name = LNAME[loader], jar = path.join(ROOT, 'installers', `${loader}-${tag}-installer.jar`);
  try {
    if (!fs.existsSync(jar)) { send('progress', { pct: 0, text: T('m.ldr.dl', { l: name }) }); await dl(url, jar); }
    const lp = path.join(ROOT, 'launcher_profiles.json'); // установщик требует этот файл в целевой папке
    if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {}, settings: {}, version: 3 }));
    send('progress', { pct: 0, text: T('m.ldr.inst', { l: name }) });
    await runInstaller(jp, jar, name);
  } catch (e) { fs.rmSync(jar, { force: true }); throw e; } // возможно, скачался битый файл — в следующий раз возьмём заново
  id = find(); if (!id) throw new Error(T('m.ldr.instfail', { l: name, e: '' }));
  return id;
}
// в профиле Forge/NeoForge остаются плейсхолдеры, которых minecraft-launcher-core может не знать, — подставляем сами (оригинал хранится рядом как .orig)
function patchProfile(id) {
  const f = verJson(id), orig = f + '.orig';
  if (!fs.existsSync(orig)) fs.copyFileSync(f, orig);
  const lib = path.join(ROOT, 'libraries').replace(/\\/g, '/');
  fs.writeFileSync(f, fs.readFileSync(orig, 'utf8').split('${library_directory}').join(lib).split('${classpath_separator}').join(path.delimiter).split('${version_name}').join(id));
}
// офлайн-аккаунт: скин показывается через мод CustomSkinLoader (локальный скин по нику). Работает с Fabric/Quilt/Forge/NeoForge
async function applyOfflineSkin(acc, loader, mc, gdir) {
  const id = S.skinSel[acc.id], x = id && skInLib(id);
  if (acc.type !== 'offline' || !x || !fs.existsSync(skFile(id))) return;
  if (loader === 'vanilla') { send('log', T('m.sk.vanilla')); return; }
  const md = path.join(gdir, 'mods'), mf = path.join(md, '.managed.json'); let M = {};
  try { M = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
  try {
    const v0 = (await (await fetch(`https://api.modrinth.com/v2/project/customskinloader/version?${mlQ(AUTO[loader].ml, mc)}`, { headers: UA })).json())[0], file = (v0?.files || []).find(f => f.primary) || v0?.files?.[0];
    if (file) {
      const dest = path.join(md, file.filename);
      if (M.customskinloader && M.customskinloader !== file.filename) fs.rmSync(path.join(md, M.customskinloader), { force: true });
      if (!fs.existsSync(dest)) { send('progress', { pct: 0, text: T('m.mod', { slug: 'customskinloader' }) }); await dl(file.url, dest); }
      M.customskinloader = file.filename; fs.mkdirSync(md, { recursive: true }); fs.writeFileSync(mf, JSON.stringify(M));
    } else send('log', T('m.sk.nomod', { mc }));
  } catch (e) { send('log', T('m.sk.nomod', { mc })); }
  const sd = path.join(gdir, 'CustomSkinLoader', 'LocalSkin', 'skins'); fs.mkdirSync(sd, { recursive: true });
  fs.copyFileSync(skFile(id), path.join(sd, acc.name + '.png'));
}
async function ensureLoader(loader, mc, gdir, jp) {
  if (!AUTO[loader]) return null;
  S.ldrIds = S.ldrIds || {};
  const key = loader + ':' + mc, have = id => id && fs.existsSync(verJson(id));
  let id;
  if (META[loader]) {
    try {
      const lv = await (await fetch(`${META[loader]}/versions/loader/${mc}`)).json();
      if (!Array.isArray(lv) || !lv.length) throw new Error(T('m.ldr.unsup', { mc, l: LNAME[loader] }));
      const lver = lv[0].loader.version; id = `${loader}-loader-${lver}-${mc}`;
      if (!have(id)) { fs.mkdirSync(path.dirname(verJson(id)), { recursive: true }); fs.writeFileSync(verJson(id), await (await fetch(`${META[loader]}/versions/loader/${mc}/${lver}/profile/json`)).text()); }
    } catch (e) { if (have(S.ldrIds[key])) id = S.ldrIds[key]; else throw e; } // нет сети — берём уже установленный профиль
  } else {
    id = S.ldrIds[key]; if (!have(id)) id = await installForgeLike(loader, mc, jp);
    patchProfile(id);
  }
  if (S.ldrIds[key] !== id) { S.ldrIds[key] = id; persist(); }
  try { await ensureAuto(loader, mc, gdir); } catch {}
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
    got += c.length; if (total) send('progress', { pct: Math.round(got / total * 100), text: T('m.java.mb', { major: label, n: Math.round(got / 1048576) }) });
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
  try { await dlp(`https://api.adoptium.net/v3/binary/latest/${major}/ga/${osn}/${ar}/jre/hotspot/normal/eclipse`, f, major); }
  catch { throw new Error(T('m.java.dl', { major })); }
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  send('progress', { pct: 100, text: T('m.java.unpack') });
  try { await new Promise((res, rej) => execFile('tar', ['-xf', f, '-C', dir], e => e ? rej(e) : res())); }
  catch { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(T('m.java.unpackErr')); }
  fs.rmSync(f, { force: true });
  j = findJava(dir); if (!j) throw new Error(T('m.java.nf')); return j;
}
const isInstalled = v => fs.existsSync(path.join(ROOT, 'versions', v, v + '.jar'));
const installing = new Set();
ipcMain.handle('installed', (_, v) => isInstalled(v));
const installVer = async (v, loader = 'vanilla') => {
  if (installing.has(v)) return false; installing.add(v);
  try {
    send('progress', { pct: 0, text: T('m.java.prep') });
    const jp = S.settings.java || await ensureJava(await javaMajor(v));
    for (let i = 0; i < 3 && !isInstalled(v); i++) { // до 3 попыток при обрыве сети
      const l = new Client();
      l.on('progress', e => send('progress', { pct: e.total ? Math.round(e.task / e.total * 100) : 0, text: T('m.inst.p', { v, type: e.type }) }));
      const proc = await l.launch({ authorization: await Authenticator.getAuth('Installer'), root: ROOT, version: { number: v, type: 'release' },
        memory: { max: '512M', min: '256M' }, javaPath: jp, overrides: { detached: false, gameDirectory: path.join(ROOT, 'instances', '_install') } }).catch(() => null);
      if (proc) proc.kill(); // файлы скачаны — пробный процесс не нужен
    }
    if (!isInstalled(v)) throw new Error(T('m.inst.fail', { v }));
    if (loader !== 'vanilla') { const g = path.join(ROOT, 'instances', instOf(v, loader)); fs.mkdirSync(g, { recursive: true }); send('progress', { pct: 0, text: T('m.ldr.p', { l: LNAME[loader] }) }); try { await ensureLoader(loader, v, g, jp); } catch (e) { send('log', e.message); } }
    send('progress', { pct: 100, text: T('m.inst.done', { v }) });
    return true;
  } finally { installing.delete(v); }
};
ipcMain.handle('install', (_, v, l) => installVer(v, LOADERS.includes(l) ? l : 'vanilla'));


// ---- моды с Modrinth ----
const UA = { 'User-Agent': `pidorchain/VoidLauncher/${app.getVersion()} (t.me/v0idlauncher)` };
const mrj = async u => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(T('m.mr.err', { s: r.status })); return r.json(); };
const modDir = (v, l) => path.join(ROOT, 'instances', instOf(v, l), 'mods');
const userFile = (v, l) => path.join(modDir(v, l), '.user.json');
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const modL = l => AUTO[l] ? l : 'fabric'; // при профиле «Обычный» вкладка «Моды» работает с Fabric, как раньше
// шейдеры и ресурспаки: те же поиск/установка/список/удаление, но файлы идут в shaderpacks / resourcepacks экземпляра
const PACKS = { shader: 'shaderpacks', resourcepack: 'resourcepacks' };
const isPack = t => Object.prototype.hasOwnProperty.call(PACKS, t);
// шейдерам нужен Iris (мод), поэтому они лежат рядом с модами (Fabric при профиле «Обычный»); ресурспаки работают и на чистой игре
const packInst = (t, v, l) => instOf(v, t === 'shader' ? modL(l) : (LOADERS.includes(l) ? l : 'vanilla'));
const packDir = (t, v, l) => path.join(ROOT, 'instances', packInst(t, v, l), PACKS[t]);
const packFile = (t, v, l) => path.join(ROOT, 'instances', packInst(t, v, l), '.user-' + PACKS[t] + '.json');
ipcMain.handle('modsSearch', async (_, q, v, l, t) => {
  const facets = isPack(t) ? [['project_type:' + t], ['versions:' + v]] : [['project_type:mod'], AUTO[modL(l)].ml.map(x => 'categories:' + x), ['versions:' + v]];
  const url = `https://api.modrinth.com/v2/search?limit=20&index=${q ? 'relevance' : 'downloads'}&query=${encodeURIComponent(q || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  return (await mrj(url)).hits.map(h => ({ id: h.project_id, slug: h.slug, title: h.title, desc: h.description, icon: h.icon_url, dl: h.downloads }));
});
async function putMod(ref, v, U, L, depth = 0, seen = new Set()) {
  if (seen.has(ref) || depth > 3) return []; seen.add(ref);
  const meta = await mrj('https://api.modrinth.com/v2/project/' + ref);
  if (L === 'quilt' && meta.slug === 'fabric-api') return putMod('quilted-fabric-api', v, U, L, depth, seen); // на Quilt вместо Fabric API нужен Quilted Fabric API
  if (readJ(path.join(modDir(v, L), '.managed.json'))[meta.slug]) return []; // уже стоит как авто-мод (Sodium, Fabric API…)
  const vs = await mrj(`https://api.modrinth.com/v2/project/${meta.id}/version?${mlQ(AUTO[L].ml, v)}`);
  if (!vs[0]) throw new Error(T('m.mr.nover', { title: meta.title, v }));
  const file = vs[0].files.find(f => f.primary) || vs[0].files[0], done = [];
  for (const d of vs[0].dependencies || []) if (d.dependency_type === 'required' && d.project_id) done.push(...await putMod(d.project_id, v, U, L, depth + 1, seen));
  const md = modDir(v, L); fs.mkdirSync(md, { recursive: true });
  if (U[meta.id]?.file && U[meta.id].file !== file.filename) fs.rmSync(path.join(md, U[meta.id].file), { force: true });
  const dest = path.join(md, file.filename);
  if (!fs.existsSync(dest)) await dl(file.url, dest);
  U[meta.id] = { file: file.filename, title: meta.title, dep: depth > 0 };
  done.push(meta.title); return done;
}
async function putPack(t, ref, v, l) {
  const meta = await mrj('https://api.modrinth.com/v2/project/' + ref);
  const vs = await mrj(`https://api.modrinth.com/v2/project/${meta.id}/version?game_versions=${encodeURIComponent(JSON.stringify([v]))}`); // у паков нет загрузчика — достаточно версии игры
  const ver = vs.find(x => x.version_type === 'release') || vs[0];
  if (!ver) throw new Error(T('m.mr.nover', { title: meta.title, v }));
  const file = ver.files.find(f => f.primary) || ver.files[0], name = path.basename(file.filename), dir = packDir(t, v, l), F = packFile(t, v, l), U = readJ(F);
  fs.mkdirSync(dir, { recursive: true });
  if (U[meta.id]?.file && U[meta.id].file !== name) fs.rmSync(path.join(dir, U[meta.id].file), { force: true });
  const dest = path.join(dir, name);
  if (!fs.existsSync(dest)) await dl(file.url, dest);
  U[meta.id] = { file: name, title: meta.title };
  fs.writeFileSync(F, JSON.stringify(U));
  const done = [meta.title];
  if (t === 'shader') { // без Iris (на Forge — Oculus) шейдеры не включатся, поэтому ставим его сами
    try {
      const L = modL(l), MU = readJ(userFile(v, L));
      if (!Object.values(MU).some(x => /iris|oculus/i.test(x.title || ''))) {
        const r = await putMod(L === 'forge' ? 'oculus' : 'iris', v, MU, L);
        fs.mkdirSync(modDir(v, L), { recursive: true }); fs.writeFileSync(userFile(v, L), JSON.stringify(MU)); done.push(...r);
      }
    } catch (e) { send('log', e.message); }
  }
  return done;
}
ipcMain.handle('modsInstall', async (_, slug, v, l, t) => {
  if (isPack(t)) return putPack(t, slug, v, l);
  l = modL(l); const U = readJ(userFile(v, l)); const done = await putMod(slug, v, U, l); fs.mkdirSync(modDir(v, l), { recursive: true }); fs.writeFileSync(userFile(v, l), JSON.stringify(U)); return done;
});
ipcMain.handle('modsList', (_, v, l, t) => {
  if (isPack(t)) return Object.entries(readJ(packFile(t, v, l))).map(([id, x]) => ({ id, title: x.title, file: x.file }));
  l = modL(l);
  const U = readJ(userFile(v, l)), M = readJ(path.join(modDir(v, l), '.managed.json'));
  return [...Object.entries(M).map(([s, f]) => ({ id: 'auto:' + s, title: s, file: f, auto: true })), ...Object.entries(U).map(([id, x]) => ({ id, title: x.title, file: x.file, dep: x.dep }))];
});
ipcMain.handle('modsRemove', (_, id, v, l, t) => {
  if (isPack(t)) { const F = packFile(t, v, l), U = readJ(F); if (U[id]) { fs.rmSync(path.join(packDir(t, v, l), path.basename(U[id].file)), { recursive: true, force: true }); delete U[id]; fs.writeFileSync(F, JSON.stringify(U)); } return true; }
  l = modL(l); const U = readJ(userFile(v, l)); if (U[id]) { fs.rmSync(path.join(modDir(v, l), U[id].file), { force: true }); delete U[id]; fs.writeFileSync(userFile(v, l), JSON.stringify(U)); } return true;
});

// ---- запуск (можно запускать несколько аккаунтов параллельно) ----
const startGame = async (o = {}) => {
  const { join, ...opts } = o; // join — адрес сервера из списка: заходим один раз, настройку «Автовход» не трогаем
  const acc = S.accounts.find(a => a.id === S.active);
  if (!acc) throw new Error(T('m.noacc'));
  S.settings = { ...S.settings, ...opts }; persist();
  const st = S.settings;
  let srv = st.server;
  if (join) { const h = SRV.parseAddr(join); if (!h) throw new Error(T('m.srv.addr')); srv = SRV.fmtAddr(h); }
  if (installing.has(st.version)) throw new Error(T('m.installing'));
  if (!isInstalled(st.version)) await installVer(st.version);
  const want = LOADERS.includes(st.loader) ? st.loader : 'vanilla', loader = (S.broken || {})[instOf(st.version, want)] ? 'vanilla' : want; // загрузчик, который падал на старте, пропускаем
  let jp = st.java;
  if (jp) { if (!await javaOk(jp)) throw new Error(T('m.java.bad')); }
  else { send('progress', { pct: 0, text: T('m.java.prep') }); jp = await ensureJava(await javaMajor(st.version)); }
  const gdir = path.join(ROOT, 'instances', instOf(st.version, loader));
  fs.mkdirSync(gdir, { recursive: true });
  if (bkAuto()) { // автобэкап: копируем только миры этого экземпляра, изменившиеся с прошлой копии; сбой не мешает запуску
    send('progress', { pct: 0, text: T('m.bk.p') });
    try { await bkLock(async () => bkRun(await BK_WORLDS_OF(path.basename(gdir)), { kind: 'auto', skipUnchanged: true, keep: bkKeep() })); }
    catch (e) { send('log', bkErr(e).message); }
  }
  const version = { number: st.version, type: 'release' };
  if (loader !== 'vanilla') { send('progress', { pct: 0, text: T('m.ldr.p', { l: LNAME[loader] }) }); try { version.custom = await ensureLoader(loader, st.version, gdir, jp); } catch (e) { send('log', e.message); } }
  try { await applyOfflineSkin(acc, loader, st.version, gdir); } catch (e) { send('log', e.message); }
  const l = new Client();
  l.on('progress', e => send('progress', { pct: e.total ? Math.round(e.task / e.total * 100) : 0, text: T('m.dl', { type: e.type }) }));
  l.on('debug', m => send('log', String(m).slice(0, 120)));
  const tail = []; // последние строки вывода игры: по ним разбираем вылет, если crash-report не создан (например, ошибка загрузки модов Fabric)
  l.on('data', m => {
    const x = String(m); send('log', x.trim().slice(0, 120));
    for (const ln of x.split(/\r?\n/)) if (ln) { tail.push(ln.slice(0, 400)); if (tail.length > 400) tail.shift(); }
  });
  const proc = await l.launch({
    authorization: await authFor(acc), root: ROOT, version,
    memory: { max: st.ram + 'M', min: Math.min(st.ram, 2048) + 'M' },
    javaPath: jp, overrides: { gameDirectory: gdir },
    ...(srv ? { server: { host: srv.split(':')[0], port: srv.split(':')[1] || '25565' } } : {}),
    customArgs: FLAGS[st.flags].split(' ').filter(Boolean)
  });
  if (!proc) throw new Error(T('m.launch.fail'));
  const t0 = Date.now(), entry = { pid: proc.pid, name: acc.name, version: st.version, server: srv || '', t0, tail };
  running.set(proc.pid, entry);
  proc.on('close', code => {
    running.delete(proc.pid); sendList();
    const early = code && version.custom && Date.now() - t0 < 25000; // загрузчик упал на старте — это не игровая сессия
    if (early) entry.recorded = true; else recordSession(entry);
    if (code) crAuto(entry, code, gdir, early); // разбор вылета: придёт событие 'crash'
    if (early) { // загрузчик упал на старте — автоматически запускаем чистую игру
      (S.broken = S.broken || {})[instOf(st.version, loader)] = true; persist(); send('log', T('m.ldr.crash', { l: LNAME[loader] }));
      startGame({ loader: 'vanilla', join }).catch(e => send('log', e.message)); return;
    }
    if (code) send('log', T('m.game.err', { code }));
  });
  sendList(); send('progress', { pct: 100, text: T('m.running') });
  return true;
};
ipcMain.handle('launch', (_, o) => startGame(o));

// ---- статистика игры ----
const recordSession = r => { if (STATS.record(S, r, Date.now())) { persist(); send('stats', STATS.summary(S, Date.now())); } };
ipcMain.handle('stats', () => STATS.summary(S, Date.now()));

// ---- новости Minecraft (лента Mojang; последний удачный ответ кэшируется на диск для работы без сети) ----
const NEWS_FILE = path.join(ROOT, 'news-cache.json');
let newsMem = null; // { t, raw }
ipcMain.handle('news', async (_, force) => {
  if (!force && newsMem && Date.now() - newsMem.t < 10 * 60 * 1000) return { ok: true, items: NEWS.normalize(newsMem.raw) };
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(NEWS.URL_NEWS, { headers: { 'User-Agent': 'pidorchain/VoidLauncher (t.me/v0idlauncher)' }, signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const raw = await r.json(), items = NEWS.normalize(raw);
    if (!items.length) throw new Error('empty');
    newsMem = { t: Date.now(), raw };
    fs.writeFile(NEWS_FILE, JSON.stringify(raw), () => {});
    return { ok: true, items };
  } catch {
    let raw = newsMem && newsMem.raw;
    if (!raw) try { raw = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')); } catch {}
    const items = raw ? NEWS.normalize(raw) : [];
    return items.length ? { ok: true, stale: true, items } : { ok: false, items: [] };
  } finally { clearTimeout(to); }
});

// ---- бэкапы миров ----
const BK_DIR = path.join(ROOT, 'backups'), INST_DIR = path.join(ROOT, 'instances');
const BK_WORLDS_OF = inst => BK.listWorlds(INST_DIR, inst);
const bkAuto = () => S.settings.bkAuto !== false;
const bkKeep = () => Math.min(50, Math.max(1, Math.floor(+S.settings.bkKeep) || 5));
let bkChain = Promise.resolve(); // копии идут по одной: ручная и автоматическая не наступают друг на друга
const bkLock = f => { const p = bkChain.then(f); bkChain = p.catch(() => {}); return p; };
const bkErr = e => new Error(T('m.bk.err', { e: String((e && e.message) || e).slice(0, 90) }));
const bkRun = async (worlds, o) => { let made = 0; for (const w of worlds) if ((await BK.backupWorld(BK_DIR, w, o)).status === 'ok') made++; return made; };
ipcMain.handle('bkWorlds', async () => {
  const out = [], last = {};
  for (const b of await BK.listBackups(BK_DIR)) { const k = b.inst + '/' + b.key; if (!last[k]) last[k] = b.t; }
  for (const w of await BK.listWorlds(INST_DIR)) {
    let i = { size: 0, mtime: 0 }; try { i = await BK.info(w.dir); } catch {}
    out.push({ inst: w.inst, world: w.world, size: i.size, mtime: i.mtime, last: last[BK.safe(w.inst) + '/' + BK.safe(w.world)] || 0 });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('bkList', async () => (await BK.listBackups(BK_DIR)).map(({ id, inst, key, t, kind, size }) => ({ id, inst, world: key, t, kind, size })));
ipcMain.handle('bkRun', (_, inst, world) => bkLock(async () => { // без аргументов — все миры
  try {
    const ws = (await BK.listWorlds(INST_DIR)).filter(w => !inst || (w.inst === inst && w.world === world));
    return { made: await bkRun(ws, { kind: 'manual' }) };
  } catch (e) { throw bkErr(e); }
}));
ipcMain.handle('bkRestore', (_, id) => bkLock(async () => {
  try { return await BK.restore(BK_DIR, INST_DIR, id, T('m.bk.rsuffix', { d: BK.stamp(new Date()) })); }
  catch (e) { throw bkErr(e); }
}));
ipcMain.handle('bkDel', (_, id) => bkLock(async () => { try { await BK.remove(BK_DIR, id); return true; } catch (e) { throw bkErr(e); } }));
ipcMain.handle('bkOpen', () => { fs.mkdirSync(BK_DIR, { recursive: true }); return shell.openPath(BK_DIR); });

// ---- разбор вылетов ----
// Читает crash-report / hs_err / latest.log (src/crash.js) и говорит, какой мод, Java, память или драйвер виноваты.
// Исправления — только по кнопке и только безопасные: моды не удаляются, а переносятся в mods-disabled.
const brokenOf = mv => Object.keys(S.broken || {}).filter(k => { const x = LDR_RE.exec(k); return x && k.slice(0, x.index) === mv && S.broken[k]; }); // загрузчики этой версии, упавшие на старте
const crCtx = async inst => {
  const md = path.join(INST_DIR, inst, 'mods');
  return { mods: await CR.scanMods(md), managed: readJ(path.join(md, '.managed.json')), settings: S.settings, totalMem: os.totalmem() / 1048576, inst, broken: brokenOf(inst.replace(LDR_RE, '')).length > 0 };
};
const crRun = async (text, ref) => ({ ...CR.analyze(text, { ...(await crCtx(ref.inst)), kind: ref.kind }), id: ref.id || '', inst: ref.inst, name: ref.name || '', t: ref.t || Date.now() });
const crHas = r => r.suspects.length > 0 || r.findings.some(f => f.id !== 'unknown');
async function crAuto(entry, code, gdir, early) { // игра закрылась с ошибкой — ищем свежий отчёт, иначе разбираем вывод игры
  try {
    const inst = path.basename(gdir);
    const fresh = (await CR.listReports(INST_DIR)).find(x => x.inst === inst && x.kind !== 'log' && x.t >= entry.t0 - 2000);
    let r;
    if (fresh) { const ref = CR.resolveId(INST_DIR, fresh.id); ref.t = fresh.t; r = await crRun(await CR.readText(ref.file, ref.kind), ref); }
    else {
      r = await crRun((entry.tail || []).join('\n'), { inst, kind: 'log' });
      if (!crHas(r)) { // причину мог записать только latest.log
        const ref = CR.resolveId(INST_DIR, inst + '/logs/latest.log');
        try { const st = fs.statSync(ref.file); if (st.mtimeMs >= entry.t0 - 2000) { ref.t = st.mtimeMs; r = await crRun(await CR.readText(ref.file, 'log'), ref); } } catch {}
      }
      if (!crHas(r)) return; // убили процесс вручную и ничего не нашли — не шумим
    }
    send('crash', { ...r, code, early: !!early });
  } catch {}
}
const crE = k => Object.assign(new Error(T(k)), { crOwn: true });
const crUserClean = (inst, files) => { // убираем перенесённые файлы из списка «своих» модов (вкладка Моды)
  const f = path.join(INST_DIR, inst, 'mods', '.user.json'), U = readJ(f); let ch = false;
  for (const k of Object.keys(U)) if (files.includes(U[k].file)) { delete U[k]; ch = true; }
  if (ch) fs.writeFileSync(f, JSON.stringify(U));
};
ipcMain.handle('crList', async () => (await CR.listReports(INST_DIR)).slice(0, 40).map(({ id, inst, name, kind, t }) => ({ id, inst, name, kind, t })));
ipcMain.handle('crAnalyze', async (_, id) => {
  const ref = CR.resolveId(INST_DIR, id); if (!ref) throw crE('m.cr.bad');
  let text; try { text = await CR.readText(ref.file, ref.kind); ref.t = (await fs.promises.stat(ref.file)).mtimeMs; } catch { throw crE('m.cr.read'); }
  return crRun(text, ref);
});
ipcMain.handle('crShow', (_, id) => { const ref = CR.resolveId(INST_DIR, id); if (ref && fs.existsSync(ref.file)) shell.showItemInFolder(ref.file); return !!ref; });
ipcMain.handle('crFix', async (_, a, arg, inst) => {
  inst = String(inst || ''); arg = arg == null ? '' : String(arg);
  const mv = inst.replace(LDR_RE, ''), playing = v => [...running.values()].some(x => x.version === v);
  try {
    if (a === 'rmMod' || a === 'dedupe' || a === 'rmFile') {
      if (!/^[\w.\-]+-(vanilla|fabric|quilt|forge|neoforge)$/.test(inst) || !fs.existsSync(path.join(INST_DIR, inst))) throw crE('m.cr.nomod');
      if (playing(mv)) throw crE('m.cr.busy');
      const md = path.join(INST_DIR, inst, 'mods'), scan = await CR.scanMods(md), auto = new Set(Object.values(readJ(path.join(md, '.managed.json'))));
      let files = [];
      if (a === 'rmMod') files = (scan.byId.get(arg) || []).map(x => x.file).filter(f => !auto.has(f)); // моды лаунчера (Sodium…) вернутся при запуске — их отключают через Fabric
      else if (a === 'rmFile') files = scan.files.has(arg) ? [arg] : [];
      else for (const d of scan.dups) { const keep = d.files.find(f => auto.has(f)) || d.keep; files.push(...d.files.filter(f => f !== keep)); }
      if (!files.length) throw crE('m.cr.nomod');
      for (const f of files) await CR.moveToDisabled(md, f);
      crUserClean(inst, files);
      if (S.broken && S.broken[inst]) { delete S.broken[inst]; persist(); } // загрузчик снова можно пробовать
      return { k: 'cr.done.rm', p: { n: files.length }, state: pub() };
    }
    if (a === 'noFab') S.settings.loader = 'vanilla';
    else if (a === 'fabRetry') { const ks = brokenOf(mv), l = (LDR_RE.exec(ks[0] || inst) || [])[1]; for (const k of ks) delete S.broken[k]; S.settings.loader = l && l !== 'vanilla' ? l : 'fabric'; }
    else if (a === 'ram') { const max = Math.max(2048, Math.floor(os.totalmem() / 1048576 * 0.75 / 512) * 512), n = Math.round((+arg || 0) / 512) * 512; S.settings.ram = Math.min(max, Math.max(1024, n || S.settings.ram)); }
    else if (a === 'javaReset') S.settings.java = '';
    else if (a === 'flagsNone') S.settings.flags = 'none';
    else if (a === 'reinstall') {
      const root = path.resolve(ROOT, 'versions'), d = path.resolve(root, arg);
      if (!/^[\w.\-]+$/.test(arg) || !d.startsWith(root + path.sep)) throw crE('m.cr.bad');
      if (installing.has(arg) || playing(arg)) throw crE('m.cr.busy');
      fs.rmSync(d, { recursive: true, force: true }); // при следующем запуске лаунчер скачает версию заново
    } else throw crE('m.cr.bad');
    persist(); return { k: 'cr.done', p: {}, state: pub() };
  } catch (e) { throw e.crOwn ? e : new Error(T('m.cr.err', { e: String((e && e.message) || e).slice(0, 90) })); }
});

// ---- список серверов ----
const srvOut = () => S.servers.map(x => ({ ...x }));
ipcMain.handle('srvList', () => srvOut());
ipcMain.handle('srvAdd', (_, name, addr) => {
  const h = SRV.parseAddr(addr); if (!h) throw new Error(T('m.srv.addr'));
  const a = SRV.fmtAddr(h);
  if (S.servers.length >= 50) throw new Error(T('m.srv.max'));
  if (S.servers.some(x => x.addr === a)) throw new Error(T('m.srv.dup'));
  S.servers.push({ id: crypto.randomUUID(), name: String(name || '').trim().slice(0, 32) || a, addr: a, fav: false });
  persist(); return srvOut();
});
ipcMain.handle('srvDel', (_, id) => { S.servers = S.servers.filter(x => x.id !== id); persist(); return srvOut(); });
ipcMain.handle('srvFav', (_, id) => { const x = S.servers.find(y => y.id === id); if (x) x.fav = !x.fav; persist(); return srvOut(); });
ipcMain.handle('srvPing', async (_, addr) => { const h = SRV.parseAddr(addr); return h ? SRV.ping(h) : { ok: false, error: 'bad' }; });

// ---- автообновление лаунчера (GitHub Releases: pidorchain/VoidLauncher) ----
// работает только в установленной версии; portable и запуск из исходников не обновляются
function setupUpdater() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => send('log', T('m.upd.found', { v: i.version })));
  autoUpdater.on('update-downloaded', i => {
    send('log', T('m.upd.done', { v: i.version }));
    dialog.showMessageBox(win, {
      type: 'info', buttons: [T('m.upd.now'), T('m.upd.later')], defaultId: 0, cancelId: 1, title: 'VoidLauncher',
      message: T('m.upd.msg', { v: i.version }),
      detail: T('m.upd.detail')
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
  });
  autoUpdater.on('error', () => {}); // нет сети или релизов — молча пропускаем
  autoUpdater.checkForUpdates().catch(() => {});
}
app.whenReady().then(() => setTimeout(setupUpdater, 4000));
