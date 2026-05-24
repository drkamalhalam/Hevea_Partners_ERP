/**
 * OTP transport abstraction.
 *
 * Single entry point `sendOtp` chooses the active transport based on env:
 *   - OTP_TRANSPORT=stdout (default) — writes structured log line via logger.
 *   - OTP_TRANSPORT=sms    — provider-ready stub (throws until provider wired).
 *   - OTP_TRANSPORT=email  — provider-ready stub (throws until provider wired).
 *
 * Production deployments MUST set OTP_TRANSPORT to a real provider value and
 * wire the corresponding integration (Twilio / SendGrid). Until then, the
 * stub throws so a misconfigured prod deploy fails loudly rather than
 * silently dropping OTPs.
 *
 * Every send is audited via `logger` with channel + recipient (masked) +
 * purpose. The plaintext code is ONLY emitted via the stdout transport in
 * non-production environments.
 */
import { logger } from "../logger";

export type OtpChannel = "stdout" | "sms" | "email";
export type OtpPurpose =
  | "maturity_declaration"
  | "contribution_verification"
  | "expenditure_verification"
  | "project_closure_acknowledgment"
  | "transfer_workflow";

export interface OtpDeliveryRequest {
  purpose: OtpPurpose;
  recipient: { name?: string | null; phone?: string | null; email?: string | null };
  code: string;
  expiresAt: Date;
  subjectId: string;
  metadata?: Record<string, unknown>;
}

export interface OtpDeliveryResult {
  channel: OtpChannel;
  deliveredAt: Date;
  recipientMasked: string;
}

function maskRecipient(r: OtpDeliveryRequest["recipient"]): string {
  if (r.phone) {
    const digits = r.phone.replace(/\D/g, "");
    return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
  }
  if (r.email) {
    const [local, domain] = r.email.split("@");
    if (!domain) return "***";
    return `${(local ?? "").slice(0, 2)}***@${domain}`;
  }
  return r.name ? `${r.name.slice(0, 2)}***` : "anonymous";
}

function resolveChannel(): OtpChannel {
  const t = process.env.OTP_TRANSPORT;
  if (t === "sms" || t === "email" || t === "stdout") return t;
  return "stdout";
}

export async function sendOtp(req: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
  const channel = resolveChannel();
  const recipientMasked = maskRecipient(req.recipient);
  const deliveredAt = new Date();

  if (channel === "stdout") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "OTP_TRANSPORT=stdout is not permitted in production. " +
          "Set OTP_TRANSPORT to 'sms' or 'email' and wire a provider integration."
      );
    }
    logger.info(
      {
        otp: {
          purpose: req.purpose,
          subjectId: req.subjectId,
          recipientMasked,
          code: req.code,
          expiresAt: req.expiresAt.toISOString(),
          channel: "stdout",
        },
      },
      "[OTP DEV] Code issued"
    );
    return { channel, deliveredAt, recipientMasked };
  }

  // Provider-ready stubs — throw until real provider is wired.
  logger.error(
    { purpose: req.purpose, subjectId: req.subjectId, channel },
    "OTP transport not implemented for requested channel"
  );
  throw new Error(
    `OTP transport '${channel}' is configured but no provider is wired. ` +
      "Wire the corresponding integration before issuing OTPs in this channel."
  );
}

/**
 * Structured audit log for any OTP lifecycle event.
 * Use for: issued, verified, expired, failed.
 */
export function auditOtpEvent(event: {
  purpose: OtpPurpose;
  subjectId: string;
  outcome: "issued" | "verified" | "expired" | "failed";
  actorId?: string | null;
  recipientMasked?: string;
  metadata?: Record<string, unknown>;
}): void {
  logger.info(
    {
      otpAudit: {
        purpose: event.purpose,
        subjectId: event.subjectId,
        outcome: event.outcome,
        actorId: event.actorId ?? null,
        recipientMasked: event.recipientMasked ?? null,
        ...event.metadata,
      },
    },
    `[OTP AUDIT] ${event.purpose} ${event.outcome}`
  );
}
