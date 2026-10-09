import { createMock } from '../mock/mockUber.js';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
createMock().listen(4000, () => console.log('mock on :4000'));
const cfg = loadConfig();
createApp(cfg).listen(cfg.port, () => console.log(`app on http://localhost:${cfg.port}`));
