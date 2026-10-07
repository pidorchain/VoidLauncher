'use strict';
// Список серверов: разбор адреса и опрос сервера по протоколу Minecraft (Server List Ping).
// Модуль не зависит от Electron — его можно тестировать обычным Node.
const net = require('net'), dns = require('dns').promises;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
// "host" | "host:port" | "minecraft://host:port" → { host, port|null }; неверный адрес → null
function parseAddr(a) {
  a = String(a == null ? '' : a).trim().replace(/^minecraft:\/\//i, '');
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(a);
  if (!m) return null;
  const host = m[1].toLowerCase(), port = m[2] ? +m[2] : null;
  if (host.length > 253 || !host.split('.').every(l => LABEL.test(l))) return null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host, port };
}
const fmtAddr = h => h.host + (h.port ? ':' + h.port : '');

// --- кодирование пакетов ---
const vint = n => { const b = []; n >>>= 0; do { let x = n & 127; n >>>= 7; if (n) x |= 128; b.push(x); } while (n); return Buffer.from(b); };
const frame = b => Buffer.concat([vint(b.length), b]);
const mstr = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([vint(b.length), b]); };
const rvint = (b, o) => { let n = 0, s = 0; for (;;) { if (o >= b.length) return null; const x = b[o++]; n += (x & 127) * 2 ** s; if (!(x & 128)) return [n, o]; s += 7; if (s > 35) throw new Error('bad varint'); } };

// --- разбор ответа ---
const strip = s => String(s == null ? '' : s).replace(/§[0-9a-fk-or]/gi, '');
const flat = d => typeof d === 'string' ? d : Array.isArray(d) ? d.map(flat).join('') : d && typeof d === 'object' ? (d.text || '') + flat(d.extra || []) : '';
const motd = d => strip(flat(d)).split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 2).join(' · ').slice(0, 160);
const summary = (info, ms) => {
  const p = info.players || {}, f = info.favicon;
  return {
    ok: true, ping: Math.max(1, Math.round(ms)), online: +p.online || 0, max: +p.max || 0,
    sample: (Array.isArray(p.sample) ? p.sample : []).map(x => strip(x && x.name).trim()).filter(Boolean).slice(0, 8),
    version: strip(info.version && info.version.name).slice(0, 40), motd: motd(info.description),
    // иконка приходит от чужого сервера — пропускаем только настоящий PNG в base64
    icon: typeof f === 'string' && f.length < 100000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(f) ? f : ''
  };
};

// Для "host" без порта клиент Minecraft смотрит SRV-запись _minecraft._tcp
async function resolveTarget(h) {
  if (h.port) return { host: h.host, port: h.port };
  if (!net.isIP(h.host)) {
    let t;
    try {
      const r = await Promise.race([dns.resolveSrv('_minecraft._tcp.' + h.host), new Promise((_, j) => { t = setTimeout(j, 2000); })]);
      if (r && r[0] && r[0].name) return { host: r[0].name, port: r[0].port };
    } catch {} finally { clearTimeout(t); }
  }
  return { host: h.host, port: 25565 };
}

// → { ok:true, ping, online, max, sample[], version, motd, icon } | { ok:false, error:'timeout'|'refused'|'dns'|'bad' }
async function ping(h, opt = {}) {
  const timeout = opt.timeout || 6000, tgt = await resolveTarget(h);
  return new Promise(resolve => {
    let done = false, buf = Buffer.alloc(0), stage = 0, info = null, tReq = 0, tPing = 0, pt = null;
    const sock = net.createConnection({ host: tgt.host, port: tgt.port });
    const end = r => { if (done) return; done = true; clearTimeout(tm); clearTimeout(pt); sock.destroy(); resolve(r); };
    const fail = error => end({ ok: false, error });
    const finish = ms => end(summary(info, ms));
    const tm = setTimeout(() => info ? finish(tPing - tReq) : fail('timeout'), timeout);
    sock.setNoDelay(true);
    sock.on('connect', () => {
      const hs = Buffer.concat([vint(0), vint(767), mstr(h.host), Buffer.from([tgt.port >> 8, tgt.port & 255]), vint(1)]);
      tReq = Date.now(); sock.write(Buffer.concat([frame(hs), frame(vint(0))]));
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      try {
        for (;;) {
          const L = rvint(buf, 0); if (!L) return;
          const [len, o] = L;
          if (len > 2097152) return fail('bad');
          if (buf.length < o + len) return;
          const p = buf.subarray(o, o + len); buf = buf.subarray(o + len);
          const [id, o2] = rvint(p, 0);
          if (stage === 0 && id === 0) {
            const [sl, o3] = rvint(p, o2);
            info = JSON.parse(p.toString('utf8', o3, o3 + sl)); stage = 1; tPing = Date.now();
            const pl = Buffer.alloc(8); pl.writeBigInt64BE(BigInt(tPing));
            sock.write(frame(Buffer.concat([vint(1), pl])));
            pt = setTimeout(() => finish(tPing - tReq), 1500); // сервер не ответил на ping — берём время ответа на status
          } else if (stage === 1 && id === 1) return finish(Date.now() - tPing);
          else if (stage === 0) return fail('bad'); // первым должен прийти status-ответ, иначе это не Minecraft-сервер
        }
      } catch { fail('bad'); }
    });
    sock.on('error', e => info ? finish(tPing - tReq) : fail(e.code === 'ECONNREFUSED' ? 'refused' : /^(ENOTFOUND|EAI_AGAIN)$/.test(e.code) ? 'dns' : 'timeout'));
    sock.on('close', () => info ? finish(tPing - tReq) : fail('bad'));
  });
}

module.exports = { parseAddr, fmtAddr, ping };
