# SteamCards 小黑盒小程序版

SteamCards 的小黑盒小程序（小程序工坊）移植版本。使用标准 Web 技术开发，通过 `@heybox/hb-sdk` 运行在小黑盒客户端沙箱内，不依赖桌面程序。

## 当前实现

- 自动读取小黑盒账号绑定的 SteamID（需要平台启用 Steam 账号能力），提供「一键估值我的库存」
  - 未绑定/未返回 SteamID 时，回退到手动输入 SteamID64、profiles 链接或 `/id/自定义域名` 链接
- 读取公开 Steam 库存中的集换式卡牌
- 两种取价模式：
  - **快速参考价**：按游戏调用 Steam 市场搜索接口批量获取参考价，适合先看整体区间
  - **精确逐卡价**：调用 `market/priceoverview` 逐张获取最低价，速度较慢
- 本地价格缓存（24 小时内复用）与历史估值汇总
- 手机端页面，适配窄屏与安全区

## 重要限制

本项目的真实数据能力依赖平台审批，**不能只在本地构建后直接上线使用**：

1. 需要在 `package.json#heybox.permissions` 中声明 `network`，并在小黑盒开放平台申请获批；
2. 需要申报访问域名：`steamcommunity.com`；
3. Steam 库存/市场数据来源需在提审版本说明中如实申报；
4. 端口/路径/域名限制、Host 能力差异由小黑盒客户端控制；
5. Steam 市场接口存在频率限制，快速模式也可能被限流；
6. 手机上使用加速器时，需确保加速器采用全局代理或覆盖小黑盒客户端流量；只加速 Steam 客户端的分应用模式可能不会作用于小程序请求。

本项目没有自有后端，所有请求由小程序 Host 网络直接发往 Steam；如果平台审核不通过或网络策略不允许，需改为“小程序 + 后端 API”架构。

> 本地 `hb-sdk dev` 的 Browser Mock 受浏览器 CORS 限制，访问 Steam 可能返回 `REQUEST_FAILED`，不能作为真实网络能力的验收依据；Steam 直连必须在真实手机/PC Host 上验证。

## 开发

环境要求：Node.js >= 22.20.0。

```bash
cd miniapp
npm install

# 本地 Browser Mock 调试
npm run dev

# 构建
npm run build
```

真实手机调试和发布需要小黑盒开放平台账号：

```bash
npm run hb-sdk -- login
npm run hb-sdk -- remote create
# 已有小程序时：
# npm run hb-sdk -- remote bind <mini-program-id>

# 申请 network 权限（域名用逗号分隔）
npm run hb-sdk -- remote permission apply network \
  --reason "读取 Steam 公开库存与市场价格，用于卡牌估值" \
  --domains "steamcommunity.com"

# 提交审核（需先完成平台绑定与权限审批）
npm run deploy -- --release-note "Steam 库存卡牌估值首个版本"
```

## 架构

- `src/main.js`：页面状态、表单、进度、结果与历史交互
- `src/steam.js`：Steam 库存解析、自定义链接解析、价格查询、缓存与历史存储
- `src/styles.css`：移动端深色界面
- `package.json#heybox`：小程序名称、图标、封面、平台与权限声明

## 隐私

- 不需要 Steam 账号密码或登录凭据，只读取公开库存；
- 不包含自有服务器，不上传用户数据；
- 价格缓存与历史汇总保存在小黑盒小程序隔离 Storage 中；
- 不采集小黑盒账号资料。

## 许可证

GPL-3.0-only，与 SteamCards 主项目一致。

## 当前发布状态

- 远端小程序已创建并绑定：`01a152a8-212d-7e63-aaaa-5cc084f6134d`
- 线上版本：`0.1.0`（已发布）
- `0.1.1` 已撤回
- 新版本 `0.1.2`：已提交审核（账号绑定一键估值 + UI 重构），状态：`auditing`
- `network` 权限申请仍在审核中，状态：`auditing`
- 线上页面：https://activity.xiaoheihe.cn/u/1xkv3nr/QNsw11SYe_/index.html
- 分享页：https://web.xiaoheihe.cn/tools/common_share?user_miniprogram_id=01a152a8-212d-7e63-aaaa-5cc084f6134d
- 在 `network` 获批前，线上版本只能查看「演示数据」；真实 Steam 请求会返回权限错误
- `network` 获批后无需重新发版，权限会按当前版本 Manifest 生效；如果平台要求重新提审，则重新执行 `remote deploy`
- 首次提交的远程展示名可能仍是平台默认的「我的小程序」，需要在开放平台管理页确认/修改名称与封面
- 审核测试可使用页面上的「查看演示数据」按钮，无需真实 Steam 网络

> 当前提交版本在 `network` 权限获批前只能查看演示数据；真实 Steam 请求需要等平台批准权限后重新验证。

## 为什么 /id/ 链接会提示无法解析

`/id/自定义域名` 链接本身可以识别，但需要向 `steamcommunity.com` 请求个人资料 XML/HTML 才能解析成 SteamID64。当前线上版本尚未获得 `network` 权限，旧版本会把该权限错误误报为“无法解析”。`0.1.1` 已改为保留权限/网络错误并明确提示；在 `network` 获批前，任何真实链接解析都会受平台权限限制。

## 一键估值与账号资料

本版本新增 `userInfo` 权限，使用 `hbSDK.user.getInfo()` 读取当前小黑盒账号资料。只有在平台启用 Steam 账号能力、且账号已绑定 Steam 时才会返回 `userInfo.steam_id`；该字段存在时首页显示「一键估值我的库存」，否则自动展开手动输入。
