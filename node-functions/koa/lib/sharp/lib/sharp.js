// 使用动态 require 避免 esbuild 在构建时打包 .node 文件
const fs = require('fs');
const path = require('path');
const os = require('os');

let sharpNative = null;
let loadingPromise = null;

async function loadSharpFromRemote() {
  const tmpPath = path.join(os.tmpdir(), 'sharp-linux-x64.node');

  // 如果已经下载过，直接使用
  if (fs.existsSync(tmpPath)) {
    try {
      return require(tmpPath);
    } catch (err) {
      // 如果临时文件损坏，删除后重新下载
      console.warn('临时文件损坏，重新下载:', err.message);
      try {
        fs.unlinkSync(tmpPath);
      } catch (unlinkErr) {
        // 忽略删除错误
      }
    }
  }

  try {
    console.log('📥 从远程下载 sharp 原生模块: https://koa.niumengke.top/img/sharp-linux-x64/lib/sharp-linux-x64.node');
    const remoteUrl = 'https://koa.niumengke.top/img/sharp-linux-x64/lib/sharp-linux-x64.node';
    const response = await fetch(remoteUrl);

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 确保临时目录存在
    const tmpDir = os.tmpdir();
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // 保存到临时目录
    fs.writeFileSync(tmpPath, buffer, { mode: 0o755 }); // 设置可执行权限

    console.log('✅ sharp 原生模块下载成功:', tmpPath);

    return require(tmpPath);
  } catch (error) {
    throw new Error('从远程加载 sharp 原生模块失败: ' + error.message);
  }
}

// 首先尝试从本地加载
try {
  sharpNative = require('./sharp-linux-x64.node');
  module.exports = sharpNative;
} catch (err) {
  // 如果都失败，尝试从远程加载（异步）
  console.warn('⚠️  本地加载失败，尝试从远程加载...');
  console.warn('  本地路径1失败:', err.message);

  // 立即开始异步下载（不阻塞）
  loadingPromise = loadSharpFromRemote()
    .then(loaded => {
      sharpNative = loaded;
      loadingPromise = null;
      console.log('✅ sharp 模块从远程加载完成');
      return loaded;
    })
    .catch(remoteErr => {
      loadingPromise = null;
      console.error('❌ 从远程加载失败:', remoteErr.message);
      throw remoteErr;
    });

  // 导出一个会抛出错误的占位符
  // 注意：这会导致第一次 require 时抛出错误
  // 调用者需要处理这个错误，或者等待异步加载完成
  module.exports = new Proxy({}, {
    get(target, prop) {
      if (sharpNative) {
        return sharpNative[prop];
      }
      if (loadingPromise) {
        throw new Error('sharp 模块正在从远程加载中，请稍候重试...');
      }
      throw new Error('sharp 模块加载失败，请检查网络连接或本地文件');
    }
  });
}
