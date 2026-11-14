ALTER TABLE "inquiries" ADD COLUMN "closed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiry_messages" ADD COLUMN "kind" text DEFAULT 'respuesta' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_messages" ADD COLUMN "channel" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_messages" ADD COLUMN "on_behalf_of_id" uuid;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_messages" ADD CONSTRAINT "inquiry_messages_on_behalf_of_id_users_id_fk" FOREIGN KEY ("on_behalf_of_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;