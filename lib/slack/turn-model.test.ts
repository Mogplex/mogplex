import { describe, expect, it } from "vitest";
import { pickSlackTurnModel } from "./turn-model";

const textOnly = { id: "lab/text-only", capabilities: ["tool-use"] };
const seeing = { id: "lab/seeing", capabilities: ["tool-use", "vision"] };
const disabledModelId = "lab/disabled";
const usableModels = [seeing, textOnly];

describe("pickSlackTurnModel", () => {
  it("should honor an explicit Slack preference the user can invoke", () => {
    expect(
      pickSlackTurnModel({
        preferredModel: textOnly.id,
        storedDefaultModel: seeing.id,
        conversationModel: null,
        usableModels,
        needsVision: true,
      })
    ).toBe(textOnly.id);
  });

  it("should use the user's stored default instead of the conversation's stamped model", () => {
    expect(
      pickSlackTurnModel({
        preferredModel: null,
        storedDefaultModel: seeing.id,
        conversationModel: textOnly.id,
        usableModels,
        needsVision: false,
      })
    ).toBe(seeing.id);
  });

  it("should replace a stamped conversation model the user cannot invoke with a usable one", () => {
    expect(
      pickSlackTurnModel({
        preferredModel: null,
        storedDefaultModel: null,
        conversationModel: disabledModelId,
        usableModels,
        needsVision: false,
      })
    ).toBe(seeing.id);
    expect(
      pickSlackTurnModel({
        preferredModel: disabledModelId,
        storedDefaultModel: textOnly.id,
        conversationModel: disabledModelId,
        usableModels,
        needsVision: false,
      })
    ).toBe(textOnly.id);
  });

  it("should return null only when the scope can invoke no model at all", () => {
    expect(
      pickSlackTurnModel({
        preferredModel: disabledModelId,
        storedDefaultModel: disabledModelId,
        conversationModel: disabledModelId,
        usableModels: [],
        needsVision: true,
      })
    ).toBeNull();
  });

  it("should prefer a model that can see images when the turn has attachments", () => {
    expect(
      pickSlackTurnModel({
        preferredModel: null,
        storedDefaultModel: textOnly.id,
        conversationModel: null,
        usableModels,
        needsVision: true,
      })
    ).toBe(seeing.id);
  });

  it("should fall back to the stored default when no usable model can see images", () => {
    expect(
      pickSlackTurnModel({
        preferredModel: null,
        storedDefaultModel: textOnly.id,
        conversationModel: null,
        usableModels: [textOnly],
        needsVision: true,
      })
    ).toBe(textOnly.id);
  });
});
