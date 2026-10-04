/**
 * The "Send feedback" sheet is app-wide, like Add a feed: the account menu
 * opens it over whatever page you are on. One store, one sheet mounted in the
 * layout.
 */
export const feedback = $state<{ open: boolean }>({ open: false });

export function openFeedback() {
  feedback.open = true;
}
export function closeFeedback() {
  feedback.open = false;
}
