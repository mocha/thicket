import './automatic.js';
import { browserApi as api, instanceOrigin, createClient, followingSnapshot } from './core.js';
const $ = id => document.getElementById(id);
const stored = await api.storage.local.get('settings');
if (stored.settings) {
  $('instance').value = stored.settings.instance;
  $('disconnect').hidden = false;
  $('token').placeholder = 'Paste a token to reconnect';
}
function accountLink() {
  try { $('account').href = `${instanceOrigin($('instance').value)}/account`; }
  catch { $('account').removeAttribute('href'); }
}
$('instance').addEventListener('input', accountLink);
accountLink();
$('connect').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const settings = { instance: instanceOrigin($('instance').value), token: $('token').value.trim() };
    if (!/^thk_rw_[A-Za-z0-9_-]{43}$/.test(settings.token)) throw new Error('Paste a full-access token (thk_rw_…) from the Account page.');
    const allowed = await api.permissions.request({ origins: [`${settings.instance}/*`] });
    if (!allowed) throw new Error('Access to your instance is needed to connect.');
    await createClient(settings)('/collections');
    await api.storage.local.set({ settings });
    await api.storage.local.remove('following');
    const following = await followingSnapshot(createClient(settings));
    await api.storage.local.set({ following });
    $('token').value = '';
    $('disconnect').hidden = false;
    $('status').textContent = 'Connected. Open a page and click thicket in the toolbar.';
  } catch (error) { $('status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('disconnect').addEventListener('click', async () => {
  await api.storage.local.remove(['settings', 'following']);
  $('token').value = '';
  $('disconnect').hidden = true;
  $('status').textContent = 'Disconnected. You can revoke the token on your Account page.';
});

$('detection').addEventListener('click', async () => {
  try {
    const granted = await api.permissions.request({ origins: ['https://*/*', 'http://*/*'] });
    if (granted) {
      await api.storage.local.set({ automaticDetection: true });
      await globalThis.configureThicketDiscovery(true);
    }
    $('status').textContent = granted ? 'Automatic badges enabled. Reload existing tabs to detect their feeds.' : 'You can still discover feeds by clicking the toolbar icon.';
  } catch (error) { $('status').textContent = error.message; }
});

$('stop-detection').addEventListener('click', async () => {
  try {
    await api.storage.local.set({ automaticDetection: false });
    await globalThis.configureThicketDiscovery(false);
    $('status').textContent = 'Automatic discovery disabled. Reload existing tabs to remove their discovery scripts. Click the toolbar icon to discover on demand.';
  } catch (error) { $('status').textContent = error.message; }
});
