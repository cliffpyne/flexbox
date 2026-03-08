import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import 'dotenv/config';

// ── Types ────────────────────────────────────────────────────────────────────
interface ConnectedClient {
  userId:        string;
  role:          string;
  officeId:      string | null;
  socket:        WebSocket;
  socketId:      string;
  subscribedChannels: Set<string>;
  lastPing:      number;
  connectedAt:   string;
}

// ── Redis Clients ─────────────────────────────────────────────────────────────
// Separate pub/sub client — required by Redis (subscribed client can't do other ops)
const subRedis = createClient({ url: process.env.REDIS_URL });
const cmdRedis = createClient({ url: process.env.REDIS_URL });

subRedis.on('error', (err) => console.error('Redis sub error:', err.message));
cmdRedis.on('error', (err) => console.error('Redis cmd error:', err.message));

// ── In-memory connection store ────────────────────────────────────────────────
// Per-instance. Redis Pub/Sub broadcasts across instances automatically.
const connectedClients = new Map<string, ConnectedClient>();

// ── Redis Pub/Sub Channels to subscribe to ────────────────────────────────────
const REDIS_CHANNELS = [
  'parcel:*:tracking',
  'parcel:*:internal',
  'office:*:operations',
  'rider:*:jobs',
  'rider:*:location',
  'ops:network:overview',
  'ml:alerts:1', 'ml:alerts:2', 'ml:alerts:3', 'ml:alerts:4', 'ml:alerts:5',
];

// ── Channel Authorization ─────────────────────────────────────────────────────
function canSubscribe(client: ConnectedClient, channel: string): boolean {
  const role = client.role;
  const userId = client.userId;

  // Ops/super admin can subscribe to anything
  if (['OPS_ADMIN', 'SUPER_ADMIN'].includes(role)) return true;

  // parcel:{id}:tracking — customer, agent, receiver for their parcels
  if (channel.startsWith('parcel:') && channel.endsWith(':tracking')) return true;

  // parcel:{id}:internal — office staff only
  if (channel.startsWith('parcel:') && channel.endsWith(':internal')) {
    return ['OFFICE_WORKER', 'OFFICE_MANAGER', 'BRANCH_MANAGER', 'SUPPORT_AGENT'].includes(role);
  }

  // office:{id}:operations — only workers at that office
  if (channel.startsWith('office:') && channel.endsWith(':operations')) {
    const officeId = channel.split(':')[1];
    return ['OFFICE_WORKER', 'OFFICE_MANAGER'].includes(role) && client.officeId === officeId;
  }

  // rider:{id}:jobs — only that specific rider
  if (channel.startsWith('rider:') && channel.endsWith(':jobs')) {
    const riderId = channel.split(':')[1];
    return role === 'RIDER' && userId === riderId;
  }

  // ml:alerts — managers and above
  if (channel.startsWith('ml:alerts:')) {
    return ['OFFICE_MANAGER', 'BRANCH_MANAGER', 'OPS_ADMIN', 'SUPER_ADMIN'].includes(role);
  }

  return false;
}

// ── Send to client safely ─────────────────────────────────────────────────────
function sendToClient(client: ConnectedClient, message: object) {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(message));
  }
}

// ── Handle incoming WebSocket message ────────────────────────────────────────
async function handleMessage(client: ConnectedClient, raw: string) {
  let msg: any;
  try { msg = JSON.parse(raw); }
  catch { return; }

  switch (msg.type) {
    case 'ping':
      client.lastPing = Date.now();
      sendToClient(client, { type: 'pong', server_time: new Date().toISOString() });
      break;

    case 'subscribe': {
      const channel = msg.channel;
      if (!channel) return;
      if (!canSubscribe(client, channel)) {
        sendToClient(client, { type: 'error', code: 'UNAUTHORIZED_CHANNEL', channel });
        return;
      }
      client.subscribedChannels.add(channel);
      await cmdRedis.sAdd(`channel_subscribers:${channel}`, client.userId);
      sendToClient(client, { type: 'subscribed', channel });
      break;
    }

    case 'unsubscribe': {
      const channel = msg.channel;
      if (!channel) return;
      client.subscribedChannels.delete(channel);
      await cmdRedis.sRem(`channel_subscribers:${channel}`, client.userId);
      sendToClient(client, { type: 'unsubscribed', channel });
      break;
    }

    case 'viewing': {
      const { parcel_id, active } = msg;
      if (!parcel_id) return;
      if (active) {
        // 60-second TTL — client must resend every 30s to keep alive
        await cmdRedis.set(`viewing:${client.userId}:${parcel_id}`, '1', { EX: 60 });
      } else {
        await cmdRedis.del(`viewing:${client.userId}:${parcel_id}`);
      }
      break;
    }
  }
}

// ── On client disconnect — clean up Redis ───────────────────────────────────
async function handleDisconnect(client: ConnectedClient) {
  connectedClients.delete(client.userId);

  // Clean up all channel subscriptions
  for (const channel of client.subscribedChannels) {
    await cmdRedis.sRem(`channel_subscribers:${channel}`, client.userId).catch(() => {});
  }

  // Clean up connection metadata
  await cmdRedis.del(`ws_connections:${client.userId}`).catch(() => {});
  console.log(`[ws] Disconnected: ${client.userId} (${client.role})`);
}

// ── Push to all subscribers of a channel ─────────────────────────────────────
async function pushToChannelSubscribers(channel: string, data: any) {
  // Get all subscribers from Redis (across all instances)
  const subscriberIds = await cmdRedis.sMembers(`channel_subscribers:${channel}`);
  const timestamp = new Date().toISOString();

  for (const userId of subscriberIds) {
    const client = connectedClients.get(userId);
    if (client && client.socket.readyState === WebSocket.OPEN) {
      sendToClient(client, { type: 'update', channel, data, timestamp });
    } else if (!client) {
      // Client disconnected without cleaning up — remove stale subscriber
      await cmdRedis.sRem(`channel_subscribers:${channel}`, userId).catch(() => {});
    }
  }
}

// ── Main startup ──────────────────────────────────────────────────────────────
async function start() {
  await subRedis.connect();
  await cmdRedis.connect();
  console.log('[ws] Redis connected');

  // Subscribe to all parcel/rider/office channels using pattern matching
  await subRedis.pSubscribe('parcel:*', async (message, channel) => {
    try {
      const data = JSON.parse(message);
      await pushToChannelSubscribers(channel, data);
    } catch {}
  });

  await subRedis.pSubscribe('office:*', async (message, channel) => {
    try { await pushToChannelSubscribers(channel, JSON.parse(message)); } catch {}
  });

  await subRedis.pSubscribe('rider:*', async (message, channel) => {
    try { await pushToChannelSubscribers(channel, JSON.parse(message)); } catch {}
  });

  await subRedis.pSubscribe('ops:*', async (message, channel) => {
    try { await pushToChannelSubscribers(channel, JSON.parse(message)); } catch {}
  });

  await subRedis.pSubscribe('ml:alerts:*', async (message, channel) => {
    try { await pushToChannelSubscribers(channel, JSON.parse(message)); } catch {}
  });

  // Health check HTTP server
  const app = express();
  app.use(helmet()); app.use(cors()); app.use(express.json());
  app.get('/health', (_, res) => res.json({
    status: 'ok', service: 'websocket-gateway',
    connected_clients: connectedClients.size,
    time: new Date().toISOString()
  }));

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/connect' });

  wss.on('connection', async (socket, req) => {
    // ── JWT Auth ──────────────────────────────────────────────────────
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (!token) { socket.close(4001, 'Unauthorized — missing token'); return; }

    let actor: any;
    try { actor = jwt.verify(token, process.env.JWT_SECRET || ''); }
    catch { socket.close(4001, 'Unauthorized — invalid token'); return; }

    const socketId = crypto.randomUUID();
    const client: ConnectedClient = {
      userId: actor.user_id, role: actor.role,
      officeId: actor.office_id || null,
      socket, socketId,
      subscribedChannels: new Set(),
      lastPing: Date.now(),
      connectedAt: new Date().toISOString(),
    };

    // Store connection (in-memory for this instance)
    connectedClients.set(actor.user_id, client);

    // Store metadata in Redis for cross-instance visibility
    await cmdRedis.hSet(`ws_connections:${actor.user_id}`, {
      connected_at: client.connectedAt,
      role: actor.role,
      office_id: actor.office_id || '',
      socket_id: socketId,
    });
    await cmdRedis.expire(`ws_connections:${actor.user_id}`, 86400);

    console.log(`[ws] Connected: ${actor.user_id} (${actor.role})`);

    // Welcome message
    sendToClient(client, { type: 'connected', user_id: actor.user_id, server_time: new Date().toISOString() });

    // ── Message handler ───────────────────────────────────────────────
    socket.on('message', (data) => handleMessage(client, data.toString()));

    // ── Disconnect handler ────────────────────────────────────────────
    socket.on('close', () => handleDisconnect(client));
    socket.on('error', (err) => {
      console.error(`[ws] Socket error for ${actor.user_id}:`, err.message);
      handleDisconnect(client);
    });
  });

  // ── Heartbeat check — drop silent connections after 90s ──────────────────
  setInterval(() => {
    const now = Date.now();
    for (const [userId, client] of connectedClients) {
      if (now - client.lastPing > 90000) {
        console.log(`[ws] Dropping silent connection: ${userId}`);
        client.socket.terminate();
        handleDisconnect(client);
      }
    }
  }, 30000);

  const PORT = process.env.PORT || 3012;
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`WebSocket Gateway running on port ${PORT}`);
    console.log(`WS endpoint: ws://0.0.0.0:${PORT}/connect?token=JWT`);
  });
}

start().catch(console.error);