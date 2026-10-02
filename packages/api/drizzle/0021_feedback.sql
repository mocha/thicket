CREATE TABLE "feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"body" text NOT NULL,
	"page" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issue_number" integer,
	"issue_url" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;