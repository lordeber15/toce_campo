CREATE TABLE "incident_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "is_critical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "critical_reason" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "critical_by_id" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "critical_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "follow_up_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "follow_up_due_date" date;--> statement-breakpoint
ALTER TABLE "incident_follow_ups" ADD CONSTRAINT "incident_follow_ups_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_follow_ups" ADD CONSTRAINT "incident_follow_ups_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_follow_ups_incident_idx" ON "incident_follow_ups" USING btree ("incident_id","created_at");--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_critical_by_id_users_id_fk" FOREIGN KEY ("critical_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_follow_up_owner_id_users_id_fk" FOREIGN KEY ("follow_up_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;