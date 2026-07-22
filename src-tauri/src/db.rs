// db.rs — SQLite 初始化 + 表结构 + 连接管理
//
// 数据库放在应用数据目录：AppData/yixiu-todos/yixiu-todos.db
// 使用 rusqlite（同步）+ Mutex 包装，通过 Tauri State 共享

use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::{Connection, Result as SqlResult};
use tauri::{AppHandle, Manager};

/// 应用共享的数据库状态
pub struct DbState {
    /// 个人任务库
    pub personal: Mutex<Connection>,
    /// 员工库（可拆独立文件，这里统一一个文件多张表）
    pub conn: Mutex<Connection>,
}

/// 取数据库文件路径
pub fn db_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("无法获取应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("yixiu-todos.db"))
}

/// 打开连接
fn open(path: &PathBuf) -> SqlResult<Connection> {
    Connection::open(path)
}

/// 建表（幂等）
fn create_schema(conn: &Connection) -> SqlResult<()> {
    // ─── 个人任务表 ───────────────────────────────────────
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS tasks (
            id              TEXT PRIMARY KEY,            -- UUID
            title           TEXT NOT NULL,
            description     TEXT DEFAULT '',
            priority        INTEGER NOT NULL DEFAULT 2,  -- 1=紧急 2=高 3=中 4=低
            start_time      TEXT NOT NULL,               -- ISO 8601
            end_time        TEXT NOT NULL,
            effort_percent  INTEGER NOT NULL DEFAULT 100,-- 精力占用百分比
            status          TEXT NOT NULL DEFAULT 'pending', -- pending/active/done/postponed
            category        TEXT DEFAULT 'personal',    -- personal/work/study/...
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            parent_id       TEXT,                       -- 关联父任务（延后/拆分）
            FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_start ON tasks(start_time);
        CREATE INDEX IF NOT EXISTS idx_tasks_end   ON tasks(end_time);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

        -- 任务依赖/重叠记录（用于冲突分析）
        CREATE TABLE IF NOT EXISTS task_overlaps (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            task_a_id   TEXT NOT NULL,
            task_b_id   TEXT NOT NULL,
            overlap_minutes INTEGER NOT NULL,
            severity    TEXT NOT NULL DEFAULT 'warning', -- warning/error
            detected_at TEXT NOT NULL,
            FOREIGN KEY (task_a_id) REFERENCES tasks(id),
            FOREIGN KEY (task_b_id) REFERENCES tasks(id)
        );

        -- 提醒规则
        CREATE TABLE IF NOT EXISTS reminders (
            id          TEXT PRIMARY KEY,
            task_id     TEXT NOT NULL,
            trigger_at  TEXT NOT NULL,  -- ISO 8601
            channel     TEXT NOT NULL DEFAULT 'desktop', -- desktop/sound/email
            message     TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending',
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        -- 强制录入规则（哪些软件必须先录入任务才能用）
        CREATE TABLE IF NOT EXISTS force_rules (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name    TEXT NOT NULL UNIQUE,   -- 进程名或应用标识
            enabled     INTEGER NOT NULL DEFAULT 1,
            remind_interval_sec INTEGER NOT NULL DEFAULT 300, -- 每隔几分钟提醒
            created_at  TEXT NOT NULL
        );

        -- 强制录入事件日志
        CREATE TABLE IF NOT EXISTS force_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name    TEXT NOT NULL,
            detected_at TEXT NOT NULL,
            action      TEXT NOT NULL, -- warned/blocked/allowed
            user_response TEXT
        );
        "#,
    )?;

    // ─── 员工表 ───────────────────────────────────────────
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS employees (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            role        TEXT DEFAULT '',
            email       TEXT DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'active', -- active/leave/resigned
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS employee_tasks (
            id              TEXT PRIMARY KEY,
            employee_id     TEXT NOT NULL,
            title           TEXT NOT NULL,
            description     TEXT DEFAULT '',
            priority        INTEGER NOT NULL DEFAULT 2,
            start_time      TEXT NOT NULL,
            end_time        TEXT NOT NULL,
            effort_percent  INTEGER NOT NULL DEFAULT 100,
            progress        INTEGER NOT NULL DEFAULT 0,  -- 0-100
            status          TEXT NOT NULL DEFAULT 'pending',
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_emp_tasks_emp ON employee_tasks(employee_id);
        CREATE INDEX IF NOT EXISTS idx_emp_tasks_start ON employee_tasks(start_time);
        "#,
    )?;

    // ─── STAR 任务事件表 ────────────────────────────────────
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS task_events (
            id            TEXT PRIMARY KEY,
            task_id       TEXT NOT NULL,
            star_section  TEXT NOT NULL CHECK(star_section IN ('S','T','A','R')),
            content       TEXT NOT NULL,
            event_type    TEXT NOT NULL DEFAULT 'note',
            created_at    TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_events_section ON task_events(task_id, star_section);

        -- 暂停记录
        CREATE TABLE IF NOT EXISTS task_pauses (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id   TEXT NOT NULL,
            paused_at TEXT NOT NULL,
            resumed_at TEXT,
            reason    TEXT,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_pauses_task ON task_pauses(task_id);
        "#,
    )?;

    Ok(())
}

/// 初始化数据库（在 setup 中调用）
pub fn init_db(app: &AppHandle) -> anyhow::Result<DbState> {
    let path = db_path(app)?;
    log::info!("数据库路径: {}", path.display());

    let conn = open(&path)?;
    conn.pragma_update(None, "journal_mode", &"WAL")?;
    conn.pragma_update(None, "foreign_keys", &true)?;
    create_schema(&conn)?;

    Ok(DbState {
        personal: Mutex::new(conn),
        conn: Mutex::new(open(&path)?), // 第二连接给员工库用（可拆文件）
    })
}
