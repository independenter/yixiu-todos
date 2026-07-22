# 架构详图 — TodoApp

> 与 README 互补：README 讲"做什么"，本文讲"怎么拆、为什么"。

---

## 1. 分层

```
┌────────────────────────────────────────────────────────┐
│  Presentation (Webview)                      L1   │
│  Vanilla TS → 可换 React/Vue/Svelte            │
│  - 任务表单 / 列表 / 面板 / 冲突表 / 员工面板  │
└──────────────────┬─────────────────────────────────┘
                   │  Tauri IPC  (invoke / listen)
┌──────────────────▼─────────────────────────────────┐
│  Application (Rust / Tauri commands)         L2   │
│  - task.rs       个人任务用例                       │
│  - employee.rs   员工任务用例                       │
│  - rules.rs      强制规则用例                       │
│  - reminder.rs   通知 + 调度用例                   │
│  - scheduler.rs  后台节拍器（30s）                │
│  - tray.rs       系统托盘（菜单/事件）              │
└──────────────────┬─────────────────────────────────┘
                   │  rusqlite (sync, Mutex 包装)
┌──────────────────▼─────────────────────────────────┐
│  Persistence (SQLite, WAL mode)              L3   │
│  - tasks / task_overlaps / reminders               │
│  - employees / employee_tasks / force_rules         │
│  - force_events                                    │
└────────────────────────────────────────────────────────┘
```

设计原则：**L2 是业务规则的唯一持有者**。L1 只渲染 + 采集输入，不计算精力、不判冲突。

---

## 2. 关键不变量（Invariants）

| # | 不变量 | 守护位置 |
|---|---|---|
| 1 | `task.start_time < task.end_time` | `task::create_task` / `update_task` 解析时校验 |
| 2 | 同时段精力之和 ≤ 100% 为正常，>100% 必为 `error` | `conflict::recompute_all` |
| 3 | 50%×2 重叠 = 100% → `warning`（黄色，提示切换代价） | `conflict.rs` 分支 |
| 4 | 任意任务写入后必须重算冲突 | 所有 task 写操作末尾调 `recompute_all` |
| 5 | `force_rules` 触发必须留痕 `force_events` | `rules::check_force_rule` |
| 6 | 时间字符串统一 RFC 3339 / ISO 8601 | 全栈，前端 `toISOString()` |

---

## 3. 精力占用算法

输入：所有 `status IN ('pending','active')` 的任务列表
输出：按时间排序的"占用快照"序列

```
1. 收集所有任务的 start 和 end，去重排序 → times[]
2. 对相邻 (times[i], times[i+1]) 形成区间
3. 在区间内累加所有 "start < t1 AND end > t0" 任务的 effort_percent
4. 标记 level：
     total > 100 → "error"
     total == 100 且由多任务组成 → "warning"
     total > 50 → "warning"
     其他 → "ok"
5. 返回序列给前端画堆叠面积图
```

复杂度 O(n·k)，n=时间点数，k=任务数。n≤500 时 <1ms。

---

## 4. 冲突检测算法

两两比较（O(n²)，n=任务数，通常 <200）：

```
对每对 (A, B)：
  overlap_start = max(A.start, B.start)
  overlap_end   = min(A.end,   B.end)
  if overlap_start < overlap_end:
    minutes = (overlap_end - overlap_start).num_minutes()
    peak_effort = A.effort + B.effort
    severity = if peak > 100 → "error" else "warning"
    写入 task_overlaps(A.id, B.id, minutes, severity)
```

注意：当前实现把"瞬时峰值"作为冲突度量。后续可扩展为"区间积分"。

---

## 5. 状态管理

Tauri 端（Rust）：
- `DbState { personal: Mutex<Connection>, conn: Mutex<Connection> }`
- `AppState { reminders: Arc<AsyncMutex<HashMap<task_id, AbortHandle>>>, force_rules: Arc<Mutex<Vec<ForceRule>>> }`

前端（TS）：
- 模块级变量 + 30s 轮询（`setInterval(loadAll, 30_000)`）
- 不引入 Redux/Zustand，保持轻量

---

## 6. 后台调度器

```
Tokio interval 30s
  ├─▶ 查"5min 内即将开始"的 pending 任务
  ├─▶ 对每条 spawn 一次性提醒（sleep + notify-rust）
  └─▶ 重算冲突（保持面板新鲜）
```

设计取舍：
- 用 Tokio 而非 cron，避免外部依赖
- 30s 节拍对桌面应用足够（秒级精度不必要）
- 提醒用 `tokio::spawn` + `sleep`，可通过 `AbortHandle` 取消

---

## 7. 强制规则引擎

```
进程监控（未来，阶段 2.2）
  └─▶ rules::check_force_rule(app_name)
        ├─▶ 命中规则？→ 返回 { required:true, interval, message }
        └─▶ 未命中 → { required:false }

前端
  └─▶ 弹窗"请先录入任务"
      ├─ 已录入 → record_force_response("allowed")
      ├─ 忽略   → record_force_response("ignored")
      └─ 阻断   → record_force_response("blocked") + 不启动目标 app
```

留痕目的：事后可导出"我每天被哪些软件打断"报告。

---

## 8. 跨平台适配矩阵

| 能力 | Linux (Debian) | Windows | macOS |
|---|---|---|---|
| 系统通知 | notify-rust (libnotify/dbus) | notify-rust (WinRT) | notify-rust (NS) |
| 托盘图标 | Tauri tray-icon | Tauri tray-icon | Tauri tray-icon |
| 进程检测 | `/proc` 扫描 | WMI / ETW | `libproc` |
| 路径 | `XDG_DATA_HOME` | `%APPDATA%` | `~/Library/Application Support` |
| 通知通道扩展 | sound/critical urgency | Toast 按钮/输入 | NSUserNotification |

Tauri 的 `AppHandle::path().app_data_dir()` 已抽象平台差异，DB 路径无需手写。

---

## 9. 安全与隐私

- 全部数据本地 SQLite，**无网络请求**（除非未来加 CalDAV）
- `force_events` 仅本地留痕，不上传
- 通知内容来自任务 title/description，需防注入？→ 当前信任本地用户输入
- 强制规则可阻断应用启动 → 仅本机生效，无远程控制面

---

## 10. 演进路线（与 DEV_PLAN 对齐）

| 阶段 | 架构变化 |
|---|---|
| 0.1 | 骨架 + IPC 通 |
| 0.2 | 加精力面板 + 冲突算法 + 单测 |
| 0.3 | 加 scheduler + reminder + 强制规则 |
| 0.4 | 加员工模块 + 多用户面板 |
| 0.5-1.0 | 前端框架迁移 + 跨平台验证 + 性能 |
| 1.x | 任务依赖 / 重复 / CalDAV / AI 预估 |
