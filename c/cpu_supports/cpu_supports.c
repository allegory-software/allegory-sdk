
#define CPU_SUPPORTS_SSE   0x0001
#define CPU_SUPPORTS_SSE2  0x0002
#define CPU_SUPPORTS_SSE3  0x0010
#define CPU_SUPPORTS_SSSE3 0x0020
#define CPU_SUPPORTS_SSE41 0x0040
#define CPU_SUPPORTS_SSE42 0x0080
#define CPU_SUPPORTS_AVX   0x0100
#define CPU_SUPPORTS_AVX2  0x0200

int cpu_supports() {
	__builtin_cpu_init();
	return
		(__builtin_cpu_supports("sse"   ) ? CPU_SUPPORTS_SSE    : 0) |
		(__builtin_cpu_supports("sse2"  ) ? CPU_SUPPORTS_SSE2   : 0) |
		(__builtin_cpu_supports("sse3"  ) ? CPU_SUPPORTS_SSE3   : 0) |
		(__builtin_cpu_supports("ssse3" ) ? CPU_SUPPORTS_SSSE3  : 0) |
		(__builtin_cpu_supports("sse4.1") ? CPU_SUPPORTS_SSE41  : 0) |
		(__builtin_cpu_supports("sse4.2") ? CPU_SUPPORTS_SSE42  : 0) |
		(__builtin_cpu_supports("avx"   ) ? CPU_SUPPORTS_AVX    : 0) |
		(__builtin_cpu_supports("avx2"  ) ? CPU_SUPPORTS_AVX2   : 0);
}
