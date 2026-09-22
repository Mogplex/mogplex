import { describe, expect, it } from "vitest";
import { getConnectionPreset } from "./presets";
import { normalizeConnectionCreateInput } from "./validation";

describe("Neon connection preset", () => {
  it("creates a hosted connection from the same preset used by quick-add", () => {
    const preset = getConnectionPreset("neon");
    expect(preset).not.toBeNull();
    const connection = normalizeConnectionCreateInput({
      source_preset: preset?.id,
      credentials: "neon_test_key",
    });

    expect(connection).toMatchObject({
      name: "Neon",
      type: "mcp_server",
      mcp_url: "https://mcp.neon.tech/mcp",
      mcp_transport: "http",
      auth_type: "bearer",
      auth_header: "Authorization",
      credentials: "neon_test_key",
    });
    expect(preset?.auth_fields[0].secret).toBe(true);
  });
});
