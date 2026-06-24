CREATE TABLE "room_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lodging_id" uuid NOT NULL,
	"room_label" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_occupant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_assignment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "room_occupant_room_user_unique" UNIQUE("room_assignment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "room_assignment" ADD CONSTRAINT "room_assignment_lodging_id_lodging_id_fk" FOREIGN KEY ("lodging_id") REFERENCES "public"."lodging"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_occupant" ADD CONSTRAINT "room_occupant_room_assignment_id_room_assignment_id_fk" FOREIGN KEY ("room_assignment_id") REFERENCES "public"."room_assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_occupant" ADD CONSTRAINT "room_occupant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;