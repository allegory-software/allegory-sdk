
#include "Python.h"
#include "Imaging.h"

void
ImagingSectionEnter(ImagingSectionCookie *cookie) {};
void
ImagingSectionLeave(ImagingSectionCookie *cookie) {};

void *
ImagingError_MemoryError(void) {};
void *
ImagingError_ModeError(void) {};
void *
ImagingError_ValueError(const char *message) {};
void *
ImagingError_Mismatch(void) {};

void
ImagingError_Clear(void) {};
