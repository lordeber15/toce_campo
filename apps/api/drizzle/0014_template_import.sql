CREATE TYPE "public"."activity_type" AS ENUM('estacion', 'movilizacion', 'desmovilizacion', 'descanso', 'otro');--> statement-breakpoint
CREATE TYPE "public"."brigade_region" AS ENUM('COSTA', 'SIERRA', 'SELVA');--> statement-breakpoint
CREATE TYPE "public"."method_class" AS ENUM('todas', 'condicional', 'evento', 'atributo', 'transversal');--> statement-breakpoint
CREATE TABLE "specialty_access" (
	"specialty_id" uuid NOT NULL,
	"granted_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialty_access_specialty_id_granted_id_pk" PRIMARY KEY("specialty_id","granted_id")
);
--> statement-breakpoint
ALTER TABLE "schedules" ALTER COLUMN "station_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brigade_members" ADD COLUMN "valid_from" date;--> statement-breakpoint
ALTER TABLE "brigade_members" ADD COLUMN "valid_to" date;--> statement-breakpoint
ALTER TABLE "brigades" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "brigades" ADD COLUMN "region" "brigade_region";--> statement-breakpoint
ALTER TABLE "brigades" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "methods" ADD COLUMN "method_class" "method_class";--> statement-breakpoint
ALTER TABLE "methods" ADD COLUMN "requires_track" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "methods" ADD COLUMN "photos_per_unit" integer;--> statement-breakpoint
ALTER TABLE "methods" ADD COLUMN "schedule_text" text;--> statement-breakpoint
ALTER TABLE "methods" ADD COLUMN "guideline" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "activity_type" "activity_type" DEFAULT 'estacion' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "station_methods" ADD COLUMN "brigade_id" uuid;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "influence_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "vegetation_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "specialty_access" ADD CONSTRAINT "specialty_access_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialty_access" ADD CONSTRAINT "specialty_access_granted_id_specialties_id_fk" FOREIGN KEY ("granted_id") REFERENCES "public"."specialties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_methods" ADD CONSTRAINT "station_methods_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brigades_project_code_idx" ON "brigades" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "station_methods_brigade_idx" ON "station_methods" USING btree ("brigade_id");--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_station_activity_chk" CHECK ("activity_type" <> 'estacion' OR "station_id" IS NOT NULL);