import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const alertInclude = {
  citizen: { select: { id: true, name: true, email: true } },
  acknowledgedBy: { select: { id: true, name: true } },
  history: {
    orderBy: { createdAt: "asc" as const },
    include: { updatedBy: { select: { id: true, name: true } } }
  }
} satisfies Prisma.SOSAlertInclude;

export type SosAlertRecord = Prisma.SOSAlertGetPayload<{ include: typeof alertInclude }>;
export type SosAlertStatus = "New" | "Acknowledged" | "In Progress" | "Resolved";

export type SosAlertCreateInput = {
  citizenId: string;
  category: string;
  incidentAt: Date;
  amount: number | null;
  description: string;
  contactPhone: string;
  idempotencyKey: string;
  payloadHash: string;
};

export type SosAlertRepository = {
  create(input: SosAlertCreateInput): Promise<SosAlertRecord>;
  findById(id: string): Promise<SosAlertRecord | null>;
  findByCitizenAndKey(citizenId: string, key: string): Promise<SosAlertRecord | null>;
  list(status?: SosAlertStatus, citizenId?: string): Promise<SosAlertRecord[]>;
  count(status?: SosAlertStatus): Promise<number>;
  acknowledge(id: string, userId: string): Promise<SosAlertRecord | null>;
  updateStatus(id: string, userId: string, status: SosAlertStatus): Promise<SosAlertRecord | null>;
};

function makeReference() {
  const year = new Date().getFullYear();
  return `RFX-${year}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export const sosAlertRepository: SosAlertRepository = {
  async create(input) {
    return prisma.$transaction(async tx => {
      const created = await tx.sOSAlert.create({
        data: { ...input, reference: makeReference() }
      });
      await tx.sOSAlertHistory.create({
        data: {
          alertId: created.id,
          status: "New",
          note: "Alert submitted to RecoverX administration.",
          updatedById: input.citizenId
        }
      });
      return tx.sOSAlert.findUniqueOrThrow({
        where: { id: created.id },
        include: alertInclude
      });
    });
  },

  findById(id) {
    return prisma.sOSAlert.findUnique({ where: { id }, include: alertInclude });
  },

  findByCitizenAndKey(citizenId, idempotencyKey) {
    return prisma.sOSAlert.findUnique({
      where: { citizenId_idempotencyKey: { citizenId, idempotencyKey } },
      include: alertInclude
    });
  },

  list(status, citizenId) {
    return prisma.sOSAlert.findMany({
      where: { ...(status ? { status } : {}), ...(citizenId ? { citizenId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      include: alertInclude
    });
  },

  count(status) {
    return prisma.sOSAlert.count({ where: status ? { status } : undefined });
  },

  async acknowledge(id, userId) {
    return prisma.$transaction(async tx => {
      const updated = await tx.sOSAlert.updateMany({
        where: { id, status: "New", acknowledgedAt: null },
        data: { status: "Acknowledged", acknowledgedAt: new Date(), acknowledgedById: userId }
      });
      if (updated.count) {
        await tx.sOSAlertHistory.create({
          data: { alertId: id, status: "Acknowledged", note: "Alert acknowledged by administration.", updatedById: userId }
        });
      }
      return tx.sOSAlert.findUnique({ where: { id }, include: alertInclude });
    });
  },

  async updateStatus(id, userId, status) {
    return prisma.$transaction(async tx => {
      const current = await tx.sOSAlert.findUnique({ where: { id }, select: { id: true, status: true, acknowledgedAt: true } });
      if (!current) return null;
      const acknowledged = status === "Acknowledged" && current.acknowledgedAt === null;
      const updateData = {
        status,
        ...(acknowledged ? { acknowledgedAt: new Date(), acknowledgedById: userId } : {})
      };
      await tx.sOSAlert.update({ where: { id }, data: updateData });
      if (current.status !== status) {
        await tx.sOSAlertHistory.create({
          data: { alertId: id, status, updatedById: userId }
        });
      }
      return tx.sOSAlert.findUnique({ where: { id }, include: alertInclude });
    });
  }
};

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
