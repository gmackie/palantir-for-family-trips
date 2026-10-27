const SHARE_HANDOFF =
  /^((?:sortey|sortey-dev|sortey-expo)):\/\/dataUrl=\1ShareKey(?:\?nonce=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?(?:#(?:media|file|text|weburl))?$/i;

/** Extension handoffs are transport URLs, not Expo Router page addresses. */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  return SHARE_HANDOFF.test(path) ? "/" : path;
}
