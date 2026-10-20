-- CreateTable
CREATE TABLE "public"."ScimUserIdentity" (
    "id" UUID NOT NULL,
    "directoryId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expectedUserUuid" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimUserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScimMembershipGrant" (
    "id" UUID NOT NULL,
    "directoryId" TEXT NOT NULL,
    "membershipId" INTEGER NOT NULL,
    "lastManagedRole" "public"."MembershipRole" NOT NULL,
    "lastManagedAccepted" BOOLEAN NOT NULL,
    "lastManagedCustomRoleId" TEXT,
    "lastManagedUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimMembershipGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScimUserIdentity_userId_idx" ON "public"."ScimUserIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimUserIdentity_directoryId_externalId_key" ON "public"."ScimUserIdentity"("directoryId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimUserIdentity_directoryId_userId_key" ON "public"."ScimUserIdentity"("directoryId", "userId");

-- CreateIndex
CREATE INDEX "ScimMembershipGrant_membershipId_idx" ON "public"."ScimMembershipGrant"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimMembershipGrant_directoryId_membershipId_key" ON "public"."ScimMembershipGrant"("directoryId", "membershipId");

-- AddForeignKey
ALTER TABLE "public"."ScimUserIdentity" ADD CONSTRAINT "ScimUserIdentity_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "public"."DSyncData"("directoryId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ScimUserIdentity" ADD CONSTRAINT "ScimUserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ScimMembershipGrant" ADD CONSTRAINT "ScimMembershipGrant_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "public"."DSyncData"("directoryId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ScimMembershipGrant" ADD CONSTRAINT "ScimMembershipGrant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."Membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

