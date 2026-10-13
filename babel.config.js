/**
 * Only jest uses this: the published package is built by `bob` (commonjs, esm and
 * .d.ts), and a consuming app compiles `src` with its own Metro/Babel setup. The
 * RN preset is still the right one here — it is what strips the TypeScript and
 * transforms the flow-typed `react-native` internals that `jest/setup.js` pulls
 * in, which plain `@babel/preset-typescript` cannot parse.
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
