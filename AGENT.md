# AGENT.md — TodoApp 协作规范

> 本文件给 **AI Agent / 协作者** 阅读，明确项目约定、命令、禁区。
> 人类开发者也建议通读一遍，避免踩协作雷区。

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 名称 | TodoApp |
| 定位 | 个人/团队待办 + 精力占用面板 + 时间冲突告警 |
| 框架 | Tauri 2（Rust 后端 + Web 前端） |
| 数据库 | SQLite（rusqlite，文件位于应用数据目录） |
| 前端 | 当前 Vanilla TS，可平滑迁移 React/Vue |
| 构建 | Cargo（Rust）+ Vite（前端） |

---

## 2. 常用命令（Agent 必须优先用这些）

### 开发模式（热重载）
```bash
cd todoapp
npm install        # 首次
npm run tauri dev   # 同时启前端+Vite+Rust编译
```

### 仅编译检查（不启动 GUI，CI 友好）
```bash
cd src-tauri
cargo check          # 最快，只做类型检查
cargo clippy -- -D warnings  # lint，CI 必跑
cargo build           # 完整编译
```

### 运行测试
```bash
cd src-tauri
cargo test --lib conflict::tests   # 只跑冲突检测单测
cargo test                        # 全量
```

### 生产构建
```bash
npm run tauri build
# 产物：src-tauri/target/release/bundle/
```

### 数据库维护（运行时通过 Tauri 命令调用）
- `vacuum_db` — VACUUM + ANALYZE
- `export_time_report(from, to, "json"|"csv")` — 导出

---

## 3. 架构与模块边界（Agent 改代码前必读）

```
src-tauri/src/
├── lib.rs            ← 入口、命令注册、全局状态
├── db.rs             ← 仅做"连接+建表"，不放业务逻辑
├── task.rs           ← 个人任务 CRUD + 精力面板 + 导出
├── conflict.rs       ← 时间冲突算法（纯函数，易测试）
├── scheduler.rs      ← 后台 Tokio 循环（30s 节拍）
├── reminder.rs       ← 桌面通知 + 定时提醒
├── employee.rs       ← 员工 + 任务分配 + 进度
├── rules.rs         ← 强制录入规则
├── tray.rs          ← 系统托盘（可独立测试）
└── error.rs         ← 统一错误类型
```

### 数据流
```
前端 invoke ──▶ Tauri command ──▶ task.rs / employee.rs / rules.rs
                                     │
                                     ▼
                                  db.rs (rusqlite + Mutex)
                                     │
                                     ▼
                            SQLite (app_data_dir/todoapp.db)
```

### 关键不变量（Invariants）
1. **精力占用 = 同时段内所有任务 `effort_percent` 之和**
2. **`> 100%` 必为 `error`（红色），绝不降级为 warning**
3. **`== 100%` 且由两个 50% 任务组成 → `warning`（黄色）**
4. **任务时间区间满足 `start < end`，否则拒绝写入**
5. **强制规则触发后必须留痕到 `force_events`**

---

## 4. 编码约定

### Rust
- **edition 2021**，MSRV 1.75
- 所有 Tauri 命令返回 `Result<T, String>`，错误用 `.map_err(|e| e.to_string())`
- 时间一律 **ISO 8601 / RFC 3339 字符串** 在 IPC 边界传递，内部用 `chrono::DateTime<Utc>`
- 不要在前端塞时间计算逻辑，**时间比较/重叠检测只在 Rust 端**
- 数据库写操作放在 `Mutex<Connection>` 临界区内，**禁止跨锁调用异步代码**
- 新增表必须在 `db.rs::create_schema` 里用 `CREATE TABLE IF NOT EXISTS`，并补 migration 注释

### 前端
- 当前 Vanilla TS，但 **所有 IPC 调用集中到 `src/api.ts`**（迁移框架时只动这一层）
- 渲染函数保持纯函数：`(data) => HTMLElement`
- 状态管理不要引入 Redux/Zustand，**暂时用模块级变量 + 轮询即可**

### 提交
- 一个 PR 只做一件事（"加冲突检测"、"修托盘菜单 bug"）
- Commit message 用中文或英文均可，但**必须说明动机**，不只写"fix bug"

---

## 5. 禁区（Agent 不要做的事）

- ❌ **不要**把 `effort_percent` 改成浮点 —— 全员约定整数百分比
- ❌ **不要**引入 ORM（Diesel/SeaORM）—— rusqlite 直写 + 少量 SQL 是刻意选择
- ❌ **不要**把冲突检测搬到前端 —— 这是安全/一致性边界
- ❌ **不要**在 `lib.rs` 写业务逻辑 —— 它是组装根，保持薄
- ❌ **不要**用 `unwrap()` 处理用户输入 —— 走 `Result` 返回前端提示
- ❌ **不要**绕过 `force_rules` 直接放行受控应用 —— 这是产品核心纪律

---

## 6. 测试约定

- **冲突算法必须有单测**：`conflict::tests` 模块
  - 至少覆盖：无重叠、部分重叠、完全包含、50%×2=100%、120% 过载
- **提醒调度**：用 `tokio::time::pause()` 做时间控制测试，禁止真等 5 分钟
- **数据库测试**：用 `tempfile` 建临时 DB 文件，不污染真实数据

---

## 7. 新增功能的标准流程

1. **先在 `docs/DEV_PLAN.md` 里追加一条里程碑**（哪怕三行）
2. 在对应模块加单测（红→绿）
3. 实现 + 在 `lib.rs` 注册 Tauri 命令
4. 前端 `src/api.ts` 暴露调用
5. UI 层消费（保持渲染函数纯）
6. 更新 `README.md` 的"功能"小节
7. `cargo clippy -- -D warnings` 通过再提 PR

---

## 8. 常见问题（Agent 自排查清单）

| 现象 | 优先检查 |
|---|---|
| `cargo check` 报 `cannot find macro` | 是否漏 `#[macro_use]` 或 `use` |
| Tauri 命令前端调不到 | `tauri.conf.json` 的 `app.security.csp` 是否拦了 IPC |
| SQLite `database is locked` | 是否在同一个线程里重复持锁 |
| 托盘菜单点了没反应 | `on_menu_event` 的 `id` 是否和 `MenuItem::with_id` 一致 |
| 通知不弹（Linux） | `notify-rust` 依赖 `libdbus`，检查 `apt list libdbus-1-3` |
| 精力面板数字对不上 | 检查是否有 `status='done'` 的任务仍被计入（应在 SQL 里过滤） |

---

## 9. 给 AI Agent 的一句话

> **Rust 端是事实之源（Source of Truth）。**
> 前端只是展示 + 采集输入。任何"看起来两边都对"的冲突，以 Rust 端为准。
