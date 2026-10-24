import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { prisma } from "../db.js";

const adminRoom = "authorized-admins";

function sessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "recoverx_session") continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export type SosAlertNotification = {
  id: string;
  reference: string;
  category: string;
  incidentAt: string;
  createdAt: string;
  status: string;
};

export function createSosRealtime(httpServer: HttpServer, allowedOrigins: string[]) {
  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: allowedOrigins, credentials: true },
    serveClient: false
  });

  io.use(async (socket, next) => {
    try {
      const token = sessionToken(socket.handshake.headers.cookie);
      const secret = process.env.JWT_SECRET;
      if (!token || !secret || secret.length < 32) return next(new Error("Administrator authentication required."));
      const payload = jwt.verify(token, secret, { issuer: "recoverx-api" });
      if (typeof payload === "string" || typeof payload.sub !== "string") {
        return next(new Error("Administrator authentication required."));
      }
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { role: true }
      });
      if (!user || (user.role !== "ADMIN" && user.role !== "INVESTIGATOR")) {
        return next(new Error("Administrator access is required."));
      }
      socket.data.authorizedAdmin = true;
      next();
    } catch {
      next(new Error("Administrator authentication required."));
    }
  });

  io.on("connection", socket => {
    if (socket.data.authorizedAdmin === true) socket.join(adminRoom);
  });

  return {
    notifyAdmins(alert: SosAlertNotification) {
      io.to(adminRoom).emit("sos:new-alert", alert);
    },
    close() {
      return new Promise<void>(resolve => io.close(() => resolve()));
    }
  };
}
