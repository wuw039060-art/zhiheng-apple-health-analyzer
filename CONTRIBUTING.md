# Contributing

感谢关注知衡健康。提交 Issue 或 Pull Request 前，请遵守以下边界：

- 不要提交真实 Apple 健康 ZIP/XML、ECG、运动路线、数据库、日志或截图中的个人健康信息；
- 测试夹具必须人工构造、最小化，并能清楚说明预期行为；
- 医疗相关文案必须引用可追溯来源，并保持“趋势提示而非诊断”的产品边界；
- 功能变化应同时提供对应的 TypeScript 或 Rust 测试；
- 提交前运行 `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --locked` 和 `npm run clean:workspace`。

发现可能泄露健康数据或其他安全问题时，请不要公开粘贴敏感内容；优先使用 GitHub 的私密漏洞报告功能联系仓库维护者。
