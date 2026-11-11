
-- Construction Project Management Application Module.
--	Written by Cosmin Apreutesei. Public Domain.

db_schema:import(function()

	category'Project Management'

	tables.company = { icon'building',
		company      , idpk,
		name         , name, not_null, uk,
		address      , name, icon'map-pin',
		registration , name, icon'id',
		phone        , phone,
		email        , email,
		website      , url,
		note         , text, icon'notes',
	}

	tables.contact = { icon'user',
		contact   , idpk,
		name      , name, not_null, uk,
		phone     , phone,
		email     , email,
		position  , name, icon'briefcase',
		company   , id, fk,
		note      , text, icon'notes',
	}

	tables.project = { icon'briefcase',
		project    , idpk,
		name       , name, not_null, uk,
		client     , id, child_fk(company),
		note       , text, icon'notes',
	}

	tables.unit = { icon'home',
		unit    , idpk,
		project , id, not_null, child_fk,
		name    , name, not_null,
		note    , text, icon'notes',
		plan    , id, weak_fk, --agreed plan
	}

	tables.plan = { icon'map',
		plan    , idpk,
		unit    , id, not_null, fk,
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

	tables.folder = { icon'folder',
		folder , idpk,
		name   , name, not_null,
		parent , id, fk(folder),
	}

	tables.measure = { icon'ruler',
		measure , idpk,
		name    , name, not_null, uk,
		unit    , name, not_null, icon'ruler',
		note    , text, icon'notes',
	}

	for i=1,3 do
		tables['dim'..i..'_wbs'] = { icon'tags',
			id   , idpk,
			name , name, not_null,
			note , text, icon'notes',
		}
	end

	tables.wbs = { icon'list-tree', --work breakdown structure
		wbs    , idpk,
		name   , name, not_null,
		code   , name, icon'code',
		type   , enum'work product service', icon'category',
		project, id,
		--estimated current cost
		unit_cost , money,
		unit      , name, icon'ruler',
		measure   , id, fk,
		--estimated productivity
		output_per_day , qty, icon'gauge',
		output_unit    , name, icon'ruler',
		--org
		folder , id, fk,
		dim1   , id, fk(dim1_wbs),
		dim2   , id, fk(dim2_wbs),
		dim3   , id, fk(dim3_wbs),
		note   , text, icon'notes',
	}

	tables.wbs_dependency = { icon'arrows-shuffle',
		wbs          , id, child_fk,
		needs_wbs    , id, fk(wbs),
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
		note         , text, icon'notes',
		pk(wbs, needs_wbs),
	}

	--cost estimates and cost tracking

	tables.unit_measure = { icon'ruler',
		unit    , id, not_null, child_fk,
		measure , id, not_null, fk,
		qty     , qty, not_null,
		pk(unit, measure),
	}

	tables.cost = { icon'currency-dollar',
		unit      , id, not_null, child_fk,
		wbs       , id, not_null, fk,
		qty       , qty, not_null,
		estimated_unit_cost  , money,
		contracted_unit_cost , money,
		status    , enum'started finished', icon'progress-check',
		note      , text, icon'notes',
		pk(unit, wbs),
	}

	tables.punch = { icon'clock',
		punch    , idpk,
		unit     , id, not_null, child_fk,
		wbs      , id, not_null, fk,
		start_at , time, icon'player-play',
		end_at   , time, icon'player-stop',
		hours    , duration,
		output   , qty,
		worker   , id, not_null, fk(contact),
		note     , text, icon'notes',
	}

end)

--plans ---------------------------------------------------------------------

require'rowset_mdbx'

local function can_see_plan(plan)
	return plan.public or plan.user == user()
end

local function plan_rowset(detail)
	local cols = 'plan, unit, user, name, public, locked, mtime'
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
			unit = {
				for_cols = 'unit', accept_many = true, auto_bind = true,
				lookup_rowset_name = 'table_unit', lookup_cols = 'unit',
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
