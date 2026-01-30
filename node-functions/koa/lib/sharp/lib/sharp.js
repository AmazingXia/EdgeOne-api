module.exports = require('./sharp-linux-x64.node');

import('https://koa.niumengke.top/img/sharp-linux-x64/lib/sharp-linux-x64.node')
  .then((module) => {
    module.exports = module;
  })
