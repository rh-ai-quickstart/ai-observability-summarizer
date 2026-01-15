/* eslint-env node */

import * as path from 'path';
import { Configuration as WebpackConfiguration } from 'webpack';
import { Configuration as WebpackDevServerConfiguration } from 'webpack-dev-server';
import { commonConfig } from './webpack.common';

const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const isProd = process.env.NODE_ENV === 'production';

interface Configuration extends WebpackConfiguration {
  devServer?: WebpackDevServerConfiguration;
}

const config: Configuration = {
  mode: isProd ? 'production' : 'development',
  entry: {
    app: path.resolve(__dirname, '../src/react-ui/index.tsx'),
  },
  context: path.resolve(__dirname, '../src'),
  output: {
    path: path.resolve(__dirname, '../dist/react-ui'),
    filename: isProd ? 'static/js/[name].[contenthash:8].js' : 'static/js/[name].js',
    chunkFilename: isProd ? 'static/js/[name].[contenthash:8].chunk.js' : 'static/js/[name].chunk.js',
    publicPath: '/',
  },
  ...commonConfig,
  devServer: {
    static: './dist/react-ui',
    port: 3000,
    historyApiFallback: true,
    open: true,
    proxy: {
      '/api/mcp': {
        target: 'http://localhost:8085',
        pathRewrite: { '^/api/mcp': '/mcp' },
        changeOrigin: true,
      },
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '../public/index.html'),
      inject: true,
      minify: isProd
        ? {
            removeComments: true,
            collapseWhitespace: true,
            removeRedundantAttributes: true,
            useShortDoctype: true,
            removeEmptyAttributes: true,
            removeStyleLinkTypeAttributes: true,
            keepClosingSlash: true,
            minifyJS: true,
            minifyCSS: true,
            minifyURLs: true,
          }
        : false,
    }),
    new CopyWebpackPlugin({
      patterns: [{ from: path.resolve(__dirname, '../locales'), to: 'locales' }],
    }),
  ],
};

export default config;
