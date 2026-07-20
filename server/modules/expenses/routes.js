// Route ownership: Expenses (Chi phí) — sổ chi phí + danh mục + liên kết két/kế toán.
// Nghiệp vụ ở services/expenses.js; giữ NGUYÊN hành vi.
import * as Expenses from '../../services/expenses.js';

export function registerExpenseRoutes(api, { wrap, guard, branch }) {
// --- Expenses (Chi phí): sổ chi phí, liên kết két (drawer) hoặc kế toán chi trực tiếp ---
api.get('/expenses', guard('module.expenses'), wrap((req) => Expenses.listExpenses(branch(req), req.query)));
api.get('/expenses/categories', guard('module.expenses'), wrap((req) => Expenses.listCategories(branch(req))));
api.post('/expenses/categories', guard('module.expenses'), wrap((req) => Expenses.upsertCategory(req.body, branch(req))));
api.post('/expenses/categories/:id/delete', guard('module.expenses'), wrap((req) => Expenses.deleteCategory(req.params.id, branch(req))));
api.post('/expenses', guard('module.expenses'), wrap((req) => Expenses.createExpense(req.body, branch(req), req.user)));
api.post('/expenses/:id', guard('module.expenses'), wrap((req) => Expenses.updateExpense(req.params.id, req.body, branch(req), req.user)));
api.post('/expenses/:id/delete', guard('module.expenses'), wrap((req) => Expenses.deleteExpense(req.params.id, branch(req), req.user)));
}
