/**
 * OTP exposure gate.
 *
 * The plaintext OTP code may only be returned in API responses when BOTH:
 *   1. NODE_ENV !== "production"
 *   2. EXPOSE_OTP === "true"
 *
 * In all other environments (production, or dev without the explicit flag),
 * OTP codes must NEVER appear in response bodies. The actor must obtain the
 * code via the configured transport (SMS/email in prod, logger in dev).
 */
export function mayExposeOtpCode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.EXPOSE_OTP === "true";
}

/**
 * Returns the OTP code only when exposure is permitted, otherwise null.
 * Use as: `otpCodePlaceholder: maskOtp(code)`.
 */
export function maskOtp(code: string | null | undefined): string | null {
  if (!code) return null;
  return mayExposeOtpCode() ? code : null;
}
