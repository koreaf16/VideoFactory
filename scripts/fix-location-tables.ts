import { getConnection, initPool } from '../src/db/connection';

async function main() {
  await initPool();
  const conn = await getConnection();
  try {
    console.log('Adding IMAGE_PATH to location_candidates...');
    await conn.execute('ALTER TABLE location_candidates ADD (image_path VARCHAR2(500))');
    console.log('Adding IMAGE_PATH to location_ref_images...');
    await conn.execute('ALTER TABLE location_ref_images ADD (image_path VARCHAR2(500))');
    await conn.commit();
    console.log('Success!');
  } catch (err: any) {
    if (err.code === 'ORA-01430') {
      console.log('Column already exists.');
    } else {
      console.error('Error:', err);
    }
  } finally {
    await conn.close();
  }
}

main().catch(console.error);
