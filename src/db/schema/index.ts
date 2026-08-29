// The one Drizzle schema, split by domain. Source of truth for the DB.
//
// Order matters for readability: `transactions` references both
// `recurring_rules` and `installment_payments`, so it comes after them.
export * from './users.js';
export * from './categories.js';
export * from './accounts.js';
export * from './recurring.js';
export * from './installments.js';
export * from './credit-loans.js';
export * from './investments.js';
export * from './transactions.js';
export * from './budgets.js';
