-- Add placement column to OrderItem to record which design placement the customer selected.
ALTER TABLE "OrderItem" ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'left';
