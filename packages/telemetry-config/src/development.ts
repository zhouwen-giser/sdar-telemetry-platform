/** This opt-in belongs to the development composition, never to a request header. */
export function trustedDevelopment(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = environment["TELEMETRY_TRUSTED_DEVELOPMENT"];
  if (value === undefined || value === "false") return false;
  if (value !== "true")
    throw new Error("TELEMETRY_TRUSTED_DEVELOPMENT_INVALID");
  return true;
}
export const DEVELOPMENT_PRINCIPAL = "ugv-debug-development";
