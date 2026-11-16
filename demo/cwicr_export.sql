-- export the CWICR items that `import-cwicr` reads, one json line per item.
-- run against the OpenConstructionERP postgres:
--   psql -At -h ~/.openestimate/pgdata -U postgres -d postgres \
--      -f demo/cwicr_export.sql > /tmp/cwicr.jsonl

select jsonb_build_object(
	'code', i.code,
	'name', i.description,
	'unit', coalesce(i.unit, ''),
	'currency', i.currency,
	'cls', i.classification,
	'comps', (
		select jsonb_agg(jsonb_build_object(
			'code', coalesce(c->>'code', ''),
			'name', coalesce(c->>'name', ''),
			'type', c->>'type',
			'unit', coalesce(c->>'unit', ''),
			'rate', c->>'unit_rate',
			'qty', c->>'quantity'
		))
		from jsonb_array_elements(i.components) c
	)
)
from oe_costs_item i
where i.source = 'cwicr'
and i.classification->>'collection' in (
	'Clădiri și instalații temporare, demontabile',
	'Lucrări de terasament',
	'Lucrări de fundație, gropi de fundație, consolidarea solului',
	'Fundații',
	'Construcții monolitice din beton și beton armat',
	'Construcții din beton și beton armat, prefabricate',
	'Construcții din cărămizi și blocuri',
	'Construcții metalice pentru construcție',
	'Construcții din lemn',
	'Acoperișuri',
	'Acoperișuri, construcții de acoperișuri',
	'Pereți',
	'Deschideri',
	'Lucrări de izolație termică',
	'Plafon',
	'Pardoseli',
	'Lucrări de finisare',
	'Lucrări de tencuială',
	'Lucrări de tencuire',
	'Lucrări de vopsire',
	'Lucrări de sticlărie, tapetare și îmbrăcare',
	'Țevi interioare',
	'Lucrări de tehnică sanitară și de construcții interioare',
	'Încălzire – Finisaje interioare',
	'Conductă de apă și canalizare – Dotări interioare',
	'Alimentare cu gaz – amenajare interioară',
	'Lucrări de instalații electrice',
	'Ventilație și climatizare',
	'Instalații de comunicații, radiodifuziune și televiziune',
	'Alimentare cu apă – conducte exterioare',
	'Canalizare – Conducte exterioare',
	'Furnizarea de căldură și conducte de gaz – conducte exterioare',
	'Amenajarea peisajului',
	'Lucrări la reabilitarea clădirilor și construcțiilor',
	'Instalații exterioare'
)
order by i.code;
