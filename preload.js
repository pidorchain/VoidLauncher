const { contextBridge, ipcRenderer: r } = require('electron');
const inv = c => (...a) => r.invoke(c, ...a);
const on = c => cb => r.on(c, (_, d) => cb(d));
contextBridge.exposeInMainWorld('api', {
  state: inv('state'), profile: inv('profile'), profileAuth: inv('profileAuth'), profileLogout: inv('profileLogout'), bgPick: inv('bgPick'), bgClear: inv('bgClear'), versions: inv('versions'), save: inv('save'),
  addOffline: inv('addOffline'), addMs: inv('addMs'), remove: inv('remove'), select: inv('select'),
  launch: inv('launch'), modsSearch: inv('modsSearch'), modsInstall: inv('modsInstall'), modsList: inv('modsList'), modsRemove: inv('modsRemove'), version: inv('version'), ext: inv('ext'), installed: inv('installed'), install: inv('install'), open: inv('open'), win: inv('win'),
  stats: inv('stats'), onStats: on('stats'), news: inv('news'),
  bkWorlds: inv('bkWorlds'), bkList: inv('bkList'), bkRun: inv('bkRun'), bkRestore: inv('bkRestore'), bkDel: inv('bkDel'), bkOpen: inv('bkOpen'),
  softs: inv('softs'), softInstall: inv('softInstall'), softRemove: inv('softRemove'), softRun: inv('softRun'),
  crList: inv('crList'), crAnalyze: inv('crAnalyze'), crShow: inv('crShow'), crFix: inv('crFix'), onCrash: on('crash'),
  skState: inv('skState'), skSave: inv('skSave'), skDel: inv('skDel'), skPick: inv('skPick'), skFetch: inv('skFetch'), skCurrent: inv('skCurrent'), skExport: inv('skExport'), skApply: inv('skApply'), skProfile: inv('skProfile'), skCape: inv('skCape'),
  srvList: inv('srvList'), srvAdd: inv('srvAdd'), srvDel: inv('srvDel'), srvFav: inv('srvFav'), srvPing: inv('srvPing'),
  onProgress: on('progress'), onFull: on('full'), onList: on('list'), onLog: on('log')
});
