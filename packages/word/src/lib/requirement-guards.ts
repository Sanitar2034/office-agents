/* global Office */

/**
 * Runtime requirement-set guards. The manifest deliberately ships without a
 * <Requirements> activation gate (it would block add-in activation on entire
 * Office builds); instead each tool checks the API level it needs and fails
 * with an actionable message when the host is older.
 *
 * API levels used by this package's optional features (per office.d.ts
 * annotations); core tools only need WordApi 1.1:
 *   changeTrackingMode            -> WordApiOnline 1.1
 *   body pages / page count       -> WordApiDesktop 1.2
 *   getStyles / style inspection  -> WordApi 1.5
 */
export function requirementSetSupported(
  setName: string,
  version: string,
): boolean {
  try {
    const req = (globalThis as { Office?: any }).Office?.context?.requirements;
    if (typeof req?.isSetSupported !== "function") return false;
    return req.isSetSupported(setName, version) === true;
  } catch {
    return false;
  }
}

export function unsupportedFeatureMessage(
  setName: string,
  version: string,
  feature: string,
): string {
  return (
    `${feature} requires ${setName} ${version}, which this Office build does ` +
    `not support. The tool is unavailable on this host — note that perpetual ` +
    `LTSC builds cap the ${setName} level below Microsoft 365 builds.`
  );
}

/** Returns undefined when the feature may run, an error message otherwise. */
export function guardRequirementSet(
  setName: string,
  version: string,
  feature: string,
): string | undefined {
  return requirementSetSupported(setName, version)
    ? undefined
    : unsupportedFeatureMessage(setName, version, feature);
}
