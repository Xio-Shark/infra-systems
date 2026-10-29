# 部署与国内访问

当前线上是 GitHub Pages：`https://xio-shark.github.io/infra-systems/`。站点本身是纯静态的，问题不在代码，而在国内到 GitHub Pages 的链路时好时坏。

这份文档给的是“不依赖 VPN”的备选方案。结论先说：**没有备案域名时，帽子云最值得先试；有域名时，Cloudflare Pages 可以试。Zeabur 已宣布 2026/12/31 停止运营，新项目不要再迁。** EdgeOne Makers 的默认域名在国内容易只给 3 小时预览，不适合直接分享。

## 方案对比

| 方案 | 国内直连 | 需要备案 | 成本 | 适合 |
|---|---|---|---|---|
| **Zeabur** `*.zeabur.app` | 2026/12/31 停止运营 | — | — | 不要新迁 |
| **帽子云** `*.maoziyun.com` | 国内优化 CDN，通常较快 | 不需要 | 免费 | 纯静态、国内读者 |
| **Cloudflare Pages + 自有域名** | 时好时坏，绑域名后通常好一些 | 不需要（海外节点） | 域名费用 | 已有域名 |
| **EdgeOne Makers（原 Pages）** | 默认域名仅 3 小时预览；自定义域名 + 大陆加速需备案 | 大陆加速需要 | 免费额度 | 有备案域名 |
| **腾讯云 CloudBase 静态托管** | 默认域名有访问提示中间页，导航请求可能触发下载 | 自定义域名需要 | 按量 | 不推荐给公开课程 |
| **Netlify** | 时断时续 | 不需要 | 免费 | 备选 |
| **Vercel** | 默认域名基本打不开 | 不需要 | 免费 | 不推荐 |
| **GitHub Pages** | 时好时坏，当前方案 | 不需要 | 免费 | 海外读者、开发预览 |

这张表是 2026 年 10 月的公开资料和实测讨论汇总；国内不同省份、运营商差异很大，部署完一定要用手机流量、多个网络各测一次。

## 方案一：Zeabur（已宣布停止运营）

> Zeabur 官方公告：2026/12/31 停止运营，部分服务 12/1 起陆续停止。新项目不要再用；已经部署的尽快迁到帽子云或 Cloudflare Pages。

Zeabur 的 `*.zeabur.app` 默认域名在国内通常能直连，免费额度对小站够用，支持 GitHub 部署。下面步骤只用于理解历史配置或迁移，不再作为推荐方案。

1. 用 GitHub 登录 https://zeabur.com。
2. 新建项目，区域选 Asia 或 Hong Kong。
3. 添加服务，选 Git 部署，授权并选择 `Xio-Shark/infra-systems`。
4. 仓库根目录有 `Dockerfile`，Zeabur 会自动用 Docker 部署；不需要再填构建命令。
5. `Dockerfile` 会安装 Pandoc、执行 `./build.sh`，并用 `${PORT:-8080}` 启动静态服务器；服务端口保持 8080。
6. 在服务详情里生成域名，例如 `infra-systems.zeabur.app`。
7. 用手机 4G/5G 打开，确认不是只在你自己的网络里能开。

注意：Zeabur 免费额度是每月 5 美元左右的资源额度，静态站通常够用；额度政策以后可能调整。

## 方案二：帽子云（当前首选）

帽子云是国产静态托管，默认域名 `*.maoziyun.com`，有面向大陆优化的 CDN，支持 GitHub 部署，当前免费。

1. 注册 https://www.maoziyun.com/（需要手机号）。
2. 新建静态站点，连接 GitHub，选择本仓库。
3. 构建命令 `./build.sh`，输出目录 `dist`；如果构建环境没有 Pandoc，直接上传本地 `dist/`。
4. 部署完成后用默认域名访问，手机流量再测一次。

它是个人项目，长期稳定性不如大厂；如果课程要长期公开，建议同时保留 GitHub Pages 和帽子云中的一个。

## 方案三：Cloudflare Pages + 自有域名

Cloudflare Pages 的 `*.pages.dev` 在国内经常打不开；绑定自己的域名后会好一些，但仍不保证稳定。

1. 在 Cloudflare Pages 里连接 GitHub 仓库。
2. 构建命令 `./build.sh`，输出目录 `dist`；如果构建镜像没有 Pandoc，用 `wrangler pages deploy dist` 直接上传构建产物。
3. 绑定一个自己的域名，按提示加 CNAME。
4. 国内访问仍可能被链路干扰；不要把它当成唯一入口。

## 方案四：EdgeOne Makers（有备案域名再考虑）

腾讯云 EdgeOne Makers（原 Pages）免费额度很大，但文档写得很清楚：

- 默认项目域名在中国大陆网络下只能用系统生成的预览链接，有效期 3 小时，过期返回 401。
- 想长期访问要绑自定义域名；选中国大陆或全球（含中国大陆）加速，域名必须完成 ICP 备案。
- 不想备案，只能选“全球可用区（不含中国大陆）”，走境外节点，和 Cloudflare 类似。

所以它适合“已有备案域名”的国内课程站，不适合现在这个还没有备案域名的仓库。

## 方案五：CloudBase / Netlify / Vercel

- **CloudBase 静态托管**：默认域名有访问提示中间页，浏览器直接导航可能被加上 `Content-Disposition: attachment`；自定义域名要备案。不建议给公开课程。
- **Netlify**：默认域名国内时断时续；如果要用，绑自有域名并实测。
- **Vercel**：默认域名国内基本打不开；不推荐。

## 仓库里的部署文件

- `Dockerfile`：Alpine + Pandoc + Python 静态服务器；适合 Render、Fly 等支持 Docker 的平台。
- `netlify.toml`：Netlify 的构建命令和发布目录。
- `vercel.json`：Vercel 的构建命令和输出目录；Vercel 构建镜像通常没有 Pandoc，建议直接上传 `dist/`，不要依赖这个配置。

本地构建要求：`bash`、`pandoc`、`openssl`、`awk`、`sed`。`./build.sh` 会把站点生成到 `dist/`。

## 检查清单

- [ ] 用手机 4G/5G 打开一次，不连 Wi-Fi。
- [ ] 换一个运营商或让朋友在另一个省份打开一次。
- [ ] 检查首页、讲义、一个实验页、一个 CSS/JS 资源是否都能加载。
- [ ] 确认没有把账号、Token、私钥写进仓库；部署平台用 OAuth 授权，不要提交凭据。
- [ ] 记录部署平台、域名、构建命令和最后验证时间，下次换平台时不用重新猜。
