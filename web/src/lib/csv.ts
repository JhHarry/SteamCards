import type { CardRow, Summary } from "../types";

/** Client-side CSV export so mock mode can still hand out files. */

function escapeCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

const DETAIL_HEADERS = [
  "hash",
  "name",
  "game",
  "appid",
  "foil",
  "count",
  "marketable",
  "tradable",
  "lowest",
  "value",
  "volume",
  "status",
];

export function rowsToCsv(rows: CardRow[]): string {
  return toCsv(
    DETAIL_HEADERS,
    rows.map((row) => [
      row.hash,
      row.name,
      row.game,
      row.appid,
      row.foil ? "yes" : "no",
      row.count,
      row.marketable ? "yes" : "no",
      row.tradable ? "yes" : "no",
      row.lowest == null ? "" : row.lowest.toFixed(2),
      row.value.toFixed(2),
      row.volume ?? "",
      row.status,
    ]),
  );
}

const SUMMARY_HEADERS = [
  "steamid64",
  "nickname",
  "currency",
  "card_types",
  "card_copies",
  "games",
  "foil_types",
  "priced_types",
  "unpriced_types",
  "sellable_copies",
  "gross_value",
  "fee_rate",
  "net_value",
  "generated_at",
];

export function summaryToCsv(summary: Summary): string {
  return toCsv(SUMMARY_HEADERS, [
    [
      summary.steamid64,
      summary.nickname,
      summary.currency,
      summary.types,
      summary.copies,
      summary.games,
      summary.foil_types,
      summary.priced,
      summary.unpriced,
      summary.sellable,
      summary.gross.toFixed(2),
      summary.fee.toFixed(2),
      summary.net.toFixed(2),
      summary.generated_at,
    ],
  ]);
}

export function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
