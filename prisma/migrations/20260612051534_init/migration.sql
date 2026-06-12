-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "sdkVersion" TEXT NOT NULL,
    "device" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "screenCount" INTEGER NOT NULL DEFAULT 0,
    "blobKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_startedAt_idx" ON "Session"("startedAt" DESC);
