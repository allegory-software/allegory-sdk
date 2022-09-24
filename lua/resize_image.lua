--[[

	Image resizing and format conversion for jpeg and png files.
	Written by Cosmin Apreutesei. Public Domain.

API
	resize_image(src_path, dst_path, max_w, max_h)

]]

if not ... then require'resize_image_test'; return end

require'glue'
require'fs'
require'path'
require'rect'
require'pillow'
require'jpeg'
require'png'

function resize_image(src_path, dst_path, max_w, max_h)

	fcall(function(finally, except)

		local src_ext = path_ext(src_path)
		local dst_ext = path_ext(dst_path)
		assert(src_ext == 'jpg' or src_ext == 'jpeg' or src_ext == 'png')
		assert(dst_ext == 'jpg' or dst_ext == 'jpeg' or dst_ext == 'png')

		--decode.
		local bmp do
			local f = open(src_path)
			finally(function() if f then f:close() end end)

			if src_ext == 'jpg' or src_ext == 'jpeg' then

				local read = f:buffered_reader()
				local img = jpeg_open{read = read}
				finally(function() if img then img:free() end end)

				local w, h = rect_fit(img.w, img.h, max_w, max_h)
				local sn = ceil(clamp(max(w / img.w, h / img.h) * 8, 1, 8))
				bmp = img:load{
					accept = {rgba8 = true},
					scale_num = sn,
					scale_denom = 8,
				}
				--img:free()
				--img = nil

			elseif src_ext == 'png' then

				error'NYI'

			end
			--f:close()
			--f = nil
		end

		--scale down, if necessary.
		local w, h = rect_fit(bmp.w, bmp.h, max_w, max_h)
		if w < bmp.w or h < bmp.h then

			log('note', 'rszimg', 'rszimg', '%s %d,%d -> %d,%d %d%%', path_file(src_path),
				bmp.w, bmp.h, w, h, w / bmp.w * 100)

			local src_img = pillow_image(bmp)
			local dst_img = src_img:resize(w, h)
			src_img:free()
			bmp = dst_img:bitmap()
			finally(function() dst_img:free() end)

		end

		--encode back.

		if dst_ext == 'jpg' or dst_ext == 'jpeg' then

			--we can't use file_saver() here because we can't yield from write().
			local write, collect = dynarray_pump()
			jpeg_save{
				bitmap = bmp,
				write = write,
				quality = 90,
			}
			local buf, sz = collect()
			save(dst_path, buf, sz)

		elseif dst_ext == 'png' then

			error'NYI'

		end

	end)

end
