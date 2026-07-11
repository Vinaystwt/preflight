export function resolveSelftestTarget(value: string | undefined, publicDomain: string): URL {
  const url = new URL(value ?? `https://${publicDomain}/api/v1/run_preflight`);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/api/v1/run_preflight";
  return url;
}
