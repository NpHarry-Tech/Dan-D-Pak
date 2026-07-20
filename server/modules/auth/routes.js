// Route ownership: Auth (login/logout/me/branches/users) + ERP module registry.
// Nghiệp vụ ở services/auth.js + branches.js + modules.js. Giữ NGUYÊN hành vi.
// NHẠY CẢM: đây là đường đăng nhập — mọi thay đổi phải giữ chính xác hành vi.
import * as Auth from '../../services/auth.js';
import * as Branches from '../../services/branches.js';
import * as Modules from '../../services/modules.js';
import { audit } from '../../db.js';
import { clientIp } from '../../core/util.js';

export function registerAuthRoutes(api, { wrap, guard, guardAny, branch, visibleBranch, publicBranch }) {
api.get('/branches', wrap(() => Branches.listBranches()));
api.post('/login', wrap((req) => Auth.login(req.body.username, req.body.pin, req.body.branch_id || publicBranch(req), { ip: clientIp(req) })));
// Cổng PIN Quản lý/Admin để đổi sang chi nhánh khác (chỉ xác minh, KHÔNG tạo session).
// Phát từ trạng thái đang đăng nhập nên dùng guard(); verifyManagerOwnerPin yêu cầu
// owner/manager có quyền vào chi nhánh đích.
api.post('/auth/verify-branch-switch', guard(), wrap((req) => {
  const target = req.body?.branch_id;
  if (!target) throw new Error('Thiếu chi nhánh đích.');
  const approvedBy = Auth.verifyManagerOwnerPin(req.body?.pin, target);
  if (!approvedBy) throw new Error('Cần PIN Quản lý hoặc Admin (có quyền chi nhánh đích) để đổi chi nhánh.');
  audit('auth.branch_switch', { to: target, approved_by: approvedBy.username }, target, approvedBy.username);
  return { ok: true, approved_by: approvedBy.username };
}));
api.post('/logout', wrap((req) => {
  Auth.logout((req.headers.authorization || '').slice(7) || req.headers['x-auth-token']);
  return { ok: true };
}));
api.get('/me', guard(), wrap((req) => ({ ...req.user, perms: Auth.effectivePermsForUser(req.user.id) })));
api.post('/me/lang', guard(), wrap((req) => Auth.updateOwnLang(req.user.id, req.body.lang, branch(req))));
api.get('/users', wrap((req) => Auth.listUsers(visibleBranch(req))));
api.get('/ping', wrap(() => ({ ok: true, serverTime: Date.now() })));

// --- ERP module registry ---
api.get('/modules', guard(), wrap((req) => ({ groups: Modules.MODULE_GROUPS, modules: Modules.visibleModules(Auth.effectivePermsForUser(req.user.id)) })));
api.get('/modules/all', guardAny('settings.perms'), wrap(() => ({ groups: Modules.MODULE_GROUPS, modules: Modules.listModules(Auth.ALL_PERMS) })));
}
