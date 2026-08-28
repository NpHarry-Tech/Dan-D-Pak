import * as Omni from '../../services/omni/core.js';

export function registerOmniRoutes(api, { wrap, guardAny, branch, visibleBranch, actor }) {
  api.get('/omni/capabilities', guardAny('omni.view', 'online'), wrap(() => Omni.capabilities()));
  api.get('/omni/conversations', guardAny('omni.view', 'online'), wrap(req =>
    Omni.listConversations(visibleBranch(req), req.query)));
  api.get('/omni/conversations/:id', guardAny('omni.view', 'online'), wrap(req =>
    Omni.getConversation(req.params.id, visibleBranch(req))));
  api.get('/omni/conversations/:id/messages', guardAny('omni.view', 'online'), wrap(req =>
    Omni.listMessages(req.params.id, visibleBranch(req), req.query)));
  api.patch('/omni/conversations/:id', guardAny('omni.manage', 'online'), wrap(req =>
    Omni.updateConversation(req.params.id, req.body, branch(req), actor(req))));
  api.post('/omni/conversations/:id/customer', guardAny('omni.manage', 'online'), wrap(req =>
    Omni.linkCustomer(req.params.id, req.body.customer_id, branch(req), actor(req))));
  api.post('/omni/conversations/:id/orders', guardAny('omni.manage', 'online'), wrap(req =>
    Omni.linkOrder(req.params.id, req.body.order_id, branch(req), actor(req))));
  api.get('/omni/canned-replies', guardAny('omni.view', 'online'), wrap(req =>
    Omni.listCannedReplies(visibleBranch(req), req.query.include_inactive === 'true')));
  api.post('/omni/canned-replies', guardAny('omni.manage', 'online'), wrap(req =>
    Omni.saveCannedReply(req.body, branch(req), actor(req))));
  api.get('/omni/tags', guardAny('omni.view', 'online'), wrap(req => Omni.listTags(visibleBranch(req))));
  api.post('/omni/tags', guardAny('omni.manage', 'online'), wrap(req =>
    Omni.saveTag(req.body, branch(req), actor(req))));
  api.put('/omni/conversations/:id/tags', guardAny('omni.manage', 'online'), wrap(req =>
    Omni.setConversationTags(req.params.id, req.body.tag_ids, branch(req), actor(req))));

  // Only trusted connector adapters call this internal canonical endpoint.
  // Each provider-facing webhook still verifies its own signature first.
  api.post('/omni/events/ingest', guardAny('omni.connector'), wrap(req =>
    Omni.ingestMessage(req.body, branch(req))));
}
