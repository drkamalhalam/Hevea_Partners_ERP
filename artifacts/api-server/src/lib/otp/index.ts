export { mayExposeOtpCode, maskOtp } from "./exposure";
export {
  sendOtp,
  auditOtpEvent,
  validateOtpTransportConfig,
  type OtpChannel,
  type OtpPurpose,
  type OtpDeliveryRequest,
  type OtpDeliveryResult,
} from "./transport";

/**
 * Standard freshness window for OTP-gated state transitions.
 * After OTP verification, the actor has this many minutes to consume it.
 */
export const OTP_FRESHNESS_WINDOW_MS = 30 * 60 * 1000;

/**
 * Returns true when an OTP verification timestamp is still within the
 * freshness window relative to `now`.
 */
export function isOtpVerificationFresh(
  otpVerifiedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!otpVerifiedAt) return false;
  return now.getTime() - otpVerifiedAt.getTime() <= OTP_FRESHNESS_WINDOW_MS;
}
