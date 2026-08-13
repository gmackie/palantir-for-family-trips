CREATE TABLE `post` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`permissions` text DEFAULT '["read"]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `application_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`setup_completed_at` integer,
	`setup_completed_by_user_id` text,
	`initial_workspace_id` text,
	`tenancy_mode` text DEFAULT 'single-tenant' NOT NULL,
	`maintenance_mode` integer DEFAULT false NOT NULL,
	`signup_enabled` integer DEFAULT true NOT NULL,
	`announcement_message` text,
	`announcement_tone` text DEFAULT 'info' NOT NULL,
	`allowed_email_domains` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`setup_completed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`initial_workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `billing_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`interval` text DEFAULT 'month' NOT NULL,
	`amount_in_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_plan_key_unique` ON `billing_plan` (`key`);--> statement-breakpoint
CREATE TABLE `billing_plan_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`key` text NOT NULL,
	`value` integer,
	`period` text DEFAULT 'month' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_plan_limit_plan_key_unique` ON `billing_plan_limit` (`plan_id`,`key`);--> statement-breakpoint
CREATE TABLE `cast_episode_job` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`target_date` text NOT NULL,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimed_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`script_json` text,
	`checkpoints_json` text,
	`eval_json` text,
	`llm_input_tokens` integer DEFAULT 0 NOT NULL,
	`llm_output_tokens` integer DEFAULT 0 NOT NULL,
	`tts_characters` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cast_job_trip_date_active_unique` ON `cast_episode_job` (`trip_id`,`target_date`) WHERE status NOT IN ('complete', 'failed');--> statement-breakpoint
CREATE INDEX `cast_job_status_idx` ON `cast_episode_job` (`status`);--> statement-breakpoint
CREATE TABLE `cast_episode` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`job_id` text,
	`target_date` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`title` text NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_seconds` real NOT NULL,
	`segments_json` text NOT NULL,
	`voice_id` text NOT NULL,
	`tts_model` text NOT NULL,
	`script_model` text NOT NULL,
	`tts_characters` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `cast_episode_job`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cast_episode_trip_date_idx` ON `cast_episode` (`trip_id`,`target_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `cast_episode_job_unique` ON `cast_episode` (`job_id`);--> statement-breakpoint
CREATE TABLE `cast_grounding_brief` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`title` text NOT NULL,
	`facts` text NOT NULL,
	`sources` text NOT NULL,
	`provenance` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cast_grounding_trip_segment_idx` ON `cast_grounding_brief` (`trip_id`,`segment_id`);--> statement-breakpoint
CREATE TABLE `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`payer_user_id` text NOT NULL,
	`merchant` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`occurred_at` integer NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`tip_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	`ocr_confidence` real,
	`ocr_warnings` text,
	`ocr_provider` text,
	`ocr_status` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ferry_crossing` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`operator` text,
	`departure_terminal` text,
	`arrival_terminal` text,
	`scheduled_departure_at` integer,
	`duration_minutes` integer,
	`arrival_cutoff_minutes` integer DEFAULT 30 NOT NULL,
	`vehicle_reservation` integer DEFAULT false NOT NULL,
	`confirmation_number` text,
	`fare_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fare_note` text,
	`after_segment_id` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_raw` text,
	`ocr_provider` text,
	`ocr_confidence` real,
	`expense_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`after_segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `fuel_log` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text,
	`user_id` text NOT NULL,
	`van_profile_id` text,
	`odometer_miles` real,
	`gallons` real NOT NULL,
	`price_per_gallon` real NOT NULL,
	`total_cents` integer NOT NULL,
	`fuel_type` text DEFAULT 'gas' NOT NULL,
	`station_name` text,
	`station_lat` real,
	`station_lng` real,
	`is_costco` integer DEFAULT false NOT NULL,
	`logged_at` integer NOT NULL,
	`expense_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`van_profile_id`) REFERENCES `van_profile`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `gps_track_point` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`speed` real,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ground_transport_group` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`created_by_user_id` text,
	`transport_type` text,
	`label` text NOT NULL,
	`from_description` text,
	`to_description` text,
	`scheduled_at` integer,
	`cost_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ground_transport_member` (
	`id` text PRIMARY KEY NOT NULL,
	`ground_transport_group_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`ground_transport_group_id`) REFERENCES `ground_transport_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ground_transport_members_group_user_unique` ON `ground_transport_member` (`ground_transport_group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `imported_poi` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`data` text,
	`workspace_id` text,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `imported_poi_lat_lng_idx` ON `imported_poi` (`lat`,`lng`);--> statement-breakpoint
CREATE UNIQUE INDEX `imported_poi_source_external_id_unique` ON `imported_poi` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `itinerary_event` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text,
	`title` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'other' NOT NULL,
	`location` text,
	`lat` real,
	`lng` real,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`all_day` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `journey_stop` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`sort_order` integer NOT NULL,
	`arrived_at` integer NOT NULL,
	`note` text,
	`route_status` text DEFAULT 'ready' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journey_stop_trip_arrived_idx` ON `journey_stop` (`trip_id`,`arrived_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `journey_stop_segment_unique` ON `journey_stop` (`segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `journey_stop_trip_sort_order_unique` ON `journey_stop` (`trip_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `line_item_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`line_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`line_item_id`) REFERENCES `line_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `line_item_claim_line_item_user_unique` ON `line_item_claim` (`line_item_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `line_item` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real DEFAULT '1' NOT NULL,
	`unit_price_cents` integer DEFAULT 0 NOT NULL,
	`line_total_cents` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `lodging_guest` (
	`id` text PRIMARY KEY NOT NULL,
	`lodging_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`lodging_id`) REFERENCES `lodging`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lodging_guests_lodging_user_unique` ON `lodging_guest` (`lodging_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `lodging` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`created_by_user_id` text,
	`provider` text,
	`property_name` text NOT NULL,
	`address` text,
	`lat` real,
	`lng` real,
	`check_in_at` integer NOT NULL,
	`check_out_at` integer NOT NULL,
	`check_in_instructions` text,
	`confirmation_number` text,
	`booking_url` text,
	`nightly_rate_cents` integer,
	`total_cost_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`host_name` text,
	`host_phone` text,
	`notes` text,
	`source_type` text DEFAULT 'manual' NOT NULL,
	`source_raw` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `member_location` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`heading` real,
	`speed` real,
	`accuracy` real,
	`sharing_enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_location_trip_user_unique` ON `member_location` (`trip_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `member_transit` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`direction` text,
	`transit_type` text,
	`carrier` text,
	`transit_number` text,
	`departure_station` text,
	`arrival_station` text,
	`scheduled_at` integer NOT NULL,
	`estimated_at` integer,
	`actual_at` integer,
	`tracking_status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photo_reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `trip_photo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_reaction_photo_user_unique` ON `photo_reaction` (`photo_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `pin_attendee` (
	`id` text PRIMARY KEY NOT NULL,
	`pin_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`pin_id`) REFERENCES `pin`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pin_attendees_pin_user_unique` ON `pin_attendee` (`pin_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `pin` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`title` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`notes` text,
	`created_by_user_id` text NOT NULL,
	`edit_locked_by_user_id` text,
	`edit_locked_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edit_locked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `poi_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`data` text,
	`fetched_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poi_cache_source_external_id_unique` ON `poi_cache` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `poll_option` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `poll`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `poll_vote` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_option_id` text NOT NULL,
	`user_id` text NOT NULL,
	`response` text DEFAULT 'yes' NOT NULL,
	`rank` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`poll_option_id`) REFERENCES `poll_option`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_votes_option_user_unique` ON `poll_vote` (`poll_option_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `poll` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`poll_type` text DEFAULT 'single_choice' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closes_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `proposal_reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reaction` text DEFAULT 'up' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_reactions_proposal_user_unique` ON `proposal_reaction` (`proposal_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text,
	`created_by_user_id` text NOT NULL,
	`proposal_type` text DEFAULT 'other' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text,
	`price_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`price_note` text,
	`image_url` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`booked_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `push_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`platform` text DEFAULT 'ios' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_token_user_token_unique` ON `push_token` (`user_id`,`token`);--> statement-breakpoint
CREATE TABLE `receipt_image` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expense`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`lodging_id` text NOT NULL,
	`room_label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lodging_id`) REFERENCES `lodging`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_occupant` (
	`id` text PRIMARY KEY NOT NULL,
	`room_assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`room_assignment_id`) REFERENCES `room_assignment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_occupant_room_user_unique` ON `room_occupant` (`room_assignment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `segment_member` (
	`id` text PRIMARY KEY NOT NULL,
	`segment_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segment_members_segment_user_unique` ON `segment_member` (`segment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `settlement` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`note` text,
	`settled_at` integer NOT NULL,
	`undone_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_idempotencyKey_unique` ON `settlement` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `trip_anchor` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'event' NOT NULL,
	`place_name` text,
	`lat` real,
	`lng` real,
	`start_date` text NOT NULL,
	`end_date` text,
	`confirmation_code` text,
	`url` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_day` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`date` text NOT NULL,
	`intent` text DEFAULT 'drive' NOT NULL,
	`title` text,
	`overnight_name` text,
	`overnight_kind` text,
	`overnight_lat` real,
	`overnight_lng` real,
	`hero_title` text,
	`hero_detail` text,
	`cut_if_behind` text,
	`blocks_json` text,
	`segment_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`note` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`completed_at` integer,
	`actual_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_day_trip_date_unique` ON `trip_day` (`trip_id`,`date`);--> statement-breakpoint
CREATE TABLE `trip_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_invite_token_unique` ON `trip_invite` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_invites_trip_email_unique` ON `trip_invite` (`trip_id`,`email`);--> statement-breakpoint
CREATE TABLE `trip_member_state` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_member_state_trip_user_unique` ON `trip_member_state` (`trip_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `trip_member` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`display_name` text,
	`color_hex` text,
	`venmo_handle` text,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_members_trip_user_unique` ON `trip_member` (`trip_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `trip_message` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`context_type` text,
	`context_id` text,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_message_trip_created_idx` ON `trip_message` (`trip_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trip_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`segment_id` text,
	`user_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`caption` text,
	`lat` real,
	`lng` real,
	`taken_at` integer,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `trip_segment`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_segment` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`destination_name` text,
	`destination_lat` real,
	`destination_lng` real,
	`default_zoom` integer DEFAULT 13 NOT NULL,
	`start_date` text,
	`end_date` text,
	`tz` text DEFAULT 'UTC' NOT NULL,
	`origin_name` text,
	`origin_lat` real,
	`origin_lng` real,
	`route_polyline` text,
	`distance_miles` real,
	`duration_minutes` integer,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_segments_trip_sort_order_unique` ON `trip_segment` (`trip_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `trip_share` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`token` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_share_tripId_unique` ON `trip_share` (`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_share_token_unique` ON `trip_share` (`token`);--> statement-breakpoint
CREATE TABLE `trip` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`group_mode` integer DEFAULT false NOT NULL,
	`trip_mode` text DEFAULT 'destination' NOT NULL,
	`claim_mode` text DEFAULT 'organizer' NOT NULL,
	`destination_name` text,
	`destination_lat` real,
	`destination_lng` real,
	`default_zoom` integer DEFAULT 13 NOT NULL,
	`start_date` text,
	`end_date` text,
	`tz` text DEFAULT 'UTC' NOT NULL,
	`share_invite_token` text,
	`share_invite_enabled` integer DEFAULT true NOT NULL,
	`share_invite_created_at` integer,
	`run_state` text DEFAULT 'on_plan' NOT NULL,
	`run_state_since` integer,
	`run_state_note` text,
	`cast_voice_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_shareInviteToken_unique` ON `trip` (`share_invite_token`);--> statement-breakpoint
CREATE TABLE `usage_meter` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`aggregation` text DEFAULT 'sum' NOT NULL,
	`unit` text DEFAULT 'count' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_meter_key_unique` ON `usage_meter` (`key`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`email_notifications` integer DEFAULT true NOT NULL,
	`push_notifications` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_preferences_userId_unique` ON `user_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `van_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`vehicle_type` text,
	`year` integer,
	`make` text,
	`model` text,
	`fuel_type` text DEFAULT 'gas' NOT NULL,
	`mpg_estimate` real,
	`tank_gallons` real,
	`height_inches` integer,
	`length_feet` integer,
	`driftport_rig_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `van_state_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`resource` text NOT NULL,
	`level_pct` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `waitlist_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`source` text DEFAULT 'landing' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`referral_code` text,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_entry_email_source_unique` ON `waitlist_entry` (`email`,`source`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_slug_unique` ON `workspace` (`slug`);--> statement-breakpoint
CREATE TABLE `workspace_invite_allowlist` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invite_allowlist_workspace_email_unique` ON `workspace_invite_allowlist` (`workspace_id`,`email`);--> statement-breakpoint
CREATE TABLE `workspace_membership` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_membership_workspace_user_unique` ON `workspace_membership` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `workspace_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`plan_id` text,
	`status` text DEFAULT 'free' NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plan`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_subscription_workspace_unique` ON `workspace_subscription` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_usage_rollup` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `usage_meter`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_usage_rollup_workspace_meter_period_unique` ON `workspace_usage_rollup` (`workspace_id`,`meter_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
