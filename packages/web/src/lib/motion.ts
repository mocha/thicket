/**
 * How a scroll done in code should move: gliding, unless the reader has asked
 * their device for less motion, in which case it jumps. The stylesheet handles
 * everything else for them (app.css); a scroll asked for in code ignores the
 * stylesheet, so it asks here.
 */
export const scrollBehavior = (): ScrollBehavior =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
