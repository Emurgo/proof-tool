import { describe, expect, it } from "vitest";
import { sanitizeProviderSubmitError } from "./build-submit";

describe("claim submit provider error sanitization", () => {
  it("keeps ledger rejection text while redacting sensitive transport payloads", () => {
    const message = sanitizeProviderSubmitError(
      new Error(
        `Bad Request: ApplyTxError MissingVKeyWitnessesUTXOW ${"ab".repeat(120)} addr_test1q${"p".repeat(80)} project_id secret-project-id`,
      ),
    );

    expect(message).toContain("Bad Request");
    expect(message).toContain("MissingVKeyWitnessesUTXOW");
    expect(message).toContain("[hex-redacted]");
    expect(message).toContain("[address-redacted]");
    expect(message).not.toContain("ab".repeat(80));
    expect(message).not.toContain("addr_test1q");
    expect(message).not.toContain("secret-project-id");
  });

  it("redacts long token-like provider strings", () => {
    const message = sanitizeProviderSubmitError(`submit failed ${"Z".repeat(120)}`);

    expect(message).toBe("submit failed [token-redacted]");
  });
});
