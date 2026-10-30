/** Runs once when the server starts: resume bulk generation that a restart or redeploy interrupted. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startCampaignWorker } = await import('./lib/content/campaigns');
  startCampaignWorker();
  const { startWatchSchedule } = await import('./lib/content/watch');
  startWatchSchedule();
}
