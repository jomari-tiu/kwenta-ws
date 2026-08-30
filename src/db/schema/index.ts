// The one Drizzle schema, split by domain. Source of truth for the DB.
//
// Order matters for readability: `transactions` references both
// `recurring_rules` and `installment_payments`, so it comes after them.
// `businesses` sits directly after `accounts` — it references accounts, and
// both `recurring_rules` and `transactions` reference it.
export * from './users.js';
export * from './categories.js';
export * from './accounts.js';
export * from './businesses.js';
export * from './business-movements.js';
export * from './recurring.js';
export * from './installments.js';
export * from './credit-loans.js';
export * from './investments.js';
export * from './transactions.js';
export * from './budgets.js';
