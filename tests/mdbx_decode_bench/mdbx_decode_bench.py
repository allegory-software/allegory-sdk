import os
import pathlib
import subprocess
import tempfile
import sys

root = pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='sdk-decode-bench-') as directory:
	lib = pathlib.Path(directory) / 'libmdbx_decode_bench.so'
	subprocess.run([
		'gcc', '-shared', '-O2', '-fPIC', '-fno-strict-aliasing',
		'-Wall', '-Winline', '-Ic/mdbx/src', 'tests/mdbx_decode_bench.c',
		'-Lbin', '-lmdbx', '-o', str(lib),
	], cwd=root, check=True)
	env = dict(os.environ)
	env['LD_LIBRARY_PATH'] = ':'.join([
		directory, str(root / 'bin'), env.get('LD_LIBRARY_PATH', ''),
	])
	if '--gzip' in sys.argv:
		command = ['node', 'tests/rowset_format_bench.mjs', '--batch']
	else:
		command = [str(root / 'bin/luajit'), '-joff', '-lscite',
			'tests/rowset_format_bench.lua', directory, 'batch']
	subprocess.run(command, cwd=root, env=env, check=True)
