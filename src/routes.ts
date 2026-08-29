import { Router } from 'express';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { budgetsRoutes } from './modules/budgets/budgets.routes.js';
import { calendarRoutes } from './modules/calendar/calendar.routes.js';
import { categoriesRoutes } from './modules/categories/categories.routes.js';
import { creditLoansRoutes } from './modules/credit-loans/credit-loans.routes.js';
import { dataRoutes } from './modules/data/data.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { installmentsRoutes } from './modules/installments/installments.routes.js';
import { investmentsRoutes } from './modules/investments/investments.routes.js';
import { recurringRoutes } from './modules/recurring/recurring.routes.js';
import { transactionsRoutes } from './modules/transactions/transactions.routes.js';

/**
 * Everything mounted here sits behind requireAuth (see app.ts). Auth is
 * default-deny by MOUNT ORDER, so a newly added router is guarded
 * automatically — there is no per-route opt-in to forget.
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/categories', categoriesRoutes);
apiRouter.use('/accounts', accountsRoutes);
apiRouter.use('/transactions', transactionsRoutes);
apiRouter.use('/calendar', calendarRoutes);
apiRouter.use('/installment-plans', installmentsRoutes);
apiRouter.use('/credit-loans', creditLoansRoutes);
apiRouter.use('/investments', investmentsRoutes);
apiRouter.use('/recurring-rules', recurringRoutes);
apiRouter.use('/budgets', budgetsRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/data', dataRoutes);
