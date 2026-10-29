import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { app } = await createApp(config);
await app.listen(config.port);
console.log(`OW-DMS API listening on :${config.port}`);
