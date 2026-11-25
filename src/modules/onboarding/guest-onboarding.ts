export const GUEST_ONBOARDING_KEY = "yanko-guest-onboarding-v1";

/** This preference controls the guest welcome screen; it never authenticates a user. */
export function hasGuestOnboarding() {
  try {
    return window.localStorage.getItem(GUEST_ONBOARDING_KEY) === "complete";
  } catch {
    return false;
  }
}

export function rememberGuestOnboarding() {
  window.localStorage.setItem(GUEST_ONBOARDING_KEY, "complete");
}
