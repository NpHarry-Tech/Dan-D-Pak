// Route ownership: Contacts / Customers (danh bạ khách hàng + nhà cung cấp dùng chung).
// Nghiệp vụ ở services/customers.js; giữ NGUYÊN hành vi.
import * as Customers from '../../services/customers.js';

export function registerContactRoutes(api, { wrap, guard, guardAny, branch, requireContactMutationPermission, saveBase64Image, AVATAR_UPLOADS_DIR }) {
// --- Customers (directory + perks + tax-code lookup) ---
api.get('/customers', guard(), wrap((req) => Customers.listCustomers(branch(req), req.query.q || '')));
api.get('/customers/:id', guard(), wrap((req) => Customers.getCustomer(req.params.id, branch(req))));
api.post('/customers', guard(), wrap((req) => {
  requireContactMutationPermission(req);
  return Customers.upsertCustomer(req.body, branch(req));
}));
api.post('/customers/:id/delete', guardAny('contacts.delete'), wrap((req) => Customers.deleteCustomer(req.params.id, branch(req))));

// --- Contacts / Partners (Liên hệ: khách hàng + nhà cung cấp dùng chung 1 danh bạ) ---
api.get('/partners', guardAny('module.contacts', 'contacts.create', 'contacts.edit', 'contacts.delete'), wrap((req) => ({
  partners: Customers.listPartners(branch(req), { type: req.query.type || 'all', q: req.query.q || '', includeInactive: req.query.include_inactive === '1' }),
  counts: Customers.partnerCounts(branch(req)),
})));
api.get('/partners/:id', guardAny('module.contacts', 'contacts.create', 'contacts.edit', 'contacts.delete'), wrap((req) => Customers.getCustomer(req.params.id, branch(req))));
api.post('/partners/avatar-upload', guardAny('contacts.create', 'contacts.edit'), wrap((req) =>
  saveBase64Image(req, { dir: AVATAR_UPLOADS_DIR, urlBase: '/uploads/avatars', prefix: 'av_', auditAction: 'partner.avatar_upload' })));
api.post('/partners', guard(), wrap((req) => {
  requireContactMutationPermission(req);
  return Customers.upsertCustomer(req.body, branch(req));
}));
api.post('/partners/:id/delete', guardAny('contacts.delete'), wrap((req) => Customers.deleteCustomer(req.params.id, branch(req))));
}
