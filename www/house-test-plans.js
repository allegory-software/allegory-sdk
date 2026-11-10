// sample plans for house_plan(), used by the demos.
window.house_test_plans = {

	simple: {

		floor_h: 250,
		floors: [
			{
				points: [
					[200,  0, 'cl'],
					[200,400, 'cr'],
				],
				lines: [
					['draw','tl',0,0, 'tr',600, 'br',400, 'bl',-600, 'tl',-400],
					['connect','cl','cr'],
				],
			},
		],
	},

	gable1 : {

		floor_h: 250,
		floors: [
			{
				points: [
					[200,  0, 'cl'],
					[200,400, 'cr'],
				],
				lines: [
					['draw','tl',0,0, 'tr',600, 'br',400, 'bl',-600, 'tl',-400],
					['connect','cl','cr'],
				],
				roofs: [
					{type: 'gable', pitch: 45, eaves: 50, axis: 'h', h: 300, box: [-50,-50,650,450]},
				],
			},
		],

	},

}
