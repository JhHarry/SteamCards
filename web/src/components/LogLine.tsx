import { clockTime } from "../lib/format";
import type { LogEntry } from "../types";

export default function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className={`log-line log-${entry.level}`}>
      <span className="log-time">{clockTime(entry.ts)}</span>
      <span className="log-level">{entry.level}</span>
      <span className="log-message">{entry.message}</span>
    </div>
  );
}
