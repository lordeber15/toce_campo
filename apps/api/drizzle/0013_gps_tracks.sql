ALTER TYPE "public"."incident_type" ADD VALUE 'tracking_insuficiente';--> statement-breakpoint
CREATE TABLE "track_points" (
	"session_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"accuracy" double precision,
	"altitude" double precision
);
--> statement-breakpoint
CREATE TABLE "track_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"schedule_id" uuid,
	"brigade_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"start_geom" geometry(Point,4326),
	"start_accuracy" double precision,
	"ended_at" timestamp with time zone,
	"end_geom" geometry(Point,4326),
	"end_accuracy" double precision,
	"device_id" text,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "track_points" ADD CONSTRAINT "track_points_session_id_track_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."track_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_sessions" ADD CONSTRAINT "track_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_sessions" ADD CONSTRAINT "track_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_sessions" ADD CONSTRAINT "track_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_sessions" ADD CONSTRAINT "track_sessions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_sessions" ADD CONSTRAINT "track_sessions_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "track_points_session_at_idx" ON "track_points" USING btree ("session_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "track_sessions_client_idx" ON "track_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "track_sessions_station_user_idx" ON "track_sessions" USING btree ("station_id","user_id");--> statement-breakpoint
CREATE INDEX "track_sessions_project_idx" ON "track_sessions" USING btree ("project_id","started_at");