const webpack = require('webpack');
const ESLintPlugin = require('eslint-webpack-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      console.log('Applying Webpack configuration...');

      // Налаштування полифілів для Node.js модулів
      webpackConfig.resolve.fallback = {
        crypto: require.resolve('crypto-browserify'),
        buffer: require.resolve('buffer/'),
        stream: require.resolve('stream-browserify'),
        path: require.resolve('path-browserify'),
        os: require.resolve('os-browserify/browser'),
        vm: require.resolve('vm-browserify'),
        assert: require.resolve('assert/'),
        process: require.resolve('process/browser'),
        fs: false,
      };

      // Обробка схеми "node:" через alias
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        'node:buffer': require.resolve('buffer/'),
        'node:crypto': require.resolve('crypto-browserify'),
        'node:stream': require.resolve('stream-browserify'),
        'node:path': require.resolve('path-browserify'),
        'node:os': require.resolve('os-browserify/browser'),
        'node:vm': require.resolve('vm-browserify'),
        'node:assert': require.resolve('assert/'),
      };

      // Модифікація правил для source-map-loader
      webpackConfig.module.rules = webpackConfig.module.rules.map(rule => {
        if (rule && rule.loader && rule.loader.includes('source-map-loader')) {
          rule.exclude = [/node_modules\/@signalapp\/libsignal-client/];
          console.log('Updated source-map-loader rule with exclude:', rule.exclude);
        }
        return rule;
      });

      // Додаємо плагіни
      webpackConfig.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
        new ESLintPlugin(),
        new NodePolyfillPlugin({
          excludeAliases: ['fs'],
        }),
        new webpack.NormalModuleReplacementPlugin(/node:buffer/, 'buffer')
      );

      console.log('Webpack configuration applied successfully.');
      return webpackConfig;
    },
  },
  devServer: {
    setupMiddlewares: (middlewares, devServer) => {
      console.log('Dev server middlewares set up.');
      return middlewares;
    },
  },
};