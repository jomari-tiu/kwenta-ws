CREATE TABLE "investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"kind" text DEFAULT 'fund' NOT NULL,
	"target_centavos" bigint,
	"target_date" date,
	"current_value_centavos" bigint,
	"value_as_of" date,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"note" text,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investments_target_positive" CHECK ("investments"."target_centavos" > 0),
	CONSTRAINT "investments_current_value_not_negative" CHECK ("investments"."current_value_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "investment_id" uuid;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investments_target_date_idx" ON "investments" USING btree ("target_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investment_id_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_investment_idx" ON "transactions" USING btree ("investment_id");