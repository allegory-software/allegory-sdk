require'imtui'

local demos = {
	'flexbox',
	'box',
	'scrollbox',
	'scrollstack',
	'text',
	'popup',
	'frame',
}

function ui.main()
	ui.box()
		ui.h(1)
			ui.scrollstack('demos_sb', 0, 'contain', 'scroll')
				ui.list('demos', demos)
			ui.end_scrollstack()
			ui.line()
			--ui.line_style'dashed'
			--ui.corner_style'round'
			ui.v(1)
				ui.h()
				ui.hsplit('hs1')
					ui.box()
						ui.text_lines('', 'Hello, world 1!\nThis is a new line.', 0, 'c', 'c')
					ui.end_box()
					ui.splitter() --'v', 'sbv1', false, 1)
					ui.box()
						ui.text_lines('', 'Hello, world 2!\nThis is a new line.', 0, 'c', 'c')
					ui.end_box()
				ui.end_h()
				ui.end_hsplit()
				ui.h(2)
					ui.stack('', .5)
						ui.scrollbox('sb1', 'Goodbye!', 1, 'auto', 'auto')
							ui.stack('', 0, 'l', 't', 120, 50)
								ui.text('', 'Goodbye, cruel world!', 0, 'c', 'c') --, nil, 100, 100)
							ui.end_stack()
						ui.end_scrollbox()
					ui.end_stack()
					ui.box()
					--ui.scrollbox('st1')
						if 1==1 then
						ui.text_wrapped('t1', [[
		Lorem ipsum is a dummy or placeholder text commonly used in graphic design, publishing, and web development. Its purpose is to permit a page layout to be designed, independently of the copy that will subsequently populate it, or to demonstrate various fonts of a typeface without meaningful text that could be distracting.

		Lorem ipsum is typically a corrupted version of De finibus bonorum et malorum, a 1st-century BC text by the Roman statesman and philosopher Cicero, with words altered, added, and removed to make it nonsensical and improper Latin. The first two words themselves are a truncation of dolorem ipsum ("pain itself").
		]], 0, 'c', 'c')
						end
					ui.end_box()
					--ui.end_scrollbox()
				ui.end_h()
			ui.end_v()
			--ui.end_corner_style()
			--ui.end_line_style()
		ui.end_h()
	ui.end_box()
end

ui.start()
