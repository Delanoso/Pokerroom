import { randomInt } from "node:crypto";

/** Numeric login password for operator-created player accounts (10 digits). */
export function generateTenDigitPassword(): string {
  return String(randomInt(0, 10_000_000_000)).padStart(10, "0");
}
