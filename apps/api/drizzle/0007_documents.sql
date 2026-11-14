ALTER TYPE "public"."attachment_owner" ADD VALUE 'document';--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "brigade_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id","taken_at");