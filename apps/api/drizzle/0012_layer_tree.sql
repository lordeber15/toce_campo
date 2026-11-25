ALTER TABLE "project_layers" ADD COLUMN "source_title" text;--> statement-breakpoint
ALTER TABLE "project_layers" ADD COLUMN "folder_path" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "project_layers" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_layers" ADD COLUMN "brigade_id" uuid;--> statement-breakpoint
ALTER TABLE "project_layers" ADD CONSTRAINT "project_layers_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_layers_source_idx" ON "project_layers" USING btree ("project_id","source_file");--> statement-breakpoint
UPDATE "project_layers" SET "folder_path" = string_to_array("properties"->>'folder', ' / ') WHERE coalesce("properties"->>'folder', '') <> '';
