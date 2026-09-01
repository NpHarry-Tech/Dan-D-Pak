import * as Tax from '../../services/tax.js';

export function registerTaxRoutes(api, { wrap, guard }) {
  api.get('/public/tax-lookup/:mst', wrap(async (req) => {
    const r = await Tax.lookupTaxCode(req.params.mst);
    const { existed, ...pub } = r;
    return pub;
  }));

  api.get('/customers/lookup/tax/:mst', guard(), wrap((req) =>
    Tax.lookupTaxCode(req.params.mst)
  ));
}
