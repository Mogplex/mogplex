import assert from "node:assert/strict";
import test from "node:test";
import { useConversationsStore } from "../../hooks/use-conversations";

function resetStore() {
  useConversationsStore.setState({
    conversations: {},
    conversationList: [],
    userId: null,
    defaultModel: "minimax/minimax-m2.7",
  });
}

test("setMessages seeds a new conversation with the store's live defaultModel, not a stale constant", () => {
  resetStore();
  useConversationsStore
    .getState()
    .setDefaultModel("anthropic/claude-sonnet-4-5");

  useConversationsStore.getState().setMessages("pane-new", [
    {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    },
  ]);

  const conversation =
    useConversationsStore.getState().conversations["pane-new"];

  assert.ok(conversation, "conversation should have been created");
  assert.equal(conversation.model, "anthropic/claude-sonnet-4-5");

  resetStore();
});

test("setModel on an unknown paneId creates a conversation with the requested model and inherits live default for other fields", () => {
  resetStore();
  useConversationsStore.getState().setDefaultModel("openai/gpt-4o-mini");

  useConversationsStore
    .getState()
    .setModel("pane-a", "anthropic/claude-opus-4-7");
  const conversation = useConversationsStore.getState().conversations["pane-a"];

  assert.ok(conversation);
  assert.equal(conversation.model, "anthropic/claude-opus-4-7");
  assert.equal(conversation.mode, "AUTO");

  resetStore();
});

test("getConversation falls back to the current defaultModel when no entry exists", () => {
  resetStore();
  useConversationsStore.getState().setDefaultModel("openai/gpt-4o-mini");

  const conversation = useConversationsStore
    .getState()
    .getConversation("pane-missing");

  assert.equal(conversation.model, "openai/gpt-4o-mini");

  resetStore();
});
