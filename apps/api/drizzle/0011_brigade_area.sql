ALTER TABLE "brigades" ADD COLUMN "area_geom" geometry(Geometry,4326);--> statement-breakpoint
ALTER TABLE "brigades" ADD COLUMN "area_name" text;--> statement-breakpoint
ALTER TABLE "brigades" ADD COLUMN "area_source_file" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "outside_area" boolean;