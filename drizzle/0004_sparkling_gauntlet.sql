CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"account_id" uuid NOT NULL,
	"started_on" date,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "categories_kind_name_uq";--> statement-breakpoint
DROP INDEX "categories_kind_idx";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "scope" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "business_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "business_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_name_uq" ON "businesses" USING btree (lower("name")) WHERE closed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_account_uq" ON "businesses" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_business_idx" ON "transactions" USING btree ("business_id") WHERE business_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_kind_name_uq" ON "categories" USING btree ("scope","kind",lower("name")) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "categories_kind_idx" ON "categories" USING btree ("scope","kind","archived_at");--> statement-breakpoint
-- Starter business categories.
--
-- These live HERE, not in seed.ts, on purpose. bootstrap.ts only runs the
-- seeder when the `users` table is empty, so anything added to seed.ts would
-- never reach an already-deployed database. `where not exists` rather than
-- `on conflict` because the unique index is partial, and restating its
-- predicate in an ON CONFLICT clause is a papercut with no upside here.
insert into "categories" ("name", "kind", "scope", "icon", "color", "sort_order")
select v.name, v.kind, 'business', v.icon, v.color, v.sort_order
from (values
  ('Cost of Goods',            'expense', 'ShoppingCart',      '#dc2626', 10),
  ('Supplies',                 'expense', 'ShoppingBag',       '#ea580c', 20),
  ('Delivery & Freight',       'expense', 'Car',               '#d97706', 30),
  ('Business Rent & Utilities','expense', 'House',             '#0891b2', 40),
  ('Staff & Wages',            'expense', 'Users',             '#7c3aed', 50),
  ('Marketing',                'expense', 'Sparkles',          '#db2777', 60),
  ('Permits & Taxes',          'expense', 'Landmark',          '#475569', 70),
  ('Business Misc',            'expense', 'Ellipsis',          '#64748b', 80),
  ('Sales',                    'income',  'Store',             '#16a34a', 10),
  ('Service Income',           'income',  'Wrench',            '#0d9488', 20),
  ('Other Business Income',    'income',  'CircleDollarSign',  '#65a30d', 30)
) as v(name, kind, icon, color, sort_order)
where not exists (
  select 1 from "categories" c
  where c."scope" = 'business'
    and c."kind" = v.kind
    and lower(c."name") = lower(v.name)
    and c."archived_at" is null
);
