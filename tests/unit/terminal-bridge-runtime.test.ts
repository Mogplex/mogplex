import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTmuxSessionName,
  buildTmuxShellCommand,
  buildWsAccept,
  decodeWsFrame,
  encodeWsFrame,
  parseControlMessage,
  tokensMatch,
  WS_OPCODE_BINARY,
  WS_OPCODE_TEXT,
} from "../../lib/sandbox/terminal-bridge-runtime.mjs";

test("buildWsAccept matches the RFC 6455 example", () => {
  // Example from RFC 6455 §1.3 — dGhlIHNhbXBsZSBub25jZQ==
  assert.equal(
    buildWsAccept("dGhlIHNhbXBsZSBub25jZQ=="),
    "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
  );
});

test("encode/decode round-trips a short text frame", () => {
  const frame = encodeWsFrame(WS_OPCODE_TEXT, "hello");
  // Server-to-client frames are unmasked; wrap into a mock client frame by
  // re-encoding. Since our bridge decodes inbound frames (masked by browsers),
  // we verify decode works on unmasked too since our encoder emits unmasked.
  const decoded = decodeWsFrame(frame);
  assert.ok(decoded);
  assert.equal(decoded.opcode, WS_OPCODE_TEXT);
  assert.equal(decoded.payload.toString("utf8"), "hello");
  assert.equal(decoded.rest.length, 0);
});

test("encode/decode round-trips a medium binary frame", () => {
  const payload = Buffer.alloc(1024, 171);
  const frame = encodeWsFrame(WS_OPCODE_BINARY, payload);
  const decoded = decodeWsFrame(frame);
  assert.ok(decoded);
  assert.equal(decoded.opcode, WS_OPCODE_BINARY);
  assert.ok(decoded.payload.equals(payload));
});

test("decodeWsFrame returns null on incomplete buffer", () => {
  const frame = encodeWsFrame(WS_OPCODE_TEXT, "hello world");
  const partial = frame.subarray(0, -3);
  assert.equal(decodeWsFrame(partial), null);
});

test("decodeWsFrame leaves remainder in .rest for streaming consumers", () => {
  const f1 = encodeWsFrame(WS_OPCODE_TEXT, "first");
  const f2 = encodeWsFrame(WS_OPCODE_TEXT, "second");
  const combined = Buffer.concat([f1, f2]);
  const decoded1 = decodeWsFrame(combined);
  assert.ok(decoded1);
  assert.equal(decoded1.payload.toString("utf8"), "first");
  const decoded2 = decodeWsFrame(decoded1.rest);
  assert.ok(decoded2);
  assert.equal(decoded2.payload.toString("utf8"), "second");
});

test("decodeWsFrame unmasks client-to-server frames", () => {
  // Manually build a masked text frame "abc" with mask 0x01020304.
  const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const plaintext = Buffer.from("abc");
  const masked = Buffer.alloc(plaintext.length);
  for (let i = 0; i < plaintext.length; i += 1) {
    masked[i] = plaintext[i] ^ mask[i & 3];
  }
  const frame = Buffer.concat([
    Buffer.from([0x81, 0x80 | plaintext.length]),
    mask,
    masked,
  ]);
  const decoded = decodeWsFrame(frame);
  assert.ok(decoded);
  assert.equal(decoded.payload.toString("utf8"), "abc");
});

test("parseControlMessage accepts resize with cols/rows", () => {
  const result = parseControlMessage('{"type":"resize","cols":100,"rows":30}');
  assert.ok(result.ok);
  assert.deepEqual(result.ok ? result.message : null, {
    type: "resize",
    cols: 100,
    rows: 30,
  });
});

test("parseControlMessage rejects resize with bad dimensions", () => {
  for (const body of [
    '{"type":"resize"}',
    '{"type":"resize","cols":0,"rows":10}',
    '{"type":"resize","cols":"wide","rows":10}',
  ]) {
    const r = parseControlMessage(body);
    assert.equal(r.ok, false, `expected failure for ${body}`);
  }
});

test("parseControlMessage accepts ping", () => {
  const result = parseControlMessage('{"type":"ping"}');
  assert.ok(result.ok);
  assert.equal(result.ok ? result.message?.type : null, "ping");
});

test("parseControlMessage rejects malformed JSON and unknown types", () => {
  assert.equal(parseControlMessage("not json").ok, false);
  assert.equal(parseControlMessage("null").ok, false);
  assert.equal(parseControlMessage('{"type":"mystery"}').ok, false);
});

test("tokensMatch requires both sides present and equal length", () => {
  assert.equal(tokensMatch("abc", "abc"), true);
  assert.equal(tokensMatch("abc", "abd"), false);
  assert.equal(tokensMatch("abc", "abcd"), false);
  assert.equal(tokensMatch("", "abc"), false);
  assert.equal(tokensMatch("abc", ""), false);
  assert.equal(tokensMatch(undefined, "abc"), false);
});

test("buildTmuxSessionName is stable and hashes arbitrary session keys", () => {
  const first = buildTmuxSessionName("pane:one/shared");
  const second = buildTmuxSessionName("pane:one/shared");
  const third = buildTmuxSessionName("pane:two");

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.match(first, /^mogplex-[a-f0-9]{24}$/);
});

test("buildTmuxShellCommand attaches to a named session with quoted cwd", () => {
  const command = buildTmuxShellCommand({
    cwd: "/tmp/O'Brien/project",
    sessionKey: "pane:one/shared",
  });

  assert.match(
    command,
    /if command -v tmux >\/dev\/null 2>&1; then exec tmux new-session -A -s 'mogplex-[a-f0-9]{24}'/
  );
  assert.match(command, /tmux new-session -A -s 'mogplex-[a-f0-9]{24}'/);
  assert.match(command, /-c '\/tmp\/O'\\''Brien\/project'/);
  assert.match(command, /cd '\/tmp\/O'\\''Brien\/project' \|\| exit 1/);
  assert.match(
    command,
    /printf '%s\\n' '\[mogplex\] tmux unavailable; running plain shell without session persistence'/
  );
  assert.match(command, /if \[ -n "\$SHELL" \]; then exec "\$SHELL" -il; fi/);
  assert.match(command, /exec \/bin\/sh -il/);
});
