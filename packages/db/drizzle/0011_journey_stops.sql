CREATE TABLE "journey_stop" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"sort_order" integer NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"note" text,
	"route_status" text DEFAULT 'ready' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "journey_stop_segment_unique" UNIQUE("segment_id"),
	CONSTRAINT "journey_stop_trip_sort_order_unique" UNIQUE("trip_id", "sort_order")
);
--> statement-breakpoint
ALTER TABLE "journey_stop" ADD CONSTRAINT "journey_stop_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journey_stop" ADD CONSTRAINT "journey_stop_segment_id_trip_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."trip_segment"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journey_stop" ADD CONSTRAINT "journey_stop_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "journey_stop_trip_arrived_idx" ON "journey_stop" USING btree ("trip_id", "arrived_at");
