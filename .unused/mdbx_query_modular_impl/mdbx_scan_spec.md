## Keys from multiple tables

- Use: one exact lookup key needs columns from more than one current table
  row.
- Current limit: `key_encoder` reads every input column from one table.

### Example

    customers(id, tier_id)
    orders(id, customer_id, product_id)
    prices(tier_id, product_id, amount)

### SQL

    SELECT p.amount
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    JOIN prices p ON p.tier_id = c.tier_id
                 AND p.product_id = o.product_id

- `prices(tier_id, product_id)` needs `customers.tier_id` and
  `orders.product_id`.
- Without this extension: decode both columns into Lua, pass both values to a
  prepared `prices` scan, then encode them again.
- With this extension: read both columns from MDBX data and encode the
  `prices` key without creating Lua values.

### `key_encoder`

- Compile each output key field with the table cursor and column that supply
  its stored bytes.
- Read the stored bytes from every current table row and encode the `prices`
  key into the reusable key buffer.
- Return `false` when any input column is DB null, because DB null does not
  equal another value or another DB null.
- Keep the raw-key and `key_reencode` paths when all fields come from one key.
- Use the existing C field readers and key encoder when fields come from
  multiple tables. Do not decode values into Lua.

### Useful for

- Exact lookups with a composite key split across two or more current rows.
- A later grouped join API such as `prices:each(customer_row, order_row)`.
- Avoiding Lua strings, decoded Lua values and per-row Lua allocation.

### Not needed for

- FK joins; one FK already supplies the complete parent or child index key.
- Exact joins whose key columns all come from one current table.
- Additional conditions between rows that are already joined; test those in
  Lua.

### Limits

- Limit: exact keys only.
- Not added: expressions, sorting, join ordering or a public multi-table join
  syntax.
