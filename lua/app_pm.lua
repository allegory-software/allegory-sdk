
-- Construction Project Management Application Module.
--	Written by Cosmin Apreutesei. Public Domain.

db_schema:import(function()

	category'Project Management'

	tables.company = { icon'building', label'Companies',
		company      , idpk,
		name         , name, not_null, uk,
		address      , address,
		registration , name,
		phone        , phone,
		email        , email,
		website      , url,
		note         , note,
	}

	tables.contact = { icon'user', label'Contacts',
		contact   , idpk,
		name      , name, not_null, uk,
		phone     , phone,
		email     , email,
		position  , name, icon'briefcase',
		company   , id, fk,
		note      , note,
	}

	tables.project = { icon'briefcase', label'Projects',
		project    , idpk,
		name       , name, not_null, uk,
		client     , id, child_fk(company),
		note       , note,
	}

	tables.lot = { icon'home', label'Lots',
		lot     , idpk,
		project , id, not_null, child_fk,
		name    , name, not_null,
		note    , note,
		plan    , id, weak_fk, --agreed plan
	}

	tables.plan = { icon'map', label'Plans',
		plan    , idpk,
		lot     , id, not_null, fk,
		user    , id, not_null, fk, server_default(function()
			return user()
		end), --owner
		name    , name,
		public  , bool0, icon'world',
		locked  , bool0, icon'lock',
		data    , json, not_null, internal,
			server_default'\'{"floors":[{"points":[],"lines":[]}]}\'',
		mtime   , mtime,
	}

	types.unit = {str, w = 2, icon = 'ruler', maxlen = 16}

	tables.unit = { icon'ruler', label'Units',
		unit, unit, pk,
		note, note,
	}

	tables.folder = { icon'folder', label'Folders',
		folder , idpk,
		name   , long_name, not_null,
		parent , id, fk(folder),
	}

	tables.folder.parent_col = 'parent'

	tables.measure = { icon'ruler', label'Measures',
		measure , idpk,
		name    , name, not_null, uk,
		unit    , unit, not_null, fk,
		note    , note,
	}

	for i=1,3 do
		tables['dim'..i..'_wi'] = { icon'tags', label('Dimension '..i..' Tags'),
			id   , idpk,
			name , name, not_null,
			note , note,
		}
	end

	tables.wi = { icon'list-tree', label'Work Items',
		wi     , idpk,
		name   , long_name, not_null,
		code   , name, icon'code',
		project, id, fk, --custom wi per project
		unit   , unit, fk,
		measure, id, fk,
		--org
		folder , id, fk,
		dim1   , id, fk(dim1_wi),
		dim2   , id, fk(dim2_wi),
		dim3   , id, fk(dim3_wi),
		note   , note,
	}

	tables.resource = { icon'package', label'Resources',
		resource  , idpk,
		name      , long_name, not_null,
		code      , name, icon'code',
		type      , enum'labor material service equipment other', icon'category',
		unit      , unit, fk,
		unit_cost , money,
		currency  , currency, fk,
		note      , note,
	}

	tables.wi_comp = { icon'components', label'Work Item Components',
		wi       , id, not_null, child_fk,
		resource , id, not_null, fk,
		qty      , qty, not_null, --per unit of wi, in resource.unit
		pk(wi, resource),
	}

	tables.wi_dependency = { icon'arrows-shuffle',
		label'Work Item Dependencies',
		wi           , id, child_fk,
		needs_wi     , id, fk(wi),
		type         , enum('FS SS FF SF', {
			FS = 'Finish-to-Start',
			SS = 'Start-to-Start',
			FF = 'Finish-to-Finish',
			SF = 'Start-to-Finish',
		}, {
			FS = [[
Most common: use it to enforce task succession and material requirements.
]],
			SS = [[
Less common. Examples:
- Laying underground pipes can start after excavation starts.
- Running wires and pipes can start after framing starts.
]],
			FF = [[
Example: cannot finish electrical inspection until wiring is finished.
]],
			SF = [[
Very rare. Example: shift handoffs.
]],
		}), not_null, client_default'"FS"', icon'category',
		delay        , duration,
		note         , note,
		pk(wi, needs_wi),
	}

	--cost estimates and cost tracking

	tables.lot_measure = { icon'ruler', label'Lot Measures',
		lot     , id, not_null, child_fk,
		measure , id, not_null, fk,
		qty     , qty, not_null,
		pk(lot, measure),
	}

	tables.cost = { icon'currency-dollar', label'Costs',
		lot       , id, not_null, child_fk,
		wi        , id, not_null, fk,
		qty       , qty, not_null,
		estimated_unit_cost  , money,
		contracted_unit_cost , money,
		status    , enum'started finished', icon'progress-check',
		note      , note,
		pk(lot, wi),
	}

	tables.punch = { icon'clock', label'Punches',
		punch    , idpk,
		lot      , id, not_null, child_fk,
		wi       , id, not_null, fk,
		start_at , time, icon'player-play',
		end_at   , time, icon'player-stop',
		hours    , duration,
		output   , qty,
		worker   , id, not_null, fk(contact),
		note     , note,
	}

end)

--plans ---------------------------------------------------------------------

require'rowset_mdbx'

local function can_see_plan(plan)
	return plan.public or plan.user == user()
end

local function plan_rowset(detail)
	local cols = 'plan, lot, user, name, public, locked, mtime'
	if detail then cols = cols..', data' end
	local changed_scan
	return scan_rowset{
		label = detail and 'Plan' or 'Plans',
		category = 'Project Management',
		internal = detail,
		pk = 'plan',
		ro_cols = 'user',
		allow_unfiltered = not detail,
		params = detail and {
			plan = {
				for_cols = 'plan', accept_many = false, auto_bind = true,
				lookup_rowset_name = 'plans', lookup_cols = 'plan',
			},
		} or {
			lot = {
				for_cols = 'lot', accept_many = true, auto_bind = true,
				lookup_rowset_name = 'table_lot', lookup_cols = 'lot',
				client_filter = true,
			},
		},
		allow = function()
			return user() ~= nil and not user'anonymous'
		end,
		scan = function(db, param_names)
			local scan = db:scan('plan',
				detail and param_names.plan and 'plan = :plan' or '')
			return scan:filter('public, user', can_see_plan):select(cols)
		end,
		on_rows_changed = function(self, changes, param_vals)
			if not changed_scan then
				changed_scan = (self.db or db()):scan('plan', 'plan = :plan')
					:filter('public, user', can_see_plan):select(cols)
					:null_value(null)
			end
			local rows, removed_pks, seen = {}, {}, {}
			for tbl, plan in changes do
				if tbl == 'plan' and not seen[plan] then
					seen[plan] = true
					local row
					if not detail or param_vals.plan == plan then
						row = changed_scan:first('[]', {plan = plan})
					end
					if row then
						add(rows, row)
					else
						add(removed_pks, {plan})
					end
				end
			end
			return {rows = rows, removed_pks = removed_pks}
		end,
		can_change_row = function(self, vals)
			local public, owner, locked = db():find('plan',
				'public user locked', vals['plan:old'])
			if not (public or owner == user()) then
				return false, 'Plan not found'
			end
			if detail and locked then
				return false, 'Plan is locked; save a copy'
			end
			local errors = self:validate_fields(vals, true)
			if errors then return false, nil, errors end
		end,
	}
end

rowset.plans = plan_rowset(false)
rowset.plan_data = plan_rowset(true)
