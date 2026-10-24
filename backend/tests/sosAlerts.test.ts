import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { createSosAlertRouter } from "../src/routes/sosAlerts.js";
import type { SosAlertRecord, SosAlertRepository, SosAlertStatus } from "../src/services/sosAlerts.js";

const now = new Date();

function createFakeRepository(): SosAlertRepository {
  const alerts = new Map<string, SosAlertRecord>();
  let nextId = 1;
  const record = (alert: SosAlertRecord) => alert;

  return {
    async create(input) {
      if ([...alerts.values()].some(alert => alert.citizenId === input.citizenId && alert.idempotencyKey === input.idempotencyKey)) {
        throw { code: "P2002" };
      }
      const id = `alert-${nextId++}`;
      const created: SosAlertRecord = {
        id,
        reference: `RFX-2026-${String(nextId).padStart(10, "0")}`,
        citizenId: input.citizenId,
        category: input.category,
        incidentAt: input.incidentAt,
        amount: input.amount === null ? null : new Prisma.Decimal(input.amount),
        description: input.description,
        contactPhone: input.contactPhone,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        status: "New",
        acknowledgedAt: null,
        acknowledgedById: null,
        createdAt: now,
        updatedAt: now,
        citizen: { id: input.citizenId, name: input.citizenId, email: `${input.citizenId}@example.test` },
        acknowledgedBy: null,
        history: [{
          id: `history-${nextId}`,
          alertId: id,
          status: "New",
          note: "Alert submitted to RecoverX administration.",
          updatedById: input.citizenId,
          createdAt: now,
          updatedBy: { id: input.citizenId, name: input.citizenId }
        }]
      };
      alerts.set(id, created);
      return record(created);
    },
    async findById(id) {
      return alerts.get(id) ?? null;
    },
    async findByCitizenAndKey(citizenId, key) {
      return [...alerts.values()].find(alert => alert.citizenId === citizenId && alert.idempotencyKey === key) ?? null;
    },
    async list(status, citizenId) {
      return [...alerts.values()].filter(alert => (status === undefined || alert.status === status) && (citizenId === undefined || alert.citizenId === citizenId));
    },
    async count(status) {
      return [...alerts.values()].filter(alert => status === undefined || alert.status === status).length;
    },
    async acknowledge(id, userId) {
      const current = alerts.get(id);
      if (!current) return null;
      if (current.status === "New") {
        current.status = "Acknowledged";
        current.acknowledgedAt = now;
        current.acknowledgedById = userId;
        current.acknowledgedBy = { id: userId, name: userId };
        current.history.push({
          id: `history-${current.history.length + 1}`,
          alertId: id,
          status: "Acknowledged",
          note: "Alert acknowledged by administration.",
          updatedById: userId,
          createdAt: now,
          updatedBy: { id: userId, name: userId }
        });
      }
      return current;
    },
    async updateStatus(id, userId, status: SosAlertStatus) {
      const current = alerts.get(id);
      if (!current) return null;
      if (current.status !== status) {
        current.status = status;
        current.updatedAt = now;
        current.history.push({
          id: `history-${current.history.length + 1}`,
          alertId: id,
          status,
          note: null,
          updatedById: userId,
          createdAt: now,
          updatedBy: { id: userId, name: userId }
        });
      }
      return current;
    }
  };
}

function makeTestServer(repository: SosAlertRepository = createFakeRepository()) {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, res, next) => {
    const id = req.header("x-test-user");
    const role = req.header("x-test-role");
    if (!id || !role) return res.status(401).json({ error: "Please sign in to continue." });
    req.user = { id, email: `${id}@example.test`, name: id, role };
    next();
  };
  const admin: RequestHandler = (req, res, next) => {
    if (req.user?.role !== "ADMIN" && req.user?.role !== "INVESTIGATOR") {
      return res.status(403).json({ error: "Administrator access is required." });
    }
    next();
  };
  app.use("/api/sos", createSosAlertRouter({
    repository,
    requireAuthentication: authenticate,
    requireAdministrator: admin,
    notifyAdmins: () => undefined,
    limiter: (_req, _res, next) => next()
  }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal test error." });
  });
  const server = createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not start test server."));
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/api/sos`,
        close: () => new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()))
      });
    });
  });
}

const validAlert = {
  category: "UPI/payment fraud",
  incidentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  amount: 1200,
  description: "An unknown person tricked me into approving a UPI payment.",
  contactPhone: "+91 98765 43210"
};

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = await makeTestServer();
  try {
    await run(server.baseUrl);
  } finally {
    await server.close();
  }
}

function citizenHeaders(userId = "citizen-1", key = "submit-key-00000001") {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": key,
    "x-test-user": userId,
    "x-test-role": "CITIZEN"
  };
}

test("SOS submission requires authentication and rejects invalid input", async () => {
  await withServer(async baseUrl => {
    const unauthenticated = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "submit-key-00000001" },
      body: JSON.stringify(validAlert)
    });
    assert.equal(unauthenticated.status, 401);

    const invalid = await fetch(`${baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders(),
      body: JSON.stringify({ ...validAlert, category: "not a category", citizenId: "victim-2" })
    });
    assert.equal(invalid.status, 400);
  });
});

test("SOS submission reports a clear setup error when its database table is missing", async () => {
  const repository = createFakeRepository();
  repository.findByCitizenAndKey = async () => null;
  repository.create = async () => { throw { code: "P2021" }; };
  const server = await makeTestServer(repository);
  try {
    const response = await fetch(`${server.baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders("citizen-1", "submit-key-00000003"),
      body: JSON.stringify(validAlert)
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "SOS alerts are not set up in the database yet. Apply the SOS database migration, then try again."
    });
  } finally {
    await server.close();
  }
});

test("citizen alert persists, returns a reference, and is idempotent", async () => {
  let notifications = 0;
  const repository = createFakeRepository();
  const server = await makeTestServerWithRepository(repository, () => { notifications += 1; });
  try {
    const firstResponse = await fetch(`${server.baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders(),
      body: JSON.stringify(validAlert)
    });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json() as { alert: { id: string; reference: string }; replayed: boolean };
    assert.match(first.alert.reference, /^RFX-2026-/);
    assert.equal(first.replayed, false);

    const replayResponse = await fetch(`${server.baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders(),
      body: JSON.stringify(validAlert)
    });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json() as { alert: { id: string }; replayed: boolean };
    assert.equal(replay.alert.id, first.alert.id);
    assert.equal(replay.replayed, true);
    const conflictResponse = await fetch(`${server.baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders("citizen-1", "submit-key-00000001"),
      body: JSON.stringify({ ...validAlert, amount: 5000 })
    });
    assert.equal(conflictResponse.status, 409);
    const statusResponse = await fetch(`${server.baseUrl}/alerts/${first.alert.id}`, {
      headers: { "x-test-user": "citizen-1", "x-test-role": "CITIZEN" }
    });
    assert.equal(statusResponse.status, 200);
    const ownStatus = await statusResponse.json() as { alert: { id: string; status: string } };
    assert.equal(ownStatus.alert.id, first.alert.id);
    assert.equal(ownStatus.alert.status, "New");
    assert.equal(notifications, 1);
  } finally {
    await server.close();
  }
});

test("citizens cannot retrieve another citizen alert and admin APIs are role-protected", async () => {
  const repository = createFakeRepository();
  const server = await makeTestServerWithRepository(repository, () => undefined);
  try {
    const createdResponse = await fetch(`${server.baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders("citizen-1"),
      body: JSON.stringify(validAlert)
    });
    const created = await createdResponse.json() as { alert: { id: string } };

    const otherCitizen = await fetch(`${server.baseUrl}/alerts/${created.alert.id}`, {
      headers: { "x-test-user": "citizen-2", "x-test-role": "CITIZEN" }
    });
    assert.equal(otherCitizen.status, 404);

    const forbiddenAdminList = await fetch(`${server.baseUrl}/admin/alerts`, {
      headers: { "x-test-user": "citizen-1", "x-test-role": "CITIZEN" }
    });
    assert.equal(forbiddenAdminList.status, 403);

    const adminList = await fetch(`${server.baseUrl}/admin/alerts`, {
      headers: { "x-test-user": "staff-1", "x-test-role": "ADMIN" }
    });
    assert.equal(adminList.status, 200);
    const body = await adminList.json() as { total: number; pending: number; alerts: Array<{ citizen: { id: string } }> };
    assert.equal(body.total, 1);
    assert.equal(body.pending, 1);
    assert.equal(body.alerts[0].citizen.id, "citizen-1");
  } finally {
    await server.close();
  }
});

test("administrators can acknowledge and persist alert status changes", async () => {
  const server = await makeTestServer();
  try {
    const createdResponse = await fetch(`${server.baseUrl}/alerts`, {
      method: "POST",
      headers: citizenHeaders(),
      body: JSON.stringify(validAlert)
    });
    const created = await createdResponse.json() as { alert: { id: string } };

    const ack = await fetch(`${server.baseUrl}/admin/alerts/${created.alert.id}/acknowledge`, {
      method: "POST",
      headers: { "x-test-user": "staff-1", "x-test-role": "INVESTIGATOR" }
    });
    assert.equal(ack.status, 200);

    const update = await fetch(`${server.baseUrl}/admin/alerts/${created.alert.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user": "staff-1", "x-test-role": "ADMIN" },
      body: JSON.stringify({ status: "In Progress" })
    });
    assert.equal(update.status, 200);
    const updated = await update.json() as { alert: { status: string; history: Array<{ status: string }> } };
    assert.equal(updated.alert.status, "In Progress");
    assert.deepEqual(updated.alert.history.map(item => item.status), ["New", "Acknowledged", "In Progress"]);
  } finally {
    await server.close();
  }
});

function makeTestServerWithRepository(repository: SosAlertRepository, notifyAdmins: () => void) {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, res, next) => {
    const id = req.header("x-test-user");
    const role = req.header("x-test-role");
    if (!id || !role) return res.status(401).json({ error: "Please sign in to continue." });
    req.user = { id, email: `${id}@example.test`, name: id, role };
    next();
  };
  const admin: RequestHandler = (req, res, next) => req.user?.role === "ADMIN" || req.user?.role === "INVESTIGATOR"
    ? next()
    : res.status(403).json({ error: "Administrator access is required." });
  app.use("/api/sos", createSosAlertRouter({
    repository,
    requireAuthentication: authenticate,
    requireAdministrator: admin,
    notifyAdmins,
    limiter: (_req, _res, next) => next()
  }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal test error." });
  });
  const server = createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not start test server."));
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/api/sos`,
        close: () => new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()))
      });
    });
  });
}
