#!/usr/bin/env bun

import { Server, ServerWebSocket } from "bun";
import { randomBytes, verify as cryptoVerify } from 'crypto';

// ECDSA P-256 Public Key for client authentication
const AUTH_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGaZP2dWY67/IV9og/ph2UDhQvcaZ
uh2D+jQAuI8pB56mC9dWFcusPYPenHtSaWL6u9VLViOfGsgJvZqMaCEKGw==
-----END PUBLIC KEY-----`;

// Track authenticated clients and pending auth challenges
const authenticatedClients = new WeakSet<ServerWebSocket<any>>();
const pendingAuth = new Map<ServerWebSocket<any>, string>(); // ws -> nonce

// Store clients by channel
const channels = new Map<string, Set<ServerWebSocket<any>>>();

// --- Multi-agent routing ---
// Each ws connection gets a short clientId for logging
const clientIds = new Map<ServerWebSocket<any>, string>();
// Track which ws sent a request by message id, so responses route back to sender
const pendingRequests = new Map<string, ServerWebSocket<any>>(); // messageId -> sender ws

// Timeout for stale pending requests (30 seconds)
const PENDING_REQUEST_TTL_MS = 30_000;
const pendingRequestTimers = new Map<string, Timer>(); // messageId -> cleanup timer

function handleConnection(ws: ServerWebSocket<any>) {
  const clientId = crypto.randomUUID().slice(0, 8);
  clientIds.set(ws, clientId);
  console.log(`New client connected [${clientId}] — auto-allowing (no auth)`);

  // Skip auth challenge entirely, immediately authenticate
  authenticatedClients.add(ws);
  ws.send(JSON.stringify({
    type: "system",
    message: "Authenticated. Please join a channel to start.",
  }));
}

const server = Bun.serve({
  port: parseInt(process.env.SOCKET_PORT || "3055"),
  // uncomment this to allow connections in windows wsl
  // hostname: "0.0.0.0",
  fetch(req: Request, server: Server) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle WebSocket upgrade
    const success = server.upgrade(req, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });

    if (success) {
      return; // Upgraded to WebSocket
    }

    // Return response for non-WebSocket requests
    return new Response("WebSocket server running", {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
  websocket: {
    open: handleConnection,
    message(ws: ServerWebSocket<any>, message: string | Buffer) {
      try {
        const data = JSON.parse(message as string);
        const senderClientId = clientIds.get(ws) || "unknown";
        console.log(`\n=== Received message from client [${senderClientId}] ===`);
        console.log(`Type: ${data.type}, Channel: ${data.channel || 'N/A'}`);
        if (data.message?.command) {
          console.log(`Command: ${data.message.command}, ID: ${data.id}`);
        } else if (data.message?.result) {
          console.log(`Response: ID: ${data.id}, Has Result: ${!!data.message.result}`);
        }
        console.log(`Full message:`, JSON.stringify(data, null, 2));

        // --- Auth gate (transport layer) ---
        if (data.type === "auth_response") {
          const nonce = pendingAuth.get(ws);
          if (!nonce) {
            console.log("✗ Unexpected auth_response — no pending challenge");
            ws.close();
            return;
          }

          try {
            // Verify ECDSA signature (ieee-p1363 = raw r||s format, compatible with SubtleCrypto)
            const isValid = cryptoVerify(
              'SHA256',
              Buffer.from(nonce),
              { key: AUTH_PUBLIC_KEY, dsaEncoding: 'ieee-p1363' },
              Buffer.from(data.signature, 'base64')
            );

            if (isValid) {
              authenticatedClients.add(ws);
              pendingAuth.delete(ws);
              console.log("✓ Client authenticated successfully");
              ws.send(JSON.stringify({
                type: "system",
                message: "Authenticated. Please join a channel to start.",
              }));
            } else {
              console.log("✗ Invalid signature — disconnecting");
              pendingAuth.delete(ws);
              ws.close();
            }
          } catch (err) {
            console.error("✗ Auth verification error:", err);
            pendingAuth.delete(ws);
            ws.close();
          }
          return;
        }

        // Reject unauthenticated clients
        if (!authenticatedClients.has(ws)) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Not authenticated. Send auth_response first."
          }));
          return;
        }
        // --- End auth gate ---

        if (data.type === "join") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          // Create channel if it doesn't exist
          if (!channels.has(channelName)) {
            channels.set(channelName, new Set());
          }

          // Add client to channel
          const channelClients = channels.get(channelName)!;
          channelClients.add(ws);

          console.log(`\n✓ Client joined channel "${channelName}" (${channelClients.size} total clients)`);

          // Notify client they joined successfully
          ws.send(JSON.stringify({
            type: "system",
            message: `Joined channel: ${channelName}`,
            channel: channelName
          }));

          ws.send(JSON.stringify({
            type: "system",
            message: {
              id: data.id,
              result: "Connected to channel: " + channelName,
            },
            channel: channelName
          }));

          // Notify other clients in channel
          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: "system",
                message: "A new user has joined the channel",
                channel: channelName
              }));
            }
          });
          return;
        }

        // Handle regular messages (requests from MCP agents to Plugin)
        if (data.type === "message") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          const channelClients = channels.get(channelName);
          if (!channelClients || !channelClients.has(ws)) {
            ws.send(JSON.stringify({
              type: "error",
              message: "You must join the channel first"
            }));
            return;
          }

          // Track the request so we can route the response back to this sender
          const messageId = data.id || data.message?.id;
          if (messageId) {
            pendingRequests.set(messageId, ws);
            // Set a timeout to clean up stale pending requests
            const timer = setTimeout(() => {
              pendingRequests.delete(messageId);
              pendingRequestTimers.delete(messageId);
              console.log(`[routing] Cleaned up stale pending request: ${messageId}`);
            }, PENDING_REQUEST_TTL_MS);
            pendingRequestTimers.set(messageId, timer);
            console.log(`[routing] Tracked request ${messageId} from client [${senderClientId}]`);
          }

          // Broadcast to all OTHER clients in the channel (not the sender)
          // This prevents echo and ensures proper request-response flow
          let broadcastCount = 0;
          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              broadcastCount++;
              const broadcastMessage = {
                type: "broadcast",
                message: data.message,
                sender: "peer",
                channel: channelName
              };
              console.log(`\n=== Broadcasting to peer #${broadcastCount} [${clientIds.get(client) || "unknown"}] ===`);
              console.log(JSON.stringify(broadcastMessage, null, 2));
              client.send(JSON.stringify(broadcastMessage));
            }
          });

          if (broadcastCount === 0) {
            console.log(`⚠️  No other clients in channel "${channelName}" to receive message!`);
          } else {
            console.log(`✓ Broadcast to ${broadcastCount} peer(s) in channel "${channelName}"`);
          }
          return;
        }

        // Handle response messages (Plugin responding to a specific request)
        if (data.type === "response") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          const channelClients = channels.get(channelName);
          if (!channelClients || !channelClients.has(ws)) {
            ws.send(JSON.stringify({
              type: "error",
              message: "You must join the channel first"
            }));
            return;
          }

          const responseId = data.id;
          const originalSender = responseId ? pendingRequests.get(responseId) : undefined;

          if (originalSender && originalSender.readyState === WebSocket.OPEN) {
            // Route response only to the original requester
            const targetClientId = clientIds.get(originalSender) || "unknown";
            console.log(`[routing] Routing response ${responseId} to client [${targetClientId}]`);
            const broadcastMessage = {
              type: "broadcast",
              message: data.message,
              sender: "peer",
              channel: channelName,
            };
            originalSender.send(JSON.stringify(broadcastMessage));

            // Clean up
            pendingRequests.delete(responseId);
            const timer = pendingRequestTimers.get(responseId);
            if (timer) { clearTimeout(timer); pendingRequestTimers.delete(responseId); }
          } else {
            // Fallback: broadcast to all other clients (backward compat)
            console.log(`[routing] No tracked sender for response ${responseId}, falling back to broadcast`);
            if (responseId) {
              pendingRequests.delete(responseId);
              const timer = pendingRequestTimers.get(responseId);
              if (timer) { clearTimeout(timer); pendingRequestTimers.delete(responseId); }
            }
            let broadcastCount = 0;
            channelClients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                broadcastCount++;
                const broadcastMessage = {
                  type: "broadcast",
                  message: data.message,
                  sender: "peer",
                  channel: channelName,
                };
                client.send(JSON.stringify(broadcastMessage));
              }
            });
            console.log(`✓ Fallback broadcast to ${broadcastCount} peer(s) in channel "${channelName}"`);
          }
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
    },
    close(ws: ServerWebSocket<any>) {
      const closedClientId = clientIds.get(ws) || "unknown";
      console.log(`Client [${closedClientId}] disconnected`);

      // Clean up auth state
      authenticatedClients.delete(ws);
      pendingAuth.delete(ws);

      // Clean up pending requests from this client
      for (const [messageId, sender] of pendingRequests.entries()) {
        if (sender === ws) {
          pendingRequests.delete(messageId);
          const timer = pendingRequestTimers.get(messageId);
          if (timer) { clearTimeout(timer); pendingRequestTimers.delete(messageId); }
          console.log(`[routing] Cleaned up pending request ${messageId} from disconnected client [${closedClientId}]`);
        }
      }

      // Clean up clientId mapping
      clientIds.delete(ws);

      // Remove client from their channel
      channels.forEach((clients) => {
        clients.delete(ws);
      });
    }
  }
});

console.log(`WebSocket server running on port ${server.port}`);
