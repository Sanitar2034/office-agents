/* global Office */

/**
 * Pin the taskpane: ask the Office host to re-open it automatically every
 * time the document (re)opens. Persists across Excel restarts; without it
 * a dev-registered add-in loads silently and the user must click the
 * ribbon button each session.
 */
export async function pinTaskpane(): Promise<boolean> {
  try {
    const office = (globalThis as { Office?: any }).Office;
    const setStartupBehavior = office?.addin?.setStartupBehavior;
    if (typeof setStartupBehavior !== "function") return false;

    const load = office.StartupBehavior?.load ?? 1;
    await setStartupBehavior.call(office.addin, load);
    return true;
  } catch {
    return false;
  }
}
