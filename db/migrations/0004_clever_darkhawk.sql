ALTER TABLE "users" ADD COLUMN "firebase_uid" varchar(128);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid");