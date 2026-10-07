'use strict';
// Разбор вылетов: читает crash-report / hs_err / latest.log и находит виноватый мод, Java, память или драйвер.
// Без зависимостей от Electron (только fs, zlib и src/backup.js для чтения .jar): на входе текст и список модов, на выходе структура для окна.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const BK = require('./backup.js');
const fsp = fs.promises;

const MAX_TEXT = 1536 * 1024;                                        // больше не читаем: у latest.log берём хвост, у отчётов — начало
const IGNORE = new Set(['minecraft', 'java', 'fabricloader', 'quilt_loader', 'forge', 'neoforge', 'mixinextras', 'mixinsquared']); // это не «виновные» моды
const WHY = ['entry', 'mixin', 'dep', 'mcver', 'conflict', 'dup', 'file', 'suspect', 'content', 'stack']; // от самого надёжного признака к самому слабому
const CONF = { entry: 'hi', mixin: 'hi', dep: 'hi', mcver: 'hi', conflict: 'hi', dup: 'hi', file: 'hi', suspect: 'mid', content: 'mid', stack: 'low' };
const SEV = { high: 0, mid: 1, low: 2 };
const GROUP = { javaver: 'java', jvmflags: 'java', oom: 'ram', nomem: 'ram', heap: 'ram', gpu: 'gpu', glfw: 'gpu', natives: 'files', corruptjar: 'files', jvm: 'jvm', unknown: 'none' };
// пакеты игры и библиотек: кадры стека из них не указывают на мод
const LIB = /^(java|javax|jdk|sun|com\.sun|net\.minecraft|com\.mojang|org\.lwjgl|org\.spongepowered|org\.objectweb|org\.apache|org\.slf4j|org\.joml|org\.lz4|io\.netty|it\.unimi|com\.google|com\.llamalad7|com\.ibm|oshi|kotlin|net\.fabricmc\.(loader|api|mapping|tinyremapper|accesswidener))\b/;

// ---- файлы отчётов ----
const CRASH_RE = /^crash-.*\.txt$/i, HS_RE = /^hs_err_pid\d+\.log$/i;
const ID_RE = /^([^/\\]+)\/(crash-reports\/crash-[^/\\]*\.txt|hs_err_pid\d+\.log|logs\/latest\.log)$/i;

// Все отчёты всех экземпляров: crash-reports/crash-*.txt, hs_err_pid*.log (падение самой Java) и logs/latest.log. Новые сверху.
async function listReports(instRoot) {
  const out = []; let insts = [];
  try { insts = await fsp.readdir(instRoot, { withFileTypes: true }); } catch { return out; }
  for (const d of insts) {
    if (!d.isDirectory() || d.name === '_install') continue;
    const base = path.join(instRoot, d.name);
    const add = async (dir, rel, re, kind) => {
      let names = []; try { names = await fsp.readdir(dir); } catch { return; }
      for (const f of names) {
        if (!re.test(f)) continue;
        try { const st = await fsp.stat(path.join(dir, f)); if (st.isFile()) out.push({ id: d.name + '/' + rel + f, inst: d.name, name: f, kind, t: st.mtimeMs, size: st.size }); } catch {}
      }
    };
    await add(path.join(base, 'crash-reports'), 'crash-reports/', CRASH_RE, 'crash');
    await add(base, '', HS_RE, 'jvm');
    await add(path.join(base, 'logs'), 'logs/', /^latest\.log$/i, 'log');
  }
  return out.sort((a, b) => b.t - a.t);
}

// id из окна → путь к файлу. Чужие пути (../, другие имена) отбрасываются.
function resolveId(instRoot, id) {
  const m = ID_RE.exec(String(id || ''));
  if (!m || m[1] === '.' || m[1] === '..') return null;
  const file = path.join(instRoot, m[1], ...m[2].split('/'));
  if (!path.resolve(file).startsWith(path.resolve(instRoot) + path.sep)) return null;
  const kind = /latest\.log$/i.test(m[2]) ? 'log' : /hs_err/i.test(m[2]) ? 'jvm' : 'crash';
  return { id: m[1] + '/' + m[2], file, inst: m[1], kind, name: path.basename(file) };
}

async function readText(file, kind) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat(), n = Math.min(size, MAX_TEXT), b = Buffer.alloc(n);
    await fh.read(b, 0, n, kind === 'log' ? size - n : 0);
    return b.toString('utf8');
  } finally { await fh.close(); }
}

// ---- моды экземпляра: id, имя и версия из описания мода внутри .jar (fabric.mod.json, quilt.mod.json, mods.toml, neoforge.mods.toml) ----
const MOD_FILES = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml'];
async function readModJson(jar) {
  const ents = await BK.readEntries(jar);
  const e = MOD_FILES.map(n => ents.find(x => x.name === n)).find(Boolean);
  if (!e || e.us > 1048576) return null;
  const fh = await fsp.open(jar, 'r');
  let txt;
  try {
    const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, e.off);
    if (lh.readUInt32LE(0) !== 0x04034b50) return null;
    const ds = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), raw = Buffer.alloc(e.cs);
    await fh.read(raw, 0, e.cs, ds);
    txt = (e.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8').replace(/^\uFEFF/, '');
  } finally { await fh.close(); }
  if (/\.toml$/.test(e.name)) { // Forge / NeoForge: берём первый [[mods]]
    const id = /modId\s*=\s*["']([^"']+)["']/.exec(txt), nm = /displayName\s*=\s*["']([^"']+)["']/.exec(txt), vr = /\n\s*version\s*=\s*["']([^"']+)["']/.exec(txt);
    return id ? { id: id[1], name: nm ? nm[1] : id[1], version: vr ? vr[1] : '' } : null;
  }
  const j = JSON.parse(txt);
  if (e.name === 'quilt.mod.json') { const q = j.quilt_loader || {}; return { id: q.id, name: (q.metadata && q.metadata.name) || q.id, version: q.version }; }
  return j;
}
async function scanMods(dir) {
  const byId = new Map(), files = new Set(), list = [], bad = [];
  let names = []; try { names = await fsp.readdir(dir); } catch { return { byId, files, list, bad, dups: [] }; }
  for (const f of names) {
    if (!/\.jar$/i.test(f)) continue;
    files.add(f);
    let st; try { st = await fsp.stat(path.join(dir, f)); } catch { continue; }
    let j = null;
    try { j = await readModJson(path.join(dir, f)); } catch { bad.push(f); continue; } // не читается как zip — файл повреждён
    const id = j && typeof j.id === 'string' ? j.id : '';
    const m = { file: f, id, name: j && typeof j.name === 'string' && j.name ? j.name : (id || f), ver: j && j.version != null ? String(j.version) : '', mtime: st.mtimeMs };
    list.push(m);
    if (id) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(m); }
  }
  const dups = [...byId.entries()].filter(([, a]) => a.length > 1).map(([id, a]) => ({ id, name: a[0].name, files: a.map(x => x.file), keep: a.slice().sort((x, y) => y.mtime - x.mtime)[0].file }));
  return { byId, files, list, bad, dups };
}

// «Отключить» мод = перенести .jar в mods-disabled рядом с mods (Fabric эту папку не читает, файл можно вернуть руками)
async function moveToDisabled(modsDir, file) {
  if (!file || file !== path.basename(file)) throw new Error('bad name');
  const dd = path.join(path.dirname(modsDir), 'mods-disabled');
  await fsp.mkdir(dd, { recursive: true });
  let dest = path.join(dd, file);
  if (fs.existsSync(dest)) dest = path.join(dd, Date.now() + '-' + file);
  await fsp.rename(path.join(modsDir, file), dest);
  return dest;
}

// ---- анализ ----
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const jmajor = v => { const m = /^1\.(\d+)/.exec(v || '') || /^(\d+)/.exec(v || ''); return m ? +m[1] : 0; };
const gpuOf = d => /^nvoglv|^nvwgf|^nvd3d|^nvlddmkm|^nvcuda|^nvapi/i.test(d) ? 'NVIDIA' : /^ig\w*icd|^igd|^igc|^ig\d/i.test(d) ? 'Intel' : /^atio|^atig|^aticfx|^atidxx|^amdxx|^amdvlk|^amdocl/i.test(d) ? 'AMD' : '';
const MB = n => Math.round(n / 512) * 512, gb = mb => (mb / 1024).toFixed(mb % 1024 ? 1 : 0);

// Корневая причина: в первом стеке (до пустой строки) — последняя строка «Caused by», иначе сама первая ошибка
function rootCause(block) {
  const L = block.split('\n'); let i = L.findIndex(l => /^(?:Exception in thread "[^"]*" )?[\w.$]+(?:Exception|Error|Throwable)\b/.test(l));
  if (i < 0) return '';
  let first = L[i], last = '';
  for (let k = i + 1; k < L.length && L[k].trim() !== ''; k++) if (/^Caused by: /.test(L[k])) last = L[k].slice(11);
  const e = (last || first.replace(/^Exception in thread "[^"]*" /, '')).trim();
  return e.length > 220 ? e.slice(0, 219) + '…' : e;
}

// text — содержимое отчёта; o = { kind: crash|jvm|log, mods: результат scanMods, managed: {slug: файл} (моды лаунчера), settings, totalMem, inst, broken }
function analyze(text, o = {}) {
  text = String(text || '').replace(/\r\n?/g, '\n');
  const kind = o.kind || 'crash', st = o.settings || {}, ram = +st.ram || 4096;
  const scan = o.mods || { byId: new Map(), files: new Set(), list: [], bad: [], dups: [] };
  const m1 = (re, i = 1) => { const m = re.exec(text); return m ? m[i] : ''; };
  const r = { kind, mc: '', java: '', exc: '', desc: '', suspects: [], findings: [], acts: [], verdict: { g: 'none', names: [] } };
  r.mc = m1(/Minecraft Version:\s*(\S+)/) || m1(/--version\s+(\d[\w.-]*)/) || (o.inst ? o.inst.replace(/-(vanilla|fabric|quilt|forge|neoforge)$/, '') : '');
  r.java = m1(/^[ \t]*Java Version:\s*([\d._]+)/m) || m1(/JRE version:[^\n]*?\((\d[\d._]*)/);
  r.desc = m1(/^Description:\s*(.+)$/m).slice(0, 160);

  // список модов из отчёта Fabric («Fabric Mods:») + моды из папки mods
  const rm = {}, fm = /^[ \t]*Fabric Mods:[ \t]*\n((?:[ \t]+\S[^\n]*\n?)*)/m.exec(text);
  if (fm) for (const l of fm[1].split('\n')) { const m = /^[ \t]+([\w.-]+): (.+) (\S+)\s*$/.exec(l); if (m) rm[m[1]] = { name: m[2], ver: m[3] }; }
  const info = id => rm[id] || ((scan.byId.get(id) || [])[0] ? { name: scan.byId.get(id)[0].name, ver: scan.byId.get(id)[0].ver } : { name: id, ver: '' });
  const ids = [...new Set([...Object.keys(rm), ...scan.byId.keys()])];

  const head = text.split(/\n-- /)[0], ex = text.search(/^(?:Exception in thread "[^"]*" )?[\w.$]+(?:Exception|Error|Throwable)\b/m);
  const block = kind === 'crash' ? head : kind === 'jvm' ? text : ex < 0 ? '' : text.slice(ex, ex + 12000);
  r.exc = kind === 'jvm' ? m1(/^#\s{2}([A-Z_]+ \(0x[0-9a-f]+\)[^\n]*)/m).slice(0, 200) || rootCause(block) : rootCause(block);

  const addS = (id, why) => {
    if (!id || IGNORE.has(id)) return;
    const s = r.suspects.find(x => x.id === id), i = info(id);
    if (s) { if (WHY.indexOf(why) < WHY.indexOf(s.why)) { s.why = why; s.conf = CONF[why]; } return; }
    r.suspects.push({ id, name: i.name, ver: i.ver, why, conf: CONF[why] });
  };
  const seen = new Set();
  const F = (id, sev, p, dv, mod) => { const k = id + '|' + (mod || '') + '|' + JSON.stringify(p || {}); if (seen.has(k)) return null; seen.add(k); const f = { id, sev, p: p || {}, dv: dv || '', acts: [], mod: mod || '' }; r.findings.push(f); return f; };

  // кадры стека → моды (по совпадению id мода с именем пакета). Слабый признак, поэтому why = stack
  const stackMods = (frames) => {
    const cand = ids.filter(id => !IGNORE.has(id) && norm(id).length >= 4 && (id === 'fabric-api' || !/^fabric-/.test(id))).sort((a, b) => norm(b).length - norm(a).length);
    const out = [];
    for (const cls of frames) {
      let id = '';
      if (/^net\.fabricmc\.fabric\./.test(cls)) id = ids.includes('fabric-api') ? 'fabric-api' : '';
      else if (!LIB.test(cls)) { const n = norm(cls); id = cand.find(c => n.includes(norm(c))) || ''; }
      if (id && !out.includes(id)) out.push(id);
      if (out.length >= 3) break;
    }
    return out;
  };

  let m;
  // --- Java ---
  const jv = /class file version (\d+)(?:\.\d+)?\)?[^\n]*?up to (\d+)/.exec(text), jv2 = /Unsupported major\.minor version (\d+)/.exec(text);
  if (jv || jv2) {
    const cls = (/UnsupportedClassVersionError:\s*([\w.$/]+)/.exec(text) || [])[1] || '';
    F('javaver', 'high', { need: jv ? +jv[1] - 44 : +jv2[1] - 44, have: jv ? +jv[2] - 44 : jmajor(r.java) || '?' }, st.java ? '' : '2');
    if (cls) stackMods([cls.replace(/\//g, '.')]).forEach(id => addS(id, 'stack'));
  }
  if ((m = /Unrecognized VM option '([^']+)'/.exec(text)) || (m = /Unrecognized option:\s*(\S+)/.exec(text))) F('jvmflags', 'high', { opt: m[1] });

  // --- память ---
  if (/Could not reserve enough space|Invalid maximum heap size|Invalid initial heap size/i.test(text)) F('heap', 'high', { gb: gb(ram) });
  else if (/insufficient memory for the Java Runtime|Native memory allocation \((?:mmap|malloc)\) failed|unable to create (?:new )?native thread/i.test(text)) F('nomem', 'high', { gb: gb(ram) });
  else if (/OutOfMemoryError/.test(text)) F('oom', 'high', { gb: gb(ram), what: (/OutOfMemoryError:\s*([^\n]*)/.exec(text) || [])[1] || '' });

  // --- видеокарта ---
  const dll = m1(/Problematic frame:\s*\n#\s*[CV]\s+\[([\w.-]+\.dll)\+/i) || m1(/^#\s*C\s+\[([\w.-]+\.dll)\+0x/m);
  if (dll && (gpuOf(dll) || /opengl|glfw|lwjgl|d3d|dxgi/i.test(dll))) { const v = gpuOf(dll); F('gpu', 'high', { vendor: v, dll }, v ? '' : '2'); }
  if (/GLFW error 6554[2-5]|does not appear to support OpenGL|Pixel format not accelerated|Couldn't set pixel format|OpenGL 3\.\d[^\n]*not supported/i.test(text)) F('glfw', 'high');

  // --- файлы игры ---
  if ((m = /(?:UnsatisfiedLinkError|Failed to (?:locate|load) library)[^\n]*/.exec(text)) && /lwjgl|glfw|openal|jemalloc|stb|tinyfd/i.test(m[0])) F('natives', 'high', { v: r.mc });
  if ((m = /(?:ZipException|ZipError|invalid LOC header|zip END header not found|Invalid or corrupt jarfile|error in opening zip file)[^\n]*/i.exec(text))) {
    const around = text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200), jf = /([\w ()+.\[\]-]+\.jar)\b/.exec(around);
    F('corruptjar', 'high', { file: jf ? path.basename(jf[1].trim()) : '?' });
  }

  // --- моды: прямые указания в тексте ---
  const entryRe = /provided by '([\w.-]+)'/g;
  while ((m = entryRe.exec(text))) { addS(m[1], 'entry'); F('entry', 'high', { mod: info(m[1]).name, stage: m1(/entrypoint stage '(\w+)'/) || '?' }, '', m[1]); }
  for (const l of text.split('\n')) {
    if (!/Mixin|Inject/i.test(l)) continue;
    const mm = /\bfrom mod ([\w.-]+)/.exec(l);
    if (!mm) continue;
    const target = ((/ -> ([\w.$/]+)/.exec(l) || [])[1] || '').replace(/\//g, '.'), prev = r.findings.find(f => f.id === 'mixin' && f.mod === mm[1]);
    if (prev) { if (target && !prev.p.target) { prev.p.target = target; prev.dv = ''; } continue; }
    addS(mm[1], 'mixin'); F('mixin', 'high', { mod: info(mm[1]).name, target }, target ? '' : '2', mm[1]);
  }
  const depRe = /Mod '([^']+)' \(([\w.-]+)\) (\S+) requires (.+?) of ([\w.-]+), (which is missing|but only the wrong version is present: ([^\s!]+))/g;
  while ((m = depRe.exec(text))) {
    const [, nm, id, mv, req, dep, , have] = m;
    if (!rm[id] && !scan.byId.has(id)) rm[id] = { name: nm, ver: mv };
    if (dep === 'java') { F('javaver', 'high', { need: +(/(\d+)/.exec(req) || [])[1] || '?', have: jmajor(have) || jmajor(r.java) || '?' }, st.java ? '' : '2'); addS(id, 'dep'); continue; }
    addS(id, dep === 'minecraft' ? 'mcver' : 'dep');
    if (dep === 'minecraft') F('mcver', 'high', { mod: nm, mc: have || r.mc || '?', req: req.replace(/^version /, '') }, '', id);
    else F('dep', 'high', { mod: nm, dep, req: req.replace(/^version /, ''), have: have || '' }, have ? '2' : '', id);
  }
  const confRe = /Mod '([^']+)' \(([\w.-]+)\) (\S+) (?:conflicts with|is incompatible with|breaks) ([^\n]+)/g;
  while ((m = confRe.exec(text))) { if (!rm[m[2]] && !scan.byId.has(m[2])) rm[m[2]] = { name: m[1], ver: m[3] }; addS(m[2], 'conflict'); F('conflict', 'high', { mod: m[1], raw: m[4].trim().slice(0, 120) }, '', m[2]); }

  // --- содержимое мода (существо / блок / тайл-энтити) ---
  if ((m = /(?:Entity Type|Block Entity Type):\s*([\w.-]+):([\w./-]+)/.exec(text)) || (m = /Block:\s*Block\{([\w.-]+):([\w./-]+)\}/.exec(text))) {
    if (m[1] !== 'minecraft') { addS(m[1], 'content'); F('content', 'mid', { mod: info(m[1]).name, id: m[1] + ':' + m[2] }, '', m[1]); }
  }

  // --- «Suspected Mods» Fabric + кадры стека ---
  const sm = /^[ \t]*Suspected Mods:[ \t]*(.*)\n((?:[ \t]{2,}\S[^\n]*\n?)*)/m.exec(text);
  if (sm && !/^none\b/i.test(sm[1].trim())) { const re = /([^(),\n][^(),\n]*?)\s*\(([\w.-]+)\)/g, chunk = sm[1] + '\n' + sm[2]; let x; while ((x = re.exec(chunk))) addS(x[2], 'suspect'); }
  const frames = []; { const re = kind === 'jvm' ? /^[jJ]\s+([\w.$]+)\.[\w$<>]+\(/gm : /^[ \t]+at ([\w.$]+)\.[\w$<>]+\(/gm; let x; while ((x = re.exec(block)) && frames.length < 80) frames.push(x[1]); }
  stackMods(frames).forEach(id => addS(id, 'stack'));

  // --- папка mods: дубликаты и битые файлы ---
  if (scan.dups.length) {
    for (const d of scan.dups) addS(d.id, 'dup');
    const f = F('dup', 'high', { mods: scan.dups.map(d => d.name).join(', '), files: scan.dups.map(d => d.files.join(' + ')).join('; ').slice(0, 200) });
    if (f) f.acts.push({ a: 'dedupe' });
  }
  for (const b of scan.bad) F('corruptjar', 'high', { file: b });

  // --- общие случаи, когда ничего конкретного не нашли ---
  if (kind === 'jvm' && !r.findings.length) F('jvm', 'mid', { frame: dll || '?' });
  const ldrInst = !o.inst || !/-vanilla$/.test(o.inst); // экземпляр с загрузчиком модов

  // --- что можно исправить кнопкой ---
  const auto = new Set(Object.values(o.managed || {}));
  const modActs = id => {
    const arr = scan.byId.get(id); if (!arr) return [];
    if (arr.some(x => auto.has(x.file))) return st.loader !== 'vanilla' && ldrInst ? [{ a: 'noFab' }] : [];
    return [{ a: 'rmMod', arg: id, p: { mod: arr[0].name } }];
  };
  const maxRam = Math.max(2048, Math.floor((+o.totalMem || 16384) * 0.75 / 512) * 512);
  const referenced = new Set(r.findings.map(f => f.mod).filter(Boolean));
  const loose = r.suspects.filter(s => (s.why === 'suspect' || s.why === 'stack') && !referenced.has(s.id));
  if (loose.length) { const f = F('sus', loose[0].conf === 'low' ? 'low' : 'mid', { mods: loose.slice(0, 3).map(s => s.name).join(', ') }, loose[0].conf === 'low' ? '2' : ''); if (f) for (const s of loose.slice(0, 2)) f.acts.push(...modActs(s.id)); }
  if (!r.findings.length) F('unknown', 'low');

  for (const f of r.findings) {
    if (f.mod) f.acts.push(...modActs(f.mod));
    if (f.id === 'oom') { const n = Math.min(maxRam, MB(ram * 1.5)); if (n > ram) f.acts.push({ a: 'ram', arg: n, p: { gb: gb(n) } }); }
    if (f.id === 'nomem' || f.id === 'heap') { const n = Math.max(1024, MB(ram * 0.6)); if (n < ram) f.acts.push({ a: 'ram', arg: n, p: { gb: gb(n) } }); }
    if (f.id === 'javaver' && st.java) f.acts.push({ a: 'javaReset' });
    if ((f.id === 'jvmflags' || f.id === 'jvm') && st.flags !== 'none') f.acts.push({ a: 'flagsNone' });
    if ((f.id === 'jvm' || f.id === 'unknown' || f.id === 'gpu') && st.loader !== 'vanilla' && ldrInst) f.acts.push({ a: 'noFab' });
    if (f.id === 'natives' && f.p.v) f.acts.push({ a: 'reinstall', arg: f.p.v, p: { v: f.p.v } });
    if (f.id === 'corruptjar' && scan.files.has(f.p.file)) f.acts.push({ a: 'rmFile', arg: f.p.file });
    const seenA = new Set(); f.acts = f.acts.filter(a => { const k = a.a + ':' + (a.arg || ''); return seenA.has(k) ? false : (seenA.add(k), true); });
  }
  if (o.broken) r.acts.push({ a: 'fabRetry' }); // загрузчик для этой версии отключён после прошлого падения — даём включить обратно

  r.findings.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
  r.suspects.sort((a, b) => WHY.indexOf(a.why) - WHY.indexOf(b.why));
  const prim = r.findings[0], strong = r.suspects.filter(s => s.conf !== 'low');
  const names = [...new Set(prim.id === 'dup' ? scan.dups.map(d => d.name)
    : prim.id === 'sus' ? loose.map(s => s.name)
    : prim.mod ? r.findings.filter(f => f.id === prim.id && f.mod).map(f => f.p.mod)
    : (strong.length ? strong : r.suspects).map(s => s.name))].slice(0, 3);
  const g = GROUP[prim.id] || 'mod';
  r.verdict = { g: g === 'mod' && !names.length ? 'none' : g, names };
  return r;
}

module.exports = { listReports, resolveId, readText, scanMods, moveToDisabled, analyze };
