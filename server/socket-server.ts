import "dotenv/config";
import { createServer } from "http";
import express from "express";
import { Server } from "socket.io";
import { jwtVerify } from "jose";

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    methods: ["GET", "POST"],
  },
});

const secretKey = new TextEncoder().encode(process.env.AUTH_SECRET ?? "");

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token || !secretKey.length) {
      next(new Error("Unauthorized"));
      return;
    }
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.userId = userId;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.on("table:watch", (tableId: string) => {
    if (typeof tableId !== "string" || !tableId) return;
    socket.join(`table:${tableId}`);
  });

  socket.on("table:unwatch", (tableId: string) => {
    if (typeof tableId !== "string") return;
    socket.leave(`table:${tableId}`);
  });
});

app.post("/internal/broadcast-table", (req, res) => {
  const incoming = req.headers["x-socket-secret"];
  const expected = process.env.SOCKET_INTERNAL_SECRET;
  if (!expected || incoming !== expected) {
    res.status(401).end();
    return;
  }
  const tableId = (req.body as { tableId?: string })?.tableId;
  if (!tableId || typeof tableId !== "string") {
    res.status(400).end();
    return;
  }
  io.to(`table:${tableId}`).emit("table:changed", { tableId });
  res.end();
});

const port = Number(process.env.SOCKET_PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`[socket] listening on ${port} (CORS ${allowedOrigin})`);
});
