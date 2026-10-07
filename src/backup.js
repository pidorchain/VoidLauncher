'use strict';
// Бэкапы миров: копии папок saves/<мир> в .zip. Без зависимостей (только встроенные fs и zlib), не зависит от Electron.
// Структура: <backups>/<экземпляр>/<мир>__<ГГГГ-ММ-ДД_чч-мм-сс>__<auto|manual>.zip, внутри архива — папка с именем мира.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const fsp = fs.promises;

const SKIP = new Set(['session.lock']);                 // замок открытого мира — в копию не нужен
const NAME_RE = /^(.*)__(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)__(auto|manual)\.zip$/;
const LIM = 0xFFFFFFFF;                                 // ZIP64 не поддерживаем: один файл или архив больше 4 ГБ — ошибка

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const safe = s => String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'world';

// ---- CRC32 ----
const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crcUpd = (c, b) => { for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 255] ^ (c >>> 8); return c; };
const crcEnd = c => (c ^ 0xFFFFFFFF) >>> 0;

// ---- обход папки ----
async function walk(dir, rel = '', out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(abs, r, out);
    else if (e.isFile()) { const st = await fsp.stat(abs); out.push({ abs, rel: r, size: st.size, mtimeMs: st.mtimeMs }); }
  }
  return out;
}
// размер и время последнего изменения мира
async function info(dir) {
  const f = await walk(dir);
  return { size: f.reduce((s, x) => s + x.size, 0), mtime: f.reduce((m, x) => Math.max(m, x.mtimeMs), 0), files: f.length };
}

// ---- запись zip ----
const dos = ms => { const d = new Date(ms), y = Math.max(1980, d.getFullYear()); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; };

async function writeZip(out, files, root) {
  if (files.length > 65535) throw new Error('too many files');
  const ws = fs.createWriteStream(out); ws.on('error', () => {}); // ошибки приходят через колбэки write/end
  let off = 0; const cd = [];
  const w = b => new Promise((res, rej) => ws.write(b, e => e ? rej(e) : res())).then(() => { off += b.length; });
  try {
    for (const f of files) {
      const name = Buffer.from(root + '/' + f.rel, 'utf8'), { time, date } = dos(f.mtimeMs), start = off;
      const lo = Buffer.alloc(30);
      lo.writeUInt32LE(0x04034b50, 0); lo.writeUInt16LE(20, 4); lo.writeUInt16LE(0x0808, 6); lo.writeUInt16LE(8, 8); // бит 3: размеры — после данных; бит 11: UTF-8
      lo.writeUInt16LE(time, 10); lo.writeUInt16LE(date, 12); lo.writeUInt16LE(name.length, 26);
      await w(lo); await w(name);
      let crc = 0xFFFFFFFF, us = 0, cs = 0;
      const rs = fs.createReadStream(f.abs), df = zlib.createDeflateRaw({ level: 6 });
      rs.on('error', e => df.destroy(e)); rs.on('data', c => { crc = crcUpd(crc, c); us += c.length; }); rs.pipe(df);
      for await (const c of df) { cs += c.length; await w(c); }
      crc = crcEnd(crc);
      if (us >= LIM || cs >= LIM || off >= LIM) throw new Error('file too large');
      const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(cs, 8); dd.writeUInt32LE(us, 12);
      await w(dd); cd.push({ name, time, date, crc, cs, us, start });
    }
    const cdStart = off;
    for (const e of cd) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(8, 10);
      h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.cs, 20); h.writeUInt32LE(e.us, 24);
      h.writeUInt16LE(e.name.length, 28); h.writeUInt32LE(e.start, 42);
      await w(h); await w(e.name);
    }
    const cdSize = off - cdStart;
    if (off >= LIM) throw new Error('archive too large');
    const z = Buffer.alloc(22); z.writeUInt32LE(0x06054b50, 0); z.writeUInt16LE(cd.length, 8); z.writeUInt16LE(cd.length, 10); z.writeUInt32LE(cdSize, 12); z.writeUInt32LE(cdStart, 16);
    await w(z);
    await new Promise((res, rej) => { ws.once('error', rej); ws.end(res); });
  } catch (e) { ws.destroy(); throw e; }
}

// ---- чтение zip ----
async function readEntries(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat(), n = Math.min(size, 65557), b = Buffer.alloc(n);
    await fh.read(b, 0, n, size - n);
    const i = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (i < 0) throw new Error('bad zip');
    const cnt = b.readUInt16LE(i + 10), cdSize = b.readUInt32LE(i + 12), cdOff = b.readUInt32LE(i + 16);
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdOff);
    const out = []; let p = 0;
    for (let k = 0; k < cnt; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip');
      const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      out.push({ method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16), cs: cd.readUInt32LE(p + 20), us: cd.readUInt32LE(p + 24), off: cd.readUInt32LE(p + 42), name: cd.toString('utf8', p + 46, p + 46 + nl) });
      p += 46 + nl + el + cl;
    }
    return out;
  } finally { await fh.close(); }
}

async function extractZip(file, dest, entries) {
  const base = path.resolve(dest), fh = await fsp.open(file, 'r');
  try {
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const target = path.resolve(base, ...e.name.split('/'));
      if (!target.startsWith(base + path.sep)) throw new Error('bad path');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, e.off);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('bad zip');
      const ds = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const ws = fs.createWriteStream(target); ws.on('error', () => {});
      const w = b => new Promise((res, rej) => ws.write(b, er => er ? rej(er) : res()));
      let crc = 0xFFFFFFFF, us = 0;
      if (e.cs > 0) {
        let src = fs.createReadStream(file, { start: ds, end: ds + e.cs - 1 });
        if (e.method === 8) { const inf = zlib.createInflateRaw(); src.on('error', er => inf.destroy(er)); src = src.pipe(inf); }
        else if (e.method !== 0) throw new Error('bad zip');
        for await (const c of src) { crc = crcUpd(crc, c); us += c.length; await w(c); }
      }
      await new Promise((res, rej) => { ws.once('error', rej); ws.end(res); });
      if (crcEnd(crc) !== e.crc || us !== e.us) throw new Error('corrupt');
    }
  } finally { await fh.close(); }
}

// ---- миры и копии ----
async function listWorlds(instRoot, only) {
  const out = []; let insts;
  try { insts = await fsp.readdir(instRoot, { withFileTypes: true }); } catch { return out; }
  for (const i of insts) {
    if (!i.isDirectory() || i.name.startsWith('_') || (only && i.name !== only)) continue;
    const saves = path.join(instRoot, i.name, 'saves'); let ws;
    try { ws = await fsp.readdir(saves, { withFileTypes: true }); } catch { continue; }
    for (const w of ws) {
      if (!w.isDirectory() || w.name.startsWith('.')) continue;
      const dir = path.join(saves, w.name);
      if (fs.existsSync(path.join(dir, 'level.dat'))) out.push({ inst: i.name, world: w.name, dir });
    }
  }
  return out;
}

// список копий (новые сверху); inst — только один экземпляр
async function listBackups(root, inst) {
  const out = []; let dirs;
  try { dirs = inst ? [{ name: inst }] : (await fsp.readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    let fl; try { fl = await fsp.readdir(path.join(root, d.name)); } catch { continue; }
    for (const f of fl) {
      const m = NAME_RE.exec(f); if (!m) continue;
      let st; try { st = await fsp.stat(path.join(root, d.name, f)); } catch { continue; }
      out.push({ id: d.name + '/' + f, inst: d.name, key: m[1], t: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).getTime(), kind: m[8], size: st.size });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

// w = { inst, world, dir }; o = { kind: 'auto'|'manual', skipUnchanged, keep, now }
async function backupWorld(root, w, o = {}) {
  const kind = o.kind === 'auto' ? 'auto' : 'manual', now = o.now || new Date();
  const files = await walk(w.dir);
  if (!files.length) return { status: 'skip' };
  const key = safe(w.world), mtime = files.reduce((m, x) => Math.max(m, x.mtimeMs), 0);
  const all = (await listBackups(root, safe(w.inst))).filter(b => b.key === key);
  if (o.skipUnchanged && all.length && mtime <= all[0].t) return { status: 'skip' }; // с прошлой копии ничего не менялось
  const dir = path.join(root, safe(w.inst)); await fsp.mkdir(dir, { recursive: true });
  const name = `${key}__${stamp(now)}__${kind}.zip`, out = path.join(dir, name);
  try { await writeZip(out + '.part', files, w.world); await fsp.rename(out + '.part', out); }
  catch (e) { await fsp.rm(out + '.part', { force: true }); throw e; }
  if (kind === 'auto' && o.keep > 0) { // храним последние N автокопий этого мира; ручные не трогаем
    const autos = (await listBackups(root, safe(w.inst))).filter(b => b.key === key && b.kind === 'auto');
    for (const b of autos.slice(o.keep)) await fsp.rm(idPath(root, b.id), { force: true });
  }
  return { status: 'ok', id: safe(w.inst) + '/' + name, size: (await fsp.stat(out)).size };
}

function idPath(root, id) {
  const p = String(id).split('/');
  if (p.length !== 2 || !p[0] || p[0] === '..' || p[0] === '.' || !NAME_RE.test(p[1])) throw new Error('bad id');
  return path.join(root, p[0], p[1]);
}

// Восстановление никогда не перезаписывает: мир возвращается в saves рядом с текущим, в папку «<мир> (<suffix>)»
async function restore(root, instRoot, id, suffix) {
  const file = idPath(root, id), inst = id.split('/')[0];
  const ent = await readEntries(file), top = ent.length ? ent[0].name.split('/')[0] : '';
  if (!top || ent.some(e => e.name.split('/')[0] !== top)) throw new Error('bad zip');
  const saves = path.join(instRoot, inst, 'saves'); await fsp.mkdir(saves, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(saves, '.restore-'));
  try {
    await extractZip(file, tmp, ent);
    let name = `${top} (${suffix})`, n = 1;
    while (fs.existsSync(path.join(saves, name))) name = `${top} (${suffix}) ${++n}`;
    await fsp.rename(path.join(tmp, top), path.join(saves, name));
    return name;
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
}

const remove = (root, id) => fsp.rm(idPath(root, id), { force: true });

module.exports = { safe, stamp, walk, info, writeZip, readEntries, extractZip, listWorlds, listBackups, backupWorld, restore, remove, idPath };
