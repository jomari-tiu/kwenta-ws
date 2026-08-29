CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT 'Owner' NOT NULL,
	"password_hash" text NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"singleton" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"icon" text,
	"color" text,
	"monthly_budget_centavos" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_budget_nonneg" CHECK ("categories"."monthly_budget_centavos" is null or "categories"."monthly_budget_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"icon" text,
	"color" text,
	"opening_balance_centavos" bigint DEFAULT 0 NOT NULL,
	"opening_balance_date" date,
	"credit_limit_centavos" bigint,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"month_of_year" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_materialized_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_rules_amount_positive" CHECK ("recurring_rules"."amount_centavos" > 0),
	CONSTRAINT "recurring_rules_end_after_start" CHECK ("recurring_rules"."end_date" is null or "recurring_rules"."end_date" >= "recurring_rules"."start_date"),
	CONSTRAINT "recurring_rules_dow_range" CHECK ("recurring_rules"."day_of_week" is null or "recurring_rules"."day_of_week" between 1 and 7),
	CONSTRAINT "recurring_rules_dom_range" CHECK ("recurring_rules"."day_of_month" is null or "recurring_rules"."day_of_month" between 1 and 31),
	CONSTRAINT "recurring_rules_moy_range" CHECK ("recurring_rules"."month_of_year" is null or "recurring_rules"."month_of_year" between 1 and 12),
	CONSTRAINT "recurring_rules_interval_positive" CHECK ("recurring_rules"."interval" >= 1),
	CONSTRAINT "recurring_rules_shape" CHECK (case "recurring_rules"."frequency"
            when 'weekly'   then "recurring_rules"."day_of_week" is not null
            when 'biweekly' then "recurring_rules"."day_of_week" is not null
            when 'monthly'  then "recurring_rules"."day_of_month" is not null
            when 'yearly'   then "recurring_rules"."day_of_month" is not null and "recurring_rules"."month_of_year" is not null
          end)
);
--> statement-breakpoint
CREATE TABLE "installment_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_payments_amount_positive" CHECK ("installment_payments"."amount_centavos" > 0),
	CONSTRAINT "installment_payments_paid_requires_date" CHECK (("installment_payments"."status" = 'pending' and "installment_payments"."paid_date" is null)
       or ("installment_payments"."status" = 'paid' and "installment_payments"."paid_date" is not null))
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"merchant" text,
	"total_centavos" bigint NOT NULL,
	"term_months" integer NOT NULL,
	"start_date" date NOT NULL,
	"day_of_month" integer NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_total_positive" CHECK ("installment_plans"."total_centavos" > 0),
	CONSTRAINT "installment_plans_term_range" CHECK ("installment_plans"."term_months" between 1 and 120),
	CONSTRAINT "installment_plans_dom_range" CHECK ("installment_plans"."day_of_month" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"amount_centavos" bigint NOT NULL,
	"txn_date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"recurring_rule_id" uuid,
	"occurrence_date" date,
	"installment_payment_id" uuid,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"month" date NOT NULL,
	"cap_centavos" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_overrides_month_is_first" CHECK (date_trunc('month', "budget_overrides"."month")::date = "budget_overrides"."month"),
	CONSTRAINT "budget_overrides_cap_nonneg" CHECK ("budget_overrides"."cap_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_payments" ADD CONSTRAINT "installment_payments_plan_id_installment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_payment_id_installment_payments_id_fk" FOREIGN KEY ("installment_payment_id") REFERENCES "public"."installment_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_overrides" ADD CONSTRAINT "budget_overrides_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_singleton_uq" ON "users" USING btree ("singleton");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_kind_name_uq" ON "categories" USING btree ("kind",lower("name")) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "categories_kind_idx" ON "categories" USING btree ("kind","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_name_uq" ON "accounts" USING btree (lower("name")) WHERE archived_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_single_default_uq" ON "accounts" USING btree ("is_default") WHERE is_default;--> statement-breakpoint
CREATE INDEX "accounts_kind_idx" ON "accounts" USING btree ("kind","archived_at");--> statement-breakpoint
CREATE INDEX "recurring_rules_active_idx" ON "recurring_rules" USING btree ("is_active","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "installment_payments_plan_seq_uq" ON "installment_payments" USING btree ("plan_id","sequence_no");--> statement-breakpoint
CREATE INDEX "installment_payments_due_status_idx" ON "installment_payments" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "installment_payments_plan_idx" ON "installment_payments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "installment_plans_start_idx" ON "installment_plans" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "transactions_type_date_idx" ON "transactions" USING btree ("type","txn_date");--> statement-breakpoint
CREATE INDEX "transactions_category_date_idx" ON "transactions" USING btree ("category_id","txn_date");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_rule_occurrence_uq" ON "transactions" USING btree ("recurring_rule_id","occurrence_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_installment_payment_uq" ON "transactions" USING btree ("installment_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_overrides_category_month_uq" ON "budget_overrides" USING btree ("category_id","month");