-- CreateTable
CREATE TABLE "TransferRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryItemId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "marketListingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_RETURN',
    "sellerTrackingNumber" TEXT,
    "dorkmugsTrackingNumber" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TransferRequest_fromUserId_idx" ON "TransferRequest"("fromUserId");

-- CreateIndex
CREATE INDEX "TransferRequest_toUserId_idx" ON "TransferRequest"("toUserId");

-- CreateIndex
CREATE INDEX "TransferRequest_status_idx" ON "TransferRequest"("status");
