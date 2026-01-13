#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import https from 'https';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';

// Windows 下设置控制台代码页为 UTF-8，解决中文乱码
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // 忽略错误
  }
}

// 检查命令是否存在
function checkCommand(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync, appendFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 配置
const config = {
  rootDir: __dirname,
  webDir: join(__dirname, 'web'),
  outputDir: join(__dirname, '_output'),
  binaryName: process.platform === 'win32' ? 'one-hub.exe' : 'one-hub',
  versionPkg: 'one-api/common/config',
};

// 国内镜像配置
const mirrors = {
  // npm 镜像
  npm: 'https://registry.npmmirror.com',
  // Go 代理 (多个备用)
  goproxy: 'https://goproxy.cn,https://goproxy.io,direct',
  gosumdb: 'sum.golang.google.cn',
  // Node.js 二进制镜像 (用于 node-gyp 等)
  nodeMirror: 'https://npmmirror.com/mirrors/node/',
  // Electron 镜像 (如果需要)
  electronMirror: 'https://npmmirror.com/mirrors/electron/',
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.cyan}${colors.bright}=== ${msg} ===${colors.reset}\n`),
};

// 进度条类
class ProgressBar {
  constructor(options = {}) {
    this.total = options.total || 100;
    this.current = 0;
    this.barLength = options.barLength || 40;
    this.status = options.status || '';
    this.startTime = Date.now();
  }

  update(current, status = '') {
    this.current = current;
    if (status) this.status = status;
    this.render();
  }

  increment(status = '') {
    this.current++;
    if (status) this.status = status;
    this.render();
  }

  render() {
    const percent = Math.min(100, Math.floor((this.current / this.total) * 100));
    const filledLength = Math.floor((percent / 100) * this.barLength);
    const emptyLength = this.barLength - filledLength;

    const filled = colors.green + '█'.repeat(filledLength) + colors.reset;
    const empty = colors.reset + '░'.repeat(emptyLength);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

    const statusText = this.status.length > 30 ? this.status.slice(0, 27) + '...' : this.status.padEnd(30);

    process.stdout.write(`\r  ${filled}${empty} ${percent.toString().padStart(3)}% | ${elapsed}s | ${statusText}`);
  }

  complete(message = '完成') {
    this.current = this.total;
    this.status = message;
    this.render();
    console.log(); // 换行
  }

  clear() {
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
  }
}

// 带进度的命令执行
function execWithProgress(cmd, options = {}) {
  return new Promise((resolve) => {
    const defaultOptions = {
      cwd: config.rootDir,
      shell: true,
      env: { ...process.env },
    };

    const child = spawn(cmd, [], {
      ...defaultOptions,
      ...options,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    const progress = new ProgressBar({ total: 100, status: '准备中...' });
    let progressValue = 0;
    let lastStatus = '';

    // 解析 npm 输出更新进度
    const parseOutput = (data) => {
      const text = data.toString();
      const lines = text.split('\n').filter(Boolean);

      for (const line of lines) {
        // 解析 npm 进度信息
        if (line.includes('reify:')) {
          const match = line.match(/reify:([^:]+)/);
          if (match) {
            lastStatus = match[1].trim().slice(0, 25);
          }
          progressValue = Math.min(95, progressValue + 0.5);
        } else if (line.includes('timing')) {
          progressValue = Math.min(95, progressValue + 0.3);
        } else if (line.includes('added') || line.includes('packages')) {
          progressValue = 98;
          lastStatus = '完成安装';
        } else if (line.includes('npm warn') || line.includes('npm WARN')) {
          // 忽略警告
        } else if (line.includes('idealTree') || line.includes('buildIdeal')) {
          lastStatus = '解析依赖树...';
          progressValue = Math.min(30, progressValue + 2);
        } else if (line.includes('diffTrees')) {
          lastStatus = '计算差异...';
          progressValue = Math.min(40, progressValue + 1);
        } else if (line.includes('fetch')) {
          lastStatus = '下载包...';
          progressValue = Math.min(80, progressValue + 0.2);
        }
      }

      progress.update(progressValue, lastStatus);
    };

    child.stdout?.on('data', parseOutput);
    child.stderr?.on('data', parseOutput);

    // 模拟进度更新（当没有输出时）
    const interval = setInterval(() => {
      if (progressValue < 95) {
        progressValue += 0.1;
        progress.update(progressValue, lastStatus || '安装中...');
      }
    }, 200);

    child.on('close', (code) => {
      clearInterval(interval);
      if (code === 0) {
        progress.complete('安装完成');
        resolve(true);
      } else {
        progress.clear();
        log.error('安装失败');
        resolve(false);
      }
    });

    child.on('error', (err) => {
      clearInterval(interval);
      progress.clear();
      log.error(`执行失败: ${err.message}`);
      resolve(false);
    });
  });
}

// 设置国内镜像环境变量
function setupMirrorEnv() {
  // Go 镜像
  process.env.GOPROXY = mirrors.goproxy;
  process.env.GOSUMDB = mirrors.gosumdb;

  // Node 镜像
  process.env.npm_config_registry = mirrors.npm;
  process.env.NODEJS_ORG_MIRROR = mirrors.nodeMirror;
  process.env.ELECTRON_MIRROR = mirrors.electronMirror;

  // 禁用 npm 审计 (加速安装)
  process.env.npm_config_audit = 'false';
  process.env.npm_config_fund = 'false';

  log.info(`已配置国内镜像:`);
  log.info(`  npm: ${mirrors.npm}`);
  log.info(`  Go:  ${mirrors.goproxy}`);
}

// 执行命令
function exec(cmd, options = {}) {
  const defaultOptions = {
    cwd: config.rootDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
  };
  try {
    execSync(cmd, { ...defaultOptions, ...options });
    return true;
  } catch (error) {
    log.error(`命令执行失败: ${cmd}`);
    return false;
  }
}

// 获取 Git 信息
function getGitInfo() {
  try {
    let version = 'dev';
    let commit = 'unknown';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    try {
      version = execSync('git describe --tags', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      version = 'dev';
    }

    try {
      commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      commit = 'unknown';
    }

    return { version, commit, date };
  } catch {
    return { version: 'dev', commit: 'unknown', date: new Date().toISOString().slice(0, 10).replace(/-/g, '') };
  }
}

// 配置 npm 使用国内镜像
function setupNpmMirror() {
  log.info('配置 npm 国内镜像...');

  // 创建 .npmrc 文件
  const npmrcPath = join(config.webDir, '.npmrc');
  const npmrcContent = `registry=${mirrors.npm}
disturl=${mirrors.nodeMirror}
sass_binary_site=https://npmmirror.com/mirrors/node-sass/
phantomjs_cdnurl=https://npmmirror.com/mirrors/phantomjs/
electron_mirror=${mirrors.electronMirror}
chromedriver_cdnurl=https://npmmirror.com/mirrors/chromedriver/
operadriver_cdnurl=https://npmmirror.com/mirrors/operadriver/
selenium_cdnurl=https://npmmirror.com/mirrors/selenium/
node_inspector_cdnurl=https://npmmirror.com/mirrors/node-inspector/
fsevents_binary_host_mirror=https://npmmirror.com/mirrors/fsevents/
`;

  writeFileSync(npmrcPath, npmrcContent);
  log.success('已创建 web/.npmrc');
}

// 构建前端
async function buildWeb() {
  log.title('构建前端');

  if (!existsSync(config.webDir)) {
    log.error('web 目录不存在');
    return false;
  }

  const { version } = getGitInfo();

  // 配置 npm 镜像
  setupNpmMirror();

  // 检查 node_modules
  const nodeModulesPath = join(config.webDir, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    log.info('安装前端依赖 (使用国内镜像)...');

    // 使用 --legacy-peer-deps 解决依赖冲突
    // 使用 --registry 确保使用国内镜像
    // 使用 --timing 获取更多进度信息
    const installCmd = `npm install --legacy-peer-deps --registry=${mirrors.npm} --timing`;

    const success = await execWithProgress(installCmd, { cwd: config.webDir });

    if (!success) {
      log.warn('尝试使用 --force 重新安装...');
      const forceSuccess = await execWithProgress(
        `npm install --force --registry=${mirrors.npm} --timing`,
        { cwd: config.webDir }
      );
      if (!forceSuccess) {
        return false;
      }
    }
  } else {
    log.info('node_modules 已存在，跳过安装');
  }

  log.info('构建前端资源...');
  const buildEnv = {
    ...process.env,
    DISABLE_ESLINT_PLUGIN: 'true',
    VITE_APP_VERSION: version,
  };

  const buildResult = exec('npm run build', { cwd: config.webDir, env: buildEnv });

  if (buildResult) {
    const buildDir = join(config.webDir, 'build');
    console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset);
    log.success('前端构建完成！');
    console.log(`\n  构建产物: ${colors.green}${buildDir}${colors.reset}`);
    console.log(`  版本: ${colors.cyan}${version}${colors.reset}`);
    console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset + '\n');
  }

  return buildResult;
}

// 带进度的 Go 构建
function execGoWithProgress(cmd, options = {}) {
  return new Promise((resolve) => {
    const defaultOptions = {
      cwd: config.rootDir,
      shell: true,
      env: { ...process.env },
    };

    const child = spawn(cmd, [], {
      ...defaultOptions,
      ...options,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    const progress = new ProgressBar({ total: 100, status: '准备中...' });
    let progressValue = 0;
    let lastStatus = '';
    let outputBuffer = '';

    const parseOutput = (data) => {
      const text = data.toString();
      outputBuffer += text;

      // Go mod tidy 进度
      if (text.includes('go: downloading')) {
        const match = text.match(/go: downloading ([^\s]+)/);
        if (match) {
          lastStatus = match[1].split('/').pop()?.slice(0, 25) || '下载模块...';
        }
        progressValue = Math.min(90, progressValue + 2);
      } else if (text.includes('go: finding')) {
        lastStatus = '解析模块...';
        progressValue = Math.min(30, progressValue + 5);
      }

      progress.update(progressValue, lastStatus || '处理中...');
    };

    child.stdout?.on('data', parseOutput);
    child.stderr?.on('data', parseOutput);

    const interval = setInterval(() => {
      if (progressValue < 95) {
        progressValue += 0.2;
        progress.update(progressValue, lastStatus || '编译中...');
      }
    }, 300);

    child.on('close', (code) => {
      clearInterval(interval);
      if (code === 0) {
        progress.complete('完成');
        resolve(true);
      } else {
        progress.clear();
        // 输出错误信息
        if (outputBuffer) {
          console.log(outputBuffer);
        }
        resolve(false);
      }
    });

    child.on('error', (err) => {
      clearInterval(interval);
      progress.clear();
      log.error(`执行失败: ${err.message}`);
      resolve(false);
    });
  });
}

// 下载文件（带进度条）
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        log.info(`重定向到: ${redirectUrl}`);
        resolve(downloadFile(redirectUrl, destPath));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，状态码: ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      const progress = new ProgressBar({
        total: 100,
        status: '下载中...',
        barLength: 40
      });

      const fileStream = createWriteStream(destPath);

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          const mbDownloaded = (downloadedBytes / 1024 / 1024).toFixed(1);
          const mbTotal = (totalBytes / 1024 / 1024).toFixed(1);
          progress.update(percent, `${mbDownloaded}MB / ${mbTotal}MB`);
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        progress.complete('下载完成');
        resolve(true);
      });

      fileStream.on('error', (err) => {
        fileStream.close();
        progress.clear();
        reject(err);
      });

      response.on('error', (err) => {
        fileStream.close();
        progress.clear();
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 在 Linux 上自动安装 Go
async function installGoOnLinux() {
  log.title('自动安装 Go 环境');

  const goVersion = '1.25.4';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const fileName = `go${goVersion}.linux-${arch}.tar.gz`;
  const downloadUrl = `https://mirrors.nju.edu.cn/golang/${fileName}`;
  const tempDir = '/tmp';
  const downloadPath = join(tempDir, fileName);

  log.info(`Go 版本: ${goVersion}`);
  log.info(`系统架构: ${arch}`);
  log.info(`下载地址: ${downloadUrl}`);

  try {
    // 1. 下载 Go
    log.info('正在下载 Go...');
    await downloadFile(downloadUrl, downloadPath);

    // 2. 检查是否有 sudo 权限
    let installPath = '/usr/local';
    let useSudo = false;
    let useUserDir = false;

    try {
      // 尝试检查 /usr/local 是否可写
      execSync('test -w /usr/local', { stdio: 'ignore' });
      log.info('检测到 /usr/local 可写');
    } catch {
      // 检查是否有 sudo
      if (checkCommand('sudo')) {
        log.warn('/usr/local 不可写，将使用 sudo 权限安装');
        useSudo = true;
      } else {
        log.warn('没有 sudo 权限，将安装到用户目录');
        installPath = join(process.env.HOME || '~', '.local');
        useUserDir = true;
      }
    }

    const goRoot = join(installPath, 'go');

    // 3. 删除旧的 Go 安装（如果存在）
    if (existsSync(goRoot)) {
      log.info('删除旧的 Go 安装...');
      if (useSudo) {
        exec(`sudo rm -rf "${goRoot}"`);
      } else {
        rmSync(goRoot, { recursive: true, force: true });
      }
    }

    // 4. 确保安装目录存在
    if (useUserDir && !existsSync(installPath)) {
      mkdirSync(installPath, { recursive: true });
    }

    // 5. 解压 Go
    log.info(`解压到 ${goRoot}...`);
    const extractCmd = useSudo
      ? `sudo tar -C "${installPath}" -xzf "${downloadPath}"`
      : `tar -C "${installPath}" -xzf "${downloadPath}"`;

    exec(extractCmd);

    // 6. 清理下载文件
    if (existsSync(downloadPath)) {
      rmSync(downloadPath);
    }

    // 7. 设置环境变量
    const goBinPath = join(goRoot, 'bin');
    const goPath = join(process.env.HOME || '~', 'go');

    // 临时设置环境变量（仅当前进程）
    process.env.GOROOT = goRoot;
    process.env.GOPATH = goPath;
    process.env.PATH = `${goBinPath}:${process.env.PATH}`;
    process.env.GOPROXY = mirrors.goproxy;
    process.env.GOSUMDB = mirrors.gosumdb;

    log.success(`Go ${goVersion} 安装成功!`);
    log.info(`安装位置: ${goRoot}`);

    // 8. 自动配置 shell 环境变量
    log.info('正在配置 shell 环境变量...');

    // 检测 shell 类型
    const shellPath = process.env.SHELL || '';
    let shellConfigFile = '';

    if (shellPath.includes('zsh')) {
      shellConfigFile = join(process.env.HOME || '~', '.zshrc');
    } else if (shellPath.includes('bash')) {
      shellConfigFile = join(process.env.HOME || '~', '.bashrc');
    } else {
      // 默认使用 .bashrc
      shellConfigFile = join(process.env.HOME || '~', '.bashrc');
    }

    const envConfig = `
# Go 环境配置 (由 one-hub build.mjs 自动添加)
export GOROOT="${goRoot}"
export GOPATH="${goPath}"
export PATH="${goBinPath}:$PATH"
export GOPROXY="${mirrors.goproxy}"
export GOSUMDB="${mirrors.gosumdb}"
`;

    try {
      // 检查配置文件是否已经包含 GOROOT 配置
      let needsUpdate = true;
      if (existsSync(shellConfigFile)) {
        const content = readFileSync(shellConfigFile, 'utf-8');
        if (content.includes('export GOROOT=') && content.includes(goRoot)) {
          log.info(`${shellConfigFile} 已包含 Go 环境配置，跳过`);
          needsUpdate = false;
        }
      }

      if (needsUpdate) {
        appendFileSync(shellConfigFile, envConfig);
        log.success(`已将 Go 环境配置写入: ${shellConfigFile}`);

        const shellName = shellPath.includes('zsh') ? 'zsh' : 'bash';
        log.warn(`\n请运行以下命令使配置立即生效:`);
        console.log(`${colors.green}source ${shellConfigFile}${colors.reset}\n`);
        log.info(`或重新打开终端，配置会自动生效。`);
      }
    } catch (error) {
      log.warn(`自动配置失败: ${error.message}`);
      log.warn('请手动将以下内容添加到你的 shell 配置文件中:');
      console.log(`${colors.green}${envConfig}${colors.reset}`);
    }

    log.info('\n当前构建会话已自动配置这些环境变量，可以继续构建。');

    // 验证安装
    if (checkCommand('go')) {
      const goVersionOutput = execSync('go version', { encoding: 'utf-8' }).trim();
      log.success(`验证成功: ${goVersionOutput}`);
      return true;
    } else {
      log.error('安装后无法找到 go 命令');
      return false;
    }

  } catch (error) {
    log.error(`安装失败: ${error.message}`);

    // 清理下载文件
    if (existsSync(downloadPath)) {
      try {
        rmSync(downloadPath);
      } catch {
        // 忽略清理错误
      }
    }

    return false;
  }
}

// 构建后端
async function buildBackend(targetOS = process.platform, targetArch = process.arch) {
  log.title('构建后端');

  // 检查 Go 是否安装
  if (!checkCommand('go')) {
    log.error('未检测到 Go 环境');

    // 如果是 Linux 系统，尝试自动安装
    if (process.platform === 'linux') {
      log.info('检测到 Linux 系统，将尝试自动安装 Go...');
      const installed = await installGoOnLinux();

      if (!installed) {
        log.error('自动安装失败，请手动安装 Go');
        log.info('推荐版本: Go 1.25.4 或更高版本');
        log.info('国内下载地址: https://golang.google.cn/dl/');
        log.info('或使用镜像: https://mirrors.nju.edu.cn/golang/');
        return false;
      }

      // 安装成功，继续构建
      log.success('Go 环境已就绪，继续构建...');
    } else {
      // 非 Linux 系统，提示手动安装
      log.info('推荐版本: Go 1.25.4 或更高版本');
      const dlFile = process.platform === 'win32' ? 'go1.25.4.windows-amd64.msi'
        : process.platform === 'darwin' ? 'go1.25.4.darwin-amd64.pkg'
        : 'go1.25.4.linux-amd64.tar.gz';
      log.info(`推荐下载: ${dlFile}`);
      log.info('国内下载地址: https://golang.google.cn/dl/');
      log.info('或使用镜像: https://mirrors.nju.edu.cn/golang/');
      return false;
    }
  }

  const { version, commit, date } = getGitInfo();

  // 映射平台名称
  const osMap = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
  const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386' };

  const goos = osMap[targetOS] || targetOS;
  const goarch = archMap[targetArch] || targetArch;

  // 确保输出目录存在
  if (!existsSync(config.outputDir)) {
    mkdirSync(config.outputDir, { recursive: true });
  }

  // 构建二进制文件名
  let binaryPath = join(config.outputDir, config.binaryName);
  if (goos === 'windows' && !binaryPath.endsWith('.exe')) {
    binaryPath += '.exe';
  } else if (goos !== 'windows') {
    binaryPath = binaryPath.replace('.exe', '');
  }

  log.info(`目标平台: ${goos}/${goarch}`);
  log.info(`版本: ${version}, 提交: ${commit}, 日期: ${date}`);
  log.info(`Go 代理: ${mirrors.goproxy}`);

  // 更新 Go 依赖 (使用国内代理)
  log.info('更新 Go 依赖 (使用国内镜像)...');
  const goEnv = {
    ...process.env,
    GOPROXY: mirrors.goproxy,
    GOSUMDB: mirrors.gosumdb,
    GOTOOLCHAIN: 'auto',
  };
  if (!(await execGoWithProgress('go mod tidy', { env: goEnv }))) {
    log.error('Go 依赖更新失败');
    return false;
  }

  // 构建命令
  const ldflags = [
    '-w', '-s',
    `-X '${config.versionPkg}.Version=${version}'`,
    `-X '${config.versionPkg}.BuildTime=${date}'`,
    `-X '${config.versionPkg}.Commit=${commit}'`,
  ].join(' ');

  const buildEnv = {
    ...goEnv,
    GOOS: goos,
    GOARCH: goarch,
    CGO_ENABLED: '0',
  };
  const buildCmd = `go build -o "${binaryPath}" -ldflags "${ldflags}"`;

  log.info('编译后端...');
  if (!(await execGoWithProgress(buildCmd, { env: buildEnv }))) {
    log.error('Go 编译失败');
    return false;
  }

  log.success(`构建完成: ${binaryPath}`);

  // 打印启动命令
  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset);
  log.success('后端构建完成！');

  // 检查配置文件
  const hasConfig = checkAndPromptConfig();

  if (hasConfig) {
    console.log('\n' + colors.yellow + '启动命令:' + colors.reset);

    // 获取绝对路径
    const absolutePath = join(config.rootDir, binaryPath);

    if (goos === 'windows') {
      console.log(`  ${colors.green}${absolutePath}${colors.reset}`);
      console.log(`\n  或在项目根目录下运行:`);
      console.log(`  ${colors.green}${binaryPath}${colors.reset}`);
    } else {
      console.log(`  ${colors.green}${absolutePath}${colors.reset}`);
      console.log(`\n  或在项目根目录下运行:`);
      console.log(`  ${colors.green}./${binaryPath}${colors.reset}`);
    }

    console.log('\n' + colors.yellow + '常用启动参数:' + colors.reset);
    console.log(`  ${colors.cyan}--port PORT${colors.reset}           指定监听端口 (默认: 3000)`);
    console.log(`  ${colors.cyan}--log-dir PATH${colors.reset}        指定日志目录`);
    console.log(`  ${colors.cyan}--data-source PATH${colors.reset}    指定数据库文件路径`);

    console.log('\n' + colors.yellow + '示例:' + colors.reset);
    if (goos === 'windows') {
      console.log(`  ${colors.green}${binaryPath} --port 8080${colors.reset}`);
    } else {
      console.log(`  ${colors.green}./${binaryPath} --port 8080${colors.reset}`);
    }
  }

  console.log('\n' + colors.cyan + colors.bright + '═'.repeat(60) + colors.reset + '\n');

  return true;
}

// 完整构建
async function buildAll() {
  log.title('完整构建');

  const webResult = await buildWeb();
  if (!webResult) {
    log.error('前端构建失败');
    return false;
  }

  const backendResult = await buildBackend();
  if (!backendResult) {
    log.error('后端构建失败');
    return false;
  }

  // 完整构建成功，打印额外的信息
  console.log('\n' + colors.cyan + colors.bright + '╔' + '═'.repeat(58) + '╗' + colors.reset);
  console.log(colors.cyan + colors.bright + '║' + ' '.repeat(58) + '║' + colors.reset);
  console.log(colors.cyan + colors.bright + '║' + colors.green + colors.bright + '  ✓ 完整构建完成！前端 + 后端已成功构建  '.padEnd(58, ' ') + colors.cyan + '║' + colors.reset);
  console.log(colors.cyan + colors.bright + '║' + ' '.repeat(58) + '║' + colors.reset);
  console.log(colors.cyan + colors.bright + '╚' + '═'.repeat(58) + '╝' + colors.reset);

  console.log('\n' + colors.yellow + '📦 构建产物:' + colors.reset);
  console.log(`  前端: ${colors.green}${join(config.webDir, 'build')}${colors.reset}`);
  console.log(`  后端: ${colors.green}${join(config.outputDir, config.binaryName)}${colors.reset}`);

  console.log('\n' + colors.yellow + '🚀 快速启动:' + colors.reset);
  const binaryPath = join(config.outputDir, config.binaryName);
  if (process.platform === 'win32') {
    console.log(`  ${colors.green}${binaryPath}${colors.reset}`);
  } else {
    console.log(`  ${colors.green}./${binaryPath}${colors.reset}`);
  }

  console.log('\n' + colors.yellow + '💡 提示:' + colors.reset);
  console.log(`  - 应用会自动加载前端构建产物`);
  console.log(`  - 默认监听端口: ${colors.cyan}3000${colors.reset}`);
  console.log(`  - 访问地址: ${colors.cyan}http://localhost:3000${colors.reset}`);
  console.log('');

  return true;
}

// 清理构建产物
function clean() {
  log.title('清理构建产物');

  const pathsToClean = [
    config.outputDir,
    join(config.webDir, 'build'),
    join(config.webDir, 'dist'),
    join(config.webDir, 'node_modules'),
  ];

  for (const p of pathsToClean) {
    if (existsSync(p)) {
      log.info(`删除: ${p}`);
      rmSync(p, { recursive: true, force: true });
    }
  }

  log.success('清理完成');
}

// 清理依赖 (不包含 node_modules)
function cleanBuild() {
  log.title('清理构建产物 (保留依赖)');

  const pathsToClean = [
    config.outputDir,
    join(config.webDir, 'build'),
    join(config.webDir, 'dist'),
  ];

  for (const p of pathsToClean) {
    if (existsSync(p)) {
      log.info(`删除: ${p}`);
      rmSync(p, { recursive: true, force: true });
    }
  }

  log.success('清理完成');
}

// 运行项目
function run() {
  log.title('运行项目');

  const binaryPath = join(config.outputDir, config.binaryName);

  if (!existsSync(binaryPath)) {
    log.error('二进制文件不存在，请先构建');
    return;
  }

  log.info(`启动: ${binaryPath}`);
  const child = spawn(binaryPath, [], {
    cwd: config.rootDir,
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    log.error(`启动失败: ${err.message}`);
  });
}

// 生成随机密钥
function generateRandomSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// 初始化配置文件
function initConfig() {
  log.title('初始化配置文件');

  const configPath = join(config.rootDir, 'config.yaml');
  const examplePath = join(config.rootDir, 'config.example.yaml');

  // 检查是否已存在配置文件
  if (existsSync(configPath)) {
    log.warn('配置文件已存在: config.yaml');
    log.info('如需重新生成，请先删除或重命名现有配置文件');
    return false;
  }

  // 检查示例文件是否存在
  if (!existsSync(examplePath)) {
    log.error('找不到配置示例文件: config.example.yaml');
    return false;
  }

  try {
    // 读取示例配置
    let configContent = readFileSync(examplePath, 'utf-8');

    // 生成随机密钥
    const userTokenSecret = generateRandomSecret(32);
    const sessionSecret = generateRandomSecret(32);

    log.info('生成随机密钥...');

    // 替换配置中的空密钥
    configContent = configContent.replace(
      /user_token_secret:\s*""\s*#/,
      `user_token_secret: "${userTokenSecret}" #`
    );
    configContent = configContent.replace(
      /session_secret:\s*""\s*#/,
      `session_secret: "${sessionSecret}" #`
    );

    // 写入配置文件
    writeFileSync(configPath, configContent);

    log.success('配置文件已创建: config.yaml');
    console.log(`\n${colors.yellow}已自动生成以下密钥:${colors.reset}`);
    console.log(`  ${colors.cyan}user_token_secret:${colors.reset} ${userTokenSecret}`);
    console.log(`  ${colors.cyan}session_secret:${colors.reset}    ${sessionSecret}`);
    console.log(`\n${colors.yellow}注意:${colors.reset} 请妥善保管这些密钥，修改后用户令牌将无法验证！\n`);

    return true;
  } catch (error) {
    log.error(`创建配置文件失败: ${error.message}`);
    return false;
  }
}

// 检查并提示配置
function checkAndPromptConfig() {
  const configPath = join(config.rootDir, 'config.yaml');

  if (!existsSync(configPath)) {
    console.log('\n' + colors.yellow + colors.bright + '⚠️  配置文件不存在' + colors.reset);
    console.log(`\n${colors.yellow}One Hub 需要配置文件才能启动，请选择以下方式之一：${colors.reset}\n`);

    console.log(`${colors.cyan}方式一：使用环境变量启动（推荐，快速测试）${colors.reset}`);
    if (process.platform === 'win32') {
      console.log(`  ${colors.green}set USER_TOKEN_SECRET=${generateRandomSecret(32)} && ${config.binaryName}${colors.reset}\n`);
    } else {
      console.log(`  ${colors.green}USER_TOKEN_SECRET="${generateRandomSecret(32)}" ./${config.binaryName}${colors.reset}\n`);
    }

    console.log(`${colors.cyan}方式二：创建配置文件（推荐，生产环境）${colors.reset}`);
    console.log(`  在菜单中选择 ${colors.green}10${colors.reset} 初始化配置文件`);
    console.log(`  或运行: ${colors.green}node build.mjs init-config${colors.reset}\n`);

    return false;
  }

  return true;
}

// 显示镜像配置
function showMirrors() {
  log.title('当前镜像配置');
  console.log(`
  ${colors.green}npm 镜像:${colors.reset}      ${mirrors.npm}
  ${colors.green}Go 代理:${colors.reset}       ${mirrors.goproxy}
  ${colors.green}Go SumDB:${colors.reset}      ${mirrors.gosumdb}
  ${colors.green}Node 镜像:${colors.reset}     ${mirrors.nodeMirror}
  ${colors.green}Electron:${colors.reset}      ${mirrors.electronMirror}
`);
}

// 交互式菜单
async function showMenu() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log(`
${colors.cyan}${colors.bright}╔══════════════════════════════════════╗
║       One-Hub 构建工具 (国内版)       ║
╚══════════════════════════════════════╝${colors.reset}

${colors.yellow}请选择操作:${colors.reset}

  ${colors.green}1.${colors.reset}  构建前端
  ${colors.green}2.${colors.reset}  构建后端 (当前平台)
  ${colors.green}3.${colors.reset}  构建后端 (Linux amd64)
  ${colors.green}4.${colors.reset}  构建后端 (Linux arm64)
  ${colors.green}5.${colors.reset}  完整构建 (前端 + 后端)
  ${colors.green}6.${colors.reset}  清理构建产物 (保留依赖)
  ${colors.green}7.${colors.reset}  清理全部 (包含 node_modules)
  ${colors.green}8.${colors.reset}  运行项目
  ${colors.green}9.${colors.reset}  查看镜像配置
  ${colors.green}10.${colors.reset} 初始化配置文件
  ${colors.green}0.${colors.reset}  退出
`);

  const choice = await question(`${colors.cyan}请输入选项 [0-10]: ${colors.reset}`);
  rl.close();

  switch (choice.trim()) {
    case '1':
      await buildWeb();
      break;
    case '2':
      await buildBackend();
      break;
    case '3':
      await buildBackend('linux', 'x64');
      break;
    case '4':
      await buildBackend('linux', 'arm64');
      break;
    case '5':
      await buildAll();
      break;
    case '6':
      cleanBuild();
      break;
    case '7':
      clean();
      break;
    case '8':
      run();
      return; // 运行后不再显示菜单
    case '9':
      showMirrors();
      break;
    case '10':
      initConfig();
      break;
    case '0':
      log.info('再见!');
      process.exit(0);
    default:
      log.warn('无效选项');
  }

  // 继续显示菜单
  console.log('\n');
  await showMenu();
}

// 命令行参数处理
async function main() {
  // 初始化镜像环境
  setupMirrorEnv();

  const args = process.argv.slice(2);

  if (args.length === 0) {
    await showMenu();
    return;
  }

  const command = args[0];

  switch (command) {
    case 'web':
      await buildWeb();
      break;
    case 'backend':
      await buildBackend(args[1], args[2]);
      break;
    case 'all':
      await buildAll();
      break;
    case 'clean':
      clean();
      break;
    case 'clean-build':
      cleanBuild();
      break;
    case 'run':
      run();
      break;
    case 'mirrors':
      showMirrors();
      break;
    case 'init-config':
      initConfig();
      break;
    case 'help':
    case '-h':
    case '--help':
      console.log(`
${colors.cyan}One-Hub 构建工具 (国内镜像版)${colors.reset}

用法: node build.mjs [命令] [参数]

命令:
  (无)                  显示交互式菜单
  web                   构建前端
  backend [os] [arch]   构建后端 (默认当前平台)
  all                   完整构建
  clean                 清理全部 (包含 node_modules)
  clean-build           清理构建产物 (保留依赖)
  run                   运行项目
  mirrors               显示镜像配置
  init-config           初始化配置文件
  help                  显示帮助

示例:
  node build.mjs                      # 交互式菜单
  node build.mjs all                  # 完整构建
  node build.mjs backend linux x64    # 构建 Linux amd64
  node build.mjs backend linux arm64  # 构建 Linux arm64
  node build.mjs init-config          # 初始化配置文件

镜像配置:
  npm:     ${mirrors.npm}
  Go:      ${mirrors.goproxy}
`);
      break;
    default:
      log.error(`未知命令: ${command}`);
      log.info('使用 "node build.mjs help" 查看帮助');
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
