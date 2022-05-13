/* create opj_config_private.h for CMake */
#define OPJ_HAVE_INTTYPES_H
#define OPJ_PACKAGE_VERSION ""
#define OPJ_HAVE_FSEEKO

#define OPJ_HAVE_MALLOC_H
#define OPJ_HAVE_ALIGNED_ALLOC

#if !defined(_POSIX_C_SOURCE)
#if defined(OPJ_HAVE_FSEEKO) || defined(OPJ_HAVE_POSIX_MEMALIGN)
/* Get declarations of fseeko, ftello, posix_memalign. */
#define _POSIX_C_SOURCE 200112L
#endif
#endif
