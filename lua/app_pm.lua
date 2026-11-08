
db_schema:import(function()

	tables.company = {
		company      , idpk,
		name         , name, not_null, uk,
		address      , name,
		registration , name,
		phone        , phone,
		email        , email,
		website      , url,
		note         , text,
	}

	tables.contact = {
		contact   , idpk,
		name      , name, not_null, uk,
		phone     , phone,
		email     , email,
		position  , name,
		company   , id, fk,
		note      , text,
	}

	tables.project = {
		project    , idpk,
		name       , name, not_null, uk,
		client     , id, child_fk(company),
		note       , text,
	}

	tables.unit = {
		unit    , idpk,
		project , id, not_null, child_fk,
		name    , name, not_null,
		note    , text,
	}

	tables.folder = {
		folder , idpk,
		name   , name, not_null,
		parent , id, fk(folder),
	}

	tables.measure = {
		measure , idpk,
		name    , name, not_null, uk,
		unit    , name, not_null,
		note    , text,
	}

	for i=1,3 do
		tables['dim'..i..'_wbs'] = {
			id   , idpk,
			name , name, not_null,
			note , text,
		}
	end

	tables.wbs = { --work breakdown structure
		wbs    , idpk,
		name   , name, not_null,
		code   , name,
		type   , enum'work product service',
		project, id,
		--estimated current cost
		unit_cost , money,
		unit      , name,
		measure   , id, fk,
		--estimated productivity
		output_per_day , qty,
		output_unit    , name,
		--org
		folder , id, fk,
		dim1   , id, fk(dim1_wbs),
		dim2   , id, fk(dim2_wbs),
		dim3   , id, fk(dim3_wbs),
		note   , text,
	}

	tables.wbs_dependency = {
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
		}), not_null, client_default'"FS"',
		delay        , duration,
		note         , text,
		pk(wbs, needs_wbs),
	}

	--cost estimates and cost tracking

	tables.unit_measure = {
		unit    , id, not_null, child_fk,
		measure , id, not_null, fk,
		qty     , qty, not_null,
		pk(unit, measure),
	}

	tables.cost = {
		unit      , id, not_null, child_fk,
		wbs       , id, not_null, fk,
		qty       , qty, not_null,
		estimated_unit_cost  , money,
		contracted_unit_cost , money,
		status    , enum'started finished',
		note      , text,
		pk(unit, wbs),
	}

	tables.punch = {
		punch    , idpk,
		unit     , id, not_null, child_fk,
		wbs      , id, not_null, fk,
		start_at , time,
		end_at   , time,
		hours    , duration,
		output   , qty,
		worker   , id, not_null, fk(contact),
		note     , text,
	}

end)
