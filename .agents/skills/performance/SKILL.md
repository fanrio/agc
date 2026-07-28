---
name: performance
description: >
  Use when optimizing SAP CAP applications for performance: slow queries, N+1 problem,
  SELECT columns projection, HANA execution plan, SELECT.foreach, SELECT.pipeline,
  streaming large data, calculated elements, database index, query optimization, limit results.
metadata:
  category: cap
  version: "1.0.0"
  keywords: [N+1, SELECT projection, HANA execution plan, SELECT.foreach, SELECT.pipeline, streaming, performance, slow query, optimization, index]
  related:
    service-handlers: optimize handler implementations
    cds-modeling: model design that avoids performance issues
    remote-services: optimize remote service call patterns
---

# Performance — CAP Best Practices

> **Primary reference**: https://cap.cloud.sap/docs/guides/databases/performance

## Rule 1: Always project — never SELECT *

```js
// ❌ Fetches all columns including potentially large localized texts, blobs, etc.
const products = await SELECT.from(Products)

// ✅ Project only what the UI/consumer needs
const products = await SELECT.from(Products)
  .columns('ID', 'title', 'price', 'currency_code', 'category_ID')
  .limit(50)
```

## Rule 2: Push filters to the database / remote service

```js
// ❌ Fetches all, filters in Node.js
const all = await SELECT.from(Products)
const expensive = all.filter(p => p.price > 500)

// ✅ Filter in DB
const expensive = await SELECT.from(Products).where({ price: { '>': 500 } })

// ❌ Remote: fetches all from S/4, filters locally
const allBPs = await S4.run(SELECT.from('A_BusinessPartner'))
const companies = allBPs.filter(bp => bp.BusinessPartnerCategory === '2')

// ✅ Remote: delegate full query including filter
async onReadBusinessPartners(req) {
  return this.S4.run(req.query)  // OData $filter is translated and pushed to S/4
}
```

## Rule 3: Eliminate unnecessary abstraction layers

Porting ABAP CDS VDM patterns (C_Views, I_Views) to CAP is an anti-pattern:

```cds
// ❌ Unnecessary intermediate view — every layer = extra JOIN on HANA
entity I_CostCenter as select from db.CostCenters { ... }
entity C_CostCenter as select from I_CostCenter { ... }

// ✅ CAP separates persistence (db/) from consumption (srv/) naturally
// db/schema.cds → optimised persistence model
// srv/service.cds → projection as consumption model (one layer)
entity CostCenters as projection on db.CostCenters { ID, name, manager };
```

## Rule 4: Be careful with calculated elements

```cds
entity Products : cuid {
  price      : Decimal(9,2);
  taxRate    : Decimal(4,2);
  grossPrice = price * (1 + taxRate) : Decimal(9,2);  // live-calculated
}
```

**Live-calculated elements:**
- ✅ Great for display — computed on read
- ❌ Cannot be used in `where`, `order by`, `group by` — no DB index
- Add restrictions to prevent Fiori from filtering/sorting on them:

```cds
annotate Products with @(
  Capabilities.FilterRestrictions.NonFilterableProperties: [grossPrice],
  Capabilities.SortRestrictions.NonSortableProperties: [grossPrice]
);
```

## Rule 5: Avoid N+1 queries in after handlers

```js
// ❌ N+1 — one SELECT per product
this.after('READ', Products, async products => {
  for (const p of products) {
    const stock = await SELECT.one(Stock).where({ product_ID: p.ID })
    p.stockLevel = stock?.quantity
  }
})

// ✅ One batched SELECT
this.after('READ', Products, async products => {
  const ids = products.map(p => p.ID)
  if (!ids.length) return

  const stocks = await SELECT.from(Stock).where({ product_ID: { in: ids } })
  const stockMap = Object.fromEntries(stocks.map(s => [s.product_ID, s.quantity]))

  for (const p of products) p.stockLevel = stockMap[p.ID] ?? 0
})
```

## Rule 6: Stream large result sets (CAP Node.js 9+)

```js
// ❌ Materialises the entire result set in memory
const allOrders = await SELECT.from(Orders)
res.json(allOrders)

// ✅ Stream directly to HTTP response — no full materialisation
await SELECT.from(Orders).pipeline(res)

// ✅ Process row-by-row with forEach
await SELECT.from(Orders).foreach(order => {
  // process each row
})

// ✅ Or with async iterator
for await (const order of SELECT.from(Orders)) {
  // process each row
}
```

## Rule 7: Optimise path expressions (CAP 9+)

The compiler now auto-optimises `author.ID` → reads the FK column directly (no JOIN):

```cds
// This query no longer generates a LEFT JOIN in CAP 9+:
SELECT author.ID from Books
// → translated as: SELECT author_ID from Books
```

Auto-coerced associations also simplify filters:
```js
// Both are equivalent in CAP 9+ — use the readable form:
await SELECT.from(Books).where({ author: 150 })
// instead of:
await SELECT.from(Books).where({ 'author.ID': 150 })
```

## Rule 8: Optimise draft queries

Fiori draft "All" filter queries were optimised in CAP Feb 2026:
- First-page queries for list reports with many inactive drafts are now faster
- Draft deletion during activation is also faster

Ensure you're on `@sap/cds >= 9.4` to benefit.

## Rule 9: Use `cds.log` levels — don't log in production loops

```js
const log = cds.log('orders')

// ✅ Conditional — won't evaluate in production
if (log.debug) log.debug('Processing order', { id, amount })

// ❌ Always evaluates toString() and logs
console.log(`Processing order ${JSON.stringify(order)}`)
```

## Rule 10: HANA-specific — run EXPLAIN PLAN on slow queries

```bash
# Connect to HANA Cloud and check:
EXPLAIN PLAN FOR
  SELECT * FROM MY_ORDERS WHERE STATUS = 'Open' ORDER BY CREATED_AT DESC;

# Look for:
# - Full table scans → add index
# - Many join nodes → reduce view layers
# - High estimated rows → check statistics freshness
```

Add indexes for commonly filtered columns:
```cds
entity Orders : cuid, managed {
  status    : String(10);
  createdAt : Timestamp;  // managed aspect provides this
}

// In HANA migration, add explicit index:
// db/src/MY_ORDERS_STATUS_IDX.hdbindex
// { "indexColumns": ["STATUS", "CREATEDAT"] }
```

## Performance review checklist

- [ ] All SELECT statements have `.columns(...)` projection
- [ ] All list endpoints have `.limit(...)` with reasonable default
- [ ] No in-memory filtering of remote service data
- [ ] No N+1 patterns in `after READ` handlers
- [ ] Calculated elements excluded from filter/sort capabilities
- [ ] No unnecessary CDS abstraction view layers
- [ ] Large dataset endpoints use `SELECT.pipeline()` or `SELECT.foreach()`
- [ ] Remote service connections established in `init()`, not per request
