#!/usr/bin/env node
/**
 * One-time, offline rotation of retained v71 sandboxes after the v72 personal
 * account runtime is deployed. The chat database and external paused sandbox
 * are not deleted. Run only with the control plane stopped and a whole-volume
 * backup already verified. Without --execute this is a read-only preflight.
 */

import { DatabaseSync } from "node:sqlite";

const execute = process.argv.includes("--execute");
const ids = process.argv.slice(2).filter((arg) => arg !== "--execute");
if (ids.length === 0 || ids.some((id) => !/^[0-9a-f]{32}$/.test(id))) {
  throw new Error("Pass one or more exact 32-character session IDs");
}

for (const id of ids) {
  const db = new DatabaseSync(`/data/sessions/${id}.db`, { readOnly: !execute });
  try {
    const session = db.prepare("SELECT status FROM session LIMIT 1").get();
    const sandbox = db
      .prepare("SELECT status, modal_object_id, runtime_version FROM sandbox LIMIT 1")
      .get();
    const rawPreservation = db
      .prepare("SELECT state FROM sandbox_preservation WHERE singleton = 1")
      .get();
    const preservation = rawPreservation ? JSON.parse(rawPreservation.state) : null;
    const outstanding = db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE status IN ('processing', 'queued')")
      .get();
    if (
      session?.status !== "completed" ||
      sandbox?.status !== "stopped" ||
      !sandbox.runtime_version?.startsWith("v71-") ||
      !sandbox.modal_object_id ||
      preservation?.phase !== "saved" ||
      preservation?.receipt?.kind !== "retained" ||
      preservation.receipt.artifactId !== sandbox.modal_object_id ||
      outstanding?.count !== 0
    ) {
      throw new Error(`${id}: retained sandbox is not in the expected safe state`);
    }
    console.log(
      `${id}: ${execute ? "rotating" : "ready to rotate"} retained sandbox ${sandbox.modal_object_id}`
    );
    if (!execute) continue;

    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          `UPDATE sandbox SET status = 'failed', modal_object_id = NULL,
           snapshot_id = NULL, snapshot_image_id = NULL, snapshot_runtime_version = NULL,
           runtime_version = NULL, auth_token = NULL, auth_token_hash = '',
           active_socket_id = '', fenced = 1, last_heartbeat = NULL,
           code_server_url = NULL, code_server_password = NULL,
           vnc_url = NULL, vnc_password = NULL, tunnel_urls = NULL,
           ttyd_url = NULL, ttyd_token = NULL,
           spawn_failure_count = 0, last_spawn_failure = NULL,
           last_spawn_error = NULL, last_spawn_error_at = NULL
           WHERE status = 'stopped' AND modal_object_id = ? AND runtime_version = ?`
        )
        .run(sandbox.modal_object_id, sandbox.runtime_version);
      if (result.changes !== 1) throw new Error(`${id}: sandbox changed during rotation`);
      const removed = db.prepare("DELETE FROM sandbox_preservation WHERE singleton = 1").run();
      if (removed.changes !== 1) throw new Error(`${id}: preservation receipt changed`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") {
      throw new Error(`${id}: SQLite quick_check failed after rotation`);
    }
  } finally {
    db.close();
  }
}
