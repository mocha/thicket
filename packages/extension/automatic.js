// Dynamic registration makes the off switch stop injection on future pages.
globalThis.configureThicketDiscovery = async function(enabled) {
  const api = globalThis.browser || globalThis.chrome;
  const registered = await api.scripting.getRegisteredContentScripts({ ids: ['thicket-discovery'] });
  if (enabled && !registered.length) {
    await api.scripting.registerContentScripts([{
      id: 'thicket-discovery', matches: ['https://*/*', 'http://*/*'],
      js: ['discovery.js'], runAt: 'document_idle',
    }]);
  } else if (!enabled && registered.length) {
    await api.scripting.unregisterContentScripts({ ids: ['thicket-discovery'] });
  }
};
