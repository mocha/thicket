import { authApi, type InstanceStatus } from '$lib/api';

/**
 * The instance's public details (its name, address, sign-up policy), shared by
 * every screen that names the site to a signed-out visitor. Null until the
 * first load arrives. Each load asks again, so a screen opened after an admin
 * closes sign-ups sees the change without a reload. If the request fails, it
 * falls back to open sign-ups under the product's own name so the forms still work.
 */
export const site = $state<{ status: InstanceStatus | null }>({ status: null });

export function loadSite(): Promise<InstanceStatus> {
  return authApi.status()
    .catch((): InstanceStatus => ({ name: 'thicket', url: '', signups: 'open', visitorLimit: true }))
    .then((s) => (site.status = s));
}

/** The site's address without the scheme, for showing a page address: "bookclub.example". */
export function siteHost(s: InstanceStatus | null): string {
  return (s?.url ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
