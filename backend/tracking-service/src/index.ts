import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Pool } from 'pg';
import { createClient } from 'redis';
import 'dotenv/config';

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Two Redis clients — one for normal ops, one dedicated for pub/sub
const redis = createClient({ url: process.env.REDIS_URL });
const subscriber = redis.duplicate();

redis.connect().catch(console.error);
subscriber.connect().catch(console.error);

// Map: riderId -> Set of socket IDs tracking this rider
const trackingMap = new Map<string, Set<string>>();

// WebSocket connection handler
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Customer subscribes to track a parcel
  socket.on("track:subscribe", async ({ trackingNumber }) => {
    try {
      const { rows } = await db.query(
        'SELECT rider_id FROM parcels WHERE tracking_number=$1', [trackingNumber]
      );
      if (rows[0]?.rider_id) {
        const riderId = rows[0].rider_id;
        if (!trackingMap.has(riderId)) {
          trackingMap.set(riderId, new Set());
        }
        trackingMap.get(riderId)!.add(socket.id);
        console.log(`Socket ${socket.id} tracking rider ${riderId}`);
      }
    } catch (error) {
      console.error("Track subscribe error:", error);
    }
  });

  // Admin subscribes to all riders (fleet map)
  socket.on("admin:subscribe_fleet", () => {
    socket.join("admin-fleet");
    console.log(`Socket ${socket.id} joined admin fleet`);
  });

  socket.on("disconnect", () => {
    trackingMap.forEach((set) => set.delete(socket.id));
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Redis subscriber — listens for location updates published by rider-service
subscriber.subscribe('rider:location:updates', (message) => {
  try {
    const { riderId, lat, lng, timestamp } = JSON.parse(message);

    // Broadcast to customers tracking this rider
    const subscribers = trackingMap.get(riderId);
    if (subscribers && subscribers.size > 0) {
      subscribers.forEach((socketId) => {
        io.to(socketId).emit("rider:location_update", { lat, lng, timestamp });
      });
    }

    // Broadcast to admin fleet map
    io.to("admin-fleet").emit("fleet:positions", [{ riderId, lat, lng }]);
  } catch (error) {
    console.error("Redis message error:", error);
  }
});

// HTTP endpoint — rider-service can also POST location directly
app.post('/location/update', (req: any, res) => {
  const { riderId, lat, lng } = req.body;
  const timestamp = Date.now();

  const subscribers = trackingMap.get(riderId);
  if (subscribers && subscribers.size > 0) {
    subscribers.forEach((socketId) => {
      io.to(socketId).emit("rider:location_update", { lat, lng, timestamp });
    });
  }
  io.to("admin-fleet").emit("fleet:positions", [{ riderId, lat, lng }]);
  res.json({ success: true });
});

app.get('/health', (req, res) =>
  res.json({ status: 'ok', connections: io.engine.clientsCount })
);

const PORT = process.env.PORT || 3007;
httpServer.listen(PORT, () =>
  console.log(`✅ Tracking Service (WebSocket) running on port ${PORT}`)
);