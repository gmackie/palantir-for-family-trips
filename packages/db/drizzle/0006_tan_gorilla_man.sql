CREATE TABLE "ground_transport_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"created_by_user_id" text,
	"transport_type" text,
	"label" varchar(200) NOT NULL,
	"from_description" text,
	"to_description" text,
	"scheduled_at" timestamp with time zone,
	"cost_cents" integer,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ground_transport_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ground_transport_group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "ground_transport_members_group_user_unique" UNIQUE("ground_transport_group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lodging_guest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lodging_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "lodging_guests_lodging_user_unique" UNIQUE("lodging_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lodging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"created_by_user_id" text,
	"provider" text,
	"property_name" varchar(200) NOT NULL,
	"address" text,
	"lat" numeric,
	"lng" numeric,
	"check_in_at" timestamp with time zone NOT NULL,
	"check_out_at" timestamp with time zone NOT NULL,
	"check_in_instructions" text,
	"confirmation_number" varchar(100),
	"booking_url" text,
	"nightly_rate_cents" integer,
	"total_cost_cents" integer,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"host_name" varchar(120),
	"host_phone" varchar(30),
	"notes" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_raw" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_transit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"direction" text,
	"transit_type" text,
	"carrier" varchar(100),
	"transit_number" varchar(50),
	"departure_station" varchar(200),
	"arrival_station" varchar(200),
	"scheduled_at" timestamp with time zone NOT NULL,
	"estimated_at" timestamp with time zone,
	"actual_at" timestamp with time zone,
	"tracking_status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ground_transport_group" ADD CONSTRAINT "ground_transport_group_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ground_transport_group" ADD CONSTRAINT "ground_transport_group_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ground_transport_member" ADD CONSTRAINT "ground_transport_member_ground_transport_group_id_ground_transport_group_id_fk" FOREIGN KEY ("ground_transport_group_id") REFERENCES "public"."ground_transport_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ground_transport_member" ADD CONSTRAINT "ground_transport_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_guest" ADD CONSTRAINT "lodging_guest_lodging_id_lodging_id_fk" FOREIGN KEY ("lodging_id") REFERENCES "public"."lodging"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging_guest" ADD CONSTRAINT "lodging_guest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging" ADD CONSTRAINT "lodging_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lodging" ADD CONSTRAINT "lodging_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_transit" ADD CONSTRAINT "member_transit_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_transit" ADD CONSTRAINT "member_transit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;