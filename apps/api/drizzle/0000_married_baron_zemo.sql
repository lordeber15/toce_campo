CREATE TYPE "public"."role" AS ENUM('especialista', 'jefe_brigada', 'supervisor', 'logistico', 'coordinador', 'jefe_proyecto');--> statement-breakpoint
CREATE TYPE "public"."layer_kind" AS ENUM('huella', 'aid', 'aii', 'uv', 'superposicion', 'otro');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planificado', 'en_curso', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('planificada', 'en_curso', 'ejecutada', 'no_realizada', 'reprogramada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('planificada', 'en_ejecucion', 'ejecutada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('pendiente', 'en_ejecucion', 'fotos_ok', 'completada', 'no_realizada');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('foto', 'foto_metodo', 'audio', 'documento', 'comprobante');--> statement-breakpoint
CREATE TYPE "public"."attachment_owner" AS ENUM('execution', 'incident', 'alert_message', 'inquiry_message', 'logistics', 'station');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('en_curso', 'fotos_ok', 'completada', 'no_realizada');--> statement-breakpoint
CREATE TYPE "public"."incident_moment" AS ENUM('antes', 'durante', 'posterior');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('abierta', 'en_revision', 'resuelta', 'rechazada', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('metodologica', 'climatica', 'lluvia_intensa', 'tecnica', 'imposibilidad', 'logistica', 'seguridad', 'otra');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('abierta', 'respondida', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."reschedule_status" AS ENUM('propuesta', 'aprobada', 'rechazada');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pendiente', 'subido', 'error');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('alimentacion', 'hospedaje', 'transporte', 'combustible', 'materiales', 'apoyo_local', 'otro');--> statement-breakpoint
CREATE TYPE "public"."sample_status" AS ENUM('recolectada', 'almacenada', 'enviada', 'recibida', 'pendiente', 'perdida');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('programada', 'en_ruta', 'llegada', 'averiada', 'accidente', 'finalizada');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device_id" text,
	"device_name" text,
	"platform" text,
	"app_version" text,
	"ip_address" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"sort_order" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialties_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "species" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"specialty_id" uuid NOT NULL,
	"scientific_name" text NOT NULL,
	"common_name" text,
	"family" text,
	"order_name" text,
	"conservation_status" text,
	"extra" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dni" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"roles" "role"[] DEFAULT '{}' NOT NULL,
	"specialty_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brigade_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brigade_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brigades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"specialty_id" uuid,
	"leader_id" uuid,
	"logistician_id" uuid,
	"supervisor_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"specialty_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"is_open_ended" boolean DEFAULT false NOT NULL,
	"default_units_required" integer DEFAULT 1 NOT NULL,
	"schedule_start" time,
	"schedule_end" time,
	"min_duration_min" integer,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"photo_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method_photo_required" boolean DEFAULT true NOT NULL,
	"method_photo_instructions" text,
	"form_schema" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "layer_kind" NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"color" text,
	"geom" geometry(point) NOT NULL,
	"properties" jsonb,
	"source_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"client" text,
	"description" text,
	"start_date" date,
	"end_date" date,
	"status" "project_status" DEFAULT 'planificado' NOT NULL,
	"center_lat" text,
	"center_lng" text,
	"utm_zone" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sampling_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_method_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"code" text NOT NULL,
	"status" "unit_status" DEFAULT 'pendiente' NOT NULL,
	"client_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"planned_date" date NOT NULL,
	"original_date" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "schedule_status" DEFAULT 'planificada' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"units_required" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"geom" geometry(point) NOT NULL,
	"altitude" integer,
	"vegetation_unit" text,
	"vegetation_layer_id" uuid,
	"influence_area" text,
	"overlap" text,
	"access_notes" text,
	"status" "station_status" DEFAULT 'planificada' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"owner_type" "attachment_owner" NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"slot_key" text,
	"object_key" text NOT NULL,
	"original_object_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"original_size_bytes" bigint,
	"width" integer,
	"height" integer,
	"duration_sec" integer,
	"geom" geometry(point),
	"accuracy" double precision,
	"altitude" double precision,
	"taken_at" timestamp with time zone NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"project_id" uuid,
	"station_id" uuid,
	"sampling_unit_id" uuid,
	"upload_status" "upload_status" DEFAULT 'pendiente' NOT NULL,
	"original_upload_status" "upload_status" DEFAULT 'pendiente' NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"sampling_unit_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"schedule_id" uuid,
	"specialist_id" uuid NOT NULL,
	"brigade_id" uuid,
	"status" "execution_status" DEFAULT 'en_curso' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"start_geom" geometry(point),
	"start_accuracy" double precision,
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"form_completed_at" timestamp with time zone,
	"observations" text,
	"device_id" text,
	"client_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'comentario' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"station_id" uuid,
	"method_id" uuid,
	"sampling_unit_id" uuid,
	"schedule_id" uuid,
	"reported_by_id" uuid NOT NULL,
	"type" "incident_type" NOT NULL,
	"moment" "incident_moment",
	"launched_from" text,
	"description" text NOT NULL,
	"proposed_action" text,
	"methodological_deviation" text,
	"corrective_action" text,
	"resolution_notes" text,
	"status" "incident_status" DEFAULT 'abierta' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"geom" geometry(point),
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"coordination_response" text,
	"coordination_decision" text,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"target_user_id" uuid,
	"station_id" uuid,
	"method_id" uuid,
	"incident_id" uuid,
	"subject" text NOT NULL,
	"channel" text DEFAULT 'app' NOT NULL,
	"status" "inquiry_status" DEFAULT 'abierta' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiry_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reschedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"incident_id" uuid,
	"from_date" timestamp with time zone NOT NULL,
	"to_date" timestamp with time zone NOT NULL,
	"new_brigade_id" uuid,
	"new_station_id" uuid,
	"reason" text NOT NULL,
	"justification" text,
	"status" "reschedule_status" DEFAULT 'propuesta' NOT NULL,
	"proposed_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text,
	"direction" text NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_package_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text,
	"project_id" uuid,
	"from_date" timestamp with time zone,
	"to_date" timestamp with time zone,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"name" text NOT NULL,
	"serial" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'operativo' NOT NULL,
	"notes" text,
	"extra" jsonb,
	"registered_by_id" uuid NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"category" "expense_category" NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'PEN' NOT NULL,
	"expense_date" date NOT NULL,
	"receipt_number" text,
	"vendor" text,
	"has_receipt" boolean DEFAULT false NOT NULL,
	"registered_by_id" uuid NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"station_id" uuid,
	"code" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" "sample_status" DEFAULT 'recolectada' NOT NULL,
	"shipped_at" timestamp with time zone,
	"carrier" text,
	"tracking_code" text,
	"destination" text,
	"notes" text,
	"registered_by_id" uuid NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_support_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"full_name" text NOT NULL,
	"dni" text,
	"phone" text,
	"community" text,
	"epp_delivered" boolean DEFAULT false NOT NULL,
	"epp_items" text[] DEFAULT '{}' NOT NULL,
	"documents_delivered" text[] DEFAULT '{}' NOT NULL,
	"available_from" date,
	"available_to" date,
	"is_available" boolean DEFAULT true NOT NULL,
	"notes" text,
	"registered_by_id" uuid NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logistics_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"brigade_id" uuid,
	"plate" text,
	"description" text NOT NULL,
	"driver_name" text,
	"driver_phone" text,
	"status" "vehicle_status" DEFAULT 'programada' NOT NULL,
	"arrived_at" timestamp with time zone,
	"notes" text,
	"missing_materials" text[] DEFAULT '{}' NOT NULL,
	"defective_materials" text[] DEFAULT '{}' NOT NULL,
	"registered_by_id" uuid NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"device_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigade_members" ADD CONSTRAINT "brigade_members_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigade_members" ADD CONSTRAINT "brigade_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigades" ADD CONSTRAINT "brigades_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigades" ADD CONSTRAINT "brigades_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigades" ADD CONSTRAINT "brigades_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigades" ADD CONSTRAINT "brigades_logistician_id_users_id_fk" FOREIGN KEY ("logistician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brigades" ADD CONSTRAINT "brigades_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methods" ADD CONSTRAINT "methods_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_layers" ADD CONSTRAINT "project_layers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_units" ADD CONSTRAINT "sampling_units_station_method_id_station_methods_id_fk" FOREIGN KEY ("station_method_id") REFERENCES "public"."station_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_units" ADD CONSTRAINT "sampling_units_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_units" ADD CONSTRAINT "sampling_units_method_id_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sampling_units" ADD CONSTRAINT "sampling_units_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_methods" ADD CONSTRAINT "station_methods_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_methods" ADD CONSTRAINT "station_methods_method_id_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_vegetation_layer_id_project_layers_id_fk" FOREIGN KEY ("vegetation_layer_id") REFERENCES "public"."project_layers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sampling_unit_id_sampling_units_id_fk" FOREIGN KEY ("sampling_unit_id") REFERENCES "public"."sampling_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_sampling_unit_id_sampling_units_id_fk" FOREIGN KEY ("sampling_unit_id") REFERENCES "public"."sampling_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_method_id_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_specialist_id_users_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_messages" ADD CONSTRAINT "incident_messages_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_messages" ADD CONSTRAINT "incident_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_method_id_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sampling_unit_id_sampling_units_id_fk" FOREIGN KEY ("sampling_unit_id") REFERENCES "public"."sampling_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_method_id_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_messages" ADD CONSTRAINT "inquiry_messages_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_messages" ADD CONSTRAINT "inquiry_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_new_brigade_id_brigades_id_fk" FOREIGN KEY ("new_brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_new_station_id_stations_id_fk" FOREIGN KEY ("new_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_package_downloads" ADD CONSTRAINT "work_package_downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_package_downloads" ADD CONSTRAINT "work_package_downloads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD CONSTRAINT "logistics_equipment_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD CONSTRAINT "logistics_equipment_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_equipment" ADD CONSTRAINT "logistics_equipment_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_expenses" ADD CONSTRAINT "logistics_expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_expenses" ADD CONSTRAINT "logistics_expenses_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_expenses" ADD CONSTRAINT "logistics_expenses_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_samples" ADD CONSTRAINT "logistics_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_samples" ADD CONSTRAINT "logistics_samples_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_samples" ADD CONSTRAINT "logistics_samples_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_samples" ADD CONSTRAINT "logistics_samples_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_support_staff" ADD CONSTRAINT "logistics_support_staff_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_support_staff" ADD CONSTRAINT "logistics_support_staff_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_support_staff" ADD CONSTRAINT "logistics_support_staff_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_vehicles" ADD CONSTRAINT "logistics_vehicles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_vehicles" ADD CONSTRAINT "logistics_vehicles_brigade_id_brigades_id_fk" FOREIGN KEY ("brigade_id") REFERENCES "public"."brigades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logistics_vehicles" ADD CONSTRAINT "logistics_vehicles_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_device_idx" ON "sessions" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "species_specialty_idx" ON "species" USING btree ("specialty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "species_specialty_name_idx" ON "species" USING btree ("specialty_id","scientific_name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_dni_idx" ON "users" USING btree ("dni");--> statement-breakpoint
CREATE INDEX "users_specialty_idx" ON "users" USING btree ("specialty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brigade_members_unique_idx" ON "brigade_members" USING btree ("brigade_id","user_id");--> statement-breakpoint
CREATE INDEX "brigade_members_user_idx" ON "brigade_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "brigades_project_idx" ON "brigades" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brigades_project_name_idx" ON "brigades" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "methods_specialty_code_idx" ON "methods" USING btree ("specialty_id","code");--> statement-breakpoint
CREATE INDEX "project_layers_project_idx" ON "project_layers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_layers_geom_idx" ON "project_layers" USING gist ("geom");--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_units_code_idx" ON "sampling_units" USING btree ("station_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "sampling_units_client_idx" ON "sampling_units" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sampling_units_station_idx" ON "sampling_units" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "schedules_brigade_date_idx" ON "schedules" USING btree ("brigade_id","planned_date");--> statement-breakpoint
CREATE INDEX "schedules_station_idx" ON "schedules" USING btree ("station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "station_methods_unique_idx" ON "station_methods" USING btree ("station_id","method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_project_code_idx" ON "stations" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "stations_geom_idx" ON "stations" USING gist ("geom");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_client_idx" ON "attachments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "attachments_unit_idx" ON "attachments" USING btree ("sampling_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_client_idx" ON "executions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "executions_unit_idx" ON "executions" USING btree ("sampling_unit_id");--> statement-breakpoint
CREATE INDEX "executions_specialist_idx" ON "executions" USING btree ("specialist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_messages_client_idx" ON "incident_messages" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "incident_messages_incident_idx" ON "incident_messages" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_client_idx" ON "incidents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "incidents_project_status_idx" ON "incidents" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "incidents_brigade_idx" ON "incidents" USING btree ("brigade_id");--> statement-breakpoint
CREATE INDEX "inquiries_project_idx" ON "inquiries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "inquiries_target_idx" ON "inquiries" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_messages_client_idx" ON "inquiry_messages" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "inquiry_messages_inquiry_idx" ON "inquiry_messages" USING btree ("inquiry_id");--> statement-breakpoint
CREATE INDEX "reschedules_schedule_idx" ON "reschedules" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "sync_logs_user_idx" ON "sync_logs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "work_package_downloads_user_idx" ON "work_package_downloads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_equipment_client_idx" ON "logistics_equipment" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_expenses_client_idx" ON "logistics_expenses" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "logistics_expenses_brigade_idx" ON "logistics_expenses" USING btree ("brigade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_samples_client_idx" ON "logistics_samples" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "logistics_samples_brigade_idx" ON "logistics_samples" USING btree ("brigade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_support_client_idx" ON "logistics_support_staff" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "logistics_support_brigade_idx" ON "logistics_support_staff" USING btree ("brigade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_vehicles_client_idx" ON "logistics_vehicles" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "logistics_vehicles_brigade_idx" ON "logistics_vehicles" USING btree ("brigade_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id","at");