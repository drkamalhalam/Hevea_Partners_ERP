import app from "./app";
import { logger } from "./lib/logger";
import { seedDocumentVariableRegistry } from "./lib/seedVariableRegistry";
import { ensureOwnershipAttributionConstraint } from "./lib/ownershipAttributionGuard";
import { validateOtpTransportConfig } from "./lib/otp";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Fail fast at boot if OTP transport is misconfigured. In production this
// refuses stdout and requires the provider env vars for the selected channel.
validateOtpTransportConfig();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  seedDocumentVariableRegistry().catch((seedErr) => {
    logger.warn({ err: seedErr }, "Document variable registry seed failed");
  });
  ensureOwnershipAttributionConstraint().catch((constraintErr) => {
    logger.warn(
      { err: constraintErr },
      "Failed to ensure ownership attribution CHECK constraint",
    );
  });
});
