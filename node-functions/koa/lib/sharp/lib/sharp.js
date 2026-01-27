const { runtimePlatformArch, } = require('./libvips');
const runtimePlatform = runtimePlatformArch();
const path = require('path');
const fs = require('fs');


// 尝试多个可能的路径（从 public 目录加载）
const paths = [
  // 从 public 目录加载（EdgeOne Pages 可能会将 public 目录的内容复制到运行时环境）
  path.join(process.cwd(), 'public/img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node'),
  path.join(process.cwd(), 'img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node'),
  // 相对路径（从 sharp.js 的位置）
  path.join(__dirname, '../../../../public/img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node'),
  path.join(__dirname, '../img/sharp-' + runtimePlatform + '/lib/sharp-' + runtimePlatform + '.node'),
  // 如果当前平台不可用，尝试使用 linux-x64（生产环境）
  ...(runtimePlatform !== 'linux-x64' ? [
    path.join(process.cwd(), 'public/img/sharp-linux-x64/lib/sharp-linux-x64.node'),
    path.join(process.cwd(), 'img/sharp-linux-x64/lib/sharp-linux-x64.node'),
    path.join(__dirname, '../../../../public/img/sharp-linux-x64/lib/sharp-linux-x64.node'),
  ] : []),
];

let sharp;
const errors = [];
for (const filePath of paths) {
  try {
    // 先检查文件是否存在
    if (fs.existsSync(filePath)) {
      console.log('✅ 找到 sharp.node 文件:', filePath);
      sharp = require(filePath);
      break;
    }
  } catch (err) {
    /* istanbul ignore next */
    errors.push({ path: filePath, error: err });
    console.warn('⚠️  加载失败:', filePath, err.message);
  }
}

if (!sharp) {
  throw new Error(`sharp.node not found for platform ${runtimePlatform}. Tried paths: ${paths.join(', ')}. Errors: ${JSON.stringify(errors.map(e => e.error.message))}`);
}

module.exports = sharp;