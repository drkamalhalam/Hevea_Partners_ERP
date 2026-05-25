/**
 * money — re-export from @workspace/db (canonical single source of truth).
 *
 * All money utility logic lives in lib/db/src/money.ts.
 * This barrel exists for backward-compatible imports within the api-server
 * (import from "../lib/money" continues to work without changes).
 *
 * Only money-specific symbols are re-exported to avoid leaking DB schema
 * symbols through this barrel.
 */
export {
  toMoney,
  fromMoney,
  formatMoney,
  parseMoneyFromDb,
  addMoney,
  sumMoney,
  subMoney,
  mulMoney,
  splitMoney,
  isZeroMoney,
  gtMoney,
  gteMoney,
  ltMoney,
  lteMoney,
  MONEY_SCALE,
  ZERO,
  Decimal,
} from "@workspace/db";
export type { MoneyInput } from "@workspace/db";
