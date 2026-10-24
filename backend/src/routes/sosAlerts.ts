import { createHash } from "node:crypto";
import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { isUniqueConstraintError, sosAlertRepository, type SosAlertRecord, type SosAlertRepository, type SosAlertStatus } from "../services/sosAlerts.js";
import { notifyAdminSosAlert } from "../services/sosRealtimeState.js";
import type { SosAlertNotification } from "../services/sosRealtime.js";

const alertStatuses = ["New", "Acknowledged", "In Progress", "Resolved"] as const;
const fraudCategories = ["UPI/payment fraud", "Bank fraud", "Online scam", "Identity theft", "Other"] as const;
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many alerts were submitted. Please try again later." }
});

const alertInputSchema = z.object({
  category: z.enum(fraudCategories),
  incidentAt: z.string().datetime({ offset: true }),
  amount: z.number().finite().min(0).max(1_000_000_000).optional(),
  description: z.string().trim().min(10).max(1200),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/)
}).strict();

const statusInputSchema = z.object({
  status: z.enum(alertStatuses)
}).strict();

type RouterDependencies = {
  repository?: SosAlertRepository;
  requireAuthentication?: RequestHandler;
  requireAdministrator?: RequestHandler;
  notifyAdmins?: (alert: SosAlertNotification) => void;
  limiter?: RequestHandler;
};

function isCitizen(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please sign in to continue." });
  if (req.user.role !== "CITIZEN") return res.status(403).json({ error: "A citizen account is required." });
  next();
}

function alertDto(alert: SosAlertRecord, includeContact = false) {
  return {
    id: alert.id,
    reference: alert.reference,
    category: alert.category,
    incidentAt: alert.incidentAt,
    amount: alert.amount === null ? null : Number(alert.amount),
    description: alert.description,
    status: alert.status,
    acknowledgedAt: alert.acknowledgedAt,
    acknowledgedBy: alert.acknowledgedBy,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
    ...(includeContact ? {
      contactPhone: alert.contactPhone,
      citizen: alert.citizen
    } : {}),
    history: alert.history.map(item => ({
      status: item.status,
      note: item.note,
      createdAt: item.createdAt,
      updatedBy: item.updatedBy
    }))
  };
}

function payloadHash(payload: z.infer<typeof alertInputSchema>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function matchesReplay(alert: SosAlertRecord, hash: string, res: express.Response) {
  if (alert.payloadHash !== hash) {
    res.status(409).json({ error: "This submission key was already used for a different alert." });
    return false;
  }
  res.status(200).json({ alert: alertDto(alert), replayed: true });
  return true;
}

export function createSosAlertRouter(dependencies: RouterDependencies = {}) {
  const router = express.Router();
  const repository = dependencies.repository ?? sosAlertRepository;
  const authenticate = dependencies.requireAuthentication ?? requireAuth;
  const administrator = dependencies.requireAdministrator ?? requireAdmin;
  const notifyAdmins = dependencies.notifyAdmins ?? notifyAdminSosAlert;
  const limiter = dependencies.limiter ?? submitLimiter;

  router.post("/alerts", authenticate, isCitizen, limiter, async (req, res, next) => {
    const parsed = alertInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the alert details." });
    }
    const incidentAt = new Date(parsed.data.incidentAt);
    if (incidentAt.getTime() > Date.now()) {
      return res.status(400).json({ error: "Incident time cannot be in the future." });
    }

    const idempotencyKey = req.get("Idempotency-Key")?.trim() ?? "";
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: "A valid submission key is required. Please try submitting again." });
    }
    const hash = payloadHash(parsed.data);

    try {
      const previous = await repository.findByCitizenAndKey(req.user!.id, idempotencyKey);
      if (previous) {
        matchesReplay(previous, hash, res);
        return;
      }

      let alert: SosAlertRecord;
      try {
        alert = await repository.create({
          citizenId: req.user!.id,
          category: parsed.data.category,
          incidentAt,
          amount: parsed.data.amount ?? null,
          description: parsed.data.description,
          contactPhone: parsed.data.contactPhone,
          idempotencyKey,
          payloadHash: hash
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await repository.findByCitizenAndKey(req.user!.id, idempotencyKey);
        if (!raced) throw error;
        matchesReplay(raced, hash, res);
        return;
      }

      try {
        notifyAdmins({
          id: alert.id,
          reference: alert.reference,
          category: alert.category,
          incidentAt: alert.incidentAt.toISOString(),
          createdAt: alert.createdAt.toISOString(),
          status: alert.status
        });
      } catch {
        console.error("SOS notification broadcast failed after alert persistence.");
      }
      res.status(201).json({ alert: alertDto(alert), replayed: false });
    } catch (error) {
      next(error);
    }
  });

  router.get("/alerts", authenticate, isCitizen, async (req, res, next) => {
    try {
      const alerts = await repository.list(undefined, req.user!.id);
      res.json({ alerts: alerts.map(alert => alertDto(alert)) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/alerts/:id", authenticate, isCitizen, async (req, res, next) => {
    try {
      const alert = await repository.findById(String(req.params.id));
      if (!alert || alert.citizenId !== req.user!.id) {
        return res.status(404).json({ error: "SOS alert not found." });
      }
      res.json({ alert: alertDto(alert) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/alerts", authenticate, administrator, async (req, res, next) => {
    const parsedStatus = z.enum(alertStatuses).optional().safeParse(req.query.status);
    if (!parsedStatus.success) return res.status(400).json({ error: "Alert status filter is invalid." });
    try {
      const [alerts, total, pending] = await Promise.all([
        repository.list(parsedStatus.data),
        repository.count(),
        repository.count("New")
      ]);
      res.json({
        total,
        pending,
        alerts: alerts.map(alert => alertDto(alert, true))
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/alerts/:id", authenticate, administrator, async (req, res, next) => {
    try {
      const alert = await repository.findById(String(req.params.id));
      if (!alert) return res.status(404).json({ error: "SOS alert not found." });
      res.json({ alert: alertDto(alert, true) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/alerts/:id/acknowledge", authenticate, administrator, async (req, res, next) => {
    try {
      const alert = await repository.acknowledge(String(req.params.id), req.user!.id);
      if (!alert) return res.status(404).json({ error: "SOS alert not found." });
      res.json({ alert: alertDto(alert, true) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/alerts/:id/status", authenticate, administrator, async (req, res, next) => {
    const parsed = statusInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Select a valid alert status." });
    try {
      const alert = await repository.updateStatus(String(req.params.id), req.user!.id, parsed.data.status);
      if (!alert) return res.status(404).json({ error: "SOS alert not found." });
      res.json({ alert: alertDto(alert, true) });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const code = error && typeof error === "object"
      ? ("errorCode" in error && typeof error.errorCode === "string"
        ? error.errorCode
        : "code" in error && typeof error.code === "string" ? error.code : undefined)
      : undefined;

    if (code === "P2021") {
      return res.status(503).json({ error: "SOS alerts are not set up in the database yet. Apply the SOS database migration, then try again." });
    }
    if (code === "P1000" || code === "P1001" || code === "P1002" || code === "P1013") {
      return res.status(503).json({ error: "SOS alerts cannot connect to the database right now. Check the backend database URL and connectivity, then try again." });
    }
    next(error);
  });

  return router;
}
