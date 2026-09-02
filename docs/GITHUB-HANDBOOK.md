# GitHub 使用手册（琢言项目 · 资深程序员视角）

> 适用仓库：github.com/11MISFITKID11/zhuoyan（已配置 CI + 双 remote）
> 定位：不是入门教程，是「把 GitHub 当生产力工具用」的完整手册

---

## 0. 仓库现状

```
remote:
  origin  → gitee.com/ysz050205/zhuoyan.git   # 国内主仓（访问快）
  github  → github.com/11MISFITKID11/zhuoyan  # 国际镜像（CI 跑在这）
分支: main（已推送，CI 已配置 .github/workflows/ci.yml）
CI:   push/PR → lint + jest(24) + 覆盖率门槛
```

---

## 1. 分支策略：GitHub Flow（单人/小团队最优）

```
main（受保护，永远可部署）
  └── feat/xxx ──→ PR ──→ code review ──→ squash merge ──→ main
```

**规则**：
- `main` 永远是绿的（CI 必过）——**禁止直接 push 到 main**，一律走 PR；
- 功能分支命名：`feat/逻辑优化`、`fix/润色超时`、`docs/readme`、`ci/actions`；
- 小改动（改文档/几行）可以直推 main（单人项目，自己权衡），大功能必须 PR。

---

## 2. 日常开发循环（核心）

```bash
# 1) 拉最新
git pull github main

# 2) 开功能分支
git checkout -b feat/xxx

# 3) 改代码 + 本地验证
npm run lint && npx jest

# 4) 提交（信息规范：feat:/fix:/docs:/ci:/refactor:/chore:）
git add -A && git commit -m "feat: 新增xxx"

# 5) 推分支 + 提 PR
git push github feat/xxx
gh pr create --fill          # 或网页上点 "Compare & pull request"

# 6) 合并（推荐 squash，保持 main 历史干净）
gh pr merge --squash --delete-branch
```

**小改动捷径**（跳过分支，直接上 main）：
```bash
git add -A && git commit -m "fix: ..." && git push github main
```

---

## 3. Pull Request 最佳实践

- **PR 模板**（`.github/PULL_REQUEST_TEMPLATE.md`）：自动带出「改动内容 / 测试 / 截图」；
- **PR 关联 Issue**：描述里写 `Fixes #12`，合并后 Issue 自动关闭；
- **CI 状态检查**：PR 上必须看到 ✅ 才能合并（GitHub 默认展示 Actions 结果）；
- **Code Review**：即使单人，也养成「PR 是自己对自己 review」的习惯——合并前重读一遍 diff；
- **合并方式**：`Squash and merge`（推荐，历史干净）＞ `Rebase and merge` ＞ `Merge commit`（不推荐，历史乱）。

---

## 4. Issues 管理（把想法变成可追踪任务）

- **Issue 模板**（`.github/ISSUE_TEMPLATE/`）：
  - `bug_report.md`：环境 / 复现步骤 / 期望 vs 实际 / 截图
  - `feature_request.md`：背景 / 期望功能 / 验收标准
- **Labels**：`bug`、`enhancement`、`good first issue`、`P0/P1/P2`（按严重度）；
- **Milestone**：`v1.0`、`v2.0`——把 Issue 归入里程碑，形成发布计划；
- **Projects（看板）**：Todo / In Progress / Done，可视化迭代进度。

**工作流闭环**：发现 bug → 开 Issue → 建分支 fix/xxx → PR 里 `Fixes #编号` → 合并自动关 Issue。

---

## 5. Releases 与版本管理（semver）

**版本号规则**（Semantic Versioning）：`MAJOR.MINOR.PATCH`
- `MAJOR`：不兼容的破坏性变更（2.0 → 3.0）
- `MINOR`：新增功能（向后兼容）
- `PATCH`：bug 修复

**发布流程**：
```bash
# 1) 打 tag（如 v2.1.0）
git tag v2.1.0
git push github v2.1.0

# 2) 创建 GitHub Release（网页 Releases → Draft new release）
#    或命令行：
gh release create v2.1.0 --generate-notes
```

**自动化建议**：接入 [release-please](https://github.com/googleapis/release-please)（Actions 里），按 conventional commits 自动 bump 版本 + 生成 changelog + 打 tag——不用手动维护。

---

## 6. 安全实践（不能省）

- **Dependabot**：Settings → Code security → Enable Dependabot alerts/version updates。自动扫描依赖漏洞并提修复 PR；
- **Repository secrets**：Settings → Secrets and variables → Actions。把密钥放这里，CI 里 `${{ secrets.JWT_SECRET }}` 引用——**永远不要把密钥写进代码/提交**；
- **权限最小化**：单人项目把自己设成 Owner 即可；以后加协作者用 Write（不要 Admin）；
- **分支保护**：Settings → Branches → main → 勾选：
  - Require a pull request before merging
  - Require status checks（选 CI）
  - Require signed commits（可选，强制 GPG 签名）

---

## 7. GitHub Actions 进阶（从"能跑"到"生产力"）

**当前**：单工作流 `ci.yml`（lint + test + coverage）。

**进阶方向**：

| 场景 | 做法 |
|---|---|
| 多 Job 并行 | 同一 yml 里加多个 `jobs:`，或拆成多个 yml（ci.yml / cd.yml / release.yml） |
| Matrix 构建 | 一次测多 Node 版本：`strategy: matrix: node: [18, 20, 22]` |
| CD 部署 | 新增 `cd.yml`：CI 通过 → 构建 Docker 镜像 → 推镜像仓库 → SSH 部署 |
| 缓存 | `actions/setup-node` 已带 `cache: npm`（依赖缓存，秒级装依赖） |
| 环境隔离 | Settings → Environments：`staging` / `production`，各配独立 secrets |
| 手动触发 | `workflow_dispatch`：仓库 Actions 页可手动点「Run workflow」 |

**示例：CD 工作流骨架**
```yaml
name: CD
on:
  push:
    tags: ['v*']          # 打 tag 才部署
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t zhuoyan .
      - run: echo "${{ secrets.REGISTRY_PASSWORD }}" | docker login -u ${{ secrets.REGISTRY_USER }} --password-stdin
      - run: docker push zhuoyan:latest
      - run: ssh deploy@${{ secrets.SERVER_IP }} 'docker pull && docker compose up -d'
```

---

## 8. GitHub CLI（gh）——命令行一票到底

```bash
gh auth login                # 首次登录
gh pr create --fill          # 从当前分支提 PR
gh pr list                   # 看我的 PR
gh pr merge --squash --delete-branch   # 合并并删分支
gh run list                  # 看 CI 运行
gh run watch                 # 实时看 CI 日志
gh issue create --title "xxx" --body "yyy"
gh release create v1.0 --generate-notes
```

> 装好 `gh` 后，大部分网页操作都可以在终端完成，效率高很多。

---

## 9. 代码质量基础设施

- **CODEOWNERS**（`.github/CODEOWNERS`）：指定文件谁负责 review（多人时）；
- **徽章**：README 顶部放 `CI passing` 徽章（已加），还可以加：
  - 覆盖率徽章（接 Codecov：`[![codecov](https://codecov.io/gh/11MISFITKID11/zhuoyan/branch/main/graph/badge.svg)](https://codecov.io/gh/...)`）；
  - 依赖状态徽章（Dependabot）；
- **License**：当前 README 写 MIT 但没 LICENSE 文件——**补一个**（开源项目必须，放根目录 `LICENSE`）。

---

## 10. 国内网络 & 双仓库运维

**双 remote 同步**（Gitee 主 + GitHub 镜像）：
```bash
# 推两边
git push origin main
git push github main

# 或一条命令推两个
git push origin main github main    # 注意：会按顺序推
```

**国内连 GitHub 不稳的处理**：
1. push 失败（`CRYPT_E_NO_REVOCATION_CHECK` / 超时）→ 稍后重试或挂代理；
2. 长期方案：**Gitee 做主仓**（push 快），GitHub 做镜像——改代码推 Gitee，CI 靠 GitHub 的话就也推一下 GitHub；
3. 可以把 GitHub 的 PR/Release 流程作为"发布流程"，日常开发在 Gitee。

---

## 附：琢言项目接下来建议的 GitHub 动作（按优先级）

1. [ ] 补 `LICENSE`（MIT）——开源项目的底线
2. [ ] 加 PR / Issue 模板（`.github/` 目录）
3. [ ] 开启分支保护（main 必须 PR + CI 通过）
4. [ ] 接入 release-please（自动版本 + changelog）
5. [ ] 接 Codecov（覆盖率徽章 + 趋势）
6. [ ] 加 `cd.yml`（tag 触发部署）——等你要上云时再做

---

*手册完 · 建议把这份文件放仓库 `docs/GITHUB-HANDBOOK.md`，团队可共用*
