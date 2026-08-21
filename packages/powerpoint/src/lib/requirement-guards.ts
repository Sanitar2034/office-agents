/* global Office */

/**
 * Runtime requirement-set guards. The manifest deliberately ships without a
 * <Requirements> activation gate (it would block add-in activation on entire
 * Office builds); instead each tool checks the API level it needs and fails
 * with an actionable message when the host is older.
 *
 * API levels used by this package (per office.d.ts annotations):
 *   slides / insertSlidesFromBase64 -> PowerPointApi 1.2
 *   shapes / slideMasters          -> PowerPointApi 1.3
 *   textFrame                      -> PowerPointApi 1.4
 *   slide/shape selection          -> PowerPointApi 1.5
 *   pageSetup                      -> PowerPointApi 1.10 (M365 only)
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
