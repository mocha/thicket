// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		/** Shallow-routing state: the in-app reader is open on this post (lib/reader.svelte.ts); the page this one was reached from (lib/wayback.svelte.ts). */
		interface PageState { reader?: number; cameFrom?: import('$lib/wayback.svelte').Place }
		// interface Platform {}
	}
}

export {};
