// Route ownership: Cloud Sync / Offline (trạng thái đồng bộ, bật offline, sync ngay).
// Nghiệp vụ ở services/sync.js. Giữ NGUYÊN hành vi.
import * as Sync from '../../services/sync.js';

export function registerSyncRoutes(api, { wrap, guard, branch, visibleBranch }) {
api.get('/sync/status', wrap((req) => Sync.status(visibleBranch(req))));
api.post('/sync/offline', guard('reports'), wrap((req) => Sync.setOffline(req.body.offline, branch(req))));
api.post('/sync/now', guard('reports'), wrap((req) => Sync.syncNow(branch(req))));
}
