import { tick } from './core.mjs';
export default {
  async scheduled(controller, env) {
    const result = await tick(env, controller.scheduledTime);
    console.log(JSON.stringify({ component: 'community-runner', ...result }));
  },
  async fetch() {
    // No public trigger, enrollment, credentials, or state-management API.
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<CommunityRunnerEnv>;
