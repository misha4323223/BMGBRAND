/**
 * YDB persistence for the "AI Questions → FAQ" pipeline.
 *
 * Standalone by design: lives outside the huge DatabaseStorage class so the
 * class file never has to grow. Reuses the same driver and the same
 * safeQuery/extractTypedValue patterns as server/storage.ts.
 */
import { driver, isAuthError, reconnectYdb } from "./db";
import { logError } from "./logger";
import ydb from "ydb-sdk";

export interface AiQuestionRow {
  question: string;
  originalText: string;
  count: number;
  firstAsked: number;
  lastAsked: number;
  draftAnswer: string;
  status: string;
}

async function safeQuery<T>(
  fn: (session: ydb.Session) => Promise<T>,
  maxRetries: number = 3
): Promise<T | null> {
  if (!driver) return null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await driver.tableClient.withSession(fn);
    } catch (err: any) {
      const errorName = err.constructor?.name || "";
      const isRetryable =
        errorName === "BadSession" ||
        err.message?.includes("Session not found") ||
        err.message?.includes("RESOURCE_EXHAUSTED") ||
        err.message?.includes("Transaction locks invalidated") ||
        err.message?.includes("Aborted");

      if (isAuthError(err)) {
        const reconnected = await reconnectYdb();
        if (reconnected && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
      }

      if (isRetryable && attempt < maxRetries) {
        const delay = err.message?.includes("RESOURCE_EXHAUSTED") ? 1000 * attempt : 200 * attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      logError("[AiQuestions YDB Error]:", err.message || err);
      return null;
    }
  }
  return null;
}

function extractTypedValue(item: any): any {
  if (!item) return null;
  if (item.textValue !== undefined && item.textValue !== null) return item.textValue;
  if (item.doubleValue !== undefined && item.doubleValue !== null) return item.doubleValue;
  if (item.floatValue !== undefined && item.floatValue !== null) return item.floatValue;
  if (item.uint64Value !== undefined && item.uint64Value !== null) {
    const val = Number(item.uint64Value);
    if (val > 946684800000000) return new Date(val / 1000).toISOString(); // YDB Timestamp
    return val;
  }
  if (item.int64Value !== undefined && item.int64Value !== null) return item.int64Value;
  if (item.uint32Value !== undefined && item.uint32Value !== null) {
    const val = Number(item.uint32Value);
    if (val > 946684800) return new Date(val * 1000).toISOString(); // YDB DATETIME
    return val;
  }
  if (item.int32Value !== undefined && item.int32Value !== null) return item.int32Value;
  if (item.boolValue !== undefined && item.boolValue !== null) return item.boolValue;
  if (item.bytesValue !== undefined && item.bytesValue !== null) return item.bytesValue;
  if (item.optionalValue !== undefined && item.optionalValue !== null) {
    return extractTypedValue(item.optionalValue);
  }
  if (item.nullFlagValue !== undefined) return null;
  if (item.value !== undefined) return item.value;
  return null;
}

export async function migrateAiQuestionsTable(): Promise<{ success: boolean; message: string }> {
  if (!driver) return { success: false, message: "YDB driver not initialized — migration skipped" };
  try {
    await driver.tableClient.withSession(async (session: ydb.Session) => {
      await session.createTable(
        "ai_questions",
        new ydb.TableDescription()
          .withColumn(new ydb.Column("question", ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column("original_text", ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column("count", ydb.Types.optional(ydb.Types.UINT64)))
          .withColumn(new ydb.Column("first_asked", ydb.Types.optional(ydb.Types.INT64)))
          .withColumn(new ydb.Column("last_asked", ydb.Types.optional(ydb.Types.INT64)))
          .withColumn(new ydb.Column("draft_answer", ydb.Types.optional(ydb.Types.UTF8)))
          .withColumn(new ydb.Column("status", ydb.Types.optional(ydb.Types.UTF8)))
          .withPrimaryKey("question")
      );
    });
    return { success: true, message: "Table ai_questions created successfully" };
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      return { success: true, message: "Table already exists" };
    }
    logError("[AiQuestions Migration Error]:", err.message);
    return { success: false, message: err.message || String(err) };
  }
}

/** Upsert a question occurrence (increments count, keeps first_asked). */
export async function saveAiQuestion(q: { question: string; originalText: string; askedAt: number }): Promise<void> {
  if (!driver || !q.question) return;
  const { TypedValues } = await import("ydb-sdk");
  await safeQuery(async (session) => {
    const read = await session.executeQuery(
      `
        DECLARE $question AS Utf8;
        SELECT count, first_asked FROM ai_questions WHERE question = $question LIMIT 1;
      `,
      { $question: TypedValues.utf8(q.question) }
    );
    const row = read.resultSets?.[0]?.rows?.[0];
    const prevCount = row ? Number(extractTypedValue(row.items![0]) ?? 0) : 0;
    const prevFirst = row ? Number(extractTypedValue(row.items![1]) ?? q.askedAt) : q.askedAt;

    await session.executeQuery(
      `
        DECLARE $question AS Utf8;
        DECLARE $original_text AS Utf8;
        DECLARE $count AS Uint64;
        DECLARE $first_asked AS Int64;
        DECLARE $last_asked AS Int64;
        DECLARE $draft_answer AS Utf8;
        DECLARE $status AS Utf8;
        UPSERT INTO ai_questions (question, original_text, count, first_asked, last_asked, draft_answer, status)
        VALUES ($question, $original_text, $count, $first_asked, $last_asked, $draft_answer, $status);
      `,
      {
        $question: TypedValues.utf8(q.question),
        $original_text: TypedValues.utf8(q.originalText.slice(0, 300)),
        $count: TypedValues.uint64(prevCount + 1),
        $first_asked: TypedValues.int64(prevFirst),
        $last_asked: TypedValues.int64(q.askedAt),
        $draft_answer: TypedValues.utf8(""),
        $status: TypedValues.utf8(""),
      }
    );
    return true;
  });
}

export async function listAiQuestions(): Promise<AiQuestionRow[]> {
  if (!driver) return [];
  const result = await safeQuery(async (session) => {
    const qr = await session.executeQuery(`
      SELECT question, original_text, count, first_asked, last_asked, draft_answer, status
      FROM ai_questions
      ORDER BY count DESC, last_asked DESC;
    `);
    return qr.resultSets?.[0]?.rows || [];
  });
  if (!result) return [];
  return result.map((row: any) => ({
    question: String(extractTypedValue(row.items![0]) ?? ""),
    originalText: String(extractTypedValue(row.items![1]) ?? ""),
    count: Number(extractTypedValue(row.items![2]) ?? 0),
    firstAsked: Number(extractTypedValue(row.items![3]) ?? 0),
    lastAsked: Number(extractTypedValue(row.items![4]) ?? 0),
    draftAnswer: String(extractTypedValue(row.items![5]) ?? ""),
    status: String(extractTypedValue(row.items![6]) ?? ""),
  }));
}

export async function setAiQuestionDraft(question: string, draftAnswer: string, status: string): Promise<void> {
  if (!driver || !question) return;
  const { TypedValues } = await import("ydb-sdk");
  await safeQuery(async (session) => {
    await session.executeQuery(
      `
        DECLARE $question AS Utf8;
        DECLARE $draft_answer AS Utf8;
        DECLARE $status AS Utf8;
        DECLARE $last_asked AS Int64;
        UPSERT INTO ai_questions (question, draft_answer, status, last_asked)
        VALUES ($question, $draft_answer, $status, $last_asked);
      `,
      {
        $question: TypedValues.utf8(question),
        $draft_answer: TypedValues.utf8((draftAnswer || "").slice(0, 4000)),
        $status: TypedValues.utf8(status || ""),
        $last_asked: TypedValues.int64(Date.now()),
      }
    );
    return true;
  });
}

export async function deleteAiQuestion(question: string): Promise<void> {
  if (!driver || !question) return;
  const { TypedValues } = await import("ydb-sdk");
  await safeQuery(async (session) => {
    await session.executeQuery(
      `
        DECLARE $question AS Utf8;
        DELETE FROM ai_questions WHERE question = $question;
      `,
      { $question: TypedValues.utf8(question) }
    );
    return true;
  });
}

/**
 * Bulk-delete collected questions so the table does not fill with garbage.
 *
 * Criteria are AND-ed; when neither is provided, everything is deleted
 * ("clear all" — admin-only, UI asks for confirmation). Rows are deleted one
 * by one through deleteAiQuestion to reuse the safe path; row counts here are
 * small (tens to a few hundred), so this is not a perf concern.
 */
export async function pruneAiQuestions(criteria: {
  olderThanDays?: number; // delete questions not re-asked for this many days
  maxCount?: number;      // delete questions asked at most this many times
}): Promise<number> {
  if (!driver) return 0;
  const rows = await listAiQuestions();
  if (rows.length === 0) return 0;
  const cutoff = criteria.olderThanDays && criteria.olderThanDays > 0
    ? Date.now() - criteria.olderThanDays * 86400000
    : 0;
  const maxCount = criteria.maxCount && criteria.maxCount > 0 ? criteria.maxCount : Infinity;
  const targets = rows.filter(
    (r) => r.count <= maxCount && (cutoff === 0 || r.lastAsked < cutoff)
  );
  for (const t of targets) {
    await deleteAiQuestion(t.question);
  }
  return targets.length;
}
