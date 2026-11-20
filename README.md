# toExcellence 在线自习室

中文刷题网站。GitHub Pages 提供静态前端，Supabase Auth、PostgreSQL 和 Edge Functions 提供账号、题库、判分和进度服务。四种模式为按单元练习、随机无限练习、限时组卷和错题重练。

## 开发和发布

使用 Node.js 24，安装依赖并启动本地页面。

```sh
npm ci
npm run dev
```

默认连接已经部署的 toExcellence 项目。切换项目时将 .env.example 复制为 .env.local，修改 VITE_SUPABASE_URL 和 VITE_SUPABASE_KEY。只使用 Supabase 可公开的 publishable key。运行 npm test 执行 PostgreSQL 兼容环境中的权限和答题回归测试，npm run build 输出 dist。

将本仓库推送到 GitHub 的 main 分支，在仓库 Settings → Pages 中选择 GitHub Actions。提交或手动运行 Deploy toExcellence 工作流。页面使用相对资源路径和哈希路由，可部署在仓库子路径。工作流接受同名的两个 VITE 配置变量来覆盖默认项目。

## 后端和账号

现有项目位于东京，项目 ref 为 omuyuybdustwqnecesny。为全新项目部署时，使用 Supabase CLI 链接项目，按时间顺序部署 supabase/migrations，以 supabase/functions/api 部署 api 函数，并应用 supabase/config.toml 中的 Auth 注册配置。函数接口对未登录用户开放申请操作，其他操作均验证 Supabase 用户会话。私有 study schema 对客户端角色关闭，函数按当前用户校验记录归属和管理权限。Auth 建号触发器额外拒绝未经管理端置入授权标记的用户。

首个管理员使用 Node 命令建立。在可信终端设置 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 和 ADMIN_PASSWORD，然后运行：

```sh
npm run admin -- admin 管理员
```

现有项目的首个管理员已建立。初始登录信息保存在部署电脑的 private/管理员登录.txt，文件仅对本机用户开放，private 目录被 Git 忽略。申请资料中的密码加密后存入数据库，审批或驳回完成后清除。审批中断时可以在后台重试。普通账号可由管理员直接创建。

## 题库

现有数据库中已发布《园林艺术概论》48 个单元、255 道题。题干和答案按原 DOCX 转录，36 道灰色补充题带有标记。初始综合自测方案是 25 分钟 20 题，含单选 10 题、多选 2 题和判断 8 题。管理员可按需要发布其他方案。原始题库 JSON 位于部署电脑的 private/garden-art.json，仅示例模板进入公开网页。

后台提供 JSON 模板下载、格式校验、数量预览和确认发布。单元内按数组顺序出题，题目标识在同一题库内唯一。选项按 A、B、C 等顺序编码，多选答案使用字母数组，解析可省略。导入按标识新增或更新，现有试卷和练习保留出题快照。随机练习每轮洗牌，错题重练在显示答案后可轻触选择一至三星；三星归入已掌握，不再加入后续默认重刷轮次。再次答错会清除星级，用户可重新评分。连续答对次数独立保留。旧版本连续答对三次的记录迁移为三星，并标记来源为 legacy。

## 本地保存和错题导出

普通练习提交、切题和评分只写入当前浏览器，提交后立即本地判题；答案和解析只在提交后展示。离开答题页、完成本轮、页面进入后台或关闭时尝试批量同步。浏览器关闭和断网时无法保证上传完成，未确认的操作不会删除；回到非答题页面或该页面恢复网络后补传。记录按账号隔离，退出登录前尝试同步，失败记录留待原账号再次登录。请勿在同步前清除网站数据。

限时考试每30秒批量保存，并在交卷前、倒计时最后阶段尝试保存；服务器继续严格检查截止时间。迟到答案不计入成绩，保留浏览器归档并在练习页提示。考试交卷前不下发标准答案。

错题页面按未评分、一星、二星、三星升序显示，支持掌握度、单元、题干筛选和逐题勾选。导出 JSON 包含题目、选项、正确答案、解析、评分及可用作答历史；历史快照反映当时题目版本。schemaVersion 为 1，answered_at 缺失表示无法恢复实际作答时间，received_at 不应当作答题时间。旧历史来源为 legacy_snapshot。断网导出可使用已有缓存与待同步操作，并通过 syncStatus 标明不完整历史；没有完整题目缓存时需联网后再导出。未计入成绩的本地迟到答案标记 counted=false，不应纳入正确率。

部署此升级时，先应用 local_sync_mastery_export 迁移，再部署 api Edge Function，最后发布前端。新前端依赖 sync、rate、export 接口。可用 npm test 和 npm run build 验证数据库回归、同步队列及生产构建。

## 中国大陆访问

网页资源、字体回退和图标均在本地页面中加载。用户访问页面与 Supabase 项目域名即可使用系统。实际可达性取决于用户所在运营商到这两个域名的线路。上线检查需要分别验证网页和接口。可用 Globalping 的中国大陆 HTTP 探针检测网页及 /functions/v1/api；对该函数发送 GET 会返回 405，这表明请求已经到达应用。最后使用浏览器登录并保存一次作答以验证完整链路。部署者可将 dist 放入另一个可访问的静态站点，也可通过 VITE_SUPABASE_URL 指向自己的 Supabase API 域名。


浏览器流程验证：启动本地开发服务器，在装有 Playwright 及 Chromium 的环境运行 `node tests/browser-flow.mjs`。可用 `PLAYWRIGHT_MODULE` 指向外部 Playwright 模块，`TEST_BASE_URL` 指定本地地址。该测试用 PGlite 加载实际迁移，拦截浏览器 API 请求，不访问线上数据库；覆盖本地答题/评分、接口断网后刷新恢复、离开页面批量同步、JSON 下载与手机布局。
