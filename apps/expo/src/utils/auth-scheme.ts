export function resolveAuthScheme(
  scheme: string | string[] | undefined,
): string {
  if (Array.isArray(scheme)) return scheme[0] ?? "sortey";
  return scheme ?? "sortey";
}
