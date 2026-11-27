CREATE TABLE "station_method_forms" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"station_method_id" uuid NOT NULL,
	"specialist_id" uuid NOT NULL,
	"field_date" text NOT NULL,
	"values" jsonb NOT NULL,
	"schema_snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "station_method_forms" ADD CONSTRAINT "station_method_forms_station_method_id_station_methods_id_fk" FOREIGN KEY ("station_method_id") REFERENCES "public"."station_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_method_forms" ADD CONSTRAINT "station_method_forms_specialist_id_users_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "station_method_forms_method_idx" ON "station_method_forms" USING btree ("station_method_id");