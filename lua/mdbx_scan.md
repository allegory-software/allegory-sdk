
NESTED SCANS EXAMPLE

	local customers = db:scan('customers', 'tenant_id = ?, id asc')
		:select'id'
	local orders = customers:join_scan(
		'orders.customer_id = customers.id'):select'id'
	local items = orders:join_scan(
		'items.order_id = orders.id'):select'id'
	local invoices = customers:join_scan(
		'invoices.customer_id = customers.id'):select'id'
	local payments = invoices:join_scan(
		'payments.invoice_id = invoices.id'):select'id'

	for _, customer_id in customers:rows{tenant_id} do
		for _, order_id in orders:left_rows() do
			for _, item_id in items:left_rows() do
				for _, invoice_id in invoices:left_rows() do
					for _, payment_id in payments:left_rows() do
						print(customer_id, order_id, item_id,
							invoice_id, payment_id)
					end
				end
			end
		end
	end
	payments.close()
	invoices.close()
	items.close()
	orders.close()

FLAT JOIN EXAMPLE

	local scan = db:scan('customers', 'tenant_id = ?, id asc')
		:left_join'orders.customer_id = customers.id'
		:left_join'items.order_id = orders.id'
		:left_join'invoices.customer_id = customers.id'
		:left_join'payments.invoice_id = invoices.id'
		:select('customers.id customer_id, orders.id order_id,'
			..' items.id item_id, invoices.id invoice_id,'
			..' payments.id payment_id')

	for _, customer_id, order_id, item_id, invoice_id, payment_id in
		scan:rows{tenant_id}
	do
		print(customer_id, order_id, item_id, invoice_id, payment_id)
	end

SQL EQUIVALENT

	SELECT customers.id AS customer_id, orders.id AS order_id,
		items.id AS item_id, invoices.id AS invoice_id,
		payments.id AS payment_id
	FROM customers
	LEFT JOIN orders ON orders.customer_id = customers.id
	LEFT JOIN items ON items.order_id = orders.id
	LEFT JOIN invoices ON invoices.customer_id = customers.id
	LEFT JOIN payments ON payments.invoice_id = invoices.id
	WHERE customers.tenant_id = ?
	ORDER BY customers.id, orders.id, items.id, invoices.id, payments.id;
