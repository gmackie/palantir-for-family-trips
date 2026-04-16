CREATE TABLE "pin_attendee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pin_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "pin_attendees_pin_user_unique" UNIQUE("pin_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"type" text DEFAULT 'custom' NOT NULL,
	"title" varchar(200) NOT NULL,
	"lat" numeric NOT NULL,
	"lng" numeric NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"notes" text,
	"created_by_user_id" text NOT NULL,
	"edit_locked_by_user_id" text,
	"edit_locked_until" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pin_attendee" ADD CONSTRAINT "pin_attendee_pin_id_pin_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."pin"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_attendee" ADD CONSTRAINT "pin_attendee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_edit_locked_by_user_id_user_id_fk" FOREIGN KEY ("edit_locked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;