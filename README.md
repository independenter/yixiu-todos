# TodoApp — 精力占用面板 + 团队任务管理

> 跨平台桌面应用（Linux / Windows / macOS），用 **Rust + Tauri 2** 构建。
> 设计目标：让"我一天到底能不能做完这些事"一眼可见，并在冲突发生前主动告警。

---

## ✨ 核心功能

### 1. 个人待办 + 精力占用面板
- 每个任务有 **标题 / 描述 / 优先级 / 起止时间 / 精力占用百分比**
- **精力占用面板**：把一天按时间切片，计算每一刻"同时在做"的任务精力之和
  - `≤ 100%` → 🟢 正常
  - `> 100%` → 🔴 红色告警（过载）
  - 单任务重叠 1 次（如两个 50% 任务撞车）→ 🟡 黄色警告（提示线程切换代价）
- 任务可 **提前完成 / 延后**，面板动态刷新

### 2. 时间冲突自动检测
- 两两比较未完成任务的时间区间，自动写入 `task_overlaps` 表
- 前端可拉取冲突报告，按严重程度排序
- 冲突分两级：
  - `warning`：精力占用 100%、或仅单次 50% 重叠
  - `error`：精力占用超过 100%（必然有任务被挤掉）

### 3. 强制录入规则
- 规则示例：*"打开微信前必须先录入任务"*
- 当受控应用被检测启动时，若用户未录入关联任务 → **每隔 N 分钟弹一次提醒**
- 提供"已录入 / 忽略 / 强制阻断"三种响应，事件全部留痕

### 4. 定时提醒
- 后台调度器每 30 秒扫描"5 分钟内即将开始"的任务
- 通过 `notify-rust` 弹系统级桌面通知（支持 urgency：low/normal/critical）
- 支持前端为任意任务**手动调度一次性提醒**

### 5. 员工任务管理（多用户面板）
- 独立的 `employees` + `employee_tasks` 表
- 为每位员工计算：
  - 当前精力占用总和
  - 平均进度
  - 时间冲突告警列表
- 可单独给某员工分配任务、更新进度（0-100）、标记完成

### 6. 数据库维护
- 一键 `VACUUM` + `ANALYZE`
- 按天数清理已完成的旧任务
- 按时间区间导出任务为 **JSON / CSV**

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (Webview)                      │
│   Vanilla TS（可平滑迁移 React/Vue + Tailwind）       │
│   精力面板 / 任务列表 / 冲突表 / 员工面板 / 设置      │
└──────────────────┬──────────────────────────────────┘
                   │ Tauri invoke (IPC)
┌──────────────────▼──────────────────────────────────┐
│              Rust 后端 (Tauri 2)                     │
│  ┌──────────────────────────────────────────────┐    │
│  │ task.rs      — 个人任务 CRUD + 面板聚合      │    │
│  │ conflict.rs  — 时间冲突检测算法            │    │
│  │ scheduler.rs — 30s 后台扫描 + 提醒派发    │    │
│  │ reminder.rs  — 桌面通知 + 定时提醒         │    │
│  │ employee.rs  — 员工 + 任务分配 + 进度     │    │
│  │ rules.rs     — 强制录入规则 + 事件留痕      │    │
│  │ tray.rs      — 系统托盘 + 菜单             │    │
│  │ db.rs        — SQLite 建表 + 连接管理      │    │
│  └──────────────────────────────────────────────┘    │
│                   ▲                                  │
│              rusqlite (SQLite)                      │
└─────────────────────────────────────────────────────────┘
```

---

## 📦 项目结构

```
todoapp/
├── Cargo.toml                  # workspace 根
├── package.json                 # 前端依赖
├── vite.config.ts              # Vite 配置
├── tsconfig.json
├── index.html
├── src/                       # 前端源码
│   └── main.ts
├── src-tauri/                 # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs            # 入口 + 命令注册 + 全局状态
│       ├── db.rs             # SQLite 初始化 + 建表
│       ├── task.rs           # 任务 CRUD + 精力面板
│       ├── conflict.rs       # 时间冲突检测
│       ├── scheduler.rs      # 后台调度器
│       ├── reminder.rs       # 桌面通知
│       ├── employee.rs       # 员工管理
│       ├── rules.rs         # 强制录入规则
│       ├── tray.rs          # 系统托盘
│       └── error.rs         # 统一错误类型
├── docs/
│   ├── DEV_PLAN.md         # 开发规划（阶段/里程碑）
│   └── ARCHITECTURE.md     # 详细架构图
├── AGENT.md                  # AI/Agent 协作规范
└── README.md
```

---

## 🚀 快速开始

### 前置依赖
- **Rust** ≥ 1.75：`rustup default stable`
- **Node.js** ≥ 18 + npm
- **Linux**：`sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file`
- **Tauri CLI**：`cargo install tauri-cli --locked`

### 开发模式（热重载）
```bash
# 终端 1：前端 + Rust 一起启
cd todoapp
npm install
npm run tauri dev
```

### 生产构建
```bash
npm run tauri build
# 输出：src-tauri/target/release/bundle/
#   Linux   → .deb / .AppImage
#   Windows → .msi / .exe
#   macOS   → .dmg / .app
```

---

## 🗄️ 数据库 schema（关键表）

| 表名 | 作用 |
|------|------|
| `tasks` | 个人任务主表（含 effort_percent / priority / status） |
| `task_overlaps` | 自动检测的冲突记录（severity=warning/error） |
| `reminders` | 提醒规则（一次性/周期） |
| `force_rules` | 强制录入规则（哪个 app 需要前置任务） |
| `force_events` | 强制规则触发事件日志 |
| `employees` | 员工主表 |
| `employee_tasks` | 分配给员工的任务（含 progress 0-100） |

---

## ⚙️ 配置与扩展

- **强制规则**：前端"设置"页可添加 `app_name → remind_interval_sec`
- **提醒通道**：目前支持 `desktop`（notify-rust），扩展 `sound` / `email` 只需在 `reminder.rs` 加分支
- **前端框架**：当前是 Vanilla TS，可零成本迁移到 React/Vue（Vite 已配好）
- **移动端**：Tauri 2 支持 iOS/Android，复用同一份 Rust 后端

---

## 📜 License

MIT OR Apache-2.0
