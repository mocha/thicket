ALTER TABLE "users" ADD COLUMN "saved_display" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_offer_answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "save_first_display" boolean DEFAULT false NOT NULL;