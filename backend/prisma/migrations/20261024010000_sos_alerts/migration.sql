CREATE TABLE "SOSAlert" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "citizenId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "incidentAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2),
    "description" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'New',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SOSAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SOSAlertHistory" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SOSAlertHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SOSAlert_reference_key" ON "SOSAlert"("reference");
CREATE UNIQUE INDEX "SOSAlert_citizenId_idempotencyKey_key" ON "SOSAlert"("citizenId", "idempotencyKey");
CREATE INDEX "SOSAlert_status_createdAt_idx" ON "SOSAlert"("status", "createdAt");
CREATE INDEX "SOSAlert_citizenId_createdAt_idx" ON "SOSAlert"("citizenId", "createdAt");
CREATE INDEX "SOSAlertHistory_alertId_createdAt_idx" ON "SOSAlertHistory"("alertId", "createdAt");

ALTER TABLE "SOSAlert" ADD CONSTRAINT "SOSAlert_citizenId_fkey"
    FOREIGN KEY ("citizenId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SOSAlert" ADD CONSTRAINT "SOSAlert_acknowledgedById_fkey"
    FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SOSAlertHistory" ADD CONSTRAINT "SOSAlertHistory_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "SOSAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SOSAlertHistory" ADD CONSTRAINT "SOSAlertHistory_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
