CREATE TABLE "ferry_crossing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"operator" varchar(200),
	"departure_terminal" varchar(200),
	"arrival_terminal" varchar(200),
	"scheduled_departure_at" timestamp with time zone,
	"duration_minutes" integer,
	"arrival_cutoff_minutes" integer DEFAULT 30 NOT NULL,
	"vehicle_reservation" boolean DEFAULT false NOT NULL,
	"confirmation_number" varchar(100),
	"fare_cents" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"fare_note" varchar(200),
	"after_segment_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_raw" text,
	"ocr_provider" varchar(20),
	"ocr_confidence" numeric(4, 3),
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid,
	"user_id" text NOT NULL,
	"van_profile_id" uuid,
	"odometer_miles" numeric,
	"gallons" numeric NOT NULL,
	"price_per_gallon" numeric NOT NULL,
	"total_cents" integer NOT NULL,
	"fuel_type" varchar(20) DEFAULT 'gas' NOT NULL,
	"station_name" varchar(200),
	"station_lat" numeric,
	"station_lng" numeric,
	"is_costco" boolean DEFAULT false NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"expense_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gps_track_point" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid,
	"lat" numeric NOT NULL,
	"lng" numeric NOT NULL,
	"speed" numeric,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_poi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"name" varchar(300) NOT NULL,
	"category" varchar(100) NOT NULL,
	"lat" numeric NOT NULL,
	"lng" numeric NOT NULL,
	"data" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_poi_source_external_id_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "itinerary_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid,
	"title" varchar(200) NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"location" varchar(300),
	"lat" numeric,
	"lng" numeric,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"lat" numeric NOT NULL,
	"lng" numeric NOT NULL,
	"heading" numeric,
	"speed" numeric,
	"accuracy" numeric,
	"sharing_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_location_trip_user_unique" UNIQUE("trip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "photo_reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_reaction_photo_user_unique" UNIQUE("photo_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "poi_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(50) NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"name" varchar(300) NOT NULL,
	"category" varchar(100) NOT NULL,
	"lat" numeric NOT NULL,
	"lng" numeric NOT NULL,
	"data" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "poi_cache_source_external_id_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "push_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" varchar(255) NOT NULL,
	"platform" varchar(10) DEFAULT 'ios' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_token_user_token_unique" UNIQUE("user_id","token")
);
--> statement-breakpoint
CREATE TABLE "trip_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" varchar(4000) NOT NULL,
	"context_type" text,
	"context_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trip_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid,
	"user_id" text NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"caption" varchar(500),
	"lat" numeric,
	"lng" numeric,
	"taken_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "van_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"vehicle_type" varchar(50),
	"year" integer,
	"make" varchar(100),
	"model" varchar(100),
	"fuel_type" varchar(20) DEFAULT 'gas' NOT NULL,
	"mpg_estimate" numeric,
	"tank_gallons" numeric,
	"height_inches" integer,
	"length_feet" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "ocr_warnings" jsonb;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "ocr_provider" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "ocr_status" text;--> statement-breakpoint
ALTER TABLE "trip_segment" ADD COLUMN "origin_name" varchar(200);--> statement-breakpoint
ALTER TABLE "trip_segment" ADD COLUMN "origin_lat" numeric;--> statement-breakpoint
ALTER TABLE "trip_segment" ADD COLUMN "origin_lng" numeric;--> statement-breakpoint
ALTER TABLE "trip_segment" ADD COLUMN "route_polyline" text;--> statement-breakpoint
ALTER TABLE "trip_segment" ADD COLUMN "distance_miles" numeric;--> statement-breakpoint
ALTER TABLE "trip_segment" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "trip_mode" text DEFAULT 'destination' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "share_invite_token" varchar(64);--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "share_invite_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "share_invite_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ferry_crossing" ADD CONSTRAINT "ferry_crossing_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ferry_crossing" ADD CONSTRAINT "ferry_crossing_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ferry_crossing" ADD CONSTRAINT "ferry_crossing_after_segment_id_trip_segment_id_fk" FOREIGN KEY ("after_segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ferry_crossing" ADD CONSTRAINT "ferry_crossing_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_van_profile_id_van_profile_id_fk" FOREIGN KEY ("van_profile_id") REFERENCES "public"."van_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_track_point" ADD CONSTRAINT "gps_track_point_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_track_point" ADD CONSTRAINT "gps_track_point_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_event" ADD CONSTRAINT "itinerary_event_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_event" ADD CONSTRAINT "itinerary_event_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_event" ADD CONSTRAINT "itinerary_event_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_location" ADD CONSTRAINT "member_location_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_location" ADD CONSTRAINT "member_location_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_reaction" ADD CONSTRAINT "photo_reaction_photo_id_trip_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."trip_photo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_reaction" ADD CONSTRAINT "photo_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_message" ADD CONSTRAINT "trip_message_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_message" ADD CONSTRAINT "trip_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_photo" ADD CONSTRAINT "trip_photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "van_profile" ADD CONSTRAINT "van_profile_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "van_profile" ADD CONSTRAINT "van_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_message_trip_created_idx" ON "trip_message" USING btree ("trip_id","created_at");--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_shareInviteToken_unique" UNIQUE("share_invite_token");