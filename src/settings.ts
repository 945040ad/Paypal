import type { Db } from "./db";
import type { Mode } from "./gate/gate";

/** The gate mode is a server-side setting. The agent and its model have no way to read or change it. */
export function getMode(db: Db): Mode {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'gate_mode'").get() as { value: string } | undefined;
  return row?.value === "OBSERVE" ? "OBSERVE" : "ENFORCE";
}

export function setMode(db: Db, mode: Mode): Mode {
  db.prepare("INSERT INTO settings (key, value) VALUES ('gate_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode);
  return mode;
}
