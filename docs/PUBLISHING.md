# GitHub 首次发布步骤

本项目已经按“源码进入 Git，安装包进入 GitHub Releases”的方式整理。不要直接上传整个文件夹，也不要把 `.git`、`.reference` 或健康数据拖进 GitHub 网页。

## 1. 发布前检查

在 PowerShell 中进入项目目录。把 `<PROJECT_PATH>` 替换为你电脑上的实际路径；不要把本机绝对路径写进仓库：

```powershell
cd '<PROJECT_PATH>'
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run clean:workspace
git status --short --ignored
```

确认这些内容显示为 ignored 且不会提交：

- `.reference/`
- `release/*.exe`
- `node_modules/`、`dist/`、`src-tauri/target/`
- `*.zip`、`export.xml`、`*.db`、`data/`、`private/`

## 2. 在 GitHub 建空仓库

建议仓库名：`zhiheng-health`。

创建时：

- 可见性选择 Public，黑客松评委才能直接打开；
- 不勾选自动创建 README、`.gitignore` 或 License；本地已经有这些文件和说明；
- Description 可填：`Privacy-first local Apple Health analytics for Windows, built with Tauri, Rust and React.`

建议 Topics：`apple-health`、`healthkit`、`tauri`、`rust`、`react`、`sqlite`、`privacy`、`digital-health`、`windows`。

## 3. 首次提交和推送

先保护提交者邮箱。GitHub 的 **Settings → Emails** 中开启 `Keep my email addresses private` 和 `Block command line pushes that expose my email`，复制页面提供的 `noreply` 邮箱，然后只为这个仓库设置：

```powershell
git config user.name 'YOUR_GITHUB_NAME'
git config user.email 'YOUR_GITHUB_NOREPLY_EMAIL'
git config user.name
git config user.email
```

不要使用私人邮箱或真实姓名，除非你明确希望它们永久写入公开提交历史。然后把下面的 `YOUR_GITHUB_NAME` 替换成你的 GitHub 用户名：

```powershell
cd '<PROJECT_PATH>'
git add .
git status --short
git diff --cached --stat
git commit -m 'Initial release: ZhiHeng Health v1.3.2'
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_NAME/zhiheng-health.git
git push -u origin main
```

在 `git commit` 前检查：不应看到 `.reference`、健康 ZIP/XML/数据库或 `release/*.exe`。如果 `origin` 已存在，先运行 `git remote -v` 核对，不要重复添加；地址错误时使用：

```powershell
git remote set-url origin https://github.com/YOUR_GITHUB_NAME/zhiheng-health.git
```

## 4. 创建 v1.3.2 Release

普通 Git 仓库不提交 200 MB 安装包。首次代码推送成功后，在 GitHub 仓库页面进入 **Releases → Draft a new release**：

1. 新建标签 `v1.3.2`，目标分支选择 `main`；
2. 标题填写 `知衡健康 v1.3.2`；
3. 将本机 `release/知衡健康_1.3.2_Windows_x64_离线安装包.exe` 拖入附件区；
4. 同时上传 `release/SHA256.txt`；
5. 发布说明复制 [`RELEASE_NOTES_V1.3.2.md`](RELEASE_NOTES_V1.3.2.md)；
6. 发布后下载一次附件并核对 SHA-256。

Windows 校验命令：

```powershell
Get-FileHash -Algorithm SHA256 '.\release\知衡健康_1.3.2_Windows_x64_离线安装包.exe'
```

预期值：

```text
C6E75F7374E2D1396E7CFA59AEB18309A3FB4A221BCC0D24547AC0B6095416F4
```

## 5. 黑客松提交前最后检查

- 用无痕窗口打开仓库链接，确认未登录也能看到；
- README 顶部能在 20 秒内说明问题、方案、差异化和运行方式；
- Releases 中能下载安装包；
- 仓库搜索不到姓名、手机号、邮箱、绝对个人路径、Token 或真实健康数值；
- 查看首个 commit，确认 Author 只显示你愿意公开的 GitHub 名称和 `noreply` 邮箱；
- 演示截图只能使用合成数据；
- 明确写出 Windows x64、未签名安装包和“非医学诊断”边界；
- 仓库设置中启用 Issues，并在 Actions 页确认 CI 通过；
- 在 Settings → Security 中启用 Private vulnerability reporting，使 `SECURITY.md` 的私密报告入口可用；
- 决定许可证：当前没有 LICENSE，默认不允许他人复制、修改或分发。
