import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import pkg from './package.json' assert { type: 'json' }

export default [
  {
    input: 'index.ts',
    external: Object.keys(pkg.dependencies),
    output: [
      { file: pkg.main, format: 'cjs', sourcemap: true, exports: 'named' },
      { file: pkg.module, format: 'es', sourcemap: true, exports: 'named' },
    ],
    plugins: [
      typescript({
        outputToFilesystem: true,
        exclude: ['bin/**/*', 'tests/**/*'],
      }),
      resolve(),
      commonjs(),
      json(),
    ],
  },
]
