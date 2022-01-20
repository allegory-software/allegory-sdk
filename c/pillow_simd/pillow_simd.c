
#include "Imaging.h"

#define INT64_MAX 9223372036854775807LL

Imaging pillow_image_create_for_data(char *data, char* mode,
	int w, int h, int stride, int bottom_up
) {
	if (h > INT64_MAX / stride)
			return NULL;
	Imaging im = ImagingNewPrologueSubtype(mode, w, h, sizeof(struct ImagingMemoryInstance));
	if (!im)
		return NULL;
	/* setup file pointers */
	if (bottom_up)
		for (int y = 0; y < h; y++)
			im->image[h - y - 1] = data + y * stride;
	else
		for (int y = 0; y < h; y++)
			im->image[y] = data + y * stride;
	return im;
}

void pillow_image_free(Imaging im) {
	ImagingDelete(im);
}

int    pillow_image_width  (Imaging im) { return im->xsize; }
int    pillow_image_height (Imaging im) { return im->ysize; }
char*  pillow_image_mode   (Imaging im) { return im->mode; }
char** pillow_image_rows   (Imaging im) { return im->image; }

Imaging pillow_resample(Imaging im, int w, int h, int filter) {
	float box[4] = {0, 0, w, h};
	return ImagingResample(im, w, h, filter, box);
}
