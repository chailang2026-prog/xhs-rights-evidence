CREATE TABLE `infringement_records` (
	`id` text PRIMARY KEY NOT NULL,
	`infringement_url` text NOT NULL,
	`platform` text NOT NULL,
	`infringement_type` text NOT NULL,
	`source_url` text,
	`title` text,
	`discovered_at` text NOT NULL,
	`notes` text,
	`status` text DEFAULT '待核实' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_status_idx` ON `infringement_records` (`status`);--> statement-breakpoint
CREATE INDEX `records_created_at_idx` ON `infringement_records` (`created_at`);