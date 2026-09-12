/** One toast at a time, optionally with an undo action. Cheap undo is the product's primary safety net. */
type Toast = { id: number; message: string; action?: { label: string; run: () => void | Promise<void> } };
let counter = 0;
export const toast = $state<{ current: Toast | null }>({ current: null });
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, action?: Toast['action'], ms = 6000) {
  clearTimeout(timer);
  toast.current = { id: ++counter, message, action };
  timer = setTimeout(() => (toast.current = null), ms);
}
export function dismissToast() {
  clearTimeout(timer);
  toast.current = null;
}
