# SteamCards

SteamCards 是一款面向 Windows 平台的 Steam 库存卡牌估值桌面应用。项目使用 Rust 实现库存读取、价格查询、缓存管理与 CSV 导出等核心逻辑，使用 Tauri 2 构建桌面容器，并采用 React 19、TypeScript 与 Tailwind CSS 实现用户界面。

## 功能概述

- **库存读取**：读取指定 Steam 账号公开的游戏库存，提取其中的集换式卡牌、闪亮卡牌及数量信息。
- **价格查询**：优先调用 Steam 社区市场精确价格接口；在触发访问频率限制时，自动切换至市场搜索接口完成批量补价。
- **本地缓存**：对价格、库存与登录 Cookie 进行本地缓存，减少重复请求，并在接口受限时复用最近一次有效数据。
- **结果导出**：按卡牌明细与汇总两个维度导出 CSV 文件。
- **历史记录**：按账号保存历史估值结果，支持在应用内查看与删除。
- **桌面体验**：独立窗口运行，不依赖浏览器，不启动本地服务端口；提供浅色、深色与跟随系统三种主题。
- **界面语言**：根据操作系统语言自动切换中文或英文界面。

## 技术架构

| 模块 | 技术栈 | 职责 |
| --- | --- | --- |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS | 估值表单、进度展示、结果浏览、历史记录与日志界面 |
| 桌面容器 | Tauri 2 | 窗口管理、系统对话框、前后端命令桥接 |
| 核心逻辑 | Rust、Tokio、Serde | Steam 接口调用、价格查询与限流处理、缓存、CSV 导出、历史记录 |

## 目录结构

```text
web/                 React 前端源码
server/              Rust 核心库与服务端
desktop/src-tauri/   Tauri 桌面应用外壳
```

## 环境要求

- Windows 10 或更高版本
- Rust 1.75 或更高版本
- Node.js 18 或更高版本
- WebView2 Runtime（Windows 10/11 通常已预装）
- Tauri 2 构建依赖（Windows 建议使用 MSVC 工具链，并安装 C++ Build Tools）

## 构建与运行

```powershell
# 1. 构建前端
cd web
npm ci
npm run build

# 2. 运行核心逻辑测试
cd ..\server
cargo test

# 3. 构建桌面应用
cd ..\desktop
npx @tauri-apps/cli@^2 build
```

桌面构建复用 `web/dist` 中的前端产物，因此需先完成前端构建。若仅需构建 Rust 服务端，可使用：

```powershell
cd server
cargo build --release
```

## 本地数据与隐私

应用产生的数据仅保存在当前用户目录，不随源码仓库分发：

| 路径 | 内容 |
| --- | --- |
| `%USERPROFILE%\.steamcards_cache.json` | 价格缓存 |
| `%USERPROFILE%\.steamcards_inventory.json` | 库存缓存 |
| `%USERPROFILE%\.steamcards_cookies` | Steam 请求 Cookie |
| `%USERPROFILE%\.steamcards_history` | 历史估值结果 |
| 用户下载目录下的 `SteamCards` 文件夹 | 导出的 CSV 文件 |

本仓库仅包含程序源代码与构建配置，不包含 Steam 账号、SteamID、库存数据、价格缓存、历史结果、CSV 文件或界面截图。

## 使用限制

- 本工具仅用于个人库存整理与学习研究，不提供市场交易、自动出售或账号登录功能。
- Steam 社区市场接口存在访问频率限制，请合理控制查询频率，避免高频或大规模调用。
- 本项目与 Valve Corporation、Steam 官方无隶属关系。

## 许可证

本项目采用 **GNU General Public License v3.0（GPLv3）** 开源，SPDX 标识为 `GPL-3.0-only`，完整条款见 [LICENSE](LICENSE)。

GPLv3 允许在遵守许可证条款的前提下使用、研究、修改与分发本软件；任何分发的修改版本必须以相同许可证开放源代码。该许可证用于保持软件及其衍生作品的开源性质，防止修改版本被闭源专有化。需要说明的是，GPLv3 并不禁止收取费用或商业使用，但要求任何对外分发的修改版本继续以 GPLv3 开放源代码。
