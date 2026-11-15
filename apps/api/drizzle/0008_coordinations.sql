CREATE TABLE "incident_coordinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"with_whom" text NOT NULL,
	"channel" text DEFAULT 'presencial' NOT NULL,
	"agreement" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_coordinations" ADD CONSTRAINT "incident_coordinations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_coordinations" ADD CONSTRAINT "incident_coordinations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incident_coordinations_client_idx" ON "incident_coordinations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "incident_coordinations_incident_idx" ON "incident_coordinations" USING btree ("incident_id");