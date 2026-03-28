import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

const SERVER_URL = "ws://localhost:3056"; // Use different port for tests

// Helper: create a WebSocket connection and wait for it to open + receive auth message
function connectClient(channel?: string): Promise<{
  ws: WebSocket;
  messages: any[];
  waitForMessage: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const messages: any[] = [];
    let messageResolvers: Array<{
      predicate: (msg: any) => boolean;
      resolve: (msg: any) => void;
      reject: (err: Error) => void;
    }> = [];

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string);
      messages.push(data);
      // Check pending resolvers
      for (let i = messageResolvers.length - 1; i >= 0; i--) {
        if (messageResolvers[i].predicate(data)) {
          messageResolvers[i].resolve(data);
          messageResolvers.splice(i, 1);
        }
      }
    };

    function waitForMessage(predicate: (msg: any) => boolean, timeoutMs = 3000): Promise<any> {
      // Check already received messages first
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);

      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        messageResolvers.push({
          predicate,
          resolve: (msg) => { clearTimeout(timer); res(msg); },
          reject: rej,
        });
      });
    }

    ws.onopen = async () => {
      // Wait for auto-auth system message
      await waitForMessage((m) => m.type === "system" && m.message?.includes?.("Authenticated"));

      if (channel) {
        ws.send(JSON.stringify({ type: "join", channel }));
        await waitForMessage(
          (m) => m.type === "system" && m.channel === channel && typeof m.message === "string" && m.message.includes("Joined")
        );
      }

      resolve({ ws, messages, waitForMessage, close: () => ws.close() });
    };

    ws.onerror = (err) => reject(err);
  });
}

// We need a test server. Import and start one on a different port.
// Since socket.ts starts server on import, we'll spawn it as a subprocess with modified port.
let serverProcess: any;

beforeAll(async () => {
  // Start the server subprocess on port 3056
  serverProcess = Bun.spawn(["bun", "run", import.meta.dir + "/socket.ts"], {
    env: { ...process.env, SOCKET_PORT: "3056" },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Give server time to start
  await new Promise((r) => setTimeout(r, 500));
});

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

describe("WebSocket multi-agent routing", () => {
  it("single client message still broadcasts to plugin (backward compat)", async () => {
    const agentA = await connectClient("test-ch-1");
    const plugin = await connectClient("test-ch-1");

    // Agent sends a message
    agentA.ws.send(JSON.stringify({
      type: "message",
      channel: "test-ch-1",
      id: "msg-001",
      message: { command: "get_selection" },
    }));

    // Plugin should receive it
    const received = await plugin.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.command === "get_selection"
    );
    expect(received).toBeDefined();
    expect(received.message.command).toBe("get_selection");

    agentA.close();
    plugin.close();
  });

  it("plugin response routes only to the requesting agent, not other agents", async () => {
    const agentA = await connectClient("test-ch-2");
    const agentB = await connectClient("test-ch-2");
    const plugin = await connectClient("test-ch-2");

    // Agent A sends a request
    agentA.ws.send(JSON.stringify({
      type: "message",
      channel: "test-ch-2",
      id: "req-aaa",
      message: { command: "get_document_info" },
    }));

    // Plugin receives it
    await plugin.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.command === "get_document_info"
    );

    // Clear agentB messages so far
    const agentBMsgCountBefore = agentB.messages.length;

    // Plugin sends response with same id
    plugin.ws.send(JSON.stringify({
      type: "response",
      channel: "test-ch-2",
      id: "req-aaa",
      message: { result: { name: "My Document" } },
    }));

    // Agent A should receive the response
    const responseA = await agentA.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.result?.name === "My Document"
    );
    expect(responseA).toBeDefined();

    // Agent B should NOT receive it - wait a bit and check
    await new Promise((r) => setTimeout(r, 300));
    const agentBNewMessages = agentB.messages.slice(agentBMsgCountBefore);
    const gotResponse = agentBNewMessages.some(
      (m) => m.message?.result?.name === "My Document"
    );
    expect(gotResponse).toBe(false);

    agentA.close();
    agentB.close();
    plugin.close();
  });

  it("messages without id fallback to broadcast (backward compat)", async () => {
    const clientA = await connectClient("test-ch-3");
    const clientB = await connectClient("test-ch-3");

    // Send message without id
    clientA.ws.send(JSON.stringify({
      type: "message",
      channel: "test-ch-3",
      message: { command: "some_command" },
    }));

    // Client B should still receive it (broadcast fallback)
    const received = await clientB.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.command === "some_command"
    );
    expect(received).toBeDefined();

    clientA.close();
    clientB.close();
  });

  it("multiple agents can send requests and each gets their own response", async () => {
    const agentA = await connectClient("test-ch-4");
    const agentB = await connectClient("test-ch-4");
    const plugin = await connectClient("test-ch-4");

    // Both agents send requests
    agentA.ws.send(JSON.stringify({
      type: "message",
      channel: "test-ch-4",
      id: "req-from-a",
      message: { command: "get_selection" },
    }));

    agentB.ws.send(JSON.stringify({
      type: "message",
      channel: "test-ch-4",
      id: "req-from-b",
      message: { command: "get_styles" },
    }));

    // Wait for plugin to receive both
    await plugin.waitForMessage((m) => m.type === "broadcast" && m.message?.command === "get_selection");
    await plugin.waitForMessage((m) => m.type === "broadcast" && m.message?.command === "get_styles");

    const agentAMsgCount = agentA.messages.length;
    const agentBMsgCount = agentB.messages.length;

    // Plugin responds to B first, then A
    plugin.ws.send(JSON.stringify({
      type: "response",
      channel: "test-ch-4",
      id: "req-from-b",
      message: { result: { styles: ["bold"] } },
    }));

    plugin.ws.send(JSON.stringify({
      type: "response",
      channel: "test-ch-4",
      id: "req-from-a",
      message: { result: { selection: ["node1"] } },
    }));

    // Agent A should get selection response
    const respA = await agentA.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.result?.selection
    );
    expect(respA.message.result.selection).toEqual(["node1"]);

    // Agent B should get styles response
    const respB = await agentB.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.result?.styles
    );
    expect(respB.message.result.styles).toEqual(["bold"]);

    // Agent A should NOT have received B's response
    await new Promise((r) => setTimeout(r, 300));
    const agentANew = agentA.messages.slice(agentAMsgCount);
    const aGotBResponse = agentANew.some((m) => m.message?.result?.styles);
    expect(aGotBResponse).toBe(false);

    // Agent B should NOT have received A's response
    const agentBNew = agentB.messages.slice(agentBMsgCount);
    const bGotAResponse = agentBNew.some((m) => m.message?.result?.selection);
    expect(bGotAResponse).toBe(false);

    agentA.close();
    agentB.close();
    plugin.close();
  });

  it("response with unknown id falls back to broadcast", async () => {
    const clientA = await connectClient("test-ch-5");
    const clientB = await connectClient("test-ch-5");

    // Client A sends a "response" with an id that was never registered
    clientA.ws.send(JSON.stringify({
      type: "response",
      channel: "test-ch-5",
      id: "unknown-id-999",
      message: { result: "something" },
    }));

    // Client B should receive it via broadcast fallback
    const received = await clientB.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.result === "something"
    );
    expect(received).toBeDefined();

    clientA.close();
    clientB.close();
  });

  it("client disconnect cleans up pending requests", async () => {
    const agentA = await connectClient("test-ch-6");
    const plugin = await connectClient("test-ch-6");
    const agentB = await connectClient("test-ch-6");

    // Agent A sends a request
    agentA.ws.send(JSON.stringify({
      type: "message",
      channel: "test-ch-6",
      id: "req-disconnect",
      message: { command: "get_node_info" },
    }));

    await plugin.waitForMessage((m) => m.type === "broadcast" && m.message?.command === "get_node_info");

    // Agent A disconnects before response
    agentA.close();
    await new Promise((r) => setTimeout(r, 200));

    const agentBMsgCount = agentB.messages.length;

    // Plugin responds - should fallback to broadcast since sender is gone
    plugin.ws.send(JSON.stringify({
      type: "response",
      channel: "test-ch-6",
      id: "req-disconnect",
      message: { result: { node: "info" } },
    }));

    // Agent B should receive it as fallback broadcast
    const received = await agentB.waitForMessage(
      (m) => m.type === "broadcast" && m.message?.result?.node === "info"
    );
    expect(received).toBeDefined();

    plugin.close();
    agentB.close();
  });
});
