import { describe, expect, it } from "vitest";
import {
  assertPushHeadStable,
  parsePrPushArgs,
} from "./push-pr-with-local-claim-flow.mjs";

describe("PR push with local live claim", () => {
  it("requires an explicit live-Preprod acknowledgement", () => {
    expect(parsePrPushArgs(["--live-preprod"])).toEqual({ livePreprod: true, remote: "origin" });
    expect(parsePrPushArgs(["--live-preprod", "--remote", "upstream"])).toEqual({
      livePreprod: true,
      remote: "upstream",
    });
    expect(() => parsePrPushArgs([])).toThrowError(
      expect.objectContaining({ code: "local_live_preprod_approval_missing" }),
    );
    expect(() => parsePrPushArgs(["--live-preprod", "--remote", "bad remote"])).toThrowError(
      expect.objectContaining({ code: "local_push_remote_invalid" }),
    );
  });

  it("pushes only the exact clean commit that completed the browser claim", () => {
    const stable = {
      afterBranch: "colll78/feature",
      afterSha: "a".repeat(40),
      afterStatus: "",
      testedBranch: "colll78/feature",
      testedSha: "a".repeat(40),
    };
    expect(() => assertPushHeadStable(stable)).not.toThrow();
    expect(() => assertPushHeadStable({ ...stable, afterSha: "b".repeat(40) })).toThrowError(
      expect.objectContaining({ code: "local_push_head_changed" }),
    );
    expect(() => assertPushHeadStable({ ...stable, afterStatus: " M changed.ts" })).toThrowError(
      expect.objectContaining({ code: "local_push_head_changed" }),
    );
  });
});
