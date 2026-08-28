import * as Sync from '../../services/sync.js';
import { receiveEdgeBatch, assertEdgeSignature, authorizedBranches } from '../../services/edgeSync.js';
import { buildCatalogueSnapshot } from '../../services/catalogueSync.js';
import { headerVal } from '../../core/util.js';
import { env } from '../../config/env.js';

// ONLINE-ONLY (owner 2026-08-26): các đường EDGE/OFFLINE replication bị fail-close
// khi offline-first đã ngưng. Legacy giữ inert; bật lại bằng OFFLINE_DECOMMISSIONED=false.
function assertEdgeRuntimeEnabled() {
  if (env.OFFLINE_DECOMMISSIONED) {
    const e = new Error('Offline/Edge sync đã ngưng — hệ thống chạy online-only. Server là nguồn dữ liệu duy nhất.');
    e.code = 'OFFLINE_DECOMMISSIONED';
    e.status = 410; // Gone
    throw e;
  }
}

export function registerSyncRoutes(api, { wrap, guard, branch, visibleBranch }) {
  // Machine-to-machine authentication is independent of employee sessions so
  // an edge can reconnect after a WAN outage.
  api.post('/sync/edge/push', wrap((req) => {
    assertEdgeRuntimeEnabled();
    return receiveEdgeBatch({
      signature: headerVal(req.headers, 'x-edge-sync-signature'),
      timestamp: headerVal(req.headers, 'x-edge-sync-timestamp'),
    }, req.body);
  }));
  api.post('/sync/edge/catalogue', wrap((req) => {
    assertEdgeRuntimeEnabled();
    const auth = {
      signature: headerVal(req.headers, 'x-edge-sync-signature'),
      timestamp: headerVal(req.headers, 'x-edge-sync-timestamp'),
    };
    assertEdgeSignature(auth.signature, auth.timestamp, req.body);
    const hubId = String(req.body?.hubId || '');
    const branchId = String(req.body?.branchId || '');
    if (!authorizedBranches(hubId).has(branchId)) {
      const error = new Error('Edge hub is not authorized for this branch');
      error.code = 'EDGE_SYNC_BRANCH_FORBIDDEN';
      error.status = 403;
      throw error;
    }
    return buildCatalogueSnapshot(branchId);
  }));

  // /sync/status: CHỈ ĐỌC — vẫn cho phép để client hiển thị trạng thái (online-only
  // sẽ báo engine không chạy). KHÔNG cho bật/tắt offline mode hay ép sync thủ công.
  api.get('/sync/status', guard(), wrap((req) => Sync.status(visibleBranch(req))));
  api.post('/sync/offline', guard('reports'), wrap((req) => {
    assertEdgeRuntimeEnabled();
    return Sync.setOffline(req.body.offline, branch(req));
  }));
  api.post('/sync/now', guard('reports'), wrap((req) => {
    assertEdgeRuntimeEnabled();
    return Sync.syncNow(branch(req));
  }));
}
