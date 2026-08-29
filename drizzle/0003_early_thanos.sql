ALTER TABLE "transactions" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_account_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_transfer_account_idx" ON "transactions" USING btree ("transfer_account_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_shape" CHECK (case when "transactions"."type" = 'transfer'
             then "transactions"."transfer_account_id" is not null
                  and "transactions"."transfer_account_id" <> "transactions"."account_id"
             else "transactions"."transfer_account_id" is null end);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_shape" CHECK (case when "transactions"."type" = 'transfer'
             then "transactions"."category_id" is null
             else "transactions"."category_id" is not null end);