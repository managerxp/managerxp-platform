import express from 'express';
import {
  createExpense,
  listExpenses,
  listExpenseCategories,
  expenseSummary,
  updateExpense,
  voidExpense
} from '../controllers/expenses.Controller.js';
import { requireStaff } from '../middleware/authGuards.js';

const expensesRouter = express.Router();
const staff = requireStaff('Café staff access required');

// Literal segments before "/:id" so they are not read as an expense id.
expensesRouter.get('/categories', staff, listExpenseCategories);
expensesRouter.get('/summary', staff, expenseSummary);

expensesRouter.get('/', staff, listExpenses);
expensesRouter.post('/', staff, createExpense);
expensesRouter.put('/:id', staff, updateExpense);
expensesRouter.post('/:id/void', staff, voidExpense);

export default expensesRouter;
