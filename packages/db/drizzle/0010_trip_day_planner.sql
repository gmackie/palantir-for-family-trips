CREATE TABLE "trip_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"date" date NOT NULL,
	"intent" text DEFAULT 'drive' NOT NULL,
	"title" varchar(200),
	"overnight_name" varchar(300),
	"overnight_kind" text,
	"overnight_lat" numeric,
	"overnight_lng" numeric,
	"hero_title" varchar(300),
	"hero_detail" varchar(1000),
	"cut_if_behind" varchar(500),
	"blocks_json" jsonb,
	"segment_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "trip_day_trip_date_unique" UNIQUE("trip_id","date")
);
--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE set null ON UPDATE no action;
