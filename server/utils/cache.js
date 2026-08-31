/**
 * 琢言 · 缓存服务
 */

const NodeCache = require('node-cache');
const config = require('../config');

const cache = new NodeCache({
  stdTTL: config.cacheTTL,
  checkperiod: Math.floor(config.cacheTTL * 0.2),
  useClones: false
});

cache.on('set', (key, value) => {
  if (config.nodeEnv !== 'production') {
    // debug: cache hit
  }
});

cache.on('expired', (key) => {
  if (config.nodeEnv !== 'production') {
    // debug: cache expired
  }
});

module.exports = cache;
