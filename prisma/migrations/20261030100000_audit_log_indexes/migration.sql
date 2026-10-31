-- CreateIndex
CREATE INDEX "ix_audit_created" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "ix_audit_actor" ON "audit_log"("actor_user_id", "created_at");
