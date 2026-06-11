import { initYdb } from './server/db.js';
import { storage } from './server/storage.js';

async function main() {
  console.log('[check] YDB_SA_KEY present:', !!process.env.YDB_SA_KEY);
  await initYdb();

  // Получаем все настройки bonus_settings разом
  const all = await (storage as any).getAllBonusSettings() as Record<string, string>;

  const aiKeys = Object.keys(all).filter(k => k.startsWith('ai_'));

  if (aiKeys.length === 0) {
    console.log('\n[result] AI-ключей в YDB не найдено — используются дефолты из кода.');
  } else {
    console.log(`\n[result] Найдено AI-ключей в YDB: ${aiKeys.length}`);
    for (const k of aiKeys) {
      console.log('\n=== ' + k + ' ===');
      console.log(all[k]);
    }
  }

  // Также проверим конкретно промт и промокод
  console.log('\n\n--- Проверка ai_prompt_base напрямую ---');
  const base = await (storage as any).getBonusSetting('ai_prompt_base');
  console.log(base ?? '(не задан — используется дефолт из кода)');

  console.log('\n--- Проверка ai_block_promo напрямую ---');
  const promo = await (storage as any).getBonusSetting('ai_block_promo');
  console.log(promo ?? '(не задан — используется дефолт из кода)');

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
