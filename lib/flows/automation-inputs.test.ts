import { describe, expect, it } from "vitest";
import {
  type AutomationInputField,
  buildApiRunInputMetadata,
  coerceAutomationInputFields,
  sampleAutomationInput,
  MAX_INPUT_FIELDS,
  validateAutomationInput,
  validateAutomationInputFields,
} from "./automation-inputs";

const fields: AutomationInputField[] = [
  {
    key: "slug",
    type: "string",
    required: true,
    pattern: "[a-z0-9-]+",
    maxLength: 40,
  },
  { key: "tier", type: "string", enum: ["basic", "pro"] },
  { key: "prospect_version", type: "integer", required: true },
  { key: "dry_run", type: "boolean" },
  { key: "business", type: "json", maxBytes: 64 },
];

function errorsFor(input: unknown) {
  const result = validateAutomationInput(fields, input);
  return result.ok ? [] : result.errors;
}

describe("validateAutomationInput", () => {
  it("should accept declared values and drop nulls for optional fields", () => {
    expect(
      validateAutomationInput(fields, {
        slug: "acme",
        prospect_version: 2,
        dry_run: false,
        tier: null,
        business: { name: "Acme" },
      })
    ).toEqual({
      ok: true,
      value: {
        slug: "acme",
        prospect_version: 2,
        dry_run: false,
        business: { name: "Acme" },
      },
    });
  });

  it("should reject unknown keys and name the accepted ones", () => {
    const [error] = errorsFor({
      slug: "acme",
      prospect_version: 1,
      prompt: "x",
    });
    expect(error).toMatch(/Unknown input "prompt"/);
    expect(error).toMatch(
      /accepts: slug, tier, prospect_version, dry_run, business/
    );
  });

  it.each([
    [
      "a missing required field",
      { slug: "acme" },
      /"prospect_version" is required/,
    ],
    ["a non-object input", ["acme"], /input must be an object/],
    [
      "a string over its length",
      { slug: "a".repeat(41), prospect_version: 1 },
      /at most 40/,
    ],
    [
      "a string outside its pattern",
      { slug: "Acme Co", prospect_version: 1 },
      /required format/,
    ],
    [
      "a partial pattern match",
      { slug: "acme/../x", prospect_version: 1 },
      /required format/,
    ],
    [
      "a value outside its enum",
      { slug: "a", prospect_version: 1, tier: "max" },
      /one of: basic, pro/,
    ],
    [
      "a fractional integer",
      { slug: "a", prospect_version: 1.5 },
      /must be an integer/,
    ],
    [
      "a string boolean",
      { slug: "a", prospect_version: 1, dry_run: "true" },
      /true or false/,
    ],
    [
      "oversized JSON",
      { slug: "a", prospect_version: 1, business: { n: "x".repeat(80) } },
      /at most 64 bytes/,
    ],
  ])("should reject %s", (_label, input, message) => {
    expect(errorsFor(input).join(" ")).toMatch(message);
  });

  it("should accept an empty input when nothing is required", () => {
    expect(
      validateAutomationInput([{ key: "note", type: "string" }], undefined)
    ).toEqual({
      ok: true,
      value: {},
    });
  });
});

describe("validateAutomationInputFields", () => {
  it("should report malformed keys, duplicates and invalid patterns", () => {
    const errors = validateAutomationInputFields([
      { key: "Slug", type: "string" },
      { key: "slug", type: "string" },
      { key: "slug", type: "string", pattern: "(" },
    ]);
    expect(errors.join(" ")).toMatch(/"Slug" must be lowercase/);
    expect(errors.join(" ")).toMatch(/"slug" is declared more than once/);
    expect(errors.join(" ")).toMatch(/"slug" has an invalid pattern/);
  });
});

describe("coerceAutomationInputFields", () => {
  it("should keep well-formed fields and the options their type allows", () => {
    expect(
      coerceAutomationInputFields([
        {
          key: "slug",
          type: "string",
          required: true,
          maxLength: 40,
          maxBytes: 9,
        },
        { key: "business", type: "json", maxBytes: 1024, pattern: "x" },
        { key: "bad", type: "date" },
        "slug",
      ])
    ).toEqual([
      { key: "slug", type: "string", required: true, maxLength: 40 },
      { key: "business", type: "json", maxBytes: 1024 },
    ]);
  });

  it("should cap the number of declared fields", () => {
    const many = Array.from({ length: MAX_INPUT_FIELDS + 5 }, (_, index) => ({
      key: `f${index}`,
      type: "string",
    }));
    expect(coerceAutomationInputFields(many)).toHaveLength(MAX_INPUT_FIELDS);
  });
});

describe("buildApiRunInputMetadata", () => {
  it("should hash input independently of key order", async () => {
    const left = await buildApiRunInputMetadata({
      scopedIdempotencyKey: "api:u:f:k",
      value: { a: 1, b: { c: 2, d: 3 } },
    });
    const right = await buildApiRunInputMetadata({
      scopedIdempotencyKey: "api:u:f:k",
      value: { b: { d: 3, c: 2 }, a: 1 },
    });
    expect(right.input_hash).toBe(left.input_hash);
    expect(left.input_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should change the hash when a value changes", async () => {
    const [left, right] = await Promise.all([
      buildApiRunInputMetadata({ scopedIdempotencyKey: "k", value: { a: 1 } }),
      buildApiRunInputMetadata({ scopedIdempotencyKey: "k", value: { a: 2 } }),
    ]);
    expect(right.input_hash).not.toBe(left.input_hash);
    expect(right.working_branch).toBe(left.working_branch);
  });
});

describe("sampleAutomationInput", () => {
  it("should build a test payload that passes the inspector's example fields", () => {
    const fields = coerceAutomationInputFields([
      { key: "slug", type: "string", required: true, pattern: "[a-z0-9-]+" },
      { key: "details", type: "json" },
    ]);

    const sample = sampleAutomationInput(fields);

    expect(validateAutomationInput(fields, sample)).toEqual({
      ok: true,
      value: sample,
    });
  });

  it("should pick an allowed value for an enum and sample every type", () => {
    const fields: AutomationInputField[] = [
      { key: "tone", type: "string", required: true, enum: ["plain", "bold"] },
      { key: "count", type: "integer" },
      { key: "draft", type: "boolean" },
    ];

    expect(sampleAutomationInput(fields)).toEqual({
      tone: "plain",
      count: 1,
      draft: false,
    });
  });

  it("should leave a strict required field empty and drop a strict optional one", () => {
    const fields: AutomationInputField[] = [
      { key: "sha", type: "string", required: true, pattern: "[a-f0-9]{40}" },
      { key: "ticket", type: "string", pattern: "[A-Z]+-[0-9]+" },
    ];

    expect(sampleAutomationInput(fields)).toEqual({ sha: "" });
  });
});
