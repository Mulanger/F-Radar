import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { HttpProblem } from "../errors";

export function normalizeSwedishPhone(input: string): string {
  const phone = parsePhoneNumberFromString(input, {
    defaultCountry: "SE",
    extract: false,
  });
  if (
    !phone ||
    phone.country !== "SE" ||
    !phone.isValid() ||
    phone.getType() !== "MOBILE"
  )
    throw new HttpProblem(400, "Ange ett giltigt svenskt mobilnummer");
  return phone.number;
}
export interface PhoneVerificationProvider {
  readonly available: boolean;
  begin(phone: string, code: string): Promise<void>;
}
export class UnavailableVerificationProvider
  implements PhoneVerificationProvider
{
  readonly available = false;
  async begin(): Promise<void> {
    throw new HttpProblem(503, "Verifiering är inte tillgänglig ännu");
  }
}
/** Only directly injectable in non-production automated tests; no env flag enables it. */
export class FakeVerificationProvider implements PhoneVerificationProvider {
  readonly available = true;
  readonly codes = new Map<string, string>();
  constructor(nodeEnv: string) {
    if (nodeEnv === "production")
      throw new Error("Fake verification forbidden in production");
  }
  async begin(phone: string, code: string) {
    this.codes.set(phone, code);
  }
}
export const newVerificationCode = () => String(randomInt(100000, 1000000));
export const verificationHash = (id: string, phone: string, code: string) =>
  createHash("sha256").update(`${id}:${phone}:${code}`).digest("hex");
export function codeMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
