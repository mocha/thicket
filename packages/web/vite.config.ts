import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// In dev, the browser talks to the SvelteKit dev server, which proxies /api to
// the Hono API. The frontend never knows where the API lives.
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: true,
    // Allow any LAN hostname so the dev server can be opened from a phone or
    // another machine on the network. Dev-only; not the deploy story.
    allowedHosts: ['.lan', '.local', 'localhost'],
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } }
  }
});
