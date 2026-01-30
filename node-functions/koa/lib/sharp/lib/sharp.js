// 使用动态 require 避免 esbuild 在构建时打包 .node 文件
const fs = require('fs');
const path = require('path');
const os = require('os');

let sharpNative = null;
let loadingPromise = null;
let loadingError = null;

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer, { mode: 0o755 });
  return buffer.length;
}

async function loadSharpFromRemote() {
  // 使用字符串拼接隐藏 .node 扩展名，避免 esbuild 识别
  const nodeExt = '.node';
  const tmpDir = os.tmpdir();
  // 创建一个子目录来存放 sharp 相关文件，这样共享库和 .node 文件在同一目录
  const sharpDir = path.join(tmpDir, 'sharp-linux-x64');
  const sharpNodePath = path.join(sharpDir, 'sharp-linux-x64' + nodeExt);
  // 将共享库放到和 .node 文件同一目录，这样动态链接器会自动找到它
  const libvipsPath = path.join(sharpDir, 'libvips-cpp.so.42');

  // 如果已经下载过，直接使用
  if (fs.existsSync(sharpNodePath) && fs.existsSync(libvipsPath)) {
    try {
      // 共享库和 .node 文件在同一目录，动态链接器会自动找到它
      // 使用 Function 构造函数动态执行 require，esbuild 无法静态分析
      const dynamicRequire = new Function('path', 'return require(path)');
      return dynamicRequire(sharpNodePath);
    } catch (err) {
      // 如果临时文件损坏，删除后重新下载
      console.warn('临时文件损坏，重新下载:', err.message);
      try {
        // 删除整个目录
        if (fs.existsSync(sharpDir)) {
          fs.rmSync(sharpDir, { recursive: true, force: true });
        }
      } catch (unlinkErr) {
        // 忽略删除错误
      }
    }
  }

  try {
    // 确保目录存在
    if (!fs.existsSync(sharpDir)) {
      fs.mkdirSync(sharpDir, { recursive: true });
    }

    console.log('📥 从远程下载 sharp 原生模块和 libvips 共享库...');

    // 同时下载 sharp .node 文件和 libvips 共享库
    const [sharpSize, libvipsSize] = await Promise.all([
      downloadFile(
        'https://koa.niumengke.top/img/sharp-linux-x64.node',
        sharpNodePath
      ),
      downloadFile(
        'https://koa.niumengke.top/img/libvips-cpp.so.42',
        libvipsPath
      )
    ]);

    console.log(`✅ sharp 原生模块下载成功: ${sharpNodePath} (${sharpSize} bytes)`);
    console.log(`✅ libvips 共享库下载成功: ${libvipsPath} (${libvipsSize} bytes)`);
    console.log(`📁 文件保存在同一目录: ${sharpDir}`);

    // 共享库和 .node 文件在同一目录，动态链接器会自动找到它
    // 使用 Function 构造函数动态执行 require，esbuild 无法静态分析
    const dynamicRequire = new Function('path', 'return require(path)');
    return dynamicRequire(sharpNodePath);
  } catch (error) {
    throw new Error('从远程加载 sharp 原生模块失败: ' + error.message);
  }
}

// 直接使用远程加载，避免 esbuild 扫描本地 .node 文件
// 立即开始异步下载（不阻塞）
console.log('📥 开始加载 sharp 原生模块（从远程）...');
loadingPromise = loadSharpFromRemote()
  .then(loaded => {
    sharpNative = loaded;
    loadingPromise = null;
    loadingError = null;
    console.log('✅ sharp 模块从远程加载完成');
    return loaded;
  })
  .catch(remoteErr => {
    loadingPromise = null;
    loadingError = remoteErr;
    console.error('❌ 从远程加载失败:', remoteErr.message);
    throw remoteErr;
  });

// 导出一个智能 Proxy，能够同步等待加载完成
// 使用同步轮询机制等待异步加载完成（最多等待 30 秒，因为需要下载两个大文件）
function waitForSharpSync(maxWaitMs = 30000) {
  const startTime = Date.now();
  const checkInterval = 50; // 每 50ms 检查一次

  while (!sharpNative && loadingPromise && (Date.now() - startTime) < maxWaitMs) {
    // 使用同步方式等待（阻塞事件循环）
    // 注意：这不是最佳实践，但为了兼容同步 require，这是必要的
    const end = Date.now() + checkInterval;
    while (Date.now() < end) {
      // busy wait，但限制时间避免无限阻塞
      if (sharpNative) {
        return sharpNative;
      }
    }
  }
  return sharpNative;
}

module.exports = new Proxy({}, {
  get(target, prop) {
    // 如果已经加载完成，直接返回
    if (sharpNative) {
      const value = sharpNative[prop];
      // 如果是函数，需要绑定 this
      if (typeof value === 'function') {
        return value.bind(sharpNative);
      }
      return value;
    }

    // 如果正在加载，尝试同步等待
    if (loadingPromise) {
      const waited = waitForSharpSync();
      if (waited) {
        const value = waited[prop];
        if (typeof value === 'function') {
          return value.bind(waited);
        }
        return value;
      }
      // 如果等待超时，检查是否有错误
      if (loadingError) {
        throw new Error('sharp 模块加载失败: ' + loadingError.message);
      }
      throw new Error('sharp 模块正在从远程加载中，请稍候重试（最多等待 30 秒）...');
    }

    // 如果加载失败，抛出错误
    if (loadingError) {
      throw new Error('sharp 模块加载失败: ' + loadingError.message);
    }

    throw new Error('sharp 模块加载失败，请检查网络连接');
  }
});
