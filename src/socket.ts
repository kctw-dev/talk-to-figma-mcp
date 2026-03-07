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

function handleConnection(ws: ServerWebSocket<any>) {
  console.log("New client connected — sending auth challenge");

  // Generate random nonce for challenge
  const nonce = randomBytes(32).toString('hex');
  pendingAuth.set(ws, nonce);

  // Send auth challenge
  ws.send(JSON.stringify({
    type: "auth_challenge",
    nonce: nonce,
  }));

  // Auto-disconnect if not authenticated within 10 seconds
  setTimeout(() => {
    if (pendingAuth.has(ws)) {
      console.log("Auth timeout — disconnecting client");
      pendingAuth.delete(ws);
      ws.close();
    }
  }, 10000);
}

const server = Bun.serve({
  port: 3055,
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
        console.log(`\n=== Received message from client ===`);
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

        // Handle regular messages
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
              console.log(`\n=== Broadcasting to peer #${broadcastCount} ===`);
              console.log(JSON.stringify(broadcastMessage, null, 2));
              client.send(JSON.stringify(broadcastMessage));
            }
          });
          
          if (broadcastCount === 0) {
            console.log(`⚠️  No other clients in channel "${channelName}" to receive message!`);
          } else {
            console.log(`✓ Broadcast to ${broadcastCount} peer(s) in channel "${channelName}"`);
          }
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
    },
    close(ws: ServerWebSocket<any>) {
      // Clean up auth state
      authenticatedClients.delete(ws);
      pendingAuth.delete(ws);
      // Remove client from their channel
      channels.forEach((clients) => {
        clients.delete(ws);
      });
    }
  }
});

console.log(`WebSocket server running on port ${server.port}`);
