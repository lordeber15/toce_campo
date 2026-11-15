ALTER TYPE "public"."incident_type" ADD VALUE 'falta_materiales';--> statement-breakpoint
ALTER TYPE "public"."expense_category" ADD VALUE 'peajes' BEFORE 'materiales';--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD COLUMN "reception_status" text;--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD COLUMN "received_by" text;--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD COLUMN "received_quantity" integer;