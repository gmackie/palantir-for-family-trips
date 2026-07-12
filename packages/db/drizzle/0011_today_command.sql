ALTER TABLE "trip" ADD COLUMN "run_state" text DEFAULT 'on_plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "run_state_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "run_state_note" varchar(500);--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "status" text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "actual_note" varchar(500);
