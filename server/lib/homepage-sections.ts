/**
 * Секции главной страницы: чистые функции для эндпоинта
 * POST /api/admin/products/:id/homepage-section (кнопка в форме товара).
 *
 * Логика вынесена сюда, чтобы её можно было покрыть unit-тестами
 * (server/__tests__/homepage-sections.test.ts) без обращения к YDB.
 */

/** Секция главной, в которую можно закреплять товары. */
export interface HomepageSectionLike {
  type?: string;
  title?: string;
  mode?: string;
  pinnedProductIds?: unknown;
  visible?: unknown;
}

export interface HomepageSectionUpdateInput {
  sectionId: string;
  /** Секция из page_settings/home (undefined — если её нет). */
  section: HomepageSectionLike | undefined | null;
  productId: number;
  /** Товар найден в базе? */
  productExists: boolean;
  /** Товар скрыт (isHidden === true)? */
  productIsHidden?: boolean;
  action: "prepend" | "remove";
}

export interface HomepageSectionUpdateMeta {
  title: string;
  pinnedCount: number;
  position: number | null;
  alreadyFirst: boolean;
  modeWas: "manual" | "auto";
  emptied: boolean;
  /** action === "remove", но товара в секции не было. */
  removed: boolean;
}

export type HomepageSectionUpdateResult =
  | { ok: false; status: 400 | 404; error: string }
  | { ok: true; next: number[]; meta: HomepageSectionUpdateMeta };

/** Секция, куда вообще можно добавлять товары: popular («Новинки») или custom_* с type=custom_hits. */
export function isPinnableSection(sectionId: string, section: HomepageSectionLike): boolean {
  return sectionId === "popular" || section.type === "custom_hits";
}

/** Числовые id из произвольного значения (строки, мусор и нули отбрасываются). */
export function toPinnedIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Название секции для тостов: приоритет — title из настроек. */
export function homepageSectionTitle(sectionId: string, section?: HomepageSectionLike | null): string {
  const title = typeof section?.title === "string" ? section.title.trim() : "";
  if (title) return title;
  return sectionId === "popular" ? "Новинки" : "Хиты продаж";
}

/** Полная проверка и расчёт нового списка закреплённых товаров. */
export function resolveHomepageSectionUpdate(input: HomepageSectionUpdateInput): HomepageSectionUpdateResult {
  const { sectionId, section, productId, productExists, productIsHidden, action } = input;

  if (!Number.isFinite(productId) || productId <= 0) {
    return { ok: false, status: 400, error: "Некорректный ID товара" };
  }
  if (!section) {
    return { ok: false, status: 404, error: `Секция «${sectionId}» не найдена` };
  }
  if (!isPinnableSection(sectionId, section)) {
    return { ok: false, status: 400, error: "В эту секцию нельзя добавлять товары" };
  }
  if (!productExists) {
    return { ok: false, status: 404, error: "Товар не найден" };
  }
  if (action === "prepend" && productIsHidden === true) {
    return { ok: false, status: 400, error: "Товар скрыт — сначала покажите его в каталоге" };
  }

  const current = toPinnedIds(section.pinnedProductIds);
  const base = {
    title: homepageSectionTitle(sectionId, section),
    modeWas: (section.mode === "manual" ? "manual" : "auto") as "manual" | "auto",
  };

  if (action === "remove") {
    const next = current.filter((id) => id !== productId);
    const removed = next.length !== current.length;
    return {
      ok: true,
      next,
      meta: {
        ...base,
        pinnedCount: next.length,
        position: null,
        alreadyFirst: false,
        emptied: next.length === 0,
        removed,
      },
    };
  }

  const next = [productId, ...current.filter((id) => id !== productId)];
  return {
    ok: true,
    next,
    meta: {
      ...base,
      pinnedCount: next.length,
      position: 1,
      alreadyFirst: current[0] === productId,
      emptied: false,
      removed: true,
    },
  };
}

/** Тело ответа эндпоинта для успешного случая. */
export function homepageSectionResponse(
  sectionId: string,
  action: "prepend" | "remove",
  meta: HomepageSectionUpdateMeta,
): Record<string, unknown> {
  return {
    success: true,
    sectionId,
    action,
    title: meta.title,
    pinnedCount: meta.pinnedCount,
    position: meta.position,
    alreadyFirst: meta.alreadyFirst,
    modeWas: meta.modeWas,
    emptied: meta.emptied,
    removed: meta.removed,
    ...(action === "remove" && !meta.removed ? { message: "Товара уже нет в этой секции" } : {}),
  };
}
