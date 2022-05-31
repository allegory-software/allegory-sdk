
require'resize_image'
logging.verbose = true
logging.debug = true

resize_image(
	'resize_image_test/birds.jpg',
	'resize_image_test/birds-small.jpg'
	, 1/0, 400
	)
pr'ok'
