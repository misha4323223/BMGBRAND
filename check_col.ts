import * as ydb from 'ydb-sdk';

async function main() {
  const saKeyRaw = process.env.YDB_SA_KEY;
  if (!saKeyRaw) { console.log('No YDB_SA_KEY'); process.exit(1); }
  const saKey = JSON.parse(saKeyRaw);
  const authService = new (ydb as any).IamAuthService({
    iamCredentials: {
      serviceAccountId: saKey.service_account_id,
      accessKeyId: saKey.id,
      privateKey: saKey.private_key,
      iamEndpoint: 'iam.api.cloud.yandex.net:443',
    }
  });
  const driver = new (ydb as any).Driver({ 
    endpoint: process.env.YDB_ENDPOINT, 
    database: process.env.YDB_DATABASE, 
    authService 
  });
  await driver.ready(10000);
  await driver.tableClient.withSession(async (session: any) => {
    const desc = await session.describeTable('products');
    const priceCols = desc.columns?.filter((c: any) => 
      c.name.includes('price') || c.name === 'old_price' || c.name === 'sale_price'
    );
    console.log('PRICE COLS:', JSON.stringify(priceCols, null, 2));
  });
  await driver.destroy();
}
main().catch(console.error);
