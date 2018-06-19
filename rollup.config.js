import pkg from './package.json';

export default {
    input: 'lib/index.js',
    output: [
        { file: pkg.module, format: 'es' },
    ],
    plugins: [
    ]
}