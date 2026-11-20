
// NOTE: the floor editor doesn't work with screen sharing. won't fix.

(function () {
"use strict"
const G = window

const {
	ceil, floor, round, snap, mod, abs, sign, min, max, clamp, PI, sin, cos, rad,
	atan2, hypot,
	array_set, empty_array, format_kcount, point_around, distance,
	json_arg, try_json_arg, json, copy_to_clipboard, S,
	profile_time, timer,
} = glue

const {bbox2, line2, mat3, v2} = Math3D
const {INDOOR, OUTDOOR} = house_plan

// Plant layers: [fill, path, stroke_width_ratio?].
const plant_paths = {}
plant_paths.rosette = [
	[false, 'M138 108 A50 50 0 1 1 38 108 A50 50 0 1 1 138 108 Z'],
	[false, 'M128 108 A40 40 0 1 1 48 108 A40 40 0 1 1 128 108 Z'],
	[true, 'M80 100 C84.3 96.2 74.9 80.1 62.8 66.6'
		+' C44.9 46.8 25.8 35.6 16 29 C21.5 39.4 30.7 59.6 48.6 79.4'
		+' C60.7 92.9 75.7 103.8 80 100Z'],
	[true, 'M84 110 C86.7 105.7 73.5 93.4 58.5 83.9'
		+' C36.4 69.9 15.8 63.9 5 60 C13.1 68.1 27.4 84.2 49.5 98.1'
		+' C64.5 107.6 81.3 114.3 84 110Z'],
	[true, 'M90 100 C96.5 99.1 98.2 79.7 95.6 60.8'
		+' C91.7 33.2 80.9 12.4 76 1 C74.4 13.3 69.9 36.3 73.8 63.9'
		+' C76.5 82.7 83.5 100.9 90 100Z'],
	[true, 'M94 100 C98.9 102.6 110.4 88.7 118.5 73.1'
		+' C130.5 50.3 134.3 29.1 137 18'
		+' C129.4 26.6 114.1 41.7 102.1 64.5 C94 80.1 89.1 97.4 94 100Z'],
	[true, 'M86 104 C91.6 102.2 91 87 86.6 72.9'
		+' C81.1 55.4 70.3 44.2 65 37 C64.7 45.9 62.3 61.3 67.8 78.8'
		+' C72.2 92.9 80.4 105.8 86 104Z'],
	[true, 'M92 110 C96.3 113.5 106.8 106.3 114.3 96.9'
		+' C123.7 85.1 125.8 72.1 128 65 C121.5 68.7 109.3 73.6 99.9 85.3'
		+' C92.4 94.8 87.7 106.5 92 110Z'],
	[true, 'M92 114 C88.8 110.3 76.8 116.1 67 124.5'
		+' C52.5 136.8 44.7 150.8 40 158 C47.8 154.6 63 149.2 77.5 137'
		+' C87.4 128.6 95.2 117.7 92 114Z'],
	[true, 'M90 112 C86.3 115 93.4 128.6 102.9 140.2'
		+' C116.9 157.2 132.2 167.2 140 173'
		+' C135.8 164.2 129.1 147.2 115.1 130.2 C105.6 118.6 93.7 109 90 112Z'],
	[true, 'M92 112 C91.7 107.5 72.6 105.8 53.7 107.1'
		+' C32.9 108.6 17.9 115 8 118 C18.2 119.5 33.9 123.7 54.7 122.3'
		+' C73.6 120.9 92.3 116.5 92 112Z'],
	[true, 'M92 112 C91.9 116.6 109.4 120 126.9 120.2'
		+' C142.6 120.4 153.6 115.2 162 113'
		+' C153.6 110.6 142.9 105 127.1 104.8 C109.6 104.6 92.1 107.4 92 112Z'],
	[true, 'M88 108 C94.5 106.3 97.4 99.9 96 94.6'
		+' C93.7 85.8 84.2 80.7 80 78 C77.7 82.5 72.1 91.6 74.4 100.4'
		+' C75.8 105.6 81.5 109.7 88 108Z'],
	[true, 'M96 112 C96 107.2 88.6 104.1 81.2 104.1'
		+' C73 104.1 67 109.6 63 112 C67 114.4 73 119.9 81.2 119.9'
		+' C88.6 119.9 96 116.8 96 112Z'],
]
plant_paths.monstera = [
	[true, 'M133 98 A40 40 0 1 1 53 98 A40 40 0 1 1 133 98 Z'],
	[true, 'M127 98 A34 34 0 1 1 59 98 A34 34 0 1 1 127 98 Z'],
	[false, 'M93 98 Q74 65 57 46 M93 98 Q117 64 132 39'
		+' M93 98 Q62 106 40 133 M93 98 Q116 103 137 115'
		+' M93 98 Q87 126 66 147'],
	[true, 'M104 74 C96 64 99 51 105 44'
		+' C106 50 110 57 115 55 C119 53 109 39 110 33'
		+' C111 23 116 18 123 16 C118 27 118 40 122 40'
		+' C126 40 123 20 128 13 C131 9 136 9 140 10'
		+' C134 18 132 33 136 34 C141 35 139 18 145 13'
		+' C150 9 157 13 163 13 C162 22 165 31 160 37'
		+' C155 42 141 41 142 46 C143 50 158 47 164 44'
		+' C164 50 158 56 151 58 C145 60 134 56 133 60'
		+' C132 65 146 66 153 65 C149 74 141 78 134 77'
		+' C126 76 120 69 117 73 C119 78 124 80 130 82'
		+' C119 86 110 83 104 74 Z'],
	[true, 'M72 73 C77 64 80 54 76 46'
		+' C72 39 66 35 58 36 C66 43 70 52 66 54'
		+' C62 56 59 44 53 39 C49 36 45 36 42 38'
		+' C49 44 54 56 50 58 C46 60 41 45 34 44'
		+' C29 43 23 47 21 51 C32 53 39 61 36 65'
		+' C33 69 23 59 17 60 C11 62 6 68 6 74'
		+' C12 76 13 86 19 87 C25 89 33 78 36 81'
		+' C40 85 27 95 21 95 C25 101 31 102 37 99'
		+' C44 96 48 84 52 86 C57 89 44 104 39 106'
		+' C46 111 55 107 60 102 C65 97 61 91 66 90'
		+' C71 91 66 99 66 103 C77 97 79 86 72 73 Z'],
	[true, 'M107 112 C109 101 119 94 133 94'
		+' C141 94 146 98 148 104 C139 100 129 102 129 106'
		+' C129 110 145 106 149 111 L149 120'
		+' C143 117 129 114 128 118 C126 122 140 124 145 130'
		+' C140 135 133 134 128 131 C123 128 120 122 117 124'
		+' C115 127 122 134 124 138 C117 139 113 134 111 130'
		+' C109 126 112 120 108 119 C105 119 105 125 105 129'
		+' C99 124 101 117 107 112 Z'],
	[true, 'M69 125 C59 119 47 121 41 128'
		+' C47 125 57 126 57 130 C57 134 40 131 36 137'
		+' L33 146 C39 142 52 140 53 144'
		+' C54 148 37 150 35 157 L37 169'
		+' C46 170 50 166 53 159 C55 154 59 153 60 157'
		+' C60 163 56 168 55 172 C62 173 68 168 69 162'
		+' C69 156 65 150 69 149 C73 148 74 160 73 165'
		+' C81 163 84 155 82 149 C80 143 73 141 75 137'
		+' C78 134 85 141 87 145 C90 136 81 126 69 125 Z'],
]
plant_paths.broad_leaf = [
	[true, 'M142 105 A47 47 0 1 1 48 105 A47 47 0 1 1 142 105 Z'],
	[true, 'M134 105 A39 39 0 1 1 56 105 A39 39 0 1 1 134 105 Z'],
	[false, 'M94 104 L69 52 M94 104 L139 55'
		+' M94 104 L49 93 M94 104 L146 118 M94 104 L49 156'
		+' M94 104 L114 164'],
	[true, 'M90 72 C100.3 64.4 99 48.6 87.3 36.9'
		+' C75.6 25.2 56.8 24.2 45 27 C42.2 38.8 43.2 57.6 54.9 69.3'
		+' C66.6 81 82.4 82.3 90 72Z'],
	[false, 'M88.2 70.2 L50.4 32.4 M81.9 63.9 Q86.3 54.1 82.6 44.4'
		+' M78.3 60.3 Q68.5 64.7 58.8 61 M72 54 Q75.5 45.1 72.7 37'
		+' M68.4 50.4 Q59.6 53.8 51.9 51 M63 45 Q64.8 37.8 63.5 32.8'
		+' M60.3 42.3 Q53.6 43.6 49.3 42.7', .8],
	[true, 'M100 76 C102.3 89.1 118.8 94.6 136.5 88.4'
		+' C154.2 82.1 164.8 64.5 168 52 C157.6 44.3 138.3 37.2 120.6 43.5'
		+' C103 49.7 93.6 64.4 100 76Z'],
	[false, 'M102.7 75 L159.8 54.9 M112.2 71.7 Q119.8 80.1 131.3 80.7'
		+' M117.7 69.8 Q118.3 58.4 126.9 50.8'
		+' M127.2 66.4 Q134.3 73.6 143.9 74.3'
		+' M132.6 64.5 Q133.8 54.6 140.5 48.3'
		+' M140.8 61.6 Q147.1 66.3 152.7 67.2'
		+' M144.9 60.2 Q147 53.2 150.1 49.5', .8],
	[true, 'M78 82 C73.8 68.3 56.8 63.5 40.4 71.3'
		+' C24.1 79.1 16.3 98.5 15 112 C26.3 119.5 46.3 125.7 62.6 117.9'
		+' C79 110.1 86 93.9 78 82Z'],
	[false, 'M75.5 83.2 L22.6 108.4 M66.7 87.4 Q58 78.9 46.6 79.1'
		+' M61.6 89.8 Q62.7 101.9 55.4 110.6 M52.8 94 Q44.7 86.8 35.3 86.7'
		+' M47.8 96.4 Q48.1 106.9 42.5 114.1 M40.2 100 Q33.4 95.4 27.7 94.8'
		+' M36.4 101.8 Q35.4 109.4 32.9 113.5', .8],
	[true, 'M72 116 C65.1 105.6 49.5 106.2 37.6 117.1'
		+' C25.6 128 23.8 146.3 26 158 C37.4 161.3 55.8 161.1 67.8 150.2'
		+' C79.8 139.3 81.7 123.8 72 116Z'],
	[false, 'M70.2 117.7 L31.5 153 M63.7 123.6 Q54.3 118.8 44.7 122'
		+' M60 126.9 Q63.9 136.7 59.9 146 M53.6 132.8 Q45 128.9 37 131.4'
		+' M49.9 136.2 Q52.8 144.9 49.8 152.4'
		+' M44.4 141.2 Q37.5 139.2 32.5 140.2'
		+' M41.6 143.7 Q42.6 150.3 41.6 154.4', .8],
	[true, 'M114 97 C104.3 108 109.2 125.4 124.8 135.6'
		+' C140.4 145.7 161.5 142.1 174 136'
		+' C174.5 122.1 169.2 101.3 153.6 91.2 C138 81 120.1 83.6 114 97Z'],
	[false, 'M116.4 98.6 L166.8 131.3 M124.8 104 Q122.1 116.1 128.3 126'
		+' M129.6 107.1 Q139.5 99.7 151.1 101.4'
		+' M138 112.6 Q136 123.5 141 131.8'
		+' M142.8 115.7 Q151.8 109.8 161.1 110.8'
		+' M150 120.4 Q149.6 128.8 152.2 134.1'
		+' M153.6 122.7 Q160.8 119.6 165.7 119.5', .8],
	[true, 'M108 118 C95.3 118.9 87.9 133 91.6 149.1'
		+' C95.2 165.2 110.6 176.1 122 180 C130.6 171.5 139.8 155.1 136.2 139'
		+' C132.6 122.9 119.9 113.4 108 118Z'],
	[false, 'M108.6 120.5 L120.3 172.6 M110.5 129.2 Q101.5 135.1 99.5 145.2'
		+' M111.6 134.1 Q122.3 135.6 128.5 143.9'
		+' M113.6 142.8 Q105.8 148.5 104 156.8'
		+' M114.7 147.8 Q123.9 149.6 129 156'
		+' M116.4 155.2 Q111.1 160.3 109.5 165.2'
		+' M117.2 158.9 Q123.6 161.4 126.7 164.4', .8],
	[true, 'M90 78 C78.5 75.6 68.4 86.9 67.7 103'
		+' C66.9 119.1 77.8 133.3 87 140 C96.8 134.3 109 121.2 109.8 105.1'
		+' C110.6 88.9 101.7 76.7 90 78Z'],
	[false, 'M89.9 80.5 L87.4 132.6 M89.5 89.2 Q80 92.4 75.7 101.4'
		+' M89.2 94.1 Q98.3 98.3 101.7 107.7 M88.8 102.8 Q80.5 106.1 76.7 113.5'
		+' M88.6 107.8 Q96.3 111.9 99.2 119.3 M88.2 115.2 Q82.2 118.6 79.6 122.9'
		+' M88 118.9 Q93.1 122.9 95.1 126.5', .8],
]
for (let name in plant_paths)
	for (let layer of plant_paths[name])
		layer[1] = new Path2D(layer[1])
const plant_names = Object.keys(plant_paths)

//// UTILS -------------------------------------------------------------------

let floor_names = [
	'GROUND FLOOR',
	'1\u02e2\u1d57 FLOOR',
	'2\u207f\u1d48 FLOOR',
	'3\u02b3\u1d48 FLOOR',
]

// the key that selects the floor at index i, the roof at the index after the
// top floor: 1 to 9 from the ground floor; none above.
function floor_key(i) {
	return i < 9 ? String(i + 1) : null
}

// a floor or roof label in link colors; hovered: its key in the tooltip.
function floor_label(label_id, text, is_current, key) {
	let is_hovered = !!ui.hit(label_id)
	ui.color(is_current ? 'link' : 'text', is_hovered ? 'hover' : null)
	ui.bold()
	ui.text(label_id, text)
	if (is_hovered && key)
		ui.set_tooltip(S('press_key', 'Press {0} key', key))
}

// plan units are mm.
// ctrl held or a length with mm: mm precision, else cm.
let format_length = d => format_kcount(d / 1e3,
	ui.keypressed('ctrl') || round(d) % 10 ? 3 : 2)+'m'
let format_area = a => format_kcount(abs(a) / 1e6, 2)+' m\u00b2'

//// HELP --------------------------------------------------------------------

let help_lines = [
	'Floors',
	'',
	'1 to 9: Ground floor, floors and roof',
	'`: Show all dimensions',
	'',
	'Edit',
	'',
	'Ctrl+Z: Undo',
	'Ctrl+Y, Ctrl+Shift+Z: Redo',
	'Ctrl+C: Copy object, or the house',
	'Ctrl+V: Paste at the pointer',
	'Delete: Remove object',
	'',
	'Hovered Wall or Object',
	'',
	'←↑→↓: Move 1 cm',
	'Ctrl+←↑→↓: Move 1 mm',
	'Space: Rotate or vary object',
	'',
	'Mouse',
	'',
	'Drag near a wall: Add wall',
	'Drag across a wall: Split wall',
	'Double-click a wall: Delete it',
	'Wheel: Zoom',
	'Shift+Drag: Pan',
	'Click an eave: Toggle gable',
	'Double-click roof line: Reset it',
	'',
	'While Dragging',
	'',
	'Ctrl: No snapping, sizes and lengths in mm',
	'Shift on an eave or pitch: Move all of its kind',
]

//// SETTINGS ----------------------------------------------------------------

function setting_field(min, max) {
	return ui.create_field({type: 'number', min: min, max: max, decimals: 1})
}

// the house settings that the editor changes. their sliders are in cm.
let settings = [
	{name: 'int_wall_thickness', field: setting_field(2, 50),
		label: () => S('int_wall_thickness', 'Interior wall thickness (cm)')},
	{name: 'ext_wall_thickness', field: setting_field(2, 80),
		label: () => S('ext_wall_thickness', 'Exterior wall thickness (cm)')},
	{name: 'slab_thickness', field: setting_field(5, 100),
		label: () => S('slab_thickness', 'Slab thickness (cm)')},
	{name: 'roof_thickness', field: setting_field(5, 100),
		label: () => S('roof_thickness', 'Roof thickness (cm)')},
	{name: 'floor_h', field: setting_field(150, 600),
		label: () => S('floor_height', 'Floor height (cm)')},
	{name: 'half_wall_h', field: setting_field(30, 200),
		label: () => S('half_wall_height', 'Half-wall height (cm)')},
]

//// FLOOR EDITOR ------------------------------------------------------------

let FLOOR_EDITOR_ID = ui.BOX_ARGS+0
let FLOOR_EDITOR_E  = ui.BOX_ARGS+1 // the editor from create_floor_editor()

const CMD_FLOOR_EDITOR = ui.box_widget('floor_editor', {

	ID: FLOOR_EDITOR_ID,

	position: function(a, i, axis, sx, sw) {
		a[i+FLOOR_EDITOR_E].position(a, i, axis, sx, sw)
	},

	draw: function(a, i) {
		a[i+FLOOR_EDITOR_E].draw(a, i)
	},

	hit: function(a, i) {
		return a[i+FLOOR_EDITOR_E].hit(a, i)
	},

})

function create_floor_editor(id) {

	let e = {}

	//// STATE ----------------------------------------------------------------

	// widget value
	let s // ui.state(id): house, floor, readonly and the input value
	let is_roof_level // the roof level: the top floor's roof is edited
	let value_edit_no // house.edit_no of the value loaded or published
	let setting_edit, setting_name // the running settings edit and its setting
	// the floor whose roof is edited: the floor below; the roof level: the
	// top floor.
	let roof_floor

	// pointer interaction
	let shown_snap_lines = [] // [a, is_v, ...] snap lines of the hit or drag
	let show_key_dims = false // a key moved the hovered wall or object
	let key_dims_target // the object or seg whose dimensions are shown
	let hide_key_dims = timer(function() { // hide_key_dims(t): after t seconds
		show_key_dims = false
		ui.animate()
	})

	// view
	let ss = ui.saved_state[id] // the saved view
	let show_grid = ui.saved_state.floor_editor?.show_grid // draw the grid
	let show_dims = ui.saved_state.floor_editor?.show_dims // draw all dimensions
	let view_rotation = ss?.rotation ?? 0 // view rotation in radians
	let view_scale = ss?.scale // css pixels per plan mm
	let view_cx = ss?.cx // plan point at the center of the viewport
	let view_cy = ss?.cy
	let view_zoomed = view_scale != null // fixed view or fit to the plan
	let view_dirty = false // the view changed since it was saved
	let view_x0 // pixels from the viewport's origin to the plan's origin
	let view_y0
	let view_matrix = mat3() // view pixels -> viewport pixels: rotation, origin
	let view_matrix_inv = mat3() // viewport pixels -> view pixels
	let viewport_x // the viewport's origin, in the space of ui.mx and ui.my
	let viewport_y
	let view_line_width // thickness of the wall line stroke in pixels
	let line_width = 2 // thickness of wall line stroke in pixels at 1:1 scale
	let bb = bbox2() // rotated plan bounding box in layout_view()

	// scratch
	let out = [] // temporary [x, y] for line2.at()
	let box = [0, 0, 0, 0] // temporary bounding box for hit testing and drawing
	let object_dims = [] // [gap, x1, y1, x2, y2, ...] N, E, S, W
	let object_rects = [] // rectangles of the moving object
	let other_rects = [] // rectangles of the object being checked

	// objects
	let object_views = {} // {type name -> view functions}, set per type below
	let object_box = [0, 0, 0, 0] // [x1, y1, x2, y2] of the object hit or drawn
	let object_origin = v2() // [x, y] of the origin of the object hit or drawn
	let object_matrix = mat3() // temporary matrix
	let object_point = v2() // temporary point
	let object_point1 = v2() // temporary point
	let table_dash = [0, 0] // [dash, gap] of the hovered table's box
	let solid_line = [] // empty line dash: solid lines
	let countertop_edge = [0, 0, 0, 0] // [x1, y1, x2, y2] of a resize handle
	let tag_icon_fonts = new Map() // cached CSS fonts, indexed by icon font name

	function select_floor(floor, is_roof_level1) {
		s.floor = floor
		is_roof_level = is_roof_level1
		ui.save_state(id, 'floor', floor.i)
		ui.save_state(id, 'is_roof_level', is_roof_level1)
	}

	e.update = function(id, s) {
		s.interaction_value = undefined
		if (!s.house)
			return
		if (ui.hit_enter(id))
			ui.focus(id)
		let plan = s.floor
		let readonly = s.readonly
		let floor0 = s.floor
		let is_roof_level0 = is_roof_level
		let edit_no0 = s.house.edit_no
		let floors = s.house.floors
		// floor label clicked: focus the editor; the label isn't focusable, so
		// the click cleared the focus.
		for (let floor of floors) {
			if (ui.clicked(id+'.floor'+floor.i)) {
				select_floor(floor, false)
				ui.focus(id)
			}
		}
		if (ui.clicked(id+'.roof')) {
			select_floor(floors[floors.length-1], true)
			ui.focus(id)
		}
		if (ui.state_of(id+'.add_floor_button', 'state') == 'click') {
			select_floor(s.house.add_floor(s.floor), false)
		} else if (floors.length > 1
			&& ui.state_of(id+'.remove_floor_button', 'state') == 'click'
		) {
			// the floor above takes the removed floor's place: select it.
			let floor1 = floors[s.floor.i+1]
			s.house.remove_floor(s.floor)
			if (floor1)
				select_floor(floor1, false)
		}

		// c on the hovered object: capture the pointer and drag a copy of it.
		// the next click release drops the copy, Escape removes it.
		let is_copying = !readonly && ui.captured_id == null
			&& ui.focused_id == id && ui.keydown('c') && !ui.keypressed('ctrl')
			&& !!ui.hit(id)?.object
		if (is_copying)
			ui.capture(id)
		let cs = ui.drag(id)
		if (is_copying) {
			cs.action = 'move_object'
			cs.edit = cs.object_plan.start_copy_object(cs.object)
			cs.object = cs.edit.object
		}
		if (!cs && ui.focused_id == id) {
			for (let i = 0; i < min(floors.length, 9); i++)
				if (ui.keydown(floor_key(i)))
					select_floor(floors[i], false)
			if (ui.keydown('`'))
				toggle_show_dims()
			let roof_key = floor_key(floors.length)
			if (roof_key && ui.keydown(roof_key))
				select_floor(floors[floors.length-1], true)
		}
		let is_restored = false
		if (!readonly && !cs && ui.focus_inside(id)) {
			let entry // the operation that the undo or redo performed
			if (ui.keydown('ctrl shift z') || ui.keydown('ctrl y'))
				entry = s.house.redo()
			else if (ui.keydown('ctrl z'))
				entry = s.house.undo()
			is_restored = entry != null
			// a floor added back: select it.
			if (entry?.op == 'add_floor')
				select_floor(entry.floor, false)
		}

		let [mx_plan, my_plan] = get_pointer_plan(object_point1)

		// copy and paste the whole house as json text, or the hovered object. a
		// pasted object goes where it would go if dropped at the pointer.
		if (!cs && ui.focus_inside(id) && ui.keydown('ctrl c')) {
			let object = ui.hit(id)?.object
			copy_to_clipboard(json(object ? s.house.save_object(object)
				: s.house.save_state()))
		}
		if (!readonly && !cs && ui.focus_inside(id) && ui.keydown('paste')) {
			let state = try_json_arg(ui.clipboard_text)
			let hs0 = ui.hit(id)
			if (state?.floors?.length) {
				try {
					s.house.load_state(state)
					is_restored = true
				} catch {
					// bad state: load_state restored the house, ignore the paste.
				}
			} else if (hs0 && state) {
				try {
					plan.add_object(state, mx_plan, my_plan, 200)
				} catch {
					// not an object: add_object added nothing, ignore the paste.
				}
			}
		}

		// removed the selected floor, or undid an added floor or redid a removed
		// one, or pasted or undid a paste: select the top floor.
		floors = s.house.floors // paste and its undo replace the array.
		if (!floors.includes(s.floor) || is_restored && is_roof_level)
			select_floor(floors[floors.length-1], is_roof_level)
		// the roof level: the top floor's roof.
		if (is_roof_level)
			s.floor = floors[floors.length-1]
		plan = s.floor
		if (plan != floor0) {
			shown_snap_lines.length = 0
		}

		let is_rotated = ui.state_of(id+'.rotate_button', 'state') == 'click'
		if (is_rotated) {
			let bb = s.house.bb
			let is_empty = bb[0] > bb[2]
			rotate_view_90(is_empty ? view_cx : (bb[0] + bb[2]) / 2,
				is_empty ? view_cy : (bb[1] + bb[3]) / 2)
			save_floor_view()
		}
		if (ui.state_of(id+'.zoom_button', 'state') == 'click')
			reset_view_zoom()

		// the settings: one house edit per run of frames with user input.
		let edited_name, edited_value // the setting the user is changing, in cm
		for (let setting of settings) {
			let value = ui.interaction_value(id+'.setting.'+setting.name)
			if (value != null) { // a cleared input has no value to set.
				edited_name = setting.name
				edited_value = value
			}
		}
		if (setting_edit && setting_name != edited_name) {
			setting_edit.stop()
			setting_edit = null
		}
		if (edited_name) {
			setting_name = edited_name
			setting_edit ??= s.house.start_edit_setting(edited_name)
			setting_edit.move(edited_value * 10)
		}

		let hs = ui.hit(id)
		if ((hs || cs) && ui.wheel_dy) {
			zoom_view_at(ui.wheel_dy / ui.em(7), mx_plan, my_plan)
			save_floor_view()
		}

		if (cs) {

			// the drag moves the pointer's plan point from where it was pressed.
			let dx = mx_plan - cs.mx_plan
			let dy = my_plan - cs.my_plan

			if (cs.drag) {

				let action = cs.action
				let seg    = cs.seg

				if (action == 'move_seg') { // move seg
					cs.edit = plan.start_move_seg(seg)
				}
			}

			let action = cs.action

			if (cs.cancel) {
				cs.edit?.cancel()
			} else {
				let nosnap = ui.keypressed('ctrl')
				// past the drag threshold, or with ctrl at the first movement: a
				// press without movement starts no edit, so a double-click can.
				let is_moved = !!cs.moved || nosnap && !!(cs.dx || cs.dy)

				if (!readonly && !is_roof_level && !action && is_moved) { // dragged far enough to assume intent to drag.

					// establish direction of drag on x and y axis.
					let sdx = abs(dx) > 1.5 * abs(dy)
						? sign(dx) : 0 // straight enough
					let sdy = abs(dy) > 1.5 * abs(dx)
						? sign(dy) : 0 // straight enough
					if (sdx || sdy) {
						action = 'resize_seg'
						cs.action = action
						let p   = cs.p
						let mx0 = cs.x
						let my0 = cs.y
						cs.edit = plan.start_resize_seg(p, mx0, my0, dx, dy, sdx, sdy)
					}

				}

				if (action == 'move_grid_origin') {
					if (is_moved)
						cs.edit ??= s.house.start_move_grid_origin()
					if (cs.edit) {
						let snapped = cs.edit.move(dx, dy,
							snap_distance(200))
						shown_snap_lines.length = 0
						if (snapped & 1)
							shown_snap_lines.push(s.house.grid_x, 1)
						if (snapped & 2)
							shown_snap_lines.push(s.house.grid_y, 0)
					}
				}

				if (action == 'move_seg')
					cs.edit.move(dx, dy, snap_distance(200), snap_step())

				if (action == 'resize_seg')
					[cs.x, cs.y] = cs.edit.resize(dx, dy, snap_distance(300), snap_step())

				if (action == 'move_seg' || action == 'resize_seg') {
					let {snap_a, snap_v} = cs.edit
					if (snap_a !== undefined) {
						shown_snap_lines.length = 0
						if (snap_a != null)
							shown_snap_lines.push(snap_a, snap_v)
					}
				}


				// an object moves only past the drag threshold or with ctrl.
				if (action == 'move_object') {
					if (is_moved)
						cs.edit ??= cs.object_plan.start_move_object(cs.object)
					cs.edit?.move(dx, dy, snap_distance(200), 3 / view_scale, snap_step())
				}

				// an object end resizes only past the drag threshold or with ctrl.
				if (action == 'resize_object') {
					if (is_moved)
						cs.edit ??= cs.object_plan.start_resize_object(cs.object,
							cs.object_side, cs.object_axis)
					cs.edit?.resize(dx, dy, snap_distance(200), nosnap)
				}

				// an eave moves only past the drag threshold or with ctrl: a click
				// toggles its gable instead. shift: all eaves of its kind.
				if (action == 'move_eave') {
					if (is_moved && !cs.edit) {
						// the across positions of the eave corners, where hips and
						// valleys meet eave lines, to line the eave up with: the
						// lines of the parallel eave sides and the ends of the
						// others.
						let snap_cs = [] // [c, ...] in plan units
						let scale = prism_union.grid_scale
						let eave_sides = roof_floor.make_roof_geometry().eave_sides
						for (let side of eave_sides)
							if (!side.nx == !cs.roof_side.nx)
								snap_cs.push(side.c / scale)
							else
								snap_cs.push(side.e1 / scale, side.e2 / scale)
						cs.edit = roof_floor.start_move_eave(cs.roof_side,
							cs.roof_x, cs.roof_y, snap_cs)
					}
					if (cs.edit)
						cs.can_move_eave = cs.edit.move(dx, dy,
							!ui.keypressed('shift'),
							snap_distance(200, 0))
				}

				// the line or point where roof faces meet follows the pointer at
				// the grabbed height, past the drag threshold or with ctrl.
				if (action == 'move_faces') {
					if (is_moved)
						cs.edit ??= roof_floor.start_move_faces(
							cs.roof_faces, cs.roof_z)
					if (cs.edit)
						cs.can_move_faces = cs.edit.move(
							cs.roof_x + dx, cs.roof_y + dy)
				}

				// a pitch label moves at the first movement: up is steeper, 4
				// pixels per degree, in whole degrees (ctrl: tenths). shift: all
				// sloped faces.
				if (action == 'move_pitch') {
					let d_pitch = snap(-cs.dy / 4, nosnap ? .1 : 1)
					if (cs.dx || cs.dy)
						cs.edit ??= roof_floor.start_move_pitch(
							cs.roof_face)
					if (cs.edit)
						cs.can_move_pitch = cs.edit.move(d_pitch,
							!ui.keypressed('shift'))
				}

				if (action == 'pan')
					pan_view_to(view_cx - dx, view_cy - dy)

				if (cs.drop)
					cs.edit?.stop()
			}

		}

		if (cs?.drop || cs?.cancel)
			save_floor_view()

		let is_deleting_seg = !readonly
			&& hs?.action == 'move_seg' && ui.dblclick
		if (is_deleting_seg) {
			plan.delete_seg(hs.seg)
		}

		// double-clicked an eave side: remove its edge point.
		let is_resetting_eave = !readonly
			&& hs?.action == 'move_eave' && ui.dblclick && hs.roof_side.edge_point
		if (is_resetting_eave)
			roof_floor.remove_edge_point(hs.roof_side.edge_point)

		// double-clicked a line or point where roof faces meet: the faces back
		// to the roof's pitch.
		let is_resetting_faces = !readonly
			&& hs?.action == 'move_faces' && ui.dblclick
		if (is_resetting_faces)
			roof_floor.reset_faces(hs.roof_faces)

		// double-clicked a pitch label: the face back to the roof's pitch.
		let is_resetting_pitch = !readonly
			&& hs?.action == 'move_pitch' && ui.dblclick
		if (is_resetting_pitch)
			roof_floor.reset_faces([hs.roof_face])

		// clicked an eave side without dragging: switch it between gable and
		// the roof's pitch. ctrl: a move, not a click.
		let is_toggling_gable = !readonly && cs?.drop && !cs.cancel && !cs.moved
			&& !cs.edit && !ui.keypressed('ctrl') && cs.action == 'move_eave'
		if (is_toggling_gable)
			roof_floor.toggle_gable(cs.roof_side, cs.roof_x, cs.roof_y)

		let is_removing_object = !readonly && !cs && hs?.object
			&& ui.focus_inside(id) && (ui.keydown('delete') || ui.keydown('d'))
		if (is_removing_object)
			hs.object_plan.remove_object(hs.object)

		// keys on the hovered wall or object: the arrow keys move it 1 cm on
		// the screen, with ctrl 1 mm unsnapped, and show its dimensions for 5s;
		// an object's type uses its own keys.
		let is_keyed = !readonly && !cs && ui.focused_id == id
			&& (hs?.object || hs?.action == 'move_seg')
		if (is_keyed) {
			let kx = 0
			let ky = 0
			if (!ui.keypressed('alt')) {
				if (ui.keydown('arrowleft')) kx--
				if (ui.keydown('arrowright')) kx++
				if (ui.keydown('arrowup')) ky--
				if (ui.keydown('arrowdown')) ky++
			}
			if (kx || ky) {
				let nosnap = ui.keypressed('ctrl')
				let step = nosnap ? 1 : 10
				let [ux, uy] = get_plan_vector(kx, ky, object_point1)
				let dx = round(ux) * step
				let dy = round(uy) * step
				if (hs.object) {
					let edit = hs.object_plan.start_move_object(hs.object)
					edit.move(dx, dy, nosnap ? 0 : 20)
					edit.stop()
				} else {
					let edit = plan.start_move_seg(hs.seg)
					edit.move(dx, dy, 0)
					edit.stop()
				}
				show_key_dims = true
				key_dims_target = hs.object ?? hs.seg
				hide_key_dims(5)
			}
			let update = hs.object && object_views[hs.object.type].update
			if (update)
				update(hs.object_plan, hs.object)
		}

		// hovering another wall or object: show its dimensions for 5s more.
		let hit_target = !cs && (hs?.object
			?? (hs?.action == 'move_seg' ? hs.seg : null))
		if (show_key_dims && hit_target && hit_target != key_dims_target) {
			key_dims_target = hit_target
			hide_key_dims(5)
		}

		if (cs?.drop || cs?.cancel || is_deleting_seg
			|| is_resetting_eave || is_resetting_faces || is_resetting_pitch
			|| is_restored
		) {
			shown_snap_lines.length = 0
		}

		// the hit phase ran before this update: changed house or view: hit
		// again in a second pass of this frame.
		let is_changed = s.house.edit_no != edit_no0 || cs?.drop || cs?.cancel
			|| plan != floor0 || is_roof_level != is_roof_level0
			|| hs && ui.wheel_dy || is_rotated
		if (is_changed)
			ui.rebuild('floor_editor_changed')

		// publish the house after each committed edit, undo and redo: its owner
		// takes the value.
		if (!readonly && s.house.edit_no != value_edit_no) {
			ui.set_interaction_value(id, s, json(s.house.save_state()))
			value_edit_no = s.house.edit_no
		}

	}

	//// VIEW -----------------------------------------------------------------

	/// view ------------------------------------------------------------------

	function save_floor_view() {
		if (!view_dirty)
			return
		ui.save_state(id, 'rotation', view_rotation)
		ui.save_state(id, 'scale', view_scale)
		ui.save_state(id, 'cx', view_cx)
		ui.save_state(id, 'cy', view_cy)
		view_dirty = false
	}

	function to_pixels(d) {
		return round(d * view_scale * devicePixelRatio)
	}

	function to_pixels_exact(d) { // not rounded.
		return d * view_scale * devicePixelRatio
	}

	function to_plan(d) {
		return d / (view_scale * devicePixelRatio)
	}

	// css pixels in plan units, for hit and snap tolerances: they keep the
	// same size on the screen at any devicePixelRatio.
	function css_to_plan(d) {
		return d / view_scale
	}

	// the snap distance in plan units: d mm, but at most 12 screen pixels, so
	// that zooming in makes snapping finer.
	function snap_distance(d, ctrl_d = 20) {
		return min(ui.keypressed('ctrl') ? ctrl_d : d, 12 / view_scale)
	}

	function snap_step() {
		return ui.keypressed('ctrl') ? 0 : 100
	}

	function toggle_show_dims() {
		show_dims = !show_dims
		ui.save_state('floor_editor', 'show_dims', show_dims)
		show_key_dims = false
		hide_key_dims()
	}

	function transform_view(cx) {
		let m = view_matrix
		cx.transform(m[0], m[1], m[3], m[4], m[6], m[7])
	}

	function set_scale(sc) {
		view_scale = sc
		// snap line width to an even number for sharpness, at least 1:
		// canvas ignores a 0 line width.
		view_line_width = max(1, snap(line_width * sc * devicePixelRatio, 2))
	}

	// set the scale and the origin (view_x0, view_y0, in pixels from the
	// viewport's origin) of a viewport of w x h pixels: fitted to the plan
	// bounding box bb1, or from the saved view. returns true if fitted to a
	// non-empty plan.
	function layout_view(bb1, w, h) {
		let is_fitted = !view_zoomed && bb1[0] <= bb1[2]
		if (is_fitted) {
			view_dirty = true
			let margin = ceil(ui.em(2) + line_width)
			let [x1, y1, x2, y2] = array_set(bb, bb1).rotate(view_rotation)
			view_scale = min(
				(w - 2 * margin) / (x2 - x1),
				(h - 2 * margin) / (y2 - y1)
			) / devicePixelRatio
			view_cx = (bb1[0] + bb1[2]) / 2
			view_cy = (bb1[1] + bb1[3]) / 2
		} else if (!view_zoomed) { // empty plan.
			view_scale = .1
			view_cx = 0
			view_cy = 0
		}
		set_scale(view_scale)
		view_x0 = round(w / 2) - to_pixels(view_cx)
		view_y0 = round(h / 2) - to_pixels(view_cy)
		// rotation about the viewport centre, then the origin. mat3 calls compose
		// in the reverse order of the canvas calls.
		view_matrix.reset()
			.translate(view_x0, view_y0)
			.translate(-round(w / 2), -round(h / 2))
			.rotate(-view_rotation)
			.translate(round(w / 2), round(h / 2))
		view_matrix_inv.set(view_matrix).invert()
		return is_fitted
	}

	// zoom around the plan point (x, y): it stays where it is in the viewport.
	function zoom_view_at(d, x, y) {
		if (!d) return
		let scale1 = clamp(view_scale * 1.2 ** -d, 0.01, 1)
		view_cx = x - (x - view_cx) * view_scale / scale1
		view_cy = y - (y - view_cy) * view_scale / scale1
		set_scale(scale1)
		view_zoomed = true
		view_dirty = true
	}

	function pan_view_to(x, y) {
		view_cx = x
		view_cy = y
		view_zoomed = true
		view_dirty = true
	}

	// rotate the view by 90 degrees around the plan point (bx, by): it stays
	// where it is on screen.
	function rotate_view_90(bx, by) {
		let dx = bx - view_cx
		let dy = by - view_cy
		view_cx = bx - dy
		view_cy = by + dx
		view_rotation = (view_rotation + 90*rad) % (360*rad)
		view_dirty = true
	}

	function reset_view_zoom() {
		view_zoomed = false
	}

	// test whether the pointer is inside the plan box.
	function hit_plan_box(hs, x1, y1, x2, y2) {
		return hs.mx_plan >= x1 && hs.mx_plan < x2
			&& hs.my_plan >= y1 && hs.my_plan < y2
	}

	// the offset of the pointer from the plan point (x, y), in pixels along
	// the viewport axes.
	function get_pointer_offset(hs, x, y, out) {
		return object_point.set(to_pixels_exact(hs.mx_plan - x),
			to_pixels_exact(hs.my_plan - y))
			.transform(object_matrix.reset().rotate(-view_rotation), out)
	}

	// the vector (x, y) in viewport axes, in plan axes.
	function get_plan_vector(x, y, out) {
		return object_point.set(x, y)
			.transform(object_matrix.reset().rotate(view_rotation), out)
	}

	// the pointer in plan units: viewport pixels, view pixels, plan.
	function get_pointer_plan(out) {
		object_point.set(ui.mx - viewport_x, ui.my - viewport_y)
			.transform(view_matrix_inv, out)
		out[0] = to_plan(out[0])
		out[1] = to_plan(out[1])
		return out
	}

	/// grid ------------------------------------------------------------------

	function draw_grid(cx, x0, y0, w, h, step, alpha) {
		if (!show_grid)
			return
		if (to_pixels(step) < 7)
			return
		cx.strokeStyle = ui.hsl_adjust(ui.color_obj('bg2'), 1, 1, 1, alpha)
		for (let i = mod(to_plan(x0), step), n = to_plan(w); i < n; i += step) {
			cx.beginPath()
			cx.moveTo(to_pixels(i), 0)
			cx.lineTo(to_pixels(i), h-1)
			cx.stroke()
		}
		for (let i = mod(to_plan(y0), step), n = to_plan(h); i < n; i += step) {
			cx.beginPath()
			cx.moveTo(0, to_pixels(i))
			cx.lineTo(w-1, to_pixels(i))
			cx.stroke()
		}
		return true
	}

	function draw_grids(cx, w, h) {
		let [x0, y0] = object_point.set(to_pixels(s.house.grid_x),
			to_pixels(s.house.grid_y)).transform(view_matrix, object_point1)
		// grid
		cx.save()
		cx.translate(.5, .5)
		let step = 1000
		while (to_pixels(step / 10) < 7)
			step *= 10
		draw_grid(cx, x0, y0, w, h, step / 10, .2)
		draw_grid(cx, x0, y0, w, h, step /  2, .3)
		draw_grid(cx, x0, y0, w, h, step     ,  1)
		cx.restore()
	}

	/// walls -----------------------------------------------------------------

	function draw_edges(cx, eps) {
		for (let ep of eps) {
			let x = to_pixels(ep[0])
			let y = to_pixels(ep[1])
			if (ep == eps[0])
				cx.moveTo(x, y)
			else
				cx.lineTo(x, y)
		}
		cx.closePath()
	}

	// add clipper paths on prism_union()'s grid to the current path.
	function add_grid_paths(cx, paths) {
		let scale = prism_union.grid_scale
		for (let path of paths) {
			for (let i = 0; i < path.length; i++) {
				let p = path[i]
				let x = to_pixels(p.x / scale)
				let y = to_pixels(p.y / scale)
				if (i == 0)
					cx.moveTo(x, y)
				else
					cx.lineTo(x, y)
			}
			cx.closePath()
		}
	}

	function draw_walls(cx, paths, segs) {
		if (view_scale <= 0.02) { // too small to even show edges
			for (let seg of segs) {
				let x1 = to_pixels(seg[0][0]) + .5
				let y1 = to_pixels(seg[0][1]) + .5
				let x2 = to_pixels(seg[1][0]) + .5
				let y2 = to_pixels(seg[1][1]) + .5
				cx.beginPath()
				cx.moveTo(x1, y1)
				cx.lineTo(x2, y2)
				cx.strokeStyle = ui.color_css('text')
				cx.stroke()
			}
			return
		}

		cx.beginPath()
		add_grid_paths(cx, paths)

		if (!cx.wall_pattern) {
			let w = 100
			let c = new OffscreenCanvas(w, w)
			let x = c.getContext('2d')
			let g = x.createLinearGradient(0, 0, w, 2*w)
			for (let i = 0, n = 2*w; i <= n; i += 4) {
				g.addColorStop(clamp((i - 1) / n, 0, 1), 'white')
				g.addColorStop(clamp((i + 0) / n, 0, 1), 'gray')
				g.addColorStop(clamp((i + 1) / n, 0, 1), 'white')
			}
			x.rect(0, 0, w, w)
			x.fillStyle = g
			x.fill()
			cx.wall_pattern = cx.createPattern(c, 'repeat')
		}
		if (view_scale > 0.04) {
			cx.fillStyle = DEBUG_PLAN ? '#333' : cx.wall_pattern
			cx.fill('evenodd')
			cx.lineWidth = DEBUG_PLAN ? 2 : view_line_width
			cx.strokeStyle = 'black' //ui.color_css('text')
			cx.lineJoin = 'round'
			cx.stroke()
			cx.lineJoin = 'miter'
			cx.lineWidth = 1
		} else { // too small to stroke
			cx.fillStyle = ui.color_css('text')
			cx.fill('evenodd')
		}
	}

	function seg_center(seg) {
		return line2.at(.5, seg[0][0], seg[0][1], seg[1][0], seg[1][1], out)
	}

	// find the farthest edge point from `c.edges[i0]` going in `dir`
	// direction in the array, which has the same spatial direction `v` with
	// the previous point.
	function last_perp_edge_point(c, i, n, dir, v) {
		let ep0 = c.edges[mod(i, n)]
		while (1) {
			let ep1 = c.edges[mod(i, n)]
			let ep2 = c.edges[mod(i+dir, n)]
			if (ep2.p == ep0.p) // end-cap, don't measure
				return
			// changed direction, return last edge point
			if ((ep1[0] == ep2[0]) != v)
				return ep1
			i += dir
		}
	}

	/// dimensions ------------------------------------------------------------

	// a height relative to the wall top, signed.
	function format_height(h) {
		return 'h ' + (h < 0 ? '-' : '') + format_length(abs(h))
	}

	// s: the label, default: the length.
	function draw_length(cx, x1, y1, x2, y2, s, offset = -10, bg) {

		let d = distance(x1, y1, x2, y2)
		if (!d)
			return

		s ??= format_length(d)

		x1 = to_pixels(x1)
		y1 = to_pixels(y1)
		x2 = to_pixels(x2)
		y2 = to_pixels(y2)

		;[x1, y1, x2, y2] = line2.offset(offset, x1, y1, x2, y2)

		if (x1 > x2) {
			let x3 = x1
			let y3 = y1
			x1 = x2
			y1 = y2
			x2 = x3
			y2 = y3
		}
		let a = -atan2(y2 - y1, x2 - x1)

		cx.save()

		cx.font = 'bold 15px sans-serif'
		let m = ui.measure_text(s)
		let w = m.width

		let t1 = clamp((to_pixels(d) - (w + 10)) / 2 / to_pixels(d), 0, 1)
		let t2 = clamp((to_pixels(d) + (w + 10)) / 2 / to_pixels(d), 0, 1)

		if (to_pixels(d) < w) {
			cx.restore()
			return
		}

		cx.translate(.5, .5)

		cx.beginPath()

		if (to_pixels(d) >= w + 10 + 2 * 8 * cos(45*rad)) {
			// left arrow
			let [x1a1, y1a1] = point_around(x1, y1, 8, a + 45*rad)
			let [x1a2, y1a2] = point_around(x1, y1, 8, a - 45*rad)
			let [x1e, y1e] = line2.at(t1, x1, y1, x2, y2, out)

			cx.moveTo(x1  , y1)
			cx.lineTo(x1a1, y1a1)
			cx.moveTo(x1  , y1)
			cx.lineTo(x1a2, y1a2)
			cx.moveTo(x1  , y1)
			cx.lineTo(x1e , y1e)

			// right arrow
			let [x2a1, y2a1] = point_around(x2, y2, 8, a + (90+45)*rad)
			let [x2a2, y2a2] = point_around(x2, y2, 8, a - (90+45)*rad)
			let [x2e, y2e] = line2.at(t2, x1, y1, x2, y2, out)
			cx.moveTo(x2  , y2)
			cx.lineTo(x2a1, y2a1)
			cx.moveTo(x2  , y2)
			cx.lineTo(x2a2, y2a2)
			cx.moveTo(x2  , y2)
			cx.lineTo(x2e , y2e)

			cx.strokeStyle = ui.color_css('text')
			cx.stroke()
		}

		let [xc, yc] = line2.at(.5, x1, y1, x2, y2, out)
		cx.translate(xc, yc)
		let text_angle = mod(view_rotation - a + PI/2, PI) - PI/2
		cx.rotate(text_angle - view_rotation)
		let tx = round(-w / 2)
		let ty = round((m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2)
		cx.translate(tx, ty)
		if (bg) {
			cx.fillStyle = ui.color_css('bg')
			cx.fillRect(-2, -m.fontBoundingBoxAscent - 2, w + 4,
				m.fontBoundingBoxAscent + m.fontBoundingBoxDescent + 4)
		}
		cx.fillStyle = ui.color_css('text')
		cx.textAlign = 'left'
		cx.fillText(s, 0, 0)

		cx.restore()
	}

	// the text s centered on the plan point (x, y), upright in a rotated view.
	function draw_text(cx, x, y, s, color_name = 'text') {
		cx.save()
		cx.translate(to_pixels(x), to_pixels(y))
		if (view_rotation)
			cx.rotate(-view_rotation)
		cx.textAlign = 'center'
		cx.fillStyle = ui.color_css(color_name)
		cx.fillText(s, 0, 5)
		cx.restore()
	}

	// the overhang width, the length and, on a sloped side, the eave height
	// over the wall top of an eave side from make_roof_faces().
	function draw_eave_dims(cx, side, wall_z) {
		let scale = prism_union.grid_scale
		let {nx, ny} = side
		let c      = side.c      / scale
		let wall_c = side.wall_c / scale
		let e1     = side.e1     / scale
		let e2     = side.e2     / scale
		// draw_length() puts the dimension line on the right of its direction:
		// outward.
		let b1 = nx == 1 || ny == -1 ? e1 : e2
		let b2 = e1 + e2 - b1
		let b = e1 + (e2 - e1) / 4 // along the side: the width's position
		if (nx) {
			draw_length(cx, c, b1, c, b2)
			draw_length(cx, wall_c, b, c, b)
		} else {
			draw_length(cx, b1, c, b2, c)
			draw_length(cx, b, wall_c, b, c)
		}
		if (side.pitch == 90)
			return
		// outside the length's dimension line.
		let a = c + (nx + ny) * to_plan(30)
		let m = (e1 + e2) / 2
		draw_text(cx, nx ? a : m, nx ? m : a,
			format_height(side.eave_z - wall_z))
	}

	// a line between two roof faces: a ridge (level): its length, and its
	// height over the wall top on the other side; a hip or valley: its length
	// along the slope.
	function draw_roof_line_dims(cx, line, wall_z) {
		let [x1, y1, z1] = line.p
		let [x2, y2, z2] = line.q
		let d = distance(x1, y1, x2, y2)
		if (abs(z2 - z1) > 1e-5) {
			draw_length(cx, x1, y1, x2, y2, format_length(hypot(d, z2 - z1)))
			return
		}
		draw_length(cx, x1, y1, x2, y2)
		if (to_pixels(d) < 20)
			return
		let [x3, y3, x4, y4] = line2.offset(to_plan(14), x1, y1, x2, y2)
		draw_text(cx, (x3 + x4) / 2, (y3 + y4) / 2, format_height(z1 - wall_z))
	}

	//// ROOF -----------------------------------------------------------------

	/// roof labels -----------------------------------------------------------

	// the plan point of the pitch label of a roof face: across from the middle
	// of its longest eave side, half the face's depth inward.
	function roof_label_point(face) {
		let scale = prism_union.grid_scale
		let side
		for (let side1 of face.sides)
			if (!side || side1.e2 - side1.e1 > side.e2 - side.e1)
				side = side1
		let {nx, ny} = side
		let c = side.c / scale
		let depth = 0 // inward from the eave line
		for (let ring of face.rings)
			for (let p of ring)
				depth = max(depth, (c - (nx ? p[0] : p[1])) * (nx + ny))
		let a = c - (nx + ny) * depth / 2 // across the side
		let b = (side.e1 + side.e2) / 2 / scale // along the side
		return nx ? [a, b] : [b, a]
	}

	function format_pitch(pitch) {
		return round(pitch * 10) / 10 + '°'
	}

	/// roof hit testing ------------------------------------------------------

	// the roof while the bottom floor is edited: it has no floor below.
	let no_roof_geometry = {
		roof_faces: empty_array,
		eave_sides: empty_array,
		shared_edges: empty_array,
		half_wall_paths: empty_array,
		terrace_paths: empty_array,
	}

	// the face of this frame's roof in the plane of the side from an earlier
	// frame's roof: the same side has the same wall line and extent.
	function find_roof_face(faces, side0) {
		let {nx, ny, wall_c, m1, m2} = side0
		for (let face of faces)
			for (let side of face.sides)
				if (side.nx == nx && side.ny == ny && side.wall_c == wall_c
					&& side.m1 == m1 && side.m2 == m2
				)
					return face
	}

	// the eave side of the edited roof at the plan point (mx, my): on its eave
	// line, 8 pixels around.
	function hit_roof_side(hs, roof_sides, mx, my) {
		let scale = prism_union.grid_scale
		let x = mx * scale
		let y = my * scale
		let m = css_to_plan(8) * scale
		for (let side of roof_sides) {
			let {nx, c, e1, e2} = side
			let a = nx ? x : y // across the side
			let b = nx ? y : x // along the side
			if (b < e1 || b > e2)
				continue
			if (abs(a - c) > m)
				continue
			hs.roof_side = side
			hs.roof_x = mx // unsnapped, for placing an edge point.
			hs.roof_y = my
			hs.action = 'move_eave'
			return true
		}
		return false
	}

	// the line between two faces of the edited roof at the plan point (mx, my),
	// 8 pixels around: the nearest shared segment.
	function hit_roof_line(hs, roof_lines, mx, my) {
		let min_d = css_to_plan(8)
		let found_line, found_x, found_y
		for (let line of roof_lines) {
			let {p, q} = line
			let [px, py] = p
			let dx = q[0] - px
			let dy = q[1] - py
			let t = clamp(((mx - px) * dx + (my - py) * dy)
				/ (dx * dx + dy * dy), 0, 1)
			let x = px + t * dx // the point of p-q nearest to (mx, my)
			let y = py + t * dy
			let d = distance(mx, my, x, y)
			if (d >= min_d)
				continue
			min_d = d
			found_line = line
			found_x = x
			found_y = y
		}
		if (!found_line)
			return false
		let {face1, face2} = found_line
		let [a, b, c] = face1.plane
		hs.roof_faces = [face1, face2]
		hs.roof_x = found_x // grabbed point, on the line.
		hs.roof_y = found_y
		hs.roof_z = a * found_x + b * found_y + c
		hs.action = 'move_faces'
		return true
	}

	// the point where three or more faces of the edited roof meet (a ridge end,
	// a peak) at the plan point (mx, my), 8 pixels around: the nearest end of a
	// shared segment.
	function hit_roof_point(hs, roof_lines, mx, my) {
		let min_d = css_to_plan(8)
		let found_p
		for (let line of roof_lines)
			for (let i = 0; i < 2; i++) {
				let p = i ? line.q : line.p
				let d = distance(mx, my, p[0], p[1])
				if (d >= min_d)
					continue
				min_d = d
				found_p = p
			}
		if (!found_p)
			return false
		let [x, y, z] = found_p
		let faces = [] // faces of the segments that end at found_p
		for (let line of roof_lines) {
			let {p, q, face1, face2} = line
			let is_end = distance(x, y, p[0], p[1]) < 1e-2
				|| distance(x, y, q[0], q[1]) < 1e-2
			if (!is_end)
				continue
			if (!faces.includes(face1)) faces.push(face1)
			if (!faces.includes(face2)) faces.push(face2)
		}
		if (faces.length < 3)
			return false
		hs.roof_faces = faces
		hs.roof_x = x // grabbed point.
		hs.roof_y = y
		hs.roof_z = z
		hs.action = 'move_faces'
		return true
	}

	// the pitch label of a face of the edited roof at the pointer.
	function hit_roof_label(hs, roof_faces) {
		if (view_scale <= 0.04)
			return false
		let w = 20 // half sizes of the label's box, upright in the viewport
		let h = 10
		for (let face of roof_faces) {
			let [x, y] = roof_label_point(face)
			let [dx, dy] = get_pointer_offset(hs, x, y, object_point1)
			if (dx < -w || dx >= w || dy < -h || dy >= h)
				continue
			hs.roof_face = face
			hs.action = 'move_pitch'
			return true
		}
		return false
	}

	//// OBJECTS --------------------------------------------------------------

	/// shared ----------------------------------------------------------------

	// test whether the pointer is inside the object's plan bounding box.
	function hit_box(plan, object, hs) {
		let [x1, y1, x2, y2] = s.house.get_object_box(plan, object, box)
		return hit_plan_box(hs, x1, y1, x2, y2)
	}

	// convert local endpoints to plan coordinates, then call draw_length().
	function draw_object_length(cx, plan, object, x1, y1, x2, y2, offset) {
		let [px1, py1] = s.house.object_to_plan(plan, object,
			x1, y1, object_point1)
		let [px2, py2] = s.house.object_to_plan(plan, object,
			x2, y2, object_point1)
		draw_length(cx,px1, py1, px2, py2,
			null, offset)
	}

	// test resize handles at both width ends and the bottom length end.
	// With all_sides, include both length ends too. Include a narrow strip
	// inside and outside each edge.
	function hit_resize_rect(plan, object, hs, all_sides = false) {
		let object_type = s.house.object_types[object.type]
		let [bx1, by1, bx2, by2] = s.house.get_object_box(plan, object, box)
		let is_turned = object.rot % 180 >= 90
		let x1 = 0, y1 = 0
		let x2 = is_turned ? by2 - by1 : bx2 - bx1 // the width
		let y2 = is_turned ? bx2 - bx1 : by2 - by1 // the length
		let [x, y] = s.house.plan_to_object(plan, object,
			hs.mx_plan, hs.my_plan, object_point1)
		let inside = css_to_plan(6), outside = css_to_plan(8)
		let side = 0, axis = 'w'
		if (object_type.sizes.w && y >= y1 && y <= y2) {
			let d = min(inside, (x2 - x1) / 4)
			if (x >= x2 - d && x <= x2 + outside)
				side = 1
			else if (x >= x1 - outside && x <= x1 + d)
				side = -1
		}
		if (!side && (all_sides || object_type.sizes.l)
			&& x >= x1 && x <= x2
		) {
			let d = min(inside, (y2 - y1) / 4)
			if (y >= y2 - d && y <= y2 + outside) {
				side = 1
				axis = 'l'
			} else if (all_sides && y >= y1 - outside && y <= y1 + d) {
				side = -1
				axis = 'l'
			}
		}
		if (!side)
			return false
		hs.object_side = side
		hs.object_axis = axis
		return true
	}

	// draw width below the object and length to its right, outside both edges.
	function draw_furniture_sizes(cx, plan, object) {
		let w = object.w, l = object.l
		draw_object_length(cx, plan, object, w, l, 0, l)
		draw_object_length(cx, plan, object, w, 0, w, l)
	}

	// keep the closest facing side with an overlapping perpendicular span.
	function add_object_dim(object_dims, dir, c, m1, m2, x1, y1, x2, y2) {
		let is_v = dir % 2 == 1
		let lo = max(min(m1, m2), is_v ? y1 : x1)
		let hi = min(max(m1, m2), is_v ? y2 : x2)
		if (lo >= hi)
			return
		let end = dir == 0 ? y1 : dir == 1 ? x2 : dir == 2 ? y2 : x1
		let gap = dir == 1 || dir == 2 ? c - end : end - c
		let i = dir*5
		if (gap >= 0 && gap < object_dims[i]) {
			let along = (lo + hi) / 2
			object_dims[i] = gap
			object_dims[i+1] = is_v ? end : along
			object_dims[i+2] = is_v ? along : end
			object_dims[i+3] = is_v ? c : along
			object_dims[i+4] = is_v ? along : c
		}
	}

	// measure the moving rectangles and test overlap in one floor scan.
	function measure_object_dims(plan, object) {
		for (let dir = 0; dir < 4; dir++)
			object_dims[dir*5] = Infinity
		let rects = s.house.get_object_rects(plan, object, object_rects)
		let object_type = s.house.object_types[object.type]
		let is_overlapping = false
		for (let other of plan.objects) {
			let other_type = s.house.object_types[other.type]
			if (other == object || other_type.opens_room
				|| other_type.marks_terrace)
				continue
			if (object_type.placed_on == other.type
				|| other_type.placed_on == object.type
				|| object.type == 'rug' || other.type == 'rug')
				continue
			if (other_type.in_wall)
				s.house.get_opening_hole(plan, other, other_rects).length = 4
			else
				s.house.get_object_rects(plan, other, other_rects)
			for (let i = 0; i < rects.length; i += 4) {
				let x1 = rects[i], y1 = rects[i+1]
				let x2 = rects[i+2], y2 = rects[i+3]
				for (let j = 0; j < other_rects.length; j += 4) {
					let ox1 = other_rects[j], oy1 = other_rects[j+1]
					let ox2 = other_rects[j+2], oy2 = other_rects[j+3]
					if (x1 < ox2 && x2 > ox1 && y1 < oy2 && y2 > oy1)
						is_overlapping = true
					add_object_dim(object_dims, 0, oy2, ox1, ox2, x1, y1, x2, y2)
					add_object_dim(object_dims, 1, ox1, oy1, oy2, x1, y1, x2, y2)
					add_object_dim(object_dims, 2, oy1, ox1, ox2, x1, y1, x2, y2)
					add_object_dim(object_dims, 3, ox2, oy1, oy2, x1, y1, x2, y2)
				}
			}
		}
		for (let i = 0; i < rects.length; i += 4) {
			let x1 = rects[i], y1 = rects[i+1]
			let x2 = rects[i+2], y2 = rects[i+3]
			for (let side of plan.room_sides) {
				let [dir, c, m1, m2] = side
				add_object_dim(object_dims, dir, c, m1, m2, x1, y1, x2, y2)
			}
		}
		return is_overlapping
	}

	function draw_object_clearances(cx, object_dims) {
		for (let dir = 0; dir < 4; dir++) {
			let i = dir*5
			if (object_dims[i] == Infinity)
				continue
			draw_length(cx, object_dims[i+1], object_dims[i+2],
				object_dims[i+3], object_dims[i+4], null, 0)
		}
	}

	/// window and door -------------------------------------------------------

	function draw_opening_clearances(cx, plan, object) {
		let seg = object.seg
		if (!seg)
			return
		let is_v = seg.is_v
		let c = (seg.wall_a1 + seg.wall_a2) / 2
		let m = is_v ? object.y : object.x
		let object_type = s.house.object_types[object.type]
		for (let dir = -1; dir <= 1; dir += 2) {
			let gap = object_type.limit_size(plan, object,
				is_v ? 0 : dir, is_v ? dir : 0) - object.w
			let m1 = dir > 0 ? m + object.w : m
			let m2 = m1 + dir * gap
			if (is_v)
				draw_length(cx,c, m1, c, m2, null, 0, true)
			else
				draw_length(cx,m1, c, m2, c, null, 0, true)
		}
	}

	// draw the opening's width along the centre of its wall cut.
	function draw_opening_size(cx, plan, object) {
		let [x1, y1, x2, y2] = s.house.get_opening_hole(plan, object, box)
		if (s.house.opening_is_v(object)) {
			let x = (x1 + x2) / 2
			draw_length(cx,x, y1, x, y2, null, 0)
		} else {
			let y = (y1 + y2) / 2
			draw_length(cx,x1, y, x2, y, null, 0)
		}
	}

	object_views.window = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_opening_size,
	}

	// draw the window cut and its centre line when dimensions are hidden.
	object_views.window.draw_mask = function(cx, plan, object, show_size) {
		let [x1, y1, x2, y2] = s.house.get_opening_hole(plan, object, box)
		let is_v = s.house.opening_is_v(object)
		// leave space between the window cut and the wall outline.
		x1 = to_pixels(x1) + (is_v ? 0 : 1)
		y1 = to_pixels(y1) + (is_v ? 1 : 0)
		x2 = to_pixels(x2) - (is_v ? 0 : 1)
		y2 = to_pixels(y2) - (is_v ? 1 : 0)
		if (view_scale > 0.02) {
			cx.beginPath()
			cx.rect(x1, y1, x2 - x1, y2 - y1)
			cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1'), .5)
			cx.fill()
			if (!object.seg) { // off the wall: draw the full outline.
				cx.stroke()
			} else { // on the wall: draw faint lines along the wall faces.
				cx.beginPath()
				if (is_v) {
					cx.moveTo(x1, y1); cx.lineTo(x1, y2)
					cx.moveTo(x2, y1); cx.lineTo(x2, y2)
				} else {
					cx.moveTo(x1, y1); cx.lineTo(x2, y1)
					cx.moveTo(x1, y2); cx.lineTo(x2, y2)
				}
				let ss = cx.strokeStyle
				cx.strokeStyle = ui.theme().is_dark
					? ui.color_css('bg2')
					: ui.alpha_adjust(ui.color_obj('text'), .2)
				cx.stroke()
				cx.strokeStyle = ss
			}
		}

		if (!show_size) {
			cx.beginPath()
			if (is_v) {
				let x = (x1 + x2) / 2
				cx.moveTo(x, y1); cx.lineTo(x, y2)
			} else {
				let y = (y1 + y2) / 2
				cx.moveTo(x1, y); cx.lineTo(x2, y)
			}
			cx.stroke()
		}
	}

	object_views.door = {
		hit_resize: hit_resize_rect,
		draw_sizes: draw_opening_size,
	}

	// test the door box for a body hit and the swing area for a move-only hit.
	object_views.door.hit = function(plan, object, hs) {
		if (hit_box(plan, object, hs))
			return true
		// test the square containing the door's swing area.
		let w = object.w
		let y = s.house.ext_wall_thickness / 2 // the wall centre line
		let [x1, y1] = s.house.object_to_plan(plan, object,
			0, y, object_point1)
		let [x2, y2] = s.house.object_to_plan(plan, object,
			w, y - w, object_point1)
		if (hit_plan_box(hs, min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)))
			return 'move'
		return false
	}

	// fill the wall cut before drawing the door panel in local
	// coordinates.
	object_views.door.draw_mask = function(cx, plan, object) {
		let [x1, y1, x2, y2] = s.house.get_opening_hole(plan, object, box)
		// round the cut's pixel coordinates in the same way as the wall
		// paths.
		let sx1 = to_pixels(x1), sy1 = to_pixels(y1)
		let sx2 = to_pixels(x2), sy2 = to_pixels(y2)
		// use the wall outline width, or zero when outlines are not drawn.
		let line_width = view_scale > 0.04 ? view_line_width : 0
		// keep the fill clear of the wall outline. A one-pixel stroke on a
		// pixel boundary covers half a pixel on each side.
		let inset = ceil(line_width / 2)
		cx.beginPath()
		cx.rect(sx1 + inset, sy1 + inset,
			sx2 - sx1 - 2 * inset, sy2 - sy1 - 2 * inset)
		cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1'), .5)
		cx.fill()
		if (!object.seg)
			cx.stroke()
	}

	// draw the door panel open at 90 degrees from its hinge on the wall
	// centre line, and draw its swing arc. mirror: hinge at the other
	// end.
	object_views.door.draw = function(cx, plan, object) {
		let w = object.w
		let x = object.mirror ? w : 0
		let y = s.house.ext_wall_thickness / 2 // the wall centre line
		cx.beginPath()
		cx.moveTo(x, y)
		cx.lineTo(x, y - w)
		if (object.mirror)
			cx.arc(x, y, w, -PI / 2, -PI, true)
		else
			cx.arc(x, y, w, -PI / 2, 0)
		cx.stroke()
	}

	// press Space to cycle through four door orientations: switch the
	// hinge side, then switch the side of the wall that the door opens
	// towards.
	object_views.door.update = function(plan, object) {
		if (!ui.keydown(' '))
			return
		plan.update_object(object, function(door) {
			if (door.mirror) {
				door.mirror = false
				door.rot = (door.rot + 180) % 360
			} else {
				door.mirror = true
			}
		})
	}

	/// bed -------------------------------------------------------------------

	object_views.bed = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	// draw the mattress, pillows and cover edge, with the head at the top.
	object_views.bed.draw = function(cx, plan, object) {
		let {w, l} = object
		cx.beginPath()
		cx.rect(0, 0, w, l)
		let pillow_n = w < 1200 ? 1 : 2
		for (let i = 0; i < pillow_n; i++) {
			let px = pillow_n == 1 ? w / 2 : i ? w * 3 / 4 : w / 4
			cx.rect(px - 250, 100, 500, 350)
		}
		cx.moveTo(0, l * .4)
		cx.lineTo(w, l * .4)
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()
	}

	/// bathtub ---------------------------------------------------------------

	object_views.bathtub = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	object_views.bathtub.draw = function(cx, plan, object) {
		let {w, l} = object
		cx.beginPath()
		cx.roundRect(0, 0, w, l, 80)
		cx.roundRect(60, 100, w - 120, l - 160, 150)
		cx.moveTo(w / 2 + 25, 180)
		cx.arc(w / 2, 180, 25, 0, 2 * PI)
		cx.moveTo(w / 2 - 60, 50)
		cx.lineTo(w / 2 + 60, 50)
		cx.moveTo(w / 2, 50)
		cx.lineTo(w / 2, 130)
		cx.fillStyle = ui.color_css('bg')
		cx.fill('evenodd')
		cx.stroke()
	}

	/// wardrobe --------------------------------------------------------------

	object_views.wardrobe = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	object_views.wardrobe.draw = function(cx, plan, object) {
		let {w, l} = object
		cx.beginPath()
		cx.rect(0, 0, w, l)
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.moveTo(40, l / 2)
		cx.lineTo(w - 40, l / 2)
		let hanger_n = max(1, floor((w - 80) / 100))
		for (let i = 0; i < hanger_n; i++) {
			let x = 40 + (i + .5) * (w - 80) / hanger_n
			let dx = (i * 7 % 11 - 5) * .04 * min(l, 400)
			cx.moveTo(x - dx / 2, l * .2)
			cx.lineTo(x + dx / 2, l * .8)
		}
		cx.stroke()
	}

	/// fridge ----------------------------------------------------------------

	object_views.fridge = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	object_views.fridge.draw = function(cx, plan, object) {
		let {w, l} = object
		let front = min(50, l * .08)
		cx.beginPath()
		cx.moveTo(0, l - front)
		cx.lineTo(0, 0)
		cx.lineTo(w, 0)
		cx.lineTo(w, l - front)
		cx.quadraticCurveTo(w / 2, l + front, 0, l - front)
		cx.closePath()
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()
	}

	/// rug -------------------------------------------------------------------

	object_views.rug = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	object_views.rug.draw = function(cx, plan, object) {
		let {w, l} = object
		let inset = min(w, l) * .08
		cx.beginPath()
		cx.rect(0, 0, w, l)
		cx.rect(inset, inset, w - inset * 2, l - inset * 2)
		cx.moveTo(w / 2, inset * 2)
		cx.lineTo(w - inset * 2, l / 2)
		cx.lineTo(w / 2, l - inset * 2)
		cx.lineTo(inset * 2, l / 2)
		cx.closePath()
		cx.fillStyle = ui.color_css('bg')
		cx.fill('evenodd')
		cx.stroke()
	}

	/// potted plant ----------------------------------------------------------

	object_views.potted_plant = {
		hit: hit_box,
		hit_resize: function(plan, object, hs) {
			return hit_resize_rect(plan, object, hs, true)
		},
		draw_sizes: function(cx, plan, object) {
			let w = object.w
			draw_object_length(cx, plan, object, 0, w, w, w)
		},
	}

	object_views.potted_plant.update = function(plan, object) {
		if (!ui.keydown(' '))
			return
		plan.update_object(object, function(plant) {
			let i = plant_names.indexOf(plant.plant_name)
			plant.plant_name = plant_names[(i + 1) % plant_names.length]
		})
	}

	object_views.potted_plant.draw = function(cx, plan, object) {
		let w = object.w
		draw_hovered_box(cx, object, 0, 0, w, w)
		cx.fillStyle = ui.color_css('bg')
		cx.lineCap = 'round'
		cx.lineJoin = 'round'
		cx.scale(w / 190, w / 190)
		cx.lineWidth /= w / 150
		let line_width = cx.lineWidth
		let layers = plant_paths[object.plant_name]
		for (let [fill, path, stroke_width_ratio = 1] of layers) {
			if (fill)
				cx.fill(path)
			cx.lineWidth = line_width * stroke_width_ratio
			cx.stroke(path)
		}
		cx.lineWidth = line_width
	}

	/// bathroom sink ---------------------------------------------------------

	object_views.bathroom_sink = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	object_views.bathroom_sink.draw = function(cx, plan, object) {
		let {w, l} = object
		cx.beginPath()
		cx.moveTo(0, 0)
		cx.lineTo(w, 0)
		cx.ellipse(w / 2, 0, w / 2, l, 0, 0, PI)
		cx.closePath()
		cx.moveTo(w * .85, l * .5)
		cx.ellipse(w / 2, l * .5, w * .35, l * .3, 0, 0, 2 * PI)
		cx.moveTo(w / 2 + 20, l * .5)
		cx.arc(w / 2, l * .5, 20, 0, 2 * PI)
		cx.moveTo(w / 2 + 20, l * .1)
		cx.arc(w / 2, l * .1, 20, 0, 2 * PI)
		cx.fillStyle = ui.color_css('bg')
		cx.fill('evenodd')
		cx.stroke()
	}

	/// couch -----------------------------------------------------------------

	function couch_seats(object) {
		return clamp(round((object.w - 200) / 600), 1, 4)
	}

	object_views.couch = {}

	object_views.couch.update = function(plan, object) {
		if (!ui.keydown(' '))
			return
		plan.update_object(object, function(couch) {
			couch.rot = (couch.rot + 45) % 360
		})
	}

	object_views.couch.hit = function(plan, object, hs) {
		let [x, y] = s.house.plan_to_object(plan, object,
			hs.mx_plan, hs.my_plan, object_point1)
		let seat_w = (object.w - 200) / couch_seats(object)
		let in_futon = object.futon_side < 0 ? x <= 100 + seat_w
			: x >= object.w - 100 - seat_w
		return x >= 0 && x <= object.w && y >= 0
			&& (y <= object.l || in_futon
				&& y <= object.l + object.futon_length)
	}

	object_views.couch.hit_resize = function(plan, object, hs) {
		let [x, y] = s.house.plan_to_object(plan, object,
			hs.mx_plan, hs.my_plan, object_point1)
		let {w, l, futon_side, futon_length} = object
		let n = couch_seats(object), seat_w = (w - 200) / n
		let d = css_to_plan(8)
		let side = x < w / 2 ? -1 : 1
		let front_side = n == 1 && futon_length ? futon_side : side
		let in_end_seat = side < 0 ? x <= 100 + seat_w
			: x >= w - 100 - seat_w
		let front = l + (in_end_seat && front_side == futon_side
			? futon_length : 0)
		let axis = 'l'
		if (x >= 100 && x <= w - 100 && abs(y-front) <= d) {
			side = in_end_seat ? front_side * 2 : 1
		} else if (y >= 0 && y <= l
			&& (abs(x) <= d || abs(x-w) <= d)) {
			axis = 'w'
		} else if (x >= 0 && x <= w && (x < 100 || x > w - 100)
			&& abs(y-l) <= d) {
			side = 1
		} else {
			return false
		}
		hs.object_side = side
		hs.object_axis = axis
		return true
	}

	object_views.couch.draw_sizes = function(cx, plan, object) {
		draw_furniture_sizes(cx, plan, object)
		if (object.futon_length) {
			let x = object.futon_side < 0 ? 0 : object.w
			draw_object_length(cx, plan, object,
				x, object.l, x, object.l + object.futon_length)
		}
	}

	object_views.couch.draw = function(cx, plan, object) {
		let {w, l, futon_side, futon_length} = object
		let n = couch_seats(object), seat_w = (w - 200) / n
		let fx1 = futon_side < 0 ? 0 : w - 100 - seat_w
		let fx2 = futon_side < 0 ? 100 + seat_w : w
		cx.beginPath()
		cx.moveTo(0, 0)
		cx.lineTo(w, 0)
		cx.lineTo(w, l)
		cx.lineTo(fx2, l)
		cx.lineTo(fx2, l + futon_length)
		cx.lineTo(fx1, l + futon_length)
		cx.lineTo(fx1, l)
		cx.lineTo(0, l)
		cx.closePath()
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()
		cx.beginPath()
		cx.rect(100, 0, w - 200, 150)
		for (let side = -1; side <= 1; side += 2) {
			let x = side < 0 ? 100 : w - 100
			let arm_l = l - (futon_length && futon_side == side ? 150 : 0)
			cx.moveTo(x, 150)
			cx.lineTo(x, arm_l)
			if (arm_l < l)
				cx.lineTo(side < 0 ? 0 : w, arm_l)
		}
		for (let i = 1; i < n; i++) {
			let x = 100 + i * seat_w
			cx.moveTo(x, 150)
			cx.lineTo(x, l)
		}
		cx.stroke()
	}

	/// chair -----------------------------------------------------------------

	object_views.chair = {
		hit: hit_box,
	}

	// draw the chair with its narrower back at the top. For a diagonal
	// chair, move the drawing away from the corner by a quarter of its width
	// and length along the plan axes. Keep the plan box unchanged.
	object_views.chair.draw = function(cx, plan, object) {
		if (object.rot % 90) {
			let [ux, uy] = s.house.object_vector_to_plan(object,
				0, 1, object_point1)
			let [dx, dy] = s.house.plan_vector_to_object(object,
				sign(ux) * object.w / 4, sign(uy) * object.l / 4, object_point1)
			cx.translate(dx, dy)
		}
		let {w, l} = object
		let back_x1 = w / 8 // the back is 3/4 of the seat's width
		let back_x2 = w - back_x1

		// the seat's outline. Round each corner using points r millimetres away
		// along each adjacent edge.
		let points = [[back_x1, 0], [back_x2, 0], [w, l], [0, l]]
		let r = 60
		cx.beginPath()
		for (let i = 0, n = points.length; i < n; i++) {
			let [px, py] = points[i]
			let [x0, y0] = points[(i+n-1) % n]
			let [x1, y1] = points[(i+1) % n]
			let d0 = Math.hypot(x0 - px, y0 - py)
			let d1 = Math.hypot(x1 - px, y1 - py)
			let sx = px + (x0 - px) * r / d0
			let sy = py + (y0 - py) * r / d0
			if (i)
				cx.lineTo(sx, sy)
			else
				cx.moveTo(sx, sy)
			cx.quadraticCurveTo(px, py, px + (x1 - px) * r / d1,
				py + (y1 - py) * r / d1)
		}
		cx.closePath()

		// the back rest's line.
		cx.moveTo(w * .2, 90)
		cx.lineTo(w * .8, 90)
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()
	}

	/// wc --------------------------------------------------------------------

	object_views.wc = {
		hit: hit_box,
	}

	// draw the toilet with its tank at the top.
	object_views.wc.draw = function(cx, plan, object) {
		let {w, l} = object
		let bowl_x = w * .45
		let bowl_y = l * .35
		cx.beginPath()
		cx.rect(0, 0, w, l * .3)
		cx.moveTo(w / 2 - bowl_x, l * .3)
		cx.lineTo(w / 2 - bowl_x, l - bowl_y)
		cx.ellipse(w / 2, l - bowl_y, bowl_x, bowl_y, 0, PI, 0, true)
		cx.lineTo(w / 2 + bowl_x, l * .3)
		cx.closePath()
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()
	}

	/// table chairs ----------------------------------------------------------

	let CHAIR_SPACING = 600 // mm between chair centres along a table edge

	// the chair is centred on the table edge point (x, y); its back is on the
	// side of the unit vector (ux, uy), which points away from the table.
	function add_chair(cx, x, y, ux, uy) {
		let chair_size = 450
		let back_inset = 75
		let half_chair = chair_size / 2
		let back = half_chair - back_inset
		let hx = half_chair * ux, hy = half_chair * uy
		cx.moveTo(x - hx + hy, y - hy - hx)
		cx.lineTo(x + hx + hy, y + hy - hx)
		cx.lineTo(x + hx - hy, y + hy + hx)
		cx.lineTo(x - hx - hy, y - hy + hx)
		cx.closePath()

		let bx = x + back * ux, by = y + back * uy
		cx.moveTo(bx + hy, by - hx)
		cx.lineTo(bx - hy, by + hx)
	}

	/// hovered box -----------------------------------------------------------

	function draw_hovered_box(cx, object, x1, y1, x2, y2) {
		let hs = ui.captured(id) ?? ui.hovers(id)
		if (hs?.object != object)
			return
		let scale = to_pixels_exact(1)
		let dash = 5 / scale
		table_dash[0] = dash
		table_dash[1] = dash
		cx.setLineDash(table_dash)
		cx.strokeRect(x1, y1, x2 - x1, y2 - y1)
		cx.setLineDash(solid_line)
	}

	/// round table -----------------------------------------------------------

	object_views.round_table = {
		hit: hit_box,
	}

	object_views.round_table.hit_resize = function(plan, object, hs) {
		return hit_resize_rect(plan, object, hs, true)
	}

	object_views.round_table.draw_sizes = function(cx, plan, object) {
		let [x1, y1, x2, y2] = s.house.object_types[object.type]
			.local_box(plan, object, box)
		let x = (x1 + x2) / 2, y = (y1 + y2) / 2
		let r = object.w / 2
		draw_object_length(cx, plan, object, x - r, y, x + r, y, 0)
	}

	object_views.round_table.draw = function(cx, plan, object) {
		let [x1, y1, x2, y2] = s.house.object_types[object.type]
			.local_box(plan, object, box)

		// the chairs: a square with its back line, round the table.
		let r = object.w / 2
		let mx = (x1 + x2) / 2, my = (y1 + y2) / 2
		let n = floor(2 * PI * r / CHAIR_SPACING)
		cx.beginPath()
		for (let i = 0; i < n; i++) {
			let a = i * 2 * PI / n + (n == 4 ? PI / 4 : -PI / 2)
			let ux = cos(a), uy = sin(a)
			add_chair(cx, mx + r * ux, my + r * uy, ux, uy)
		}
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()

		cx.beginPath()
		cx.arc((x1 + x2) / 2, (y1 + y2) / 2, object.w / 2, 0, 2 * PI)
		cx.fill()
		cx.stroke()

		draw_hovered_box(cx, object, x1, y1, x2, y2)
	}

	/// rectangular table -----------------------------------------------------

	object_views.rect_table = {
		hit: hit_box,
		hit_resize: object_views.round_table.hit_resize,
	}

	// draw the width and length inside the table, along its bottom and right
	// edges.
	object_views.rect_table.draw_sizes = function(cx, plan, object) {
		let w = object.w, l = object.l
		draw_object_length(cx, plan, object, 0, l, w, l)
		draw_object_length(cx, plan, object, w, l, w, 0)
	}

	object_views.rect_table.draw = function(cx, plan, object) {
		let w = object.w, l = object.l

		// the chairs: evenly spaced along each side k (0 top, 1 right, 2
		// bottom, 3 left), going clockwise.
		cx.beginPath()
		for (let k = 0; k < 4; k++) {
			if (object.blocked_sides & (1 << k))
				continue
			let is_v = k % 2 == 1
			let dir = k < 2 ? 1 : -1
			let side_len = is_v ? l : w
			let x = k == 1 || k == 2 ? w : 0 // the start corner of the side
			let y = k >= 2 ? l : 0
			let ax = is_v ? 0 : dir // along the side
			let ay = is_v ? dir : 0
			let n = floor(side_len / CHAIR_SPACING)
			for (let i = 0; i < n; i++) {
				let d = (i + .5) * side_len / n
				add_chair(cx, x + ax * d, y + ay * d, ay, -ax)
			}
		}
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
		cx.stroke()

		cx.beginPath()
		cx.rect(0, 0, w, l)
		cx.fill()
		cx.stroke()

		draw_hovered_box(cx, object, 0, 0, w, l)
	}

	/// countertop ------------------------------------------------------------

	object_views.countertop = {}

	object_views.countertop.draw = function(cx, plan, object) {
		let a = object.contour
		cx.beginPath()
		cx.moveTo(a[0], a[1])
		for (let i = 2; i < a.length; i += 2) cx.lineTo(a[i], a[i+1])
		cx.closePath()
		cx.fillStyle = ui.color_css('bg')
		cx.fill('evenodd')
		cx.stroke()
	}

	object_views.countertop.hit = function(plan, object, hs) {
		let [x, y] = s.house.plan_to_object(plan, object,
			hs.mx_plan, hs.my_plan, object_point1)
		let a = object.contour, inside = false
		for (let i = 0, j = a.length-2; i < a.length; j = i, i += 2) {
			if ((a[i+1] > y) != (a[j+1] > y) && x < a[i])
				inside = !inside
		}
		return inside
	}

	object_views.countertop.hit_resize = function(plan, object, hs) {
		let [x, y] = s.house.plan_to_object(plan, object,
			hs.mx_plan, hs.my_plan, object_point1)
		let d = css_to_plan(8)
		for (let h = 1; h <= object.contour.length / 2 * 3; h++) {
			let edge = s.house.get_countertop_edge(object, h, countertop_edge)
			if (!edge)
				continue
			let [x1, y1, x2, y2] = edge
			let is_v = x1 == x2
			let across = is_v ? abs(x-x1) : abs(y-y1)
			let along = is_v ? y : x
			let lo = min(is_v ? y1 : x1, is_v ? y2 : x2)
			let hi = max(is_v ? y1 : x1, is_v ? y2 : x2)
			if (across <= d && along >= lo && along <= hi) {
				hs.object_side = h
				hs.object_axis = is_v ? 'w' : 'l'
				return true
			}
		}
		return false
	}

	object_views.countertop.draw_sizes = function(cx, plan, object, handle) {
		let cs = ui.captured(id)
		let a = object.contour
		let p, edge1, edge2, axis
		if (cs?.object == object && cs.action == 'resize_object' && cs.edit) {
			p = cs.edit.edge_i
			if (p == null)
				return
		} else if (handle) {
			p = floor((handle-1) / 3)*2
		}
		if (p != null) {
			edge1 = (p+a.length-2) % a.length
			edge2 = (p+2) % a.length
			axis = a[p] == a[(p+2) % a.length] ? 0 : 1
		}
		for (let i = 0; i < a.length; i += 2) {
			let j = (i+2) % a.length
			if (edge1 != null) {
				if (i != edge1 && i != edge2)
					continue
				if (a[i+axis] == a[j+axis])
					continue
				let k = edge1, l = (k+2) % a.length
				if (i == edge2
					&& min(a[i+axis], a[j+axis]) == min(a[k+axis], a[l+axis])
					&& max(a[i+axis], a[j+axis]) == max(a[k+axis], a[l+axis]))
					continue
			}
			draw_object_length(cx, plan, object, a[j], a[j+1], a[i], a[i+1])
		}
		for (let i = 4; i < a.length/2-2; i += 2) {
			let k = a.length-i, j = (k+2) % a.length
			if (p != null && p != i && p != k)
				continue
			let is_v = a[i] == a[i+2]
			let axis = is_v ? 1 : 0
			let lo = max(min(a[i+axis], a[i+2+axis]),
				min(a[k+axis], a[j+axis]))
			let hi = min(max(a[i+axis], a[i+2+axis]),
				max(a[k+axis], a[j+axis]))
			let x = is_v ? a[k] : lo + (hi-lo)*2/3
			let y = is_v ? lo + (hi-lo)*2/3 : a[k+1]
			draw_object_length(cx, plan, object,
				is_v ? a[i] : x, is_v ? y : a[i+1], x, y, 0)
		}
	}

	object_views.countertop.draw_resize = function(cx, plan, object, handle) {
		let [x1, y1, x2, y2] = s.house.get_countertop_edge(object, handle,
			countertop_edge)
		cx.beginPath()
		cx.moveTo(x1, y1); cx.lineTo(x2, y2)
		cx.stroke()
	}

	/// kitchen sink ----------------------------------------------------------

	object_views.kitchen_sink = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	// draw the rim, the basin with its drain and the tap at the top.
	object_views.kitchen_sink.draw = function(cx, plan, object) {
		let {w, l} = object
		cx.beginPath()
		cx.rect(0, 0, w, l)
		cx.roundRect(40, 100, w - 80, l - 140, 40)
		cx.moveTo(w / 2 + 25, 100 + (l - 140) / 2)
		cx.arc(w / 2, 100 + (l - 140) / 2, 25, 0, 2 * PI)
		cx.moveTo(w / 2 + 20, 50)
		cx.arc(w / 2, 50, 20, 0, 2 * PI)
		cx.fillStyle = ui.color_css('bg')
		cx.fill('evenodd')
		cx.stroke()
	}

	/// stovetop --------------------------------------------------------------

	object_views.stovetop = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
		draw_sizes: draw_furniture_sizes,
	}

	// draw the glass and the burners, about one per 300 mm each way.
	object_views.stovetop.draw = function(cx, plan, object) {
		let {w, l} = object
		let col_n = max(1, round(w / 300))
		let row_n = max(1, round(l / 300))
		let cell_w = w / col_n, cell_h = l / row_n
		let r = min(cell_w, cell_h) * .35
		cx.beginPath()
		cx.rect(0, 0, w, l)
		for (let i = 0; i < col_n; i++) {
			for (let j = 0; j < row_n; j++) {
				let x = (i + .5) * cell_w, y = (j + .5) * cell_h
				cx.moveTo(x + r, y)
				cx.arc(x, y, r, 0, 2 * PI)
			}
		}
		cx.fillStyle = ui.color_css('bg')
		cx.fill('evenodd')
		cx.stroke()
	}

	/// stair -----------------------------------------------------------------

	object_views.stair = {
		hit: hit_box,
		hit_resize: hit_resize_rect,
	}

	// draw the steps and an arrow pointing up the stairs.
	object_views.stair.draw = function(cx, plan, object) {
		let shape = s.house.stair_shape(plan, object)
		let w = object.w
		cx.beginPath()
		cx.rect(0, 0, w, shape.l)
		for (let i = 1; i < shape.n - 1; i++) {
			let y = i * shape.depth
			cx.moveTo(0, y)
			cx.lineTo(w, y)
		}
		let arrow = min(w / 5, shape.l / 5)
		let x = w / 2
		cx.moveTo(x, shape.l - arrow)
		cx.lineTo(x, arrow)
		cx.lineTo(x - arrow / 2, arrow * 1.5)
		cx.moveTo(x, arrow)
		cx.lineTo(x + arrow / 2, arrow * 1.5)
		cx.stroke()
	}

	// draw the stair width below its bottom edge and its length to the right.
	object_views.stair.draw_sizes = function(cx, plan, object) {
		let w = object.w, l = s.house.stair_shape(plan, object).l
		draw_object_length(cx, plan, object, w, l, 0, l)
		draw_object_length(cx, plan, object, w, 0, w, l)
	}

	/// tags ------------------------------------------------------------------

	// draw the icon at the tag point, with text below it. Keep both upright.
	let TAG_ICON_SIZE = 20 // px
	let TAG_TEXT_FONT = 'bold 12px sans-serif'
	let TAG_TEXT_Y = 18 // pixels from the tag point to the text centre
	let TAG_HIT_X = 28 // half the hit box width in pixels
	let TAG_HIT_Y1 = -12 // top of the hit box relative to the tag point, in px
	let TAG_HIT_Y2 = 26 // hit box bottom relative to the tag point, in pixels

	// draw the icon and text using the current stroke colour.
	function draw_tag(cx, icon_name, text) {
		let [font, glyph] = ui.get_icon(icon_name)
		let icon_font = tag_icon_fonts.get(font)
		if (!icon_font) {
			icon_font = TAG_ICON_SIZE + 'px ' + font
			tag_icon_fonts.set(font, icon_font)
		}
		cx.fillStyle = cx.strokeStyle
		cx.textAlign = 'center'
		cx.textBaseline = 'middle'
		cx.font = icon_font
		cx.fillText(glyph, 0, 0)
		cx.font = TAG_TEXT_FONT
		cx.fillText(text, 0, TAG_TEXT_Y)
	}

	// test whether the pointer is over the tag's icon or text.
	function hit_tag(plan, object, hs) {
		let [tx, ty] = get_pointer_offset(hs, object.x, object.y, object_point1)
		return tx >= -TAG_HIT_X && tx < TAG_HIT_X
			&& ty >= TAG_HIT_Y1 && ty < TAG_HIT_Y2
	}

	object_views.open_room = {
		hit: hit_tag,
		draw_space: 'screen',
	}
	object_views.open_room.draw = function(cx, plan, object) {
		draw_tag(cx, 'stairs', 'Open')
	}

	object_views.terrace = {
		hit: hit_tag,
		draw_space: 'screen',
	}
	object_views.terrace.draw = function(cx, plan, object) {
		draw_tag(cx, 'sun', 'Terrace')
	}

	/// object loops ----------------------------------------------------------

	// the topmost of `objects` at the pointer: over the object or at an end
	// that resizes it.
	function hit_object_in(objects, plan, hs, from_below) {
		for (let i = objects.length-1; i >= 0; i--) {
			let object = objects[i]
			let object_type = s.house.object_types[object.type]
			let object_view = object_views[object.type]
			if (from_below && !object_type.connects_below)
				continue
			let hit = object_view.hit(plan, object, hs) // true|'move'|false
			let is_resize = object_view.hit_resize?.(plan, object, hs)
			if (!hit && !is_resize)
				continue
			hs.object = object
			hs.object_plan = plan
			hs.action = is_resize ? 'resize_object' : 'move_object'
			return true
		}
		return false
	}

	// invalid floor objects and ground objects touching the house in the
	// error color; indoor-only ground objects in the readonly text color.
	// the hovered object in the link color unless it is in the error color.
	function draw_objects(cx, plan, objects, hit_object, is_ground,
		resize_side, from_below, is_overlapping) {
		cx.lineWidth = view_scale > 0.04 ? 2 : 1
		for (let object of objects) {
			let object_type = s.house.object_types[object.type]
			let object_view = object_views[object.type]
			if (from_below && !object_type.connects_below)
				continue
			let is_touching = false
			if (is_ground) {
				let [x1, y1, x2, y2] = s.house.get_object_box(plan, object,
					object_box)
				is_touching = plan.is_rect_touching_house(x1, y1, x2, y2)
			}
			let draw_resize = object == hit_object && resize_side
				&& object_view.draw_resize
			let is_outdoor = is_ground && ((object_type.allow ?? INDOOR) & OUTDOOR)
			let is_invalid = (object_type.in_wall ? !object.seg
				: is_ground ? is_touching : !object.is_valid)
				|| object == hit_object && is_overlapping
			cx.strokeStyle = is_invalid ? ui.color_css('error')
				: object == hit_object && !draw_resize ? ui.color_css('link')
				: ui.color_css('text', is_ground && !is_outdoor ? 'readonly' : null)
			cx.save()
			if (object_view.draw_mask)
				object_view.draw_mask(cx, plan, object,
					object == hit_object || show_dims)
			if (object_view.draw) {
				let [x, y] = s.house.get_object_origin(plan, object,
					object_origin)
				cx.translate(to_pixels(x), to_pixels(y))
				if (object_view.draw_space == 'screen') {
					cx.rotate(-view_rotation)
				} else {
					let scale = to_pixels_exact(1)
					cx.rotate(object.rot * rad)
					cx.scale(scale, scale)
					cx.lineWidth /= scale
				}
				object_view.draw(cx, plan, object)
				if (draw_resize) {
					cx.strokeStyle = ui.color_css('link')
					draw_resize(cx, plan, object, resize_side)
				}
			}
			cx.restore()
		}
		cx.lineWidth = 1
	}

	// the dimensions of the hovered object, or of all objects when
	// show_dims is on, and while moving or resizing an opening, its distances
	// to nearby openings or wall ends. Other objects show clearances on move.
	function draw_object_dims(cx, plan, objects, hit_object, show_clearances,
		from_below, object_dims, resize_side) {
		for (let object of objects) {
			let object_type = s.house.object_types[object.type]
			let object_view = object_views[object.type]
			if (from_below && !object_type.connects_below)
				continue
			if (object_view.draw_sizes && (object == hit_object || show_dims))
				object_view.draw_sizes(cx, plan, object,
					object == hit_object ? resize_side : null)
			if (show_clearances && object == hit_object && object.on_floor) {
				if (object_type.in_wall)
					draw_opening_clearances(cx, plan, object)
				else
					draw_object_clearances(cx, object_dims)
			}
		}
	}

	//// WIDGET ---------------------------------------------------------------

	e.build = function(id, value, field, opt, readonly) {

		s = ui.state(id)
		field ??= ui.input_field(id) ?? s.field
			?? ui.create_field({type: 'json'})
		let value0 = s.input_value
		let field0 = s.field
		value = ui.set_value(id, s, value, field)
		if (s.house === undefined || s.interaction_value === undefined
				&& (value !== value0 || field != field0)) {
			s.house = value != null && !s.validation.failed
				? house_plan(json_arg(value)) : null
			let ss = ui.saved_state[id]
			is_roof_level = ss?.is_roof_level ?? false
			let floors = s.house?.floors
			s.floor = floors?.[is_roof_level ? floors.length-1
				: min(ss?.floor ?? 0, floors.length-1)]
			value_edit_no = 0 // house.edit_no of the value loaded or published
			setting_edit = null // the edit of the replaced house
		}
		s.readonly = readonly ?? field.readonly
		if (!s.house) {
			ui.text('', value, 1, 's', 's', null, 'line')
			return ui.value(id)
		}

		ui.focus_group(false, 0, id)
		ui.focusable(id)

		let plan = s.floor
		roof_floor = is_roof_level ? plan : s.house.floors[plan.i-1]

		ui.stack()

			ui.cmd_box(CMD_FLOOR_EDITOR, 1, 's', 's', id, e)

			ui.m(ui.sp())
			ui.v(1, ui.sp())

				ui.h(0, ui.sp05(), 's', 't')

					ui.v(0, ui.sp05(), '[')
						let floors = s.house.floors
						floor_label(id+'.roof', S('roof', 'ROOF'), is_roof_level,
							floor_key(floors.length))
						for (let i = floors.length-1; i >= 0; i--) {
							let floor = floors[i]
							let name = floor_names[floor.i] ?? S(floor.i+'_floor',
								'{0}\u1d57\u02b0 FLOOR', floor.i)
							floor_label(id+'.floor'+floor.i, name,
								floor == plan && !is_roof_level, floor_key(floor.i))
						}
						if (!s.readonly) {
							ui.mt(ui.em(1))
							ui.h(0, ui.sp05())
								ui.button(id+'.add_floor_button', 'building-plus', '',
									0, null, null, null, null,
									S('add_floor', 'Add floor'))
								ui.button(id+'.remove_floor_button', 'building-minus',
									'', 0, null, null, null, floors.length < 2,
									S('remove_floor', 'Remove floor'))
							ui.end_h()
						}
					ui.end_v()

					ui.v(1, 0, 's', 't')
						if (!ui.window_focused() || !ui.focus_inside(id)) {
							ui.p(ui.sp05(), 0)
							ui.stack('', 0, 'c')
								ui.nobold()
								ui.xlarge()
								ui.color('text')
								ui.icon('', 'keyboard-off', 0, 'c', 'c')
							ui.end_stack()
						}
					ui.end_v()

					if (view_zoomed)
						ui.button(id+'.zoom_button',
							view_scale > .1 ? 'zoom-in' : 'zoom-out', '',
							0, 'c', 't', null, null,
							S('fit_to_view', 'Fit to view'))

					ui.button(id+'.rotate_button', 'rotate-rectangle', '',
						0, 'c', 't', null, null,
						S('rotate_90_degrees', 'Rotate 90 degrees'))

					if (ui.button(id+'.grid_button', 'grid-4x4', '',
							0, 'c', 't', null, null,
							S('show_grid', 'Show grid'))
					) {
						show_grid = !show_grid
						ui.save_state('floor_editor', 'show_grid', show_grid)
					}

					if (ui.button(id+'.dims_button', 'ruler-measure', '',
							0, 'c', 't', null, null,
							S('show_all_dimensions', 'Show all dimensions'))
					) {
						toggle_show_dims()
					}

					if (ui.popup_button(id+'.settings', 'settings', null,
						'c', 't', 'b', ']')
					) {
						ui.h2(S('settings', 'Settings'))
						ui.min_w(ui.em(24))
						ui.v_aligned(0, ui.sp(), 's', 't')
							for (let setting of settings) {
								let setting_id = id+'.setting.'+setting.name
								ui.h(0, ui.sp1(), 's', 'c')
									ui.label(setting_id, setting.label(), 0)
									ui.num_slider(setting_id,
										s.house[setting.name] / 10, setting.field,
										1, null, null, s.readonly)
								ui.end_h()
							}
						ui.end_v_aligned()
						ui.end_popup_button(id+'.settings')
					}

					if (ui.popup_button(id+'.help', 'help', null,
						'c', 't', 'b', ']')
					) {
						ui.h2(S('keyboard_and_mouse', 'Keyboard and mouse'))
						ui.help_lines(help_lines)
						ui.end_popup_button(id+'.help')
					}

				ui.end_h()

				ui.v(1, ui.sp(), ']')

					ui.v(0, ui.sp(), 'c', 'c')
						// TODO: add tools here
						// ui.button(id+'.c1', 'pointer', '', 0)
						// ui.button(id+'.c2', 'arrows-move', '', 0)
					ui.end_v()

				ui.end_v()

			ui.end_v()

		ui.end_stack()
		ui.end_focus_group()
		return ui.value(id)

	}

	e.position = function(a, i, axis, sx, sw)	{
		ui.box_position(a, i, axis, sx, sw)
		if (!axis)
			return
		let w  = a[i+2]
		let h  = a[i+3]
		let plan = s.floor
		let is_fitted = layout_view(s.house.bb, w, h)
		// lock the fitted view, like a manual zoom.
		if (is_fitted) {
			view_zoomed = true
			save_floor_view()
		}
	}

	e.draw = function(a, i) {

		let t0 = profile_time()

		let x00   = a[i+0]
		let y00   = a[i+1]
		let w     = a[i+2]
		let h     = a[i+3]
		let plan  = s.floor

		// the box after scrolling and popup positioning, for get_pointer_plan().
		viewport_x = x00
		viewport_y = y00

		// the roof of roof_floor and the half-walls around its terraces.
		let {
			roof_faces,
			eave_sides: roof_sides,
			shared_edges: roof_lines,
			half_wall_paths,
			terrace_paths,
		} = roof_floor ? roof_floor.make_roof_geometry() : no_roof_geometry

		let cs = ui.captured(id)
		let hs = cs ?? ui.hovers(id) // while dragging, the state at drag start.
		let hit_action  = hs?.action
		let hit_seg     = hs?.seg
		let hit_p       = hs?.p
		let hit_cycle   = hs?.cycle
		let hit_object = hs?.object
		let hit_roof_side = hs?.roof_side
		let hit_roof_faces = hs?.roof_faces
		let hit_roof_face  = hs?.roof_face
		let hit_x      = hs?.x
		let hit_y       = hs?.y
		let drag_action = cs?.action
		let drag_seg    = cs?.seg

		let cx = ui.cx
		cx.save()

		cx.beginPath()
		cx.rect(x00, y00, w, h)
		cx.clip()

		cx.translate(x00, y00)
		cx.font = 'bold 15px sans-serif'

		// grid
		draw_grids(cx,w, h)

		cx.textAlign = 'left'

		// legend
		{
		let m = ui.em()
		let mm = 1000
		let d = to_pixels(mm)
		while (d > w - 2*m) {
			mm /= 5
			d = to_pixels(mm)
		}
		cx.beginPath()
		let t = 4
		let x = w - d - m - t
		let y = h - m - t
		cx.rect(x, y, d, t)
		cx.fillStyle = ui.color_css('label')
		cx.fill()
		let s = format_length(mm)
		let tw = ui.measure_text(s).width
		cx.fillText(s, x + d - tw, y - 2)
		}

		// help
		{
		let m = ui.em()
		cx.fillStyle = ui.color_css('label')
		// the keys that apply to what is under the pointer.
		let s = hit_roof_side ? 'CTRL=No Snap  SHIFT=All Eaves'
			: hit_roof_face ? 'CTRL=Fine  SHIFT=All Faces'
			: hit_object ? 'CTRL=No Snap  SHIFT=Pan  DEL=Remove  CTRL+C=Copy'
			: 'CTRL=No Snap  SHIFT=Pan'
		cx.fillText(s, m, h - m)
		}

		transform_view(cx)

		// below floors. the roof level: the top floor's walls are drawn like
		// a floor below and not edited.
		cx.globalAlpha = .1
		for (let plan1 of s.house.floors) {
			if (plan1.i > plan.i || plan1 == plan && !is_roof_level)
				continue
			draw_walls(cx,plan1.make_wall_geometry().uncut_wall_paths,
				plan1.segs)
		}
		cx.globalAlpha = 1

		// snap lines
		cx.setLineDash([5, 8])
		cx.strokeStyle = ui.theme().is_dark ? '#555' : '#999'
		for (let i = 0, sl = shown_snap_lines, n = sl.length; i < n; i += 2) {
			let sa   = sl[i]
			let is_v = sl[i+1]
			let x1, y1, x2, y2
			if (is_v) {
				x1 = to_pixels(sa)
				x2 = to_pixels(sa)
				y1 = -view_y0
				y2 = -view_y0 + h
			} else {
				y1 = to_pixels(sa)
				y2 = to_pixels(sa)
				x1 = -view_x0
				x2 = -view_x0 + w
			}
			cx.beginPath()
			cx.moveTo(x1+.5, y1+.5)
			cx.lineTo(x2+.5, y2+.5)
			cx.stroke()
		}
		cx.setLineDash([])

		// room backgrounds
		if (!is_roof_level)
		for (let co of plan.comps) {
			for (let c of co.cycles) {
				if (c.outer)
					continue
				if (!c.edges)
					continue
				// open room: background only on the slab, outside the rooms below.
				let is_open = plan.open_rooms.has(c)
				if (is_open) {
					cx.save()
					cx.beginPath()
					let [x1, y1, x2, y2] = c.edges.bbox()
					cx.rect(to_pixels(x1), to_pixels(y1),
						to_pixels(x2) - to_pixels(x1), to_pixels(y2) - to_pixels(y1))
					// the cycles of the floor below: rooms, islands and island
					// rooms, but not the root outlines.
					let below_plan = s.house.floors[plan.i-1]
					if (below_plan)
						for (let below_co of below_plan.comps)
							for (let below_c of below_co.cycles) {
								if (below_c.outer && !below_co.inside)
									continue
								draw_edges(cx,below_c.edges)
							}
					cx.clip('evenodd')
				}

				cx.beginPath()

				draw_edges(cx,c.edges)

				// island outer cycles are clockwise so they draw as holes.
				for (let icomp of c.islands)
					draw_edges(cx,icomp.outer_cycle.edges)

				cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1',
					hit_cycle == c ? 'hover' : null), .5)
				cx.fill()

				if (is_open)
					cx.restore()
			}
		}

		// terrace floors: the half-walls cover their edges.
		if (terrace_paths.length) {
			cx.beginPath()
			add_grid_paths(cx,terrace_paths)
			cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1'), .5)
			cx.fill('evenodd')
		}

		// walls of this floor
		if (!is_roof_level)
			draw_walls(cx,plan.make_wall_geometry().cut_wall_paths,
				plan.segs)

		// half-walls around the terraces
		cx.globalAlpha = .5
		draw_walls(cx,half_wall_paths, empty_array)
		cx.globalAlpha = 1

		// walls of above floor
		cx.globalAlpha = .1
		for (let plan1 of s.house.floors) {
			if (plan1.i <= plan.i)
				continue
			draw_walls(cx,plan1.make_wall_geometry().uncut_wall_paths,
				plan1.segs)
		}
		cx.globalAlpha = 1

		// roof of roof_floor: the outlines of its faces. hovered or dragged
		// eave side: its eave line.
		cx.strokeStyle = ui.color_css('label')
		for (let face of roof_faces) {
			cx.beginPath()
			for (let ring of face.rings)
				draw_edges(cx,ring)
			cx.stroke()
		}
		// hovered or dragged: hit_roof_side is from an earlier frame's roof
		// (hovered: the hit phase; dragged: the drag start); the same side of
		// this frame's roof has the eave line.
		let roof_side = hit_roof_side
		if (roof_side) {
			let {nx, ny, wall_c, m1, m2} = roof_side
			roof_side = null
			for (let side of roof_sides)
				if (side.nx == nx && side.ny == ny && side.wall_c == wall_c
					&& side.m1 == m1 && side.m2 == m2
				) {
					roof_side = side
					break
				}
		}
		// the eave sides that move with it: only it; dragged with shift: all
		// of its kind (sloped or gable).
		let is_one = !(drag_action == 'move_eave' && ui.keypressed('shift'))
		let moved_sides = [] // [side, ...] of this frame's roof
		if (roof_side)
			for (let side of roof_sides)
				if (is_one ? side == roof_side
					: (side.pitch == 90) == (roof_side.pitch == 90))
					moved_sides.push(side)
		if (moved_sides.length) {
			let scale = prism_union.grid_scale
			cx.beginPath()
			for (let side of moved_sides) {
				let c  = side.c  / scale
				let e1 = side.e1 / scale
				let e2 = side.e2 / scale
				if (side.nx) {
					cx.moveTo(to_pixels(c), to_pixels(e1))
					cx.lineTo(to_pixels(c), to_pixels(e2))
				} else {
					cx.moveTo(to_pixels(e1), to_pixels(c))
					cx.lineTo(to_pixels(e2), to_pixels(c))
				}
			}
			cx.strokeStyle = ui.color_css('link')
			cx.lineWidth = 3
			cx.stroke()
			cx.lineWidth = 1
		}
		// hovered or dragged line or point where faces meet: the shared
		// segments between any two of the faces. hit_roof_faces are from an
		// earlier frame's roof (hovered: the hit phase; dragged: the drag
		// start); the faces of this frame's roof in the same planes have the
		// segments.
		let hit_lines = [] // [line, ...] of this frame's roof
		if (hit_roof_faces) {
			let found_faces = [] // [face, ...] of this frame's roof
			for (let face of hit_roof_faces)
				found_faces.push(find_roof_face(roof_faces, face.sides[0]))
			cx.beginPath()
			for (let line of roof_lines) {
				let {p, q, face1, face2} = line
				let is_shared = found_faces.includes(face1)
					&& found_faces.includes(face2)
				if (!is_shared)
					continue
				hit_lines.push(line)
				cx.moveTo(to_pixels(p[0]), to_pixels(p[1]))
				cx.lineTo(to_pixels(q[0]), to_pixels(q[1]))
			}
			cx.strokeStyle = ui.color_css('link')
			cx.lineWidth = 3
			cx.stroke()
			cx.lineWidth = 1
		}

		// roof measurements: of the dragged eave sides and lines; all of
		// them while all dimensions are shown.
		if (roof_floor) {
			let wall_z = roof_floor.z + roof_floor.h
			let sides = show_dims ? roof_sides
				: drag_action == 'move_eave' ? moved_sides : empty_array
			for (let side of sides)
				draw_eave_dims(cx,side, wall_z)
			let lines = show_dims ? roof_lines
				: drag_action == 'move_faces' ? hit_lines : empty_array
			for (let line of lines)
				draw_roof_line_dims(cx,line, wall_z)
		}

		// pitch labels of the roof's faces. hit_roof_face is from an earlier
		// frame's roof, like the line's faces above. highlighted: the hit
		// face's label; dragged with shift: the labels of all sloped faces.
		let label_face = hit_roof_face
			&& find_roof_face(roof_faces, hit_roof_face.sides[0])
		let is_all_faces = drag_action == 'move_pitch'
			&& ui.keypressed('shift')
		if (view_scale > 0.04)
			for (let face of roof_faces) {
				let is_lit = face == label_face
					|| is_all_faces && face.sides[0].pitch != 90
				let [x, y] = roof_label_point(face)
				draw_text(cx, x, y, format_pitch(face.sides[0].pitch),
					is_lit ? 'link' : 'label')
			}

		// cycles area
		if (view_scale > 0.04 && !is_roof_level)
			for (let co of plan.comps) {
				for (let c of co.cycles) {
					if (c.outer)
						continue
					let [x, y] = c.center()
					let area = c.edges.area()
					for (let icomp of c.islands)
						area += icomp.outer_cycle.edges.area()
					let s = format_area(area)
					if (DEBUG_PLAN) s = co.id + '/' + c.id + ' ' + s
					draw_text(cx, x, y, s, 'label')
				}
			}

		// objects: the ground's under the floor's.
		if (!is_roof_level) {
			let resize_side = hit_action == 'resize_object' && !cs?.edit
				? hs.object_side : null
			let object_type = hit_object && s.house.object_types[hit_object.type]
			let is_key_moved = show_key_dims && !cs && hit_object
			let is_moving_object = (drag_action == 'move_object' || is_key_moved)
				&& !object_type.opens_room && !object_type.marks_terrace
			let is_overlapping = is_moving_object
				&& measure_object_dims(hs.object_plan ?? plan, hit_object)
			let show_clearances = is_moving_object
				|| drag_action == 'resize_object' && cs.edit && object_type.in_wall
			let ground_objects = s.house.ground_objects
			draw_objects(cx, plan, ground_objects, hit_object, true,
				resize_side, false, is_overlapping)
			draw_objects(cx, plan, plan.objects, hit_object, false,
				resize_side, false, is_overlapping)
			let plan_above = s.house.floors[plan.i+1]
			let objects_above = plan_above?.objects ?? empty_array
			draw_objects(cx, plan_above, objects_above,
				hit_object, false, resize_side, true, is_overlapping)
			draw_object_dims(cx, plan, ground_objects, hit_object,
				show_clearances, false, object_dims, resize_side)
			draw_object_dims(cx, plan, plan.objects, hit_object,
				show_clearances, false, object_dims, resize_side)
			draw_object_dims(cx, plan_above, objects_above,
				hit_object, show_clearances, true, object_dims, resize_side)
		}

		// find all affected _|_ edges so we can show their lengths as we move
		// the seg, by dragging it or with the keys.
		let moved_seg = drag_action == 'move_seg' ? drag_seg
			: show_key_dims && !cs && hit_action == 'move_seg' ? hit_seg : null
		if (moved_seg && !show_dims) {
			let sp1 = moved_seg[0]
			let sp2 = moved_seg[1]
			let v = moved_seg.is_v
			for (let co of plan.comps) {
				for (let c of co.cycles) {
					for (let i = 0, n = c.edges.length; i <= n; i++) {
						let ep1 = c.edges[(i+0) % n]
						let ep2 = c.edges[(i+1) % n]
						if (!(ep1.p == sp1 && ep2.p == sp2
							|| ep1.p == sp2 && ep2.p == sp1)) // not seg's edge
							continue
						let ep0 = last_perp_edge_point(c, i+0, n, -1, !v)
						let ep3 = last_perp_edge_point(c, i+1, n,  1, !v)
						if (!(ep0 || ep3))
							continue
						if (ep0)
							draw_length(cx,ep0[0], ep0[1], ep1[0], ep1[1])
						if (ep3)
							draw_length(cx,ep2[0], ep2[1], ep3[0], ep3[1])
					}
				}
			}
		}

		// drawing a wall: its length on each side.
		if (drag_action == 'resize_seg' && !show_dims) {
			let sp1 = cs.edit.seg[0]
			let sp2 = cs.edit.seg[1]
			for (let co of plan.comps) {
				for (let c of co.cycles) {
					if (!c.edges)
						continue
					for (let i = 0, n = c.edges.length; i < n; i++) {
						let ep1 = c.edges[i]
						let ep2 = c.edges[(i+1) % n]
						if (ep1.p == sp1 && ep2.p == sp2
							|| ep1.p == sp2 && ep2.p == sp1)
							draw_length(cx,ep1[0], ep1[1], ep2[0], ep2[1])
					}
				}
			}
		}

		// show all dimensions: interior (room cycles) and exterior (outer cycles),
		// shown always while the mode is on, drags included.
		if (show_dims && !is_roof_level) {
			for (let co of plan.comps) {
				for (let c of co.cycles) {
					if (!c.edges)
						continue
					for (let ei = 0, n = c.edges.length; ei < n; ei++) {
						let ep1 = c.edges[ei]
						let ep2 = c.edges[(ei + 1) % n]
						draw_length(cx,ep1[0], ep1[1], ep2[0], ep2[1])
					}
				}
			}
		}

		// hit point
		if (hit_x != null && hit_y != null) {
			let x = to_pixels(hit_x)
			let y = to_pixels(hit_y)
			cx.beginPath()
			cx.arc(x, y, 3, 0, 2*PI)
			cx.strokeStyle = 'black'
			cx.lineWidth = 3
			cx.stroke()
			cx.lineWidth = 1
			cx.fillStyle = 'white'
			cx.fill()
		}

		// grid origin
		if (show_grid) {
			let x = to_pixels(s.house.grid_x)
			let y = to_pixels(s.house.grid_y)
			let r = to_pixels(100)
			let d = to_pixels(150)
			cx.lineWidth = 1.5 * devicePixelRatio
			cx.strokeStyle = ui.color_css('link')
			cx.fillStyle = ui.color_css('bg')
			cx.beginPath()
			cx.arc(x, y, r, 0, 2 * PI)
			cx.moveTo(x + r / 2, y)
			cx.arc(x, y, r / 2, 0, 2 * PI)
			cx.fill('evenodd')
			cx.moveTo(x - d, y)
			cx.lineTo(x + d, y)
			cx.moveTo(x, y - d)
			cx.lineTo(x, y + d)
			cx.stroke()
		}

		// cursor
		let seg = drag_action == 'move_seg' && drag_seg || (hit_action == 'move_seg' && hit_seg)
		let axes_swapped = round(view_rotation / (90*rad)) % 2 != 0
		if (seg) {
			if (seg[0].segs.length == 1 && seg[1].segs.length == 1)
				ui.set_cursor('move')
			else {
				ui.set_cursor(seg.is_v != axes_swapped ? 'ew-resize' : 'ns-resize')
			}
		} else if (hit_roof_side) {
			// no shift on an eave side with 2+ edge points: no own overhang.
			// pressed without a move started: a click that cannot toggle the
			// gable.
			let is_blocked = cs?.can_move_eave === false || cs && !cs.edit
				&& !roof_floor.can_toggle_gable(hit_roof_side)
			ui.set_cursor(is_blocked ? 'not-allowed'
				: !!hit_roof_side.nx != axes_swapped ? 'ew-resize' : 'ns-resize')
		} else if (hit_roof_face) {
			// no shift on a face with a side with 2+ edge points: no own
			// pitch.
			ui.set_cursor(cs?.can_move_pitch === false ? 'not-allowed'
				: 'ns-resize')
		} else if (hit_roof_faces) {
			// grabbed at or below the wall top, a side with 2+ edge points,
			// or moved onto or past all faces' wall lines: blocked.
			let is_blocked = cs?.edit ? cs.can_move_faces === false
				: !roof_floor.can_move_faces(
					hit_roof_faces, hs.roof_z)
			ui.set_cursor(is_blocked ? 'not-allowed' : 'move')
		} else if (hit_action == 'resize_object') {
			let is_v = (hs.object.rot % 180 == 90) != (hs.object_axis == 'l')
			ui.set_cursor(is_v != axes_swapped ? 'ns-resize' : 'ew-resize')
		} else if (hit_action == 'move_grid_origin' || hit_object) {
			ui.set_cursor(cs ? 'grabbing' : 'grab')
		} else if (hit_p)
			ui.set_cursor('copy')
		else if (drag_action == 'pan')
			ui.set_cursor('grabbing')
		else if (hs) {
			if (hit_action == 'pan')
				ui.set_cursor('grab')
			else if (is_roof_level) // no walls to draw.
				ui.set_cursor(cs?.moved ? 'not-allowed' : 'default')
			else
				ui.set_cursor('copy')
		}

		// DEBUG ---------------------------------------------------------------

		// segment lines and segment numbers
		if (DEBUG_PLAN && !is_roof_level)
		for (let seg of plan.segs) {
			let p1 = seg[0]
			let p2 = seg[1]
			cx.beginPath()
			let x1 = to_pixels(p1[0])
			let y1 = to_pixels(p1[1])
			let x2 = to_pixels(p2[0])
			let y2 = to_pixels(p2[1])
			cx.moveTo(x1, y1)
			cx.lineTo(x2, y2)
			cx.strokeStyle = hit_seg == seg ? 'white' : '#666'
			cx.stroke()

			let [x0, y0] = seg_center(seg)
			let x = to_pixels(x0) - 5
			let y = to_pixels(y0) + 5
			cx.fillStyle = '#f66'
			cx.textAlign = 'left'
			cx.fillText(seg.id, x, y)
		}

		// point numbers
		if (DEBUG_PLAN && !is_roof_level)
		for (let p of plan.ps) {
			let [x0, y0] = p
			let x = to_pixels(x0) - 5
			let y = to_pixels(y0) + 5
			cx.fillStyle = 'white'
			cx.textAlign = 'left'
			cx.fillText(p.id, x, y)
		}

		// edge point numbers
		if (0 && DEBUG_PLAN && !is_roof_level)
		for (let c of plan.comps) {
			let co = c // no var shadowing because langauge designers are dumb
			for (let c of co.cycles) {
				for (let ep of c.edges) {
					let x = to_pixels(ep[0]) - 5
					let y = to_pixels(ep[1]) + 15
					cx.fillStyle = '#0f0'
					cx.textAlign = 'left'
					cx.fillText(c.i+'/'+ep.ci, x, y)
				}
			}
		}

		cx.restore()
		profile_time('plan.draw', t0)
	}

	/*	sets in hovers(id):
		action=move_grid_origin    hit grid origin
		action=pan                 shift pressed, pan, don't hit anything
		p                          hit joint
		seg, action=move_seg       hit segment
		seg, x or y                hit around segment along its length
		x and/or y                 hit vert and/or horiz snap line
		cycle                      inside inner cycle
		object, object_plan,
		action=move_object         hit object
		object, object_plan, object_side, object_axis,
		action=resize_object       hit an end of a resizable object
		mx_plan, my_plan           the pointer, in plan units
		roof_side, roof_x, roof_y,
		action=move_eave           hit eave side
		roof_faces,
		roof_x, roof_y, roof_z,
		action=move_faces          hit line or point where roof faces meet
		roof_face, action=move_pitch  hit pitch label of a roof face
	*/
	e.hit = function(a, i) {

		let plan = s.floor

		let roof_geometry = roof_floor ? roof_floor.make_roof_geometry()
			: no_roof_geometry

		if (ui.captured_id != null && !ui.clickup)
			return

		if (!ui.hit_box(a, i))
			return

		let hs = ui.set_hit(id)

		shown_snap_lines.length = 0

		let pan = ui.keypressed('shift')

		let [mx_plan, my_plan] = get_pointer_plan(object_point1)
		hs.mx_plan = mx_plan
		hs.my_plan = my_plan

		if (pan)
			hs.action = 'pan'
		else if (!s.readonly)
			hit_plan(hs, plan, roof_geometry)

		return true

	}

	// the hits at the pointer, in plan units; pixel tolerances go through
	// to_plan().
	function hit_plan(hs, plan, roof_geometry) {

		// the roof of roof_floor.
		let {
			roof_faces,
			eave_sides: roof_sides,
			shared_edges: roof_lines,
		} = roof_geometry

		let sl = shown_snap_lines
		let nosnap = ui.keypressed('ctrl')
		let snap_d = snap_distance(200)
		let snap_lines = s.house.snap_lines
		let mx = hs.mx_plan
		let my = hs.my_plan

		// grid origin
		if (show_grid) {
			let dx = mx - s.house.grid_x
			let dy = my - s.house.grid_y
			let r = max(100, css_to_plan(13))
			if (dx * dx + dy * dy <= r * r) {
				hs.action = 'move_grid_origin'
				return
			}
		}

		// an object is on top of everything else.
		let plan_above = s.house.floors[plan.i+1]
		if (!is_roof_level && (
			hit_object_in(plan_above?.objects ?? empty_array, plan_above, hs,
				true)
			|| hit_object_in(plan.objects, plan, hs)
			|| hit_object_in(s.house.ground_objects, plan, hs)
		))
			return

		let snap_margin = 15

		let hit_p, hit_seg, hit_action, hit_cycle

		if (!is_roof_level)
		for (let p of plan.ps) {
			let dx = mx - p[0]
			let dy = my - p[1]
			let hit_d = nosnap ? css_to_plan(2)
				: p.max_offset + to_plan(view_line_width) + css_to_plan(snap_margin)
			if (abs(dx) <= hit_d && abs(dy) <= hit_d) {
				hit_p = p
				hs.p = p // point to start new seg from
				hs.x = p[0]
				hs.y = p[1]
				sl.push(p[0], 1, p[1], 0)
				break
			}
		}

		if (!hit_p && !is_roof_level)
			for (let seg of plan.segs) {

				let x1 = seg[0][0]
				let y1 = seg[0][1]
				let x2 = seg[1][0]
				let y2 = seg[1][1]
				let v = seg.is_v

				let bx1, by1, bx2, by2 // plan hit box

				// test over the seg's area between its offset edges.
				let m = to_plan(view_line_width)
				if (v) {
					bx1 = seg.wall_a1 - m
					bx2 = seg.wall_a2 + m
					by1 = seg.y1
					by2 = seg.y2
				} else if (y1 == y2) {
					by1 = seg.wall_a1 - m
					by2 = seg.wall_a2 + m
					bx1 = seg.x1
					bx2 = seg.x2
				} else {
					continue
				}
				if (hit_plan_box(hs, bx1, by1, bx2, by2)) {
					hit_seg = seg
					hit_action = 'move_seg'
					hs.seg = seg
					hs.action = hit_action
					break
				}

				// try a wider area and compute the point of the mouse projected on the seg.
				if (v) {
					bx1 -= css_to_plan(snap_margin)
					bx2 += css_to_plan(snap_margin)
				} else {
					by1 -= css_to_plan(snap_margin)
					by2 += css_to_plan(snap_margin)
				}
				if (hit_plan_box(hs, bx1, by1, bx2, by2)) {
					hit_seg = seg
					hs.seg = seg
					let sx = !v ? snap_lines[0].snap(mx, snap_d, snap_step()) ?? mx : null
					let sy =  v ? snap_lines[1].snap(my, snap_d, snap_step()) ?? my : null
					hs.x = sx ?? x1
					hs.y = sy ?? y1
					if (sx != null) sl.push(sx, 1)
					if (sy != null) sl.push(sy, 0)
					break
				}

			}

		// hit pitch label, else eave side, else point where three or more roof
		// faces meet, else line between two roof faces
		let hit_roof = !hit_p && !hit_seg
			&& (hit_roof_label(hs, roof_faces)
				|| hit_roof_side(hs, roof_sides, mx, my)
				|| hit_roof_point(hs, roof_lines, mx, my)
				|| hit_roof_line(hs, roof_lines, mx, my))

		// the roof level has no walls to draw or rooms to hover.

		// hit snapping point
		if (!hit_p && !hit_seg && !hit_roof && !is_roof_level) {
			let sx = snap_lines[0].snap(mx, snap_d, snap_step())
			let sy = snap_lines[1].snap(my, snap_d, snap_step())
			hs.x = sx ?? mx
			hs.y = sy ?? my
			if (sx != null) sl.push(sx, 1)
			if (sy != null) sl.push(sy, 0)
		}

		// hit inner cycle
		if (!hit_p && !hit_seg && !hit_roof && !is_roof_level) {
			hit_cycle = plan.hit_cycle_edges(mx, my)
			if (hit_cycle)
				hs.cycle = hit_cycle
		}

	}

	return e
}

ui.floor_editor = ui.stateful_widget(create_floor_editor)

}()) // module function
