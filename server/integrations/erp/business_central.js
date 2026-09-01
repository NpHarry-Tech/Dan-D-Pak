// ─────────────────────────────────────────────────────────────────────────
// BusinessCentralAdapter — Microsoft Dynamics 365 Business Central (Cloud/OnPrem
// qua REST API v2.0). OAuth2 client-credentials (Azure AD). Cô lập MỌI thứ đặc
// thù BC ở đây (mission #20/#21) — POS/outbox chỉ gọi interface canonical.
//
// LƯU Ý: cửa hàng nên dựng extension "DDP Integration Inbox" (mission #22) nhận
// nguyên chứng từ canonical rồi tự map/dimension/posting group/post và trả về số
// document. Khi đó salesEndpoint = tên custom API đó. Nếu để mặc định
// 'salesInvoices' (API chuẩn) thì adapter gửi payload dạng header BC tối giản.
// ─────────────────────────────────────────────────────────────────────────
import {
  ErpError, ERROR_CLASS, classifyHttp, classifyNetworkError,
} from './erp_adapter.js';

const LOGIN_HOST = 'https://login.microsoftonline.com';
const BC_SCOPE = 'https://api.businesscentral.dynamics.com/.default';

async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export class BusinessCentralAdapter {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this._token = null;         // { value, exp }
  }

  _need(field) {
    if (!this.cfg[field]) throw new ErpError(`Thiếu cấu hình BC: ${field}`, ERROR_CLASS.AUTH);
    return this.cfg[field];
  }

  async accessToken() {
    const now = Date.now();
    if (this._token && this._token.exp - 60_000 > now) return this._token.value;
    const tenant = this._need('tenantId');
    const url = `${LOGIN_HOST}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this._need('clientId'),
      client_secret: this._need('clientSecret'),
      scope: BC_SCOPE,
    });
    let res;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }, 15000);
    } catch (e) {
      throw new ErpError(`Không lấy được token BC: ${e.message}`, classifyNetworkError(e));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ErpError(`OAuth BC thất bại (HTTP ${res.status}): ${text.slice(0, 300)}`,
        res.status === 400 || res.status === 401 ? ERROR_CLASS.AUTH : classifyHttp(res.status, text));
    }
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    if (!data.access_token) throw new ErpError('OAuth BC không trả access_token', ERROR_CLASS.AUTH);
    this._token = { value: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 };
    return this._token.value;
  }

  _apiRoot() {
    const base = String(this.cfg.baseUrl || 'https://api.businesscentral.dynamics.com').replace(/\/+$/, '');
    const ver = this.cfg.apiVersion || 'v2.0';
    return `${base}/${ver}/${this._need('tenantId')}/${this.cfg.environment || 'production'}/api/${ver}`;
  }

  _companyScope() {
    const cid = this._need('companyId');
    // GUID → companies(<guid>); tên → companies(name='...')
    const sel = /^[0-9a-f-]{30,}$/i.test(cid) ? `companies(${cid})` : `companies(name='${encodeURIComponent(cid)}')`;
    return `${this._apiRoot()}/${sel}`;
  }

  async _authedFetch(method, url, jsonBody) {
    const token = await this.accessToken();
    let res;
    try {
      res = await fetchWithTimeout(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: jsonBody == null ? undefined : JSON.stringify(jsonBody),
      });
    } catch (e) {
      throw new ErpError(`Gọi BC lỗi: ${e.message}`, classifyNetworkError(e));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ErpError(`BC ${method} ${res.status}: ${text.slice(0, 400)}`,
        classifyHttp(res.status, text), { status: res.status });
    }
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }

  async getCompanies() {
    const data = await this._authedFetch('GET', `${this._apiRoot()}/companies`);
    const list = Array.isArray(data.value) ? data.value : [];
    return list.map((c) => ({ id: c.id, name: c.name, displayName: c.displayName }));
  }

  async getHealth() {
    // Lấy company hiện tại = chứng minh token + tenant + company OK.
    const companies = await this.getCompanies();
    const company = companies.find((c) =>
      c.id === this.cfg.companyId || c.name === this.cfg.companyId) || companies[0];
    return { ok: true, product: 'Business Central', environment: this.cfg.environment, company: company?.name || null };
  }

  // Số document đã có với external_id này chưa (idempotency check TRƯỚC khi tạo).
  async getPostingStatus(externalId) {
    const ep = this.cfg.salesEndpoint || 'salesInvoices';
    const url = `${this._companyScope()}/${ep}?$filter=externalDocumentNumber eq '${encodeURIComponent(externalId)}'&$top=1`;
    try {
      const data = await this._authedFetch('GET', url);
      const hit = Array.isArray(data.value) ? data.value[0] : null;
      return { found: !!hit, documentNo: hit?.number || hit?.documentNumber || null };
    } catch (e) {
      // Endpoint custom có thể không hỗ trợ filter này → coi như chưa biết.
      if (e.errorClass === ERROR_CLASS.MAPPING || e.errorClass === ERROR_CLASS.VALIDATION) return { found: false };
      throw e;
    }
  }

  _mapPayload(doc) {
    const ep = this.cfg.salesEndpoint || 'salesInvoices';
    if (ep === 'salesInvoices') {
      // Header BC tối giản (API chuẩn). Lines/post do BC hoặc bước sau xử lý; với
      // nghiệp vụ đầy đủ nên dùng extension inbox.
      return {
        externalDocumentNumber: doc.external_id,
        customerNumber: doc.customer?.no || this.cfg.defaultCustomerNo || '',
        orderDate: (doc.occurred_at || '').slice(0, 10) || undefined,
      };
    }
    // Custom "DDP Integration Inbox": gửi NGUYÊN chứng từ canonical.
    return doc;
  }

  async postSale(doc) {
    const ep = this.cfg.salesEndpoint || 'salesInvoices';
    const url = `${this._companyScope()}/${ep}`;
    const data = await this._authedFetch('POST', url, this._mapPayload(doc));
    const documentNo = data.number || data.documentNumber || data.documentNo || data.number
      || data.id || null;
    return { documentNo, entryNo: data.entryNo || data.entryNumber || null, raw: data };
  }
}

export function createBusinessCentralAdapter(runtimeConfig) {
  return new BusinessCentralAdapter(runtimeConfig);
}
