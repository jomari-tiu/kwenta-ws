CREATE TABLE "business_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"moved_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_movements_amount_positive" CHECK ("business_movements"."amount_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "business_movements" ADD CONSTRAINT "business_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_movements_business_idx" ON "business_movements" USING btree ("business_id","moved_on");