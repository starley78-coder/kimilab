/**
 * Short-lived memo of the last server-validated user, so navigating between
 * conversations does not re-validate the session with the auth server every time.
 * The server endpoints validate the bearer token on every request regardless.
 */
const TTL_MS = 5 * 60 * 1000;

let lastValidated: { userId: string; at: number } | null = null;

export function rememberValidatedUser(userId: string) {
  lastValidated = { userId, at: Date.now() };
}

export function isRecentlyValidated(userId: string): boolean {
  return (
    !!lastValidated && lastValidated.userId === userId && Date.now() - lastValidated.at < TTL_MS
  );
}

export function resetValidatedUser() {
  lastValidated = null;
}
