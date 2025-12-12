import fs from "node:fs/promises";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";

export async function readCsvPossiblyGbk(filePath: string): Promise<Record<string, string>[]> {
  const buf = await fs.readFile(filePath);

  // 经验：该数据集的 CSV 多为 GBK/GB18030；如果本身就是 UTF-8，这里也能正常解码大部分 ASCII 字段。
  const text = iconv.decode(buf, "gb18030");

  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  }) as Record<string, string>[];

  return records;
}


