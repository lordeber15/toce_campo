ALTER TABLE "project_layers" ALTER COLUMN "geom" SET DATA TYPE geometry(Geometry,4326) USING ST_SetSRID("geom", 4326);--> statement-breakpoint
ALTER TABLE "stations" ALTER COLUMN "geom" SET DATA TYPE geometry(Point,4326) USING ST_SetSRID("geom", 4326);--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "geom" SET DATA TYPE geometry(Point,4326) USING ST_SetSRID("geom", 4326);--> statement-breakpoint
ALTER TABLE "executions" ALTER COLUMN "start_geom" SET DATA TYPE geometry(Point,4326) USING ST_SetSRID("start_geom", 4326);--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "geom" SET DATA TYPE geometry(Point,4326) USING ST_SetSRID("geom", 4326);