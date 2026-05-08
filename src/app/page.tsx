"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

type HolidayMap = Record<string, string>;

type DateItem = {
  date: string;
  isTradingDay: boolean;
};

type QuerySuggestion = {
  suggestQuery: string;
  begin?: number;
  end?: number;
};

type SearchOption = {
  label: string;
  value: string;
};

type StockColumn = {
  key: string;
  title: string;
  minWidth?: number;
  sortable?: boolean;
  redGreenAble?: boolean;
  dataType?: string;
  unit?: string;
  dateMsg?: string;
  children?: StockColumn[];
};

type RawStockColumn = StockColumn & {
  hiddenNeed?: boolean;
  children?: RawStockColumn[];
};

type StockRow = Record<string, unknown> & {
  SECURITY_CODE?: string;
  SECURITY_SHORT_NAME?: string;
};

type GubaMap = Record<string, { count: number }>;

type ResultRow = {
  stockName: string;
  code: string;
  guba: GubaMap;
  trend: string;
};

type Feedback = {
  type: "error" | "info" | "success";
  text: string;
};

type SortDirection = "asc" | "desc";

type StockTableSort = {
  key: string;
  direction: SortDirection;
};

type ProxyRequestOptions = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  data?: unknown;
};

type ParsedExpressionItem = {
  date: string;
  rate: number;
  dateLabel: string;
};

type ParsedExpression = {
  items: ParsedExpressionItem[];
  aggType: "none" | "sum" | "avg" | "each";
  funcStr: string | null;
  label: string;
};

type MannKendallResult = {
  S: number;
  varS: number;
  Z: number;
  trend: "increasing" | "decreasing" | "no trend";
  pValue: number;
};

const PROXY_ENDPOINT = "https://api.niumengke.top/koa/proxy";
const MAX_HISTORY_COUNT = 5;

const HIDDEN_COLUMNS: Record<string, boolean> = {
  SERIAL: true,
  SECURITY_CODE: true,
  SECURITY_SHORT_NAME: true,
  MARKET_SHORT_NAME: true,
  MARKET_NUM: true,
};

const CN_NUM_MAP: Record<string, number> = {
  "零": 0,
  "〇": 0,
  "一": 1,
  "二": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
  "十": 10,
  "十一": 11,
  "十二": 12,
  "十三": 13,
  "十四": 14,
  "十五": 15,
  "十六": 16,
  "十七": 17,
  "十八": 18,
  "十九": 19,
  "二十": 20,
  "二十一": 21,
  "二十二": 22,
  "二十三": 23,
  "二十四": 24,
  "二十五": 25,
  "二十六": 26,
  "二十七": 27,
  "二十八": 28,
  "二十九": 29,
  "三十": 30,
  "三十一": 31,
};

const RATE_MAP = [
  { pattern: /一半|1\/2|二分之一|50%/, value: 0.5, label: "×0.5" },
  { pattern: /两倍|2倍|二倍/, value: 2, label: "×2" },
  { pattern: /三分之一|1\/3/, value: 1 / 3, label: "×0.33" },
  { pattern: /三倍|3倍/, value: 3, label: "×3" },
  { pattern: /四分之一|1\/4|25%/, value: 0.25, label: "×0.25" },
  { pattern: /四分之三|3\/4|75%/, value: 0.75, label: "×0.75" },
];

function safeParseStringArray(value: string | null, fallback: string[] = []): string[] {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return fallback;
  }
}


function pad2(value: number): string {
  return String(value).padStart(2, "0");
}


function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}


function formatCompactDate(date: Date): string {
  return formatDate(date).replace(/-/g, "");
}


function shiftDate(source: Date, days: number): Date {
  const next = new Date(source);
  next.setDate(next.getDate() + days);
  return next;
}


function parseCompactDate(value: string): Date {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  return new Date(year, month, day);
}


async function proxyRequest<T>({
  url,
  method = "GET",
  headers,
  data,
}: ProxyRequestOptions): Promise<T> {
  const response = await fetch(PROXY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      method,
      headers,
      data,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(typeof payload === "string" ? payload : JSON.stringify(payload));
  }

  return payload as T;
}


function parseHolidayCalendar(data: string): HolidayMap {
  const holidays: HolidayMap = {};
  const events = data.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g) || [];

  events.forEach((event) => {
    const start = event.match(/DTSTART;VALUE=DATE:(\d{8})/);
    const end = event.match(/DTEND;VALUE=DATE:(\d{8})/);
    const summary =
      event.match(/SUMMARY;LANGUAGE=zh_CN:(.*)/) || event.match(/SUMMARY:(.*)/);

    if (!start || !end || !summary) {
      return;
    }

    let currentDate = parseCompactDate(start[1]);
    const endDate = shiftDate(parseCompactDate(end[1]), -1);

    while (currentDate <= endDate) {
      holidays[formatCompactDate(currentDate)] = summary[1].trim();
      currentDate = shiftDate(currentDate, 1);
    }
  });

  return holidays;
}


function isTradingDay(dateStr: string, holidays: HolidayMap): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekDay = date.getDay();
  const compactDate = dateStr.replace(/-/g, "");

  return weekDay !== 0 && weekDay !== 6 && holidays[compactDate] === undefined;
}


function getTradingDays(holidays: HolidayMap, targetLength = 15): DateItem[] {
  const dates: DateItem[] = [];
  let cursor = new Date();

  while (dates.length < targetLength) {
    const dateStr = formatDate(cursor);
    dates.push({
      date: dateStr,
      isTradingDay: isTradingDay(dateStr, holidays),
    });
    cursor = shiftDate(cursor, -1);
  }

  return dates;
}


function getVisibleDateList(dateList: DateItem[], onlyTradingDay: 1 | 2): DateItem[] {
  if (onlyTradingDay === 1) {
    return dateList.filter((item) => item.isTradingDay);
  }

  return dateList;
}


function resolveQuickSelect(
  dateList: DateItem[],
  onlyTradingDay: 1 | 2,
  quickSelectType: number,
): string[] {
  if (!quickSelectType) {
    return [];
  }

  return getVisibleDateList(dateList, onlyTradingDay)
    .filter((item) => item.isTradingDay)
    .slice(0, quickSelectType)
    .map((item) => item.date);
}


function formatCellValue(value: unknown, column: StockColumn): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const strValue = String(value);
  const isChangeRate =
    !!column.key &&
    (column.key === "CHG" || column.key.startsWith("CHG{") || column.unit === "%");

  if (isChangeRate && !strValue.includes("%")) {
    const numValue = Number.parseFloat(strValue);
    if (!Number.isNaN(numValue)) {
      return `${strValue}%`;
    }
  }

  return strValue;
}


function getCellClass(column: StockColumn, value: unknown): string {
  if (!column.redGreenAble || value === null || value === undefined || value === "") {
    return "text-slate-700";
  }

  const numValue = Number.parseFloat(String(value));
  if (Number.isNaN(numValue)) {
    return "text-slate-700";
  }

  if (numValue > 0) {
    return "text-red-500";
  }

  if (numValue < 0) {
    return "text-emerald-600";
  }

  return "text-slate-700";
}


function getBarWidth(count: number, gubaData: GubaMap): number {
  const maxCount = Math.max(
    ...Object.values(gubaData).map((item) => item.count || 0),
    0,
  );

  if (!count || maxCount === 0) {
    return 0;
  }

  const percentage = (count / maxCount) * 100;
  return Math.max(5, Math.min(100, percentage));
}


function normalizeSortValue(value: unknown): number | string {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const maybeNumber = Number(value.replace(/,/g, "").replace(/%$/, ""));
    if (!Number.isNaN(maybeNumber)) {
      return maybeNumber;
    }

    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}


function compareValues(a: unknown, b: unknown): number {
  const left = normalizeSortValue(a);
  const right = normalizeSortValue(b);

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "zh-CN");
}


// 控制并发，避免帖子接口一次性打满。
async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  limit = 5,
): Promise<void> {
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;

      try {
        await worker(items[currentIndex], currentIndex);
      } catch (error) {
        console.error("任务执行失败:", error);
      }
    }
  });

  await Promise.all(runners);
}


function getCriticalValue(alpha: number): number {
  const criticalValues: Record<number, number> = {
    0.001: 3.29,
    0.01: 2.58,
    0.05: 1.96,
    0.1: 1.65,
  };

  const levels = Object.keys(criticalValues)
    .map(Number)
    .sort((a, b) => b - a);

  for (const level of levels) {
    if (alpha >= level) {
      return criticalValues[level];
    }
  }

  return criticalValues[0.05];
}


function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const normalizedX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * normalizedX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t *
      Math.exp(-normalizedX * normalizedX));

  return 0.5 * (1 + sign * y);
}


function mannKendall(data: number[], alpha = 0.05): Partial<MannKendallResult> {
  if (!Array.isArray(data) || data.length < 3) {
    return {};
  }

  const n = data.length;
  let S = 0;

  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const diff = data[j] - data[i];
      if (diff > 0) {
        S += 1;
      } else if (diff < 0) {
        S -= 1;
      }
    }
  }

  const valueCounts: Record<string, number> = {};
  data.forEach((value) => {
    const key = String(value);
    valueCounts[key] = (valueCounts[key] || 0) + 1;
  });

  let tieCorrection = 0;
  Object.values(valueCounts).forEach((count) => {
    if (count > 1) {
      tieCorrection += count * (count - 1) * (2 * count + 5);
    }
  });

  const varS = (n * (n - 1) * (2 * n + 5) - tieCorrection) / 18;
  let Z = 0;

  if (S > 0) {
    Z = (S - 1) / Math.sqrt(varS);
  } else if (S < 0) {
    Z = (S + 1) / Math.sqrt(varS);
  }

  let trend: MannKendallResult["trend"] = "no trend";
  const criticalValue = getCriticalValue(alpha);

  if (Z > criticalValue) {
    trend = "increasing";
  } else if (Z < -criticalValue) {
    trend = "decreasing";
  }

  const pValue = 2 * (1 - normalCDF(Math.abs(Z)));

  return {
    S,
    varS,
    Z: Number(Z.toFixed(2)),
    trend,
    pValue: Number(pValue.toFixed(4)),
  };
}


function parseCnNum(value: string): number | null {
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return CN_NUM_MAP[value] ?? null;
}


function buildItemStr(item: ParsedExpressionItem): string {
  const base = `(guba['${item.date}']?.count || 0)`;
  return item.rate !== 1 ? `(${base} * ${item.rate})` : base;
}


function buildMultiStr(items: ParsedExpressionItem[], aggType: "sum" | "avg"): string {
  const parts = items.map((item) => buildItemStr(item));

  if (aggType === "avg") {
    return `((${parts.join(" + ")}) / ${items.length})`;
  }

  return `(${parts.join(" + ")})`;
}


function buildMultiLabel(items: ParsedExpressionItem[], aggType: "sum" | "avg"): string {
  const labels = items.map((item) => item.dateLabel || item.date);

  if (aggType === "avg") {
    return `avg(${labels.join(", ")})`;
  }

  return `(${labels.join(" + ")})`;
}


function resolveRelativeDate(offset: number, dataType: string[]): string {
  if (dataType.length > offset) {
    return dataType[offset];
  }

  return formatDate(shiftDate(new Date(), -offset));
}


function extractDateAndRate(
  text: string,
  dataType: string[],
): { date: string | null; rate: number; rateLabel: string } {
  let date: string | null = null;
  let rate = 1;
  let rateLabel = "";
  const clean = text.replace(/的$/, "").trim();

  const fullMatch = clean.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (fullMatch) {
    date = `${fullMatch[1]}-${fullMatch[2].padStart(2, "0")}-${fullMatch[3].padStart(2, "0")}`;
  }

  if (!date) {
    const monthDayMatch = clean.match(
      /([\d一二三四五六七八九十]+)月([\d一二三四五六七八九十]+)[号日]/,
    );

    if (monthDayMatch) {
      const month = parseCnNum(monthDayMatch[1]);
      const day = parseCnNum(monthDayMatch[2]);

      if (month && day) {
        const currentYear = new Date().getFullYear();
        const fullDate = `${currentYear}-${pad2(month)}-${pad2(day)}`;
        date = dataType.find((item) => item === fullDate) || fullDate;
      }
    }
  }

  if (!date) {
    const shortMatch = clean.match(/(\d{1,2})-(\d{1,2})/);
    if (shortMatch && !clean.match(/\d{4}-/)) {
      const currentYear = new Date().getFullYear();
      date = `${currentYear}-${shortMatch[1].padStart(2, "0")}-${shortMatch[2].padStart(2, "0")}`;
    }
  }

  if (!date) {
    const dayMatch = clean.match(/([\d一二三四五六七八九十]+)[号日]/);
    if (dayMatch) {
      const dayNum = parseCnNum(dayMatch[1]);

      if (dayNum) {
        const dayText = pad2(dayNum);
        date = dataType.find((item) => item.endsWith(`-${dayText}`)) || null;

        if (!date) {
          const today = new Date();
          date = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${dayText}`;
        }
      }
    }
  }

  if (!date) {
    if (/今天|今日|当天|当日/.test(clean)) {
      date = resolveRelativeDate(0, dataType);
    } else if (/昨天|昨日/.test(clean)) {
      date = resolveRelativeDate(1, dataType);
    } else if (/前天|前日/.test(clean)) {
      date = resolveRelativeDate(2, dataType);
    } else if (/上一个交易日|上个交易日|前一个交易日/.test(clean)) {
      date = resolveRelativeDate(1, dataType);
    }
  }

  if (!date) {
    const indexMatch = clean.match(/第([一二三四五六七八九十\d]+)个/);
    if (indexMatch) {
      const index = parseCnNum(indexMatch[1]);
      if (index && index - 1 < dataType.length) {
        date = dataType[index - 1];
      }
    }
  }

  if (!date && /最新|最近|最后/.test(clean)) {
    date = dataType[0] || null;
  }

  for (const rateItem of RATE_MAP) {
    if (rateItem.pattern.test(clean)) {
      rate = rateItem.value;
      rateLabel = rateItem.label;
      break;
    }
  }

  return {
    date,
    rate,
    rateLabel,
  };
}


// 这段解析逻辑直接承接 Vue 版 NLP 规则，保证旧输入习惯可以继续使用。
function parseExpression(text: string, dataType: string[]): ParsedExpression {
  let aggType: ParsedExpression["aggType"] = "none";
  let cleanText = text;

  if (/加起来|总和|之和|总计|相加/.test(text)) {
    aggType = "sum";
    cleanText = text.replace(/的?(加起来|总和|之和|总计|相加)/g, "").trim();
  } else if (/平均值?|均值/i.test(text)) {
    aggType = "avg";
    cleanText = text.replace(/的?(平均值?|均值)/gi, "").trim();
  }

  cleanText = cleanText.replace(/的$/, "").trim();

  const recentMatch = cleanText.match(/(最近|前|近|过去)(\d+|[一二三四五六七八九十]+)[天个日]/);
  if (recentMatch && dataType.length > 0) {
    const keyword = recentMatch[1];
    const count = parseCnNum(recentMatch[2]);
    const excludeToday = /前|过去/.test(keyword);
    const startIndex = excludeToday ? 1 : 0;

    if (count && startIndex + count <= dataType.length) {
      const items = dataType.slice(startIndex, startIndex + count).map((date) => ({
        date,
        rate: 1,
        dateLabel: date,
      }));

      if (aggType === "none") {
        aggType = "avg";
      }

      const prefix = excludeToday ? "前" : "最近";
      return {
        items,
        aggType,
        funcStr: buildMultiStr(items, aggType === "sum" ? "sum" : "avg"),
        label: `${prefix}${count}天${aggType === "avg" ? "平均" : "总和"}`,
      };
    }
  }

  const hasSoftConnector = /和|跟|与/.test(cleanText);
  const hasHardConnector = /[+＋]/.test(cleanText) || /加(?!起来)/.test(cleanText);

  if (hasSoftConnector || hasHardConnector) {
    const parts = cleanText
      .split(/[和跟与＋+]|加(?!起来)/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      const items: ParsedExpressionItem[] = [];

      parts.forEach((part) => {
        const result = extractDateAndRate(part, dataType);
        if (result.date) {
          items.push({
            date: result.date,
            rate: result.rate,
            dateLabel: result.date + (result.rateLabel || ""),
          });
        }
      });

      if (items.length >= 2) {
        if (aggType === "none") {
          aggType = hasHardConnector ? "sum" : "each";
        }

        if (aggType === "each") {
          return {
            items,
            aggType,
            funcStr: null,
            label: items.map((item) => item.dateLabel).join("和"),
          };
        }

        return {
          items,
          aggType,
          funcStr: buildMultiStr(items, aggType === "sum" ? "sum" : "avg"),
          label: buildMultiLabel(items, aggType === "sum" ? "sum" : "avg"),
        };
      }
    }
  }

  const single = extractDateAndRate(cleanText, dataType);
  if (single.date) {
    const item = {
      date: single.date,
      rate: single.rate,
      dateLabel: single.date + (single.rateLabel || ""),
    };

    return {
      items: [item],
      aggType: "none",
      funcStr: buildItemStr(item),
      label: item.dateLabel,
    };
  }

  return {
    items: [],
    aggType: "none",
    funcStr: "",
    label: "",
  };
}


function parseUserPrompt(
  prompt: string,
  dataType: string[],
): { feature: string; label: string; error: string | null } {
  if (!prompt.trim()) {
    return {
      feature: "",
      label: "",
      error: "请输入筛选条件",
    };
  }

  const text = prompt
    .trim()
    .replace(/[，。！？;\s]+/g, " ")
    .replace(/的?帖子数量?/g, "")
    .replace(/的?数量/g, "")
    .trim();

  const match = text.match(/^(.+?)比(.+)$/);
  if (!match) {
    return {
      feature: "",
      label: "",
      error: '未识别到"比"字，请使用"A比B多/少"的格式',
    };
  }

  const leftText = match[1].trim();
  let rightText = match[2].trim();
  let comparison: "> 0" | "< 0" | null = null;
  let comparisonLabel = "";

  const comparisonMatch = rightText.match(/[，, ]*((?:都|还|要|也)*(?:多|少))\s*$/);
  if (comparisonMatch) {
    if (/多/.test(comparisonMatch[1])) {
      comparison = "> 0";
      comparisonLabel = "多";
    } else {
      comparison = "< 0";
      comparisonLabel = "少";
    }

    rightText = rightText.slice(0, rightText.length - comparisonMatch[0].length).trim();
  }

  if (!comparison) {
    return {
      feature: "",
      label: "",
      error: '未识别到比较关系，请在末尾加上"多"或"少"',
    };
  }

  const left = parseExpression(leftText, dataType);
  const right = parseExpression(rightText, dataType);

  if (!left.items.length) {
    return {
      feature: "",
      label: "",
      error: `未能解析左侧: "${leftText}"`,
    };
  }

  if (!right.items.length) {
    return {
      feature: "",
      label: "",
      error: `未能解析右侧: "${rightText}"`,
    };
  }

  let leftFuncStr = left.funcStr;
  let rightFuncStr = right.funcStr;
  let leftLabel = left.label;
  let rightLabel = right.label;

  if (right.aggType === "each" && right.items.length > 1) {
    const fnName = comparison === "> 0" ? "Math.max" : "Math.min";
    rightFuncStr = `${fnName}(${right.items.map((item) => buildItemStr(item)).join(", ")})`;
    rightLabel = `${right.items.map((item) => item.dateLabel).join("和")}(每个)`;
  }

  if (left.aggType === "each" && left.items.length > 1) {
    const fnName = comparison === "> 0" ? "Math.min" : "Math.max";
    leftFuncStr = `${fnName}(${left.items.map((item) => buildItemStr(item)).join(", ")})`;
    leftLabel = `${left.items.map((item) => item.dateLabel).join("和")}(每个)`;
  }

  const warnings: string[] = [];
  if (dataType.length > 0) {
    const allDates = [...new Set([...left.items, ...right.items].map((item) => item.date))];
    allDates.forEach((date) => {
      if (!dataType.includes(date)) {
        warnings.push(`"${date}" 不在已选日期中`);
      }
    });
  }

  return {
    feature: `(guba) => ${leftFuncStr} - ${rightFuncStr} ${comparison}`,
    label: `${leftLabel} 比 ${rightLabel} ${comparisonLabel}`,
    error: warnings.length > 0 ? `⚠️ ${warnings.join("；")}` : null,
  };
}


function generateFeatureOptions(dataType: string[]): SearchOption[] {
  if (!Array.isArray(dataType) || dataType.length < 2) {
    return [];
  }

  const options: SearchOption[] = [];

  for (let index = 0; index < dataType.length - 1; index += 1) {
    const date1 = dataType[index];
    const date2 = dataType[index + 1];

    options.push({
      label: `${date1}比${date2}多`,
      value: `(guba) => (guba['${date1}']?.count || 0) - (guba['${date2}']?.count || 0) > 0`,
    });

    options.push({
      label: `${date1}比${date2}少`,
      value: `(guba) => (guba['${date1}']?.count || 0) - (guba['${date2}']?.count || 0) < 0`,
    });
  }

  return options;
}


export default function Home() {
  const [trend, setTrend] = useState("");
  const [feature, setFeature] = useState("");
  const [queryCondition, setQueryCondition] = useState("");
  const [querySuggestions, setQuerySuggestions] = useState<QuerySuggestion[]>([]);
  const [holidays, setHolidays] = useState<HolidayMap>({});
  const [dataType, setDataType] = useState<string[]>([]);
  const [dateList, setDateList] = useState<DateItem[]>([]);
  const [featureOptions, setFeatureOptions] = useState<SearchOption[]>([]);
  const [tableData, setTableData] = useState<ResultRow[]>([]);
  const [stockList, setStockList] = useState<StockRow[]>([]);
  const [tableColumns, setTableColumns] = useState<StockColumn[]>([]);
  const [stockCodes, setStockCodes] = useState<string[]>([]);
  const [stockSearchOptions, setStockSearchOptions] = useState<SearchOption[]>([]);
  const [stockSearchKeyword, setStockSearchKeyword] = useState("");
  const [onlyTradingDay, setOnlyTradingDay] = useState<1 | 2>(1);
  const [quickSelectType, setQuickSelectType] = useState(0);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingStockCondition, setIsFetchingStockCondition] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [parsedLabel, setParsedLabel] = useState("");
  const [parseError, setParseError] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showQuerySuggestionMenu, setShowQuerySuggestionMenu] = useState(false);
  const [querySuggestionActiveIndex, setQuerySuggestionActiveIndex] = useState(0);
  const [showStockOptionMenu, setShowStockOptionMenu] = useState(false);
  const [stockTableSort, setStockTableSort] = useState<StockTableSort | null>(null);
  const [resultDates, setResultDates] = useState<string[]>([]);

  const queryInputTimerRef = useRef<number | null>(null);
  const stockSearchTimerRef = useRef<number | null>(null);
  const queryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const queryConditionRef = useRef(queryCondition);
  const stockSearchKeywordRef = useRef(stockSearchKeyword);
  // 跟踪查询输入框的 IME（拼音/汉字）合成状态，避免拼音过程中每个字母都打到远程接口。
  const isQueryComposingRef = useRef(false);

  // 这些派生量只跟少量 state 有关，使用 useMemo 缓存，避免每次按键都重算（删字卡顿的主因）。
  const visibleDateList = useMemo(
    () => getVisibleDateList(dateList, onlyTradingDay),
    [dateList, onlyTradingDay],
  );
  const hasGroupedHeader = useMemo(
    () => tableColumns.some((column) => (column.children?.length || 0) > 0),
    [tableColumns],
  );

  queryConditionRef.current = queryCondition;
  stockSearchKeywordRef.current = stockSearchKeyword;

  useEffect(() => {
    let cancelled = false;

    const storedStockCodes = safeParseStringArray(localStorage.getItem("stockCodes"));
    const storedQueryHistory = safeParseStringArray(localStorage.getItem("queryHistory"));
    const storedQuickSelectType = Number(localStorage.getItem("quickSelectType") || "0") || 0;

    setStockCodes(storedStockCodes);
    setQueryHistory(storedQueryHistory);
    setQuickSelectType(storedQuickSelectType);

    async function bootstrap() {
      try {
        const calendarText = await proxyRequest<string>({
          url: "https://calendars.icloud.com/holidays/cn_zh.ics",
        });

        if (cancelled) {
          return;
        }

        const nextHolidays = parseHolidayCalendar(
          typeof calendarText === "string" ? calendarText : "",
        );
        const nextDateList = getTradingDays(nextHolidays);

        setHolidays(nextHolidays);
        setDateList(nextDateList);

        if (storedQuickSelectType) {
          setDataType(resolveQuickSelect(nextDateList, 1, storedQuickSelectType));
        }
      } catch (error) {
        console.error("节假日加载失败:", error);

        if (cancelled) {
          return;
        }

        const fallbackDateList = getTradingDays({});
        setDateList(fallbackDateList);
        setHolidays({});
        setFeedback({
          type: "error",
          text: "节假日加载失败，已使用周末规则兜底。",
        });

        if (storedQuickSelectType) {
          setDataType(resolveQuickSelect(fallbackDateList, 1, storedQuickSelectType));
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;

      if (queryInputTimerRef.current) {
        window.clearTimeout(queryInputTimerRef.current);
      }

      if (stockSearchTimerRef.current) {
        window.clearTimeout(stockSearchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("stockCodes", JSON.stringify(stockCodes));
  }, [stockCodes]);

  useEffect(() => {
    localStorage.setItem("queryHistory", JSON.stringify(queryHistory));
  }, [queryHistory]);

  useEffect(() => {
    localStorage.setItem("quickSelectType", String(quickSelectType));
  }, [quickSelectType]);

  useEffect(() => {
    setFeatureOptions(generateFeatureOptions(dataType));
  }, [dataType]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 4000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  // 把"特征字符串编译为函数"缓存到 feature 变化时，避免每次按键都 new Function 一次。
  const compiledFeature = useMemo<((guba: GubaMap) => boolean) | null>(() => {
    if (!feature) {
      return null;
    }

    try {
      return new Function(`return ${feature}`)() as (guba: GubaMap) => boolean;
    } catch (error) {
      console.error("解析特征函数失败:", error);
      return null;
    }
  }, [feature]);

  // 帖子表格的过滤结果只与 tableData / trend / compiledFeature 有关，缓存避免输入触发重算。
  const filteredTableData = useMemo(() => {
    return tableData.filter((item) => {
      if (trend && !item.trend.includes(trend)) {
        return false;
      }

      if (compiledFeature) {
        try {
          return compiledFeature(item.guba);
        } catch (error) {
          console.error("执行特征函数失败:", error);
          return false;
        }
      }

      return true;
    });
  }, [tableData, trend, compiledFeature]);

  // 股票表的排序拷贝代价较高（可能上千条），缓存到排序/数据真实变化时。
  const visibleStockList = useMemo(() => {
    if (!stockTableSort) {
      return stockList;
    }

    const next = [...stockList];
    next.sort((left, right) => {
      const result = compareValues(left[stockTableSort.key], right[stockTableSort.key]);
      return stockTableSort.direction === "asc" ? result : -result;
    });
    return next;
  }, [stockList, stockTableSort]);

  function pushFeedback(text: string, type: Feedback["type"] = "info") {
    setFeedback({
      type,
      text,
    });
  }


  function saveQueryHistory(query: string) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    setQueryHistory((previous) => {
      const next = previous.filter((item) => item !== trimmedQuery);
      next.unshift(trimmedQuery);
      return next.slice(0, MAX_HISTORY_COUNT);
    });
  }


  function handleDateToggle(date: string) {
    const nextSelected = new Set(dataType);

    if (nextSelected.has(date)) {
      nextSelected.delete(date);
    } else {
      nextSelected.add(date);
    }

    setDataType(visibleDateList.map((item) => item.date).filter((item) => nextSelected.has(item)));
  }


  function handleTradingDayModeChange(mode: 1 | 2) {
    setOnlyTradingDay(mode);

    if (mode === 1) {
      const nextVisibleDates = getVisibleDateList(dateList, mode);
      setDataType(
        nextVisibleDates
          .filter((item) => dataType.includes(item.date))
          .map((item) => item.date),
      );
      return;
    }

    if (quickSelectType) {
      setDataType(resolveQuickSelect(dateList, mode, quickSelectType));
    }
  }


  function handleQuickSelect(value: number) {
    setQuickSelectType(value);

    if (!value) {
      setDataType([]);
      return;
    }

    setDataType(resolveQuickSelect(dateList, onlyTradingDay, value));
  }


  function resetSelection() {
    setDataType([]);
    setQuickSelectType(0);
  }


  function clearFeature() {
    setFeature("");
    setUserPrompt("");
    setParsedLabel("");
    setParseError("");
  }


  function parsePrompt() {
    if (!userPrompt.trim()) {
      clearFeature();
      return;
    }

    const result = parseUserPrompt(userPrompt, dataType);

    if (result.feature) {
      setFeature(result.feature);
      setParsedLabel(result.label);
      setParseError(result.error || "");
      return;
    }

    setFeature("");
    setParsedLabel("");
    setParseError(result.error || "解析失败");
  }


  function applyQuickFeature(item: SearchOption) {
    if (feature === item.value) {
      clearFeature();
      return;
    }

    setFeature(item.value);
    setParsedLabel(item.label);
    setUserPrompt(item.label);
    setParseError("");
  }


  function toggleStockSort(key: string) {
    setStockTableSort((previous) => {
      if (!previous || previous.key !== key) {
        return {
          key,
          direction: "asc",
        };
      }

      if (previous.direction === "asc") {
        return {
          key,
          direction: "desc",
        };
      }

      return null;
    });
  }


  // 调度一次远程查询建议请求，统一 debounce + 空值清空逻辑。
  function scheduleQuerySuggestion(value: string) {
    if (queryInputTimerRef.current) {
      window.clearTimeout(queryInputTimerRef.current);
    }

    if (!value.trim()) {
      setQuerySuggestions([]);
      setQuerySuggestionActiveIndex(0);
      setShowQuerySuggestionMenu(false);
      return;
    }

    queryInputTimerRef.current = window.setTimeout(() => {
      void fetchQuerySuggestions(value);
    }, 500);
  }


  function handleQueryInput(value: string) {
    // ① 任何时候都先把输入值同步到 state，保证 UI 展示与原生 textarea 一致。
    setQueryCondition(value);

    // ② 处于拼音合成中（IME composing）时只更新值，不触发远程，等 compositionEnd 后再请求。
    if (isQueryComposingRef.current) {
      return;
    }

    scheduleQuerySuggestion(value);
  }


  function handleQueryCompositionStart() {
    isQueryComposingRef.current = true;
  }


  function handleQueryCompositionEnd(
    event: React.CompositionEvent<HTMLTextAreaElement>,
  ) {
    isQueryComposingRef.current = false;
    // 取最终落字后的完整文本调度一次远程；debounce 会自动覆盖紧随其后的同值 onChange，避免重复请求。
    scheduleQuerySuggestion(event.currentTarget.value);
  }


  async function fetchQuerySuggestions(query: string) {
    try {
      const response = await proxyRequest<{
        code?: string;
        data?: {
          matchQuery?: QuerySuggestion[];
        };
      }>({
        url: "https://query-suggestion.eastmoney.com/search/stock/querySuggest",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        data: {
          query,
          limit: 5,
          clientType: "RN",
          clientVersion: "10036000",
          client: "cfw",
          uid: "9655085394568108",
          euid: "5B8199F4-0462-42AB-8310-38947E9B8C2A",
          sessionId: "3070844537738192",
        },
      });

      if (queryConditionRef.current.trim() !== query.trim()) {
        return;
      }

      // 建议菜单的更新标记为非紧急（transition），让用户击键引起的输入框/光标更新优先渲染，避免删字时卡顿。
      if (response?.code === "00000" && response.data?.matchQuery) {
        const matchQuery = response.data.matchQuery;
        startTransition(() => {
          setQuerySuggestions(matchQuery);
          setQuerySuggestionActiveIndex(0);
          setShowQuerySuggestionMenu(matchQuery.length > 0);
        });
        return;
      }

      startTransition(() => {
        setQuerySuggestions([]);
        setQuerySuggestionActiveIndex(0);
        setShowQuerySuggestionMenu(false);
      });
    } catch (error) {
      console.error("获取查询建议失败:", error);
      startTransition(() => {
        setQuerySuggestions([]);
        setQuerySuggestionActiveIndex(0);
        setShowQuerySuggestionMenu(false);
      });
    }
  }


  function handleSelectSuggestion(item: QuerySuggestion) {
    if (!item.suggestQuery) {
      return;
    }

    const begin = Number(item.begin ?? 0);
    const end = Number(item.end ?? queryCondition.length);
    const currentText = queryCondition;
    const nextText =
      currentText.slice(0, begin) + item.suggestQuery + currentText.slice(end);

    setQueryCondition(nextText);
    setQuerySuggestions([]);
    setQuerySuggestionActiveIndex(0);
    setShowQuerySuggestionMenu(false);

    window.setTimeout(() => {
      if (!queryTextareaRef.current) {
        return;
      }

      const cursorPosition = begin + item.suggestQuery.length;
      queryTextareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
      queryTextareaRef.current.focus();
    }, 0);
  }


  async function fetchStockOptions(keyword: string) {
    if (!keyword.trim()) {
      setStockSearchOptions([]);
      setShowStockOptionMenu(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    try {
      const response = await proxyRequest<{
        result?: {
          quoteList?: Array<{ code?: string; shortName?: string }>;
        };
        data?: {
          result?: {
            quoteList?: Array<{ code?: string; shortName?: string }>;
          };
        };
      }>({
        url: `https://search-codetable.eastmoney.com/codetable/search/web/wap?label=&keyword=${encodeURIComponent(
          keyword,
        )}&pageIndex=1&pageSize=20&client=wap&clientType=wapSearch&clientVersion=lastest&_=${Date.now()}`,
      });

      if (stockSearchKeywordRef.current.trim() !== keyword.trim()) {
        return;
      }

      const quoteList =
        response?.result?.quoteList || response?.data?.result?.quoteList || [];

      const nextOptions = quoteList
        .map((item) => {
          const code = String(item.code || "").replace(/<\/?em>/g, "");
          const shortName = String(item.shortName || "").replace(/<\/?em>/g, "");

          if (!code || !shortName) {
            return null;
          }

          return {
            label: `${code}:${shortName}`,
            value: `${code}:${shortName}`,
          };
        })
        .filter((item): item is SearchOption => !!item);

      setStockSearchOptions(nextOptions);
      setShowStockOptionMenu(nextOptions.length > 0);
    } catch (error) {
      console.error("搜索股票代码失败:", error);
      setStockSearchOptions([]);
      setShowStockOptionMenu(false);
      pushFeedback("股票搜索失败", "error");
    } finally {
      setSearchLoading(false);
    }
  }


  function handleStockSearchChange(value: string) {
    setStockSearchKeyword(value);

    if (stockSearchTimerRef.current) {
      window.clearTimeout(stockSearchTimerRef.current);
    }

    if (!value.trim()) {
      setStockSearchOptions([]);
      setShowStockOptionMenu(false);
      setSearchLoading(false);
      return;
    }

    stockSearchTimerRef.current = window.setTimeout(() => {
      void fetchStockOptions(value);
    }, 300);
  }


  function handleAddStockCode(value: string) {
    setStockCodes((previous) => {
      if (previous.includes(value)) {
        return previous;
      }

      return [...previous, value];
    });

    setStockSearchKeyword("");
    setStockSearchOptions([]);
    setShowStockOptionMenu(false);
  }


  function handleRemoveStockCode(value: string) {
    setStockCodes((previous) => previous.filter((item) => item !== value));
  }


  async function getGubaCount(code: string, pageGroup = 1) {
    const requestPages = 2;
    const startPage = (pageGroup - 1) * requestPages + 1;
    const endPage = pageGroup * requestPages;
    const responses = await Promise.all(
      Array.from({ length: requestPages }, (_, index) => {
        const page = startPage + index;
        const url = `https://gbapi.eastmoney.com/webarticlelist/api/Article/WebArticleList?code=${code}&p=${page}&ps=100&sorttype=0&plat=wap&version=200&product=guba&deviceid=1`;

        return proxyRequest<{
          re?: Array<{
            post_type?: number;
            post_publish_time?: string;
            post_last_time?: string;
            post_user?: {
              user_id?: string | number;
            };
          }>;
        }>({
          url,
        });
      }),
    );

    return responses.flatMap((response) =>
      (response.re || []).map((item) => ({
        post_type: item.post_type ?? 0,
        post_publish_time: item.post_publish_time || "",
        post_last_time: item.post_last_time || "",
        user_id: String(item.post_user?.user_id ?? ""),
      })),
    );
  }


  async function calcCount(code: string, targetDays: string[]): Promise<GubaMap> {
    const counts: Record<string, { users: Set<string>; count: number }> = {};
    const sortedTargetDays = [...targetDays].sort();

    if (!sortedTargetDays.length) {
      return {};
    }

    let page = 1;

    while (true) {
      const list = await getGubaCount(code, page);
      page += 1;

      if (!list.length) {
        break;
      }

      for (const item of list.filter((current) => ![1, 2, 3, 11].includes(current.post_type))) {
        const postDay = item.post_publish_time.slice(0, 10);
        const postLastDay = item.post_last_time.slice(0, 10);

        if (sortedTargetDays[0] > postLastDay) {
          const result: GubaMap = {};
          Object.entries(counts).forEach(([date, value]) => {
            result[date] = {
              count: value.count,
            };
          });
          return result;
        }

        if (!sortedTargetDays.includes(postDay)) {
          continue;
        }

        counts[postDay] = counts[postDay] || {
          users: new Set<string>(),
          count: 0,
        };

        if (!counts[postDay].users.has(item.user_id)) {
          counts[postDay].users.add(item.user_id);
          counts[postDay].count += 1;
        }
      }

      if (list.length < 100) {
        break;
      }
    }

    const result: GubaMap = {};
    Object.entries(counts).forEach(([date, value]) => {
      result[date] = {
        count: value.count,
      };
    });

    return result;
  }


  function calcTrend(guba: GubaMap, selectedDates: string[]): string {
    const orderedCounts = [...selectedDates].reverse().map((date) => guba[date]?.count || 0);
    const result = mannKendall(orderedCounts);
    const zValue = typeof result.Z === "number" ? result.Z : 0;
    let nextTrend = "";

    if (Math.abs(zValue) > 1.65) {
      if (zValue > 0) {
        nextTrend = "上升 ⤴️";
      } else {
        nextTrend = "下降 ⤵️";
      }
    }

    if (result.trend === "increasing") {
      nextTrend = "严格上升 ↗️";
    } else if (result.trend === "decreasing") {
      nextTrend = "严格下降 ↘️";
    }

    return nextTrend;
  }


  async function submitForm(nextStockCodes = stockCodes, nextDates = dataType) {
    if (nextDates.length === 0) {
      pushFeedback("请选择日期", "error");
      return;
    }

    if (nextStockCodes.length === 0) {
      pushFeedback("请选择股票", "error");
      return;
    }

    if (isFetching) {
      return;
    }

    setIsFetching(true);
    setTableData([]);
    setResultDates(nextDates);

    try {
      // ① 与 Vue 版 this.tableData.push(...) 保持一致：每只股票计算完即追加，UI 实时刷新。
      await runWithConcurrency(
        nextStockCodes,
        async (target) => {
          const [code, ...nameParts] = target.split(":");
          const name = nameParts.join(":") || code;
          const guba = await calcCount(code, nextDates);
          const row: ResultRow = {
            stockName: name,
            code,
            guba,
            trend: calcTrend(guba, nextDates),
          };

          // ② 通过函数式 setState 追加，避免并发场景下相互覆盖。
          setTableData((previous) => [...previous, row]);
        },
        5,
      );

      pushFeedback("帖子统计查询完成", "success");
    } catch (error) {
      console.error("帖子统计查询失败:", error);
      pushFeedback("查询失败", "error");
    } finally {
      setIsFetching(false);
    }
  }


  async function submitStockCondition() {
    const trimmedCondition = queryCondition.trim();

    if (!trimmedCondition) {
      pushFeedback("请输入查询条件", "error");
      return;
    }

    if (isFetchingStockCondition) {
      return;
    }

    setIsFetchingStockCondition(true);
    setStockList([]);
    setTableColumns([]);
    setStockTableSort(null);

    try {
      const timestamp = Date.now().toString();
      const requestId = `VYsjvvfYWNTswnfYcCjA1SHvg7jPbk0P${timestamp}`;

      const requestData = {
        ownSelectAll: false,
        keyWord: trimmedCondition,
        pageSize: 1000,
        pageNo: 1,
        fingerprint: "58e0cB8199F4-0462-42AB-8310-38947E9B8C21679A",
        gids: [],
        timestamp,
        requestId,
        shareToGuba: false,
        removedConditionIdList: [],
        xcId: "xc0decef7f3f07010675",
        sortName: "",
        sortWay: "",
        needCorrect: true,
        dxInfo: [],
        needShowStockNum: false,
        customData: JSON.stringify([
          {
            type: "text",
            value: trimmedCondition,
            extra: "",
          },
        ]),
        client: "",
        product: "",
      };

      const response = await proxyRequest<{
        code?: string;
        msg?: string;
        data?: {
          result?: {
            columns?: RawStockColumn[];
            dataList?: StockRow[];
          };
        };
      }>({
        url: "https://np-tjxg-app-b.eastmoney.com/api/smart-tag/stock/v3/rn/search-code",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        data: requestData,
      });

      const result = response?.data?.result;

      if (response?.code !== "100" || !result) {
        pushFeedback(response?.msg || "查询失败", "error");
        return;
      }

      const nextColumns = (result.columns || [])
        .filter((column) => !column.hiddenNeed && !HIDDEN_COLUMNS[column.key])
        .map((column) => {
          const title = column.title || "";
          const nextColumn: StockColumn = {
            key: column.key,
            title,
            minWidth: title.length * 15 + 40,
            sortable: column.sortable || false,
            redGreenAble: column.redGreenAble || false,
            dataType: column.dataType,
            unit: column.unit || "",
            dateMsg: column.dateMsg || "",
          };

          if (column.children?.length) {
            nextColumn.children = (column.children as RawStockColumn[])
              .filter((child) => !child.hiddenNeed && !HIDDEN_COLUMNS[child.key])
              .map((child) => ({
                key: child.key,
                title: child.title || "",
                dateMsg: child.dateMsg || "",
                sortable: child.sortable || false,
                redGreenAble: child.redGreenAble || false,
                dataType: child.dataType,
                unit: child.unit || "",
              }));
          }

          return nextColumn;
        });

      const nextStockList = result.dataList || [];
      setTableColumns(nextColumns);
      setStockList(nextStockList);

      if (!nextStockList.length) {
        pushFeedback("未查询到数据", "info");
        return;
      }

      const nextStockCodes = nextStockList
        .filter((item) => item.SECURITY_CODE && item.SECURITY_SHORT_NAME)
        .map((item) => `${item.SECURITY_CODE}:${item.SECURITY_SHORT_NAME}`);

      setStockCodes(nextStockCodes);
      saveQueryHistory(trimmedCondition);
      pushFeedback(`条件选股完成，共 ${nextStockList.length} 条`, "success");

      if (dataType.length > 0 && nextStockCodes.length > 0) {
        await submitForm(nextStockCodes, dataType);
      }
    } catch (error) {
      console.error("条件选股查询失败:", error);
      pushFeedback("查询失败", "error");
    } finally {
      setIsFetchingStockCondition(false);
    }
  }


  const barChartDates = useMemo(
    () => (resultDates.length > 0 ? resultDates : dataType),
    [resultDates, dataType],
  );

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7fafc_0%,#eef4ff_42%,#f8fafc_100%)] px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fbff_0%,#eef4ff_100%)] px-5 py-5 sm:px-6">
            <div className="text-center text-2xl font-semibold tracking-[0.08em] text-slate-900">
              条件选股
            </div>
            <div className="mt-2 text-center text-sm text-slate-500">
              从 Vue 页面迁移而来的 React 版查询工作台
            </div>
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-6">
            {feedback ? (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  feedback.type === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : feedback.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-sky-200 bg-sky-50 text-sky-700"
                }`}
              >
                {feedback.text}
              </div>
            ) : null}

            <div className="space-y-3">
              <Popover
                open={showQuerySuggestionMenu && querySuggestions.length > 0}
                onOpenChange={(open) => {
                  if (!open) {
                    setShowQuerySuggestionMenu(false);
                  }
                }}
              >
                <PopoverAnchor asChild>
                  <Textarea
                    ref={queryTextareaRef}
                    placeholder="请输入内容"
                    minRows={2}
                    maxRows={8}
                    value={queryCondition}
                    onChange={(event) => handleQueryInput(event.target.value)}
                    onCompositionStart={handleQueryCompositionStart}
                    onCompositionEnd={handleQueryCompositionEnd}
                    onFocus={() => {
                      if (querySuggestions.length > 0) {
                        setShowQuerySuggestionMenu(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      // IME 合成中的回车/方向键属于输入法选词，交由系统处理，不拦截到建议菜单。
                      if (isQueryComposingRef.current || event.nativeEvent.isComposing) {
                        return;
                      }

                      if (!showQuerySuggestionMenu || querySuggestions.length === 0) {
                        return;
                      }

                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setQuerySuggestionActiveIndex(
                          (previous) => (previous + 1) % querySuggestions.length,
                        );
                        return;
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setQuerySuggestionActiveIndex(
                          (previous) =>
                            (previous - 1 + querySuggestions.length) %
                            querySuggestions.length,
                        );
                        return;
                      }

                      if (event.key === "Enter") {
                        const target =
                          querySuggestions[querySuggestionActiveIndex] ??
                          querySuggestions[0];
                        if (target) {
                          event.preventDefault();
                          handleSelectSuggestion(target);
                        }
                        return;
                      }

                      if (event.key === "Escape") {
                        event.preventDefault();
                        setShowQuerySuggestionMenu(false);
                      }
                    }}
                  />
                </PopoverAnchor>

                <PopoverContent
                  align="start"
                  sideOffset={8}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {querySuggestions.map((item, index) => (
                    <button
                      key={`${item.suggestQuery}-${index}`}
                      type="button"
                      className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                        index === querySuggestionActiveIndex
                          ? "bg-sky-50 text-sky-700"
                          : "text-slate-700 hover:bg-sky-50"
                      }`}
                      onMouseEnter={() => setQuerySuggestionActiveIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSelectSuggestion(item);
                      }}
                    >
                      {item.suggestQuery}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-sky-600 px-5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
                  onClick={() => void submitStockCondition()}
                  disabled={isFetchingStockCondition}
                >
                  {isFetchingStockCondition ? "查询中..." : "查询"}
                </button>

                <div className="text-sm text-slate-500">
                  当前已加载 {stockCodes.length} 只股票
                </div>
              </div>
            </div>

            {queryHistory.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  历史查询
                </div>
                <div className="flex flex-wrap gap-2">
                  {queryHistory.map((item, index) => (
                    <div
                      key={`${item}-${index}`}
                      className="flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
                    >
                      <button
                        type="button"
                        className="text-left transition hover:text-sky-700"
                        onClick={() => setQueryCondition(item)}
                      >
                        {item}
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 transition hover:text-rose-500"
                        onClick={() =>
                          setQueryHistory((previous) =>
                            previous.filter((_, currentIndex) => currentIndex !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {tableColumns.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="max-h-[32rem] overflow-auto">
                  <table className="min-w-full border-collapse text-center text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        <th
                          rowSpan={hasGroupedHeader ? 2 : 1}
                          className="border border-slate-200 px-3 py-2 font-semibold"
                        >
                          <div>序号</div>
                          <div className="text-xs font-normal text-slate-500">
                            {visibleStockList.length}
                          </div>
                        </th>
                        <th
                          rowSpan={hasGroupedHeader ? 2 : 1}
                          className="border border-slate-200 px-3 py-2 font-semibold"
                        >
                          股票
                        </th>
                        {tableColumns.map((column) => {
                          const hasChildren = !!column.children?.length;

                          if (hasChildren) {
                            return (
                              <th
                                key={`group-${column.key}`}
                                colSpan={column.children?.length}
                                className="border border-slate-200 px-3 py-2 font-semibold"
                              >
                                {column.title}
                              </th>
                            );
                          }

                          return (
                            <th
                              key={`single-${column.key}`}
                              rowSpan={hasGroupedHeader ? 2 : 1}
                              className="border border-slate-200 px-3 py-2 font-semibold"
                              style={{ minWidth: column.minWidth }}
                            >
                              <button
                                type="button"
                                className={`flex w-full flex-col items-center ${
                                  column.sortable ? "cursor-pointer" : "cursor-default"
                                }`}
                                onClick={() => {
                                  if (column.sortable) {
                                    toggleStockSort(column.key);
                                  }
                                }}
                              >
                                <span>{column.title}</span>
                                {column.dateMsg ? (
                                  <span className="text-xs font-normal text-slate-500">
                                    {column.dateMsg}
                                  </span>
                                ) : null}
                                {stockTableSort?.key === column.key ? (
                                  <span className="text-xs text-sky-600">
                                    {stockTableSort.direction === "asc" ? "↑" : "↓"}
                                  </span>
                                ) : null}
                              </button>
                            </th>
                          );
                        })}
                      </tr>

                      {hasGroupedHeader ? (
                        <tr>
                          {tableColumns.map((column) =>
                            column.children?.map((child) => (
                              <th
                                key={`child-${child.key}`}
                                className="border border-slate-200 px-3 py-2 font-semibold"
                                style={{ minWidth: child.minWidth || 100 }}
                              >
                                <button
                                  type="button"
                                  className={`flex w-full flex-col items-center ${
                                    child.sortable ? "cursor-pointer" : "cursor-default"
                                  }`}
                                  onClick={() => {
                                    if (child.sortable) {
                                      toggleStockSort(child.key);
                                    }
                                  }}
                                >
                                  <span>{child.dateMsg || child.title}</span>
                                  {stockTableSort?.key === child.key ? (
                                    <span className="text-xs text-sky-600">
                                      {stockTableSort.direction === "asc" ? "↑" : "↓"}
                                    </span>
                                  ) : null}
                                </button>
                              </th>
                            )),
                          )}
                        </tr>
                      ) : null}
                    </thead>

                    <tbody className="bg-white text-slate-700">
                      {visibleStockList.map((row, index) => (
                        <tr key={`${row.SECURITY_CODE || index}`} className="odd:bg-white even:bg-slate-50/60">
                          <td className="border border-slate-200 px-3 py-3">{index + 1}</td>
                          <td className="border border-slate-200 px-3 py-3">
                            <div className="font-semibold text-slate-900">
                              {row.SECURITY_SHORT_NAME || "-"}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.SECURITY_CODE || "-"}
                            </div>
                          </td>
                          {tableColumns.map((column) => {
                            if (column.children?.length) {
                              return column.children.map((child) => (
                                <td
                                  key={`${row.SECURITY_CODE || index}-${child.key}`}
                                  className="border border-slate-200 px-3 py-3"
                                >
                                  <span className={getCellClass(child, row[child.key])}>
                                    {formatCellValue(row[child.key], child)}
                                  </span>
                                </td>
                              ));
                            }

                            return (
                              <td
                                key={`${row.SECURITY_CODE || index}-${column.key}`}
                                className="border border-slate-200 px-3 py-3"
                              >
                                <span className={getCellClass(column, row[column.key])}>
                                  {formatCellValue(row[column.key], column)}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">股票列表</div>

              {stockCodes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {stockCodes.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        className="text-slate-400 transition hover:text-rose-500"
                        onClick={() => handleRemoveStockCode(item)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="relative">
                <input
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                  placeholder="代码或名称"
                  value={stockSearchKeyword}
                  onChange={(event) => handleStockSearchChange(event.target.value)}
                  onFocus={() => {
                    if (stockSearchOptions.length > 0) {
                      setShowStockOptionMenu(true);
                    }
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setShowStockOptionMenu(false);
                    }, 120);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && stockSearchOptions[0]) {
                      event.preventDefault();
                      handleAddStockCode(stockSearchOptions[0].value);
                    }
                  }}
                />

                {searchLoading ? (
                  <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    搜索中...
                  </div>
                ) : null}

                {showStockOptionMenu && stockSearchOptions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    {stockSearchOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-sky-50"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleAddStockCode(item.value);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    checked={onlyTradingDay === 1}
                    onChange={() => handleTradingDayModeChange(1)}
                  />
                  只显示交易日
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    checked={onlyTradingDay === 2}
                    onChange={() => handleTradingDayModeChange(2)}
                  />
                  显示全部日期
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                {visibleDateList.map((item) => (
                  <label
                    key={item.date}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border border-white bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
                  >
                    <input
                      type="checkbox"
                      checked={dataType.includes(item.date)}
                      onChange={() => handleDateToggle(item.date)}
                    />
                    <span>{item.date}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[3, 5, 7, 10].map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    quickSelectType === item
                      ? "border-sky-600 bg-sky-600 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700"
                  }`}
                  onClick={() => handleQuickSelect(item)}
                >
                  近{item}个交易日
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                onClick={resetSelection}
              >
                重置
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={() => void submitForm()}
                disabled={isFetching}
              >
                {isFetching ? "查询中..." : "查询帖子"}
              </button>
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                <div className="flex items-center gap-2 text-sm text-slate-700 lg:w-44">
                  <span>趋势:</span>
                  <select
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    value={trend}
                    onChange={(event) => setTrend(event.target.value)}
                  >
                    <option value="">全部</option>
                    <option value="上升">上升 ⤴️</option>
                    <option value="下降">下降 ⤵️</option>
                    <option value="严格上升">严格上升 ↗️</option>
                    <option value="严格下降">严格下降 ↘️</option>
                  </select>
                </div>

                <div className="flex-1 space-y-3">
                  <div className="text-sm text-slate-700">特征:</div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <textarea
                      className="min-h-24 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                      placeholder="示例：9号比6号多 | 今天比6日的一半多 | 9号比6号和5号加起来都多 | 9号比6号和5号都多 | 今天比最近3天的平均多 | 第1个比第2个少 | 九号比六号多"
                      value={userPrompt}
                      onChange={(event) => setUserPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          parsePrompt();
                        }
                      }}
                    />
                    <div className="flex gap-2 sm:flex-col">
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-700"
                        onClick={parsePrompt}
                      >
                        解析
                      </button>
                      {feature ? (
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                          onClick={clearFeature}
                        >
                          清除
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {parsedLabel ? (
                    <div className="text-xs text-emerald-600">已应用: {parsedLabel}</div>
                  ) : null}
                  {parseError ? (
                    <div className="text-xs text-amber-600">{parseError}</div>
                  ) : null}

                  {featureOptions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {featureOptions.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          className={`rounded-full border px-3 py-1.5 text-xs transition ${
                            feature === item.value
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"
                          }`}
                          onClick={() => applyQuickFeature(item)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-center text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border border-slate-200 px-3 py-3 font-semibold">名称</th>
                      <th className="border border-slate-200 px-3 py-3 font-semibold">帖子</th>
                      <th className="border border-slate-200 px-3 py-3 font-semibold">特征</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white text-slate-700">
                    {filteredTableData.length > 0 ? (
                      filteredTableData.map((item) => (
                        <tr key={item.code} className="odd:bg-white even:bg-slate-50/60">
                          <td className="border border-slate-200 px-3 py-3">
                            <div>{item.stockName}</div>
                            <div className="text-xs text-slate-500">{item.code}</div>
                          </td>
                          <td className="border border-slate-200 px-3 py-3">
                            <div className="space-y-2 text-left">
                              {barChartDates.map((date) => {
                                const count = item.guba[date]?.count || 0;
                                return (
                                  <div key={`${item.code}-${date}`} className="flex items-center gap-3">
                                    <div className="w-24 shrink-0 text-xs text-slate-500">{date}</div>
                                    <div className="h-7 flex-1 overflow-hidden rounded-full bg-slate-100">
                                      <div
                                        className="flex h-full items-center rounded-full bg-[linear-gradient(90deg,#38bdf8_0%,#2563eb_100%)] px-3 text-xs font-medium text-white"
                                        style={{
                                          width: `${getBarWidth(count, item.guba)}%`,
                                        }}
                                      >
                                        {count}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="border border-slate-200 px-3 py-3 font-medium text-slate-900">
                            {item.trend || "-"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={3}
                          className="border border-slate-200 px-3 py-10 text-sm text-slate-500"
                        >
                          暂无数据，先执行条件选股或帖子查询。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
