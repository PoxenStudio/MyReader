import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cwd } from 'node:process'
import typescript from '@rollup/plugin-typescript'

const pkg = JSON.parse(readFileSync(join(cwd(), 'package.json'), 'utf8'))

// Get export paths from the "." export
const exports = pkg.exports['.'] || pkg.exports

const config = {
  input: 'guest-js/index.ts',
  output: [
    {
      file: exports.import,
      format: 'esm'
    },
    {
      file: exports.require,
      format: 'cjs'
    }
  ],
  plugins: [
    typescript({
      declaration: true,
      declarationDir: dirname(exports.import)
    })
  ],
  external: [
    /^@tauri-apps\/api/,
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
  ]
}

export default config
