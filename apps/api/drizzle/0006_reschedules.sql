ALTER TYPE "public"."attachment_owner" ADD VALUE 'reschedule';--> statement-breakpoint
ALTER TABLE "reschedules" ADD COLUMN "reopen_units" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reschedules" ADD COLUMN "decision_notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "reschedules_one_pending_idx" ON "reschedules" USING btree ("schedule_id") WHERE status = 'propuesta';