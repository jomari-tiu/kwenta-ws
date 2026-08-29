CREATE TABLE "credit_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lender" text,
	"principal_centavos" bigint NOT NULL,
	"due_date" date,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"note" text,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_loans_principal_positive" CHECK ("credit_loans"."principal_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "credit_loan_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_loans" ADD CONSTRAINT "credit_loans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_loans" ADD CONSTRAINT "credit_loans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_loans_due_idx" ON "credit_loans" USING btree ("due_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_loan_id_credit_loans_id_fk" FOREIGN KEY ("credit_loan_id") REFERENCES "public"."credit_loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_credit_loan_idx" ON "transactions" USING btree ("credit_loan_id");