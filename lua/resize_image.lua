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
			local f = assert(open(src_path, 'r'), 'not_found')
			finally(function() f:close() end)

			if src_ext == 'jpg' or src_ext == 'jpeg' then

				local read = f:buffered_read()
				local img = assert(jpeg_open{read = read})
				finally(function() img:free() end)

				local w, h = rect_fit(img.w, img.h, max_w, max_h)
				local sn = ceil(clamp(max(w / img.w, h / img.h) * 8, 1, 8))
				bmp = assert(img:load{
					accept = {rgba8 = true},
					scale_num = sn,
					scale_denom = 8,
				})

			elseif src_ext == 'png' then

				error'NYI'

			end
		end

		--scale down, if necessary.
		local w, h = rect_fit(bmp.w, bmp.h, max_w, max_h)
		if w < bmp.w or h < bmp.h then

			log('note', 'reszimg', '%s %d,%d -> %d,%d %d%%', path_file(src_path),
				bmp.w, bmp.h, w, h, w / bmp.w * 100)

			local src_img = pillow_image(bmp)
			local dst_img = src_img:resize(w, h)
			src_img:free()
			bmp = dst_img:bitmap()
			finally(function() dst_img:free() end)

		end

		--encode back.
		local write_protected = assert(file_saver(dst_path))
		except(function() write_protected(ABORT) end)
		local function write(buf, sz)
			return assert(write_protected(buf, sz))
		end
		if dst_ext == 'jpg' or dst_ext == 'jpeg' then

			assert(jpeg_save{
				bitmap = bmp,
				write = write,
				quality = 90,
			})

		elseif dst_ext == 'png' then

			error'NYI'

		end
		write()

	end)

end
