// conflict.rs — 时间冲突检测 + 精力占用聚合
//
// 规则（与需求一一对应）：
//   • 同一时刻多个任务 effort 之和：
//       ≤ 100% → 正常
//       > 100% → "error" 红色
//       单任务重叠 1 次（即 50%×2 = 100%）→ "warning" 黄色
//   • 重叠任务时间区间交集 > 0 即视为冲突

use std::sync::Mutex;
use rusqlite::{params, Connection};
use crate::db::DbState;
use crate::task::{ConflictItem, TaskRow};

/// 重新计算所有冲突并写回 task_overlaps 表
/// 由 task 的 create/update/delete/complete/postpone 调用
pub fn recompute_all(db: &DbState) -> rusqlite::Result<()> {
    let conn = db.personal.lock().unwrap();
    recompute_with_conn(&conn)
}

/// 允许外部传入连接（避免重复加锁）
pub fn recompute_with_conn(conn: &Connection) -> rusqlite::Result<()> {
    // 1. 拉取所有未完成任务
    let mut stmt = conn.prepare(
        "SELECT id,start_time,end_time,effort_percent FROM tasks
         WHERE status IN ('pending','active') ORDER BY start_time"
    )?;
    let tasks: Vec<(String, String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // 2. 清空旧冲突记录
    conn.execute("DELETE FROM task_overlaps", [])?;

    // 3. 两两比较（O(n²)，n 通常 < 几百，足够）
    let now = chrono::Utc::now().to_rfc3339();
    for i in 0..tasks.len() {
        for j in (i + 1)..tasks.len() {
            let (id_a, sa, ea, ef_a) = &tasks[i];
            let (id_b, sb, eb, ef_b) = &tasks[j];

            // 时间解析
            let sa_t = parse(&sa);
            let ea_t = parse(&ea);
            let sb_t = parse(&sb);
            let eb_t = parse(&eb);
            if sa_t >= ea_t || sb_t >= eb_t { continue; }

            // 是否有交集
            let over_start = sa_t.max(sb_t);
            let over_end   = ea_t.min(eb_t);
            if over_start >= over_end { continue; }

            let minutes = (over_end - over_start).num_minutes() as i64;
            if minutes <= 0 { continue; }

            // 交集区间内的"瞬时占用" = 两任务 effort 之和
            let peak = ef_a + ef_b;

            let severity = if peak > 100 { "error".to_string() }
                          else if *ef_a == 50 && *ef_b == 50 { "warning".to_string() }
                          else if peak == 100 { "warning".to_string() }
                          else { "warning".to_string() };

            conn.execute(
                "INSERT INTO task_overlaps (task_a_id,task_b_id,overlap_minutes,severity,detected_at)
                 VALUES (?1,?2,?3,?4,?5)",
                params![id_a, id_b, minutes, severity, now.clone()],
            )?;
        }
    }
    Ok(())
}

/// 给前端用：返回冲突列表（已被 task.rs 的 get_conflict_report 包装）
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ConflictItem>> {
    let mut s = conn.prepare(
        "SELECT task_a_id,task_b_id,overlap_minutes,severity,
                (SELECT start_time FROM tasks WHERE id=task_a_id)||'-'||(SELECT end_time FROM tasks WHERE id=task_a_id)
         FROM task_overlaps ORDER BY overlap_minutes DESC"
    )?;
    let rows = s.query_map([], |r| Ok(ConflictItem {
        task_a_id: r.get(0)?, task_b_id: r.get(1)?,
        overlap_minutes: r.get(2)?, severity: r.get(3)?,
        time_range: r.get(4)?,
    }))?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

// ─── helpers ──────────────────────────────────────────
fn parse(s: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now())
}

/// 实时检查单条新任务是否会冲突（用于前端"保存前预览"）
pub fn check_one_against_existing(
    conn: &Connection,
    new_start: &str,
    new_end: &str,
    new_effort: i64,
) -> rusqlite::Result<Vec<ConflictItem>> {
    let mut stmt = conn.prepare(
        "SELECT id,start_time,end_time,effort_percent FROM tasks
         WHERE status IN ('pending','active')"
    )?;
    let existing: Vec<(String, String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let ns = parse(new_start);
    let ne = parse(new_end);
    let mut out = Vec::new();
    for (id, s, e, ef) in existing {
        let ts = parse(&s); let te = parse(&e);
        let o_start = ns.max(ts); let o_end = ne.min(te);
        if o_start >= o_end { continue; }
        let mins = (o_end - o_start).num_minutes() as i64;
        let peak = new_effort + ef;
        let sev = if peak > 100 { "error" } else { "warning" };
        out.push(ConflictItem {
            task_a_id: "new".into(), task_b_id: id,
            overlap_minutes: mins, severity: sev.into(),
            time_range: format!("{}-{}", ns, ne),
        });
    }
    Ok(out)
}
