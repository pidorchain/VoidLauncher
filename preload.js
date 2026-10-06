const { contextBridge, ipcRenderer: r } = require('electron');
const inv = c => (...a) => r.invoke(c, ...a);
const on = c => cb => r.on(c, (_, d) => cb(d));
contextBridge.exposeInMainWorld('api', {
  state: inv('state'), versions: inv('versions'), save: inv('save'),
  addOffline: inv('addOffline'), addMs: inv('addMs'), remove: inv('remove'), select: inv('select'),
  launch: inv('launch'), modsSearch: inv('modsSearch'), modsInstall: inv('modsInstall'), modsList: inv('modsList'), modsRemove: inv('modsRemove'), version: inv('version'), ext: inv('ext'), installed: inv('installed'), install: inv('install'), open: inv('open'), win: inv('win'),
  onProgress: on('progress'), onList: on('list'), onLog: on('log')
});
