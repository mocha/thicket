import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * The web app is a static SPA (ssr = false everywhere) served by the API
 * process in production, so one container is the whole install. `fallback`
 * makes every unknown path load index.html and let the client router take
 * over. When public pages need SSR, swap this for adapter-node and put the
 * SvelteKit server in front of the API; nothing else changes.
 */
const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter({ fallback: 'index.html', strict: false }) }
};

export default config;
