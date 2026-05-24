/**
 * OTP transport abstraction.
 *
 * Single entry point `sendOtp` chooses the active transport based on env:
 *   - OTP_TRANSPORT=stdout   — dev only; writes structured log line via logger.
 *   - OTP_TRANSPORT=webhook  — POSTs delivery payload to OTP_WEBHOOK_URL.
 *   - OTP_TRANSPORT=sms      — Twilio REST API (Messages resource).
 *   - OTP_TRANSPORT=email    — SendGrid v3 mail/send API.
 *
 * Required environment variables per channel:
 *   webhook : OTP_WEBHOOK_URL
 *             OTP_WEBHOOK_AUTH_HEADER         (optional, sent as Authorization)
 *   sms     : TWILIO_ACCOUNT_SID
 *             TWILIO_AUTH_TOKEN
 *             TWILIO_FROM_NUMBER              (E.164, e.g. +15551234567)
 *   email   : SENDGRID_API_KEY
 *             OTP_EMAIL_FROM                  (sender address)
 *             OTP_EMAIL_FROM_NAME             (optional, display name)
 *
 * Startup validation:
 *   `validateOtpTransportConfig()` MUST be called at boot. In production it
 *   refuses `stdout` and fails fast if any selected provider is missing its
 *   required vars. In development the same channels work but stdout is the
 *   default and no validation throws.
 *
 * Every send is audited via `logger` with channel + recipient (masked) +
 * purpose. The plaintext code is ONLY emitted via the stdout transport in
 * non-production environments.
 */
import { logger } from "../logger";

export type OtpChannel = "stdout" | "webhook" | "sms" | "email";
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
  providerMessageId?: string;
}

// ── Recipient masking ────────────────────────────────────────────────────────

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

// ── Channel resolution ───────────────────────────────────────────────────────

function resolveChannel(): OtpChannel {
  const t = process.env["OTP_TRANSPORT"];
  if (t === "sms" || t === "email" || t === "webhook" || t === "stdout") return t;
  return "stdout";
}

// ── Startup validation ───────────────────────────────────────────────────────

/**
 * Verify the OTP transport configuration at boot. In production this MUST
 * throw if the configuration cannot deliver OTPs — failing the deploy is
 * preferred to silently dropping codes at runtime.
 */
export function validateOtpTransportConfig(): {
  channel: OtpChannel;
  mode: "development" | "production";
} {
  const isProd = process.env["NODE_ENV"] === "production";
  const channel = resolveChannel();

  if (isProd && channel === "stdout") {
    throw new Error(
      "OTP_TRANSPORT=stdout is not permitted in production. " +
        "Set OTP_TRANSPORT to 'webhook', 'sms', or 'email' and provide the " +
        "corresponding provider environment variables.",
    );
  }

  const missing: string[] = [];
  if (channel === "webhook") {
    if (!process.env["OTP_WEBHOOK_URL"]) missing.push("OTP_WEBHOOK_URL");
  } else if (channel === "sms") {
    if (!process.env["TWILIO_ACCOUNT_SID"]) missing.push("TWILIO_ACCOUNT_SID");
    if (!process.env["TWILIO_AUTH_TOKEN"]) missing.push("TWILIO_AUTH_TOKEN");
    if (!process.env["TWILIO_FROM_NUMBER"]) missing.push("TWILIO_FROM_NUMBER");
  } else if (channel === "email") {
    if (!process.env["SENDGRID_API_KEY"]) missing.push("SENDGRID_API_KEY");
    if (!process.env["OTP_EMAIL_FROM"]) missing.push("OTP_EMAIL_FROM");
  }

  if (missing.length > 0) {
    const msg =
      `OTP_TRANSPORT=${channel} is selected but required environment variables are missing: ${missing.join(", ")}.`;
    if (isProd) {
      throw new Error(msg);
    }
    logger.warn({ missing, channel }, msg + " (non-prod: continuing, sends will fail at runtime)");
  }

  logger.info({ channel, mode: isProd ? "production" : "development" }, "OTP transport configured");
  return { channel, mode: isProd ? "production" : "development" };
}

// ── Provider implementations ─────────────────────────────────────────────────

function renderMessage(req: OtpDeliveryRequest): { subject: string; text: string } {
  const minutes = Math.max(1, Math.round((req.expiresAt.getTime() - Date.now()) / 60_000));
  const subject = `Hevea Partners verification code (${req.purpose.replace(/_/g, " ")})`;
  const text =
    `Your verification code is ${req.code}. It expires in ${minutes} minute(s). ` +
    `Do not share this code with anyone.`;
  return { subject, text };
}

async function sendViaStdout(
  req: OtpDeliveryRequest,
  recipientMasked: string,
): Promise<OtpDeliveryResult> {
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
    "[OTP DEV] Code issued",
  );
  return { channel: "stdout", deliveredAt: new Date(), recipientMasked };
}

async function sendViaWebhook(
  req: OtpDeliveryRequest,
  recipientMasked: string,
): Promise<OtpDeliveryResult> {
  const url = process.env["OTP_WEBHOOK_URL"];
  if (!url) {
    throw new Error("OTP_WEBHOOK_URL is not configured");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = process.env["OTP_WEBHOOK_AUTH_HEADER"];
  if (auth) headers["authorization"] = auth;

  const body = {
    purpose: req.purpose,
    subjectId: req.subjectId,
    recipient: {
      name: req.recipient.name ?? null,
      phone: req.recipient.phone ?? null,
      email: req.recipient.email ?? null,
    },
    code: req.code,
    expiresAt: req.expiresAt.toISOString(),
    metadata: req.metadata ?? {},
  };

  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OTP webhook delivery failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const json = (await resp.json().catch(() => ({}))) as { messageId?: string };
  return {
    channel: "webhook",
    deliveredAt: new Date(),
    recipientMasked,
    providerMessageId: json.messageId,
  };
}

async function sendViaSms(
  req: OtpDeliveryRequest,
  recipientMasked: string,
): Promise<OtpDeliveryResult> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!sid || !token || !from) {
    throw new Error(
      "Twilio configuration incomplete (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER required)",
    );
  }
  const to = req.recipient.phone;
  if (!to) {
    throw new Error("OTP recipient phone number missing — cannot send SMS");
  }
  const { text } = renderMessage(req);
  const body = new URLSearchParams({ To: to, From: from, Body: text });
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Twilio SMS delivery failed: HTTP ${resp.status} ${detail.slice(0, 200)}`);
  }
  const json = (await resp.json().catch(() => ({}))) as { sid?: string };
  return {
    channel: "sms",
    deliveredAt: new Date(),
    recipientMasked,
    providerMessageId: json.sid,
  };
}

async function sendViaEmail(
  req: OtpDeliveryRequest,
  recipientMasked: string,
): Promise<OtpDeliveryResult> {
  const apiKey = process.env["SENDGRID_API_KEY"];
  const from = process.env["OTP_EMAIL_FROM"];
  const fromName = process.env["OTP_EMAIL_FROM_NAME"] ?? "Hevea Partners";
  if (!apiKey || !from) {
    throw new Error(
      "SendGrid configuration incomplete (SENDGRID_API_KEY, OTP_EMAIL_FROM required)",
    );
  }
  const to = req.recipient.email;
  if (!to) {
    throw new Error("OTP recipient email missing — cannot send email");
  }
  const { subject, text } = renderMessage(req);
  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: fromName },
      subject,
      content: [{ type: "text/plain", value: text }],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`SendGrid email delivery failed: HTTP ${resp.status} ${detail.slice(0, 200)}`);
  }
  // SendGrid returns 202 with X-Message-Id header
  const providerMessageId = resp.headers.get("x-message-id") ?? undefined;
  return { channel: "email", deliveredAt: new Date(), recipientMasked, providerMessageId };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function sendOtp(req: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
  const channel = resolveChannel();
  const recipientMasked = maskRecipient(req.recipient);

  if (channel === "stdout" && process.env["NODE_ENV"] === "production") {
    throw new Error(
      "OTP_TRANSPORT=stdout is not permitted in production. " +
        "Set OTP_TRANSPORT to 'webhook', 'sms', or 'email'.",
    );
  }

  try {
    let result: OtpDeliveryResult;
    if (channel === "stdout") result = await sendViaStdout(req, recipientMasked);
    else if (channel === "webhook") result = await sendViaWebhook(req, recipientMasked);
    else if (channel === "sms") result = await sendViaSms(req, recipientMasked);
    else result = await sendViaEmail(req, recipientMasked);

    auditOtpEvent({
      purpose: req.purpose,
      subjectId: req.subjectId,
      outcome: "issued",
      recipientMasked,
      metadata: { channel, providerMessageId: result.providerMessageId ?? null },
    });

    return result;
  } catch (err) {
    logger.error(
      { err, purpose: req.purpose, subjectId: req.subjectId, channel },
      "OTP delivery failed",
    );
    auditOtpEvent({
      purpose: req.purpose,
      subjectId: req.subjectId,
      outcome: "failed",
      recipientMasked,
      metadata: { channel, reason: "delivery_error" },
    });
    throw err;
  }
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
    `[OTP AUDIT] ${event.purpose} ${event.outcome}`,
  );
}
